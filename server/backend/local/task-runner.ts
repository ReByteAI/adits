/**
 * Local TaskRunner. Spawns the executor CLI, writes each stdout JSON line
 * into `frames(prompt_id, seq, data)`, and flips `prompts.status` on exit.
 *
 *   POST /projects/:pid/tasks   →  create()   →  INSERT tasks + INSERT prompts + spawn
 *   POST /tasks/:tid/prompts    →  followup() →  INSERT prompts + flip task running + spawn
 *   GET  /tasks/:tid/content    →  reads prompts + frames from Postgres
 *   GET  /prompts/:pid/stream   →  streamFrames() polls frames + emits done
 *   POST /tasks/:tid/cancel     →  cancel() SIGTERMs running children
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { db } from '../../db.js'
import { env } from '../../env.js'
import type { StreamItem, TaskContent, TaskRunner } from '../task-runner.js'
import { ensureProjectSkillLinks, refreshProjectSkills } from './skills.js'
import { consumeQuestionsFile, deleteQuestionsFile } from './question-form.js'
import type { AskDesignQuestionsPayload } from '../../../packages/shared/ask-design-questions.js'

function displayPrompt(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT_PATH = join(__dirname, '..', '..', '..', 'system.md')
const SYSTEM_PROMPT_TEXT: string = existsSync(SYSTEM_PROMPT_PATH)
  ? readFileSync(SYSTEM_PROMPT_PATH, 'utf8')
  : ''

let promptModelColumnPromise: Promise<boolean> | null = null

function supportsPromptModel(): Promise<boolean> {
  promptModelColumnPromise ??= db.columnExists('prompts', 'model')
  return promptModelColumnPromise
}

function prependSystemPrompt(userPrompt: string): string {
  if (!SYSTEM_PROMPT_TEXT) return userPrompt
  return `## SYSTEM INSTRUCTIONS\n\n${SYSTEM_PROMPT_TEXT}\n\n---\n\n## USER REQUEST\n\n${userPrompt}`
}

/** Per-executor session wiring. See git history for the full rationale; the
 *  local-mode version is unchanged from the previous file. */
type Command = {
  bin: string
  args: string[]
  env?: Record<string, string>
  preassignedSessionId?: string
  captureFromFrames?: boolean
}

function extractSessionIdFromFrame(executor: string, frame: unknown): string | null {
  if (!frame || typeof frame !== 'object') return null
  const f = frame as Record<string, unknown>
  if (executor === 'gemini' && f.type === 'init' && typeof f.session_id === 'string') return f.session_id
  if (executor === 'codex' && f.type === 'thread.started' && typeof f.thread_id === 'string') return f.thread_id
  return null
}

function commandForExecutor(
  executor: string,
  prompt: string,
  resumeSessionId: string | null,
): Command | null {
  switch (executor) {
    case 'claude': {
      const sid = resumeSessionId ?? randomUUID()
      const args = [
        '-p',
        '--permission-mode', 'bypassPermissions',
        '--disallowedTools', 'AskUserQuestion',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        resumeSessionId ? '--resume' : '--session-id', sid,
      ]
      if (SYSTEM_PROMPT_TEXT) args.push('--append-system-prompt-file', SYSTEM_PROMPT_PATH)
      args.push(prompt)
      return { bin: 'claude', args, preassignedSessionId: resumeSessionId ? undefined : sid }
    }
    case 'codex': {
      const base = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json']
      if (resumeSessionId) {
        return { bin: 'codex', args: ['exec', 'resume', '--dangerously-bypass-approvals-and-sandbox', '--json', resumeSessionId, prependSystemPrompt(prompt)] }
      }
      return { bin: 'codex', args: [...base, prependSystemPrompt(prompt)], captureFromFrames: true }
    }
    case 'gemini': {
      const args = ['-p', prependSystemPrompt(prompt), '--yolo', '-o', 'stream-json']
      if (resumeSessionId) args.push('--resume', resumeSessionId)
      return {
        bin: 'gemini',
        args,
        env: { CI: 'true', GEMINI_DISABLE_POLICIES: 'true' },
        captureFromFrames: !resumeSessionId,
      }
    }
    default:
      return null
  }
}

/** promptId → child. cancel() sends SIGTERM via this; the close handler
 *  still runs and flips status. */
const runningChildren = new Map<string, ChildProcess>()

/** Per-prompt seq counter. Frames are written as `(promptId, seq, data)`
 *  with seq ascending from 1. The Map lives only while the producer is
 *  running; reads can ORDER BY seq directly off the table. */
const seqCounter = new Map<string, number>()

async function appendFrame(promptId: string, data: unknown): Promise<void> {
  const next = (seqCounter.get(promptId) ?? 0) + 1
  seqCounter.set(promptId, next)
  await db.run(
    `INSERT INTO frames (prompt_id, seq, data) VALUES ($1, $2, $3::jsonb)`,
    [promptId, next, JSON.stringify(data)],
  )
}

async function runInBackground(taskId: string, projectId: string, prompt: string, promptId: string, executor: string): Promise<void> {
  const cwd = join(env.ADITS_DATA_DIR, 'projects', projectId)
  await ensureProjectSkillLinks(projectId)
  await refreshProjectSkills(projectId)

  const existing = await db.first<{ session_id: string | null; session_executor: string | null }>(
    `SELECT session_id, session_executor FROM tasks WHERE id = $1`,
    [taskId],
  )
  const resumeSessionId = existing?.session_executor === executor ? (existing?.session_id ?? null) : null

  const cmd = commandForExecutor(executor, prompt, resumeSessionId)
  if (!cmd) {
    await appendFrame(promptId, { __adits_error: `Executor '${executor}' is not supported in local mode.` })
    await markPromptTerminal(taskId, promptId, 'failed', null)
    return
  }

  if (cmd.preassignedSessionId) {
    await db.run(
      `UPDATE tasks SET session_id = $1, session_executor = $2 WHERE id = $3`,
      [cmd.preassignedSessionId, executor, taskId],
    )
  } else if (!resumeSessionId) {
    await db.run(
      `UPDATE tasks SET session_id = NULL, session_executor = NULL WHERE id = $1`,
      [taskId],
    )
  }

  const child = spawn(cmd.bin, cmd.args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
  })
  runningChildren.set(promptId, child)

  let lineBuf = ''
  let sessionCaptured = !cmd.captureFromFrames
  child.stdout.on('data', (chunk: Buffer) => {
    lineBuf += chunk.toString('utf8')
    let newline: number
    while ((newline = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, newline)
      lineBuf = lineBuf.slice(newline + 1)
      if (line.length === 0) continue
      let data: unknown
      try { data = JSON.parse(line) } catch { data = { __adits_raw: line } }
      if (!sessionCaptured) {
        const sid = extractSessionIdFromFrame(executor, data)
        if (sid) {
          sessionCaptured = true
          void db.run(
            `UPDATE tasks SET session_id = $1, session_executor = $2 WHERE id = $3 AND session_id IS NULL`,
            [sid, executor, taskId],
          ).catch((e) => { console.warn('[localTaskRunner] session capture failed:', (e as Error).message) })
        }
      }
      void appendFrame(promptId, data).catch((e) => {
        console.warn('[localTaskRunner] appendFrame failed:', (e as Error).message)
      })
    }
  })
  let stderrBuf = ''
  child.stderr.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf8') })

  child.on('error', (e) => {
    const msg = (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? `'${cmd.bin}' not found on PATH. Install the ${executor} CLI and retry.`
      : e.message
    void appendFrame(promptId, { __adits_error: msg })
  })

  child.on('close', async (code, signal) => {
    runningChildren.delete(promptId)
    if (lineBuf.length > 0) {
      let data: unknown
      try { data = JSON.parse(lineBuf) } catch { data = { __adits_raw: lineBuf } }
      try { await appendFrame(promptId, data) } catch { /* */ }
      lineBuf = ''
    }
    if (stderrBuf.trim().length > 0) {
      try { await appendFrame(promptId, { __adits_stderr: stderrBuf.trim() }) } catch { /* */ }
    }

    const status: 'completed' | 'failed' | 'canceled'
      = signal === 'SIGTERM' ? 'canceled'
      : code === 0 ? 'completed'
      : 'failed'

    // `ask-design-questions` skill: pick up `.adits/questions.json` if the
    // turn produced one. Status flip + form_payload write in one UPDATE.
    const formPayload = await consumeQuestionsFile(projectId)
    try {
      await markPromptTerminal(taskId, promptId, status, formPayload)
      if (formPayload) await deleteQuestionsFile(projectId)
    } catch (e) {
      console.error('[localTaskRunner] markPromptTerminal failed:', (e as Error).message)
    }
    seqCounter.delete(promptId)
  })
}

/** Plain status flip — no atomic guard. The producer only fires this once per
 *  prompt (child.on('close') runs once); cancel() fires its own UPDATE in
 *  parallel and the COALESCE-by-WHERE protects against a noisy double-write. */
async function markPromptTerminal(
  taskId: string,
  promptId: string,
  status: 'completed' | 'failed' | 'canceled',
  formPayload: AskDesignQuestionsPayload | null,
): Promise<void> {
  await db.run(
    `UPDATE prompts
        SET status = $1, completed_at = NOW(), form_payload = $3
      WHERE id = $2 AND status = 'running'`,
    [status, promptId, formPayload ? JSON.stringify(formPayload) : null],
  )

  // Mirror onto the task row iff this is the latest prompt — a follow-up
  // already in flight should keep the task in 'running'.
  const later = await db.first<{ c: string }>(
    `SELECT count(*)::text AS c FROM prompts
      WHERE task_id = $1 AND submitted_at > (SELECT submitted_at FROM prompts WHERE id = $2)`,
    [taskId, promptId],
  )
  if ((later?.c ?? '0') === '0') {
    await db.run(
      `UPDATE tasks SET status = $1, completed_at = NOW() WHERE id = $2`,
      [status, taskId],
    )
  }
}

async function loadPromptsForTask(taskId: string): Promise<TaskContent['prompts']> {
  const hasPromptModel = await supportsPromptModel()
  const rows = await db.all<{
    id: string
    prompt: string
    executor: string
    model: string | null
    status: string
    submitted_at: Date
    completed_at: Date | null
    form_payload: AskDesignQuestionsPayload | null
  }>(
    `SELECT id, prompt, executor, ${hasPromptModel ? 'model' : 'NULL::text AS model'}, status, submitted_at, completed_at, form_payload
       FROM prompts WHERE task_id = $1 ORDER BY submitted_at`,
    [taskId],
  )

  // One small SELECT per prompt is fine — chats stay short. If this ever
  // becomes a hot path we can swap in a single query with array_agg.
  const out: TaskContent['prompts'] = []
  for (const r of rows) {
    const frames = await db.all<{ seq: string; data: unknown }>(
      `SELECT seq::text AS seq, data FROM frames WHERE prompt_id = $1 ORDER BY seq`,
      [r.id],
    )
    out.push({
      id: r.id,
      userPrompt: r.prompt,
      executor: r.executor,
      model: r.model,
      status: r.status,
      submittedAt: r.submitted_at.toISOString(),
      completedAt: r.completed_at?.toISOString() ?? null,
      frames: frames.map(f => ({ seq: Number(f.seq), data: f.data })),
      formPayload: r.form_payload ?? null,
    })
  }
  return out
}

/** Sleep but interruptible by an AbortSignal. Resolves early on abort. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const POLL_INTERVAL_MS = 250

export const localTaskRunner: TaskRunner = {
  async create({ userId: _userId, projectId, prompt, extras }) {
    const hasPromptModel = await supportsPromptModel()
    const executor = typeof extras?.executor === 'string' ? extras.executor : 'claude'
    const model = typeof extras?.model === 'string' ? extras.model : null
    const taskId = randomUUID()
    const promptId = randomUUID()
    const submittedAt = new Date().toISOString()

    await db.run(
      `INSERT INTO tasks (id, workspace_id, project_id, prompt, status, last_synced_at)
       VALUES ($1, $2, $2, $3, 'running', NOW())`,
      [taskId, projectId, displayPrompt(prompt)],
    )
    if (hasPromptModel) {
      await db.run(
        `INSERT INTO prompts (id, task_id, prompt, executor, model, status)
         VALUES ($1, $2, $3, $4, $5, 'running')`,
        [promptId, taskId, prompt, executor, model],
      )
    } else {
      await db.run(
        `INSERT INTO prompts (id, task_id, prompt, executor, status)
         VALUES ($1, $2, $3, $4, 'running')`,
        [promptId, taskId, prompt, executor],
      )
    }

    void runInBackground(taskId, projectId, prompt, promptId, executor)

    return {
      id: taskId,
      workspaceId: projectId,
      status: 'running',
      createdAt: submittedAt,
    }
  },

  async get(userId, taskId) {
    const row = await db.first<{ id: string; status: string; prompt: string }>(
      `SELECT t.id, t.status, t.prompt
         FROM tasks t
         JOIN projects p ON p.id = t.project_id AND p.user_id = $1
        WHERE t.id = $2`,
      [userId, taskId],
    )
    if (!row) return null
    return { id: row.id, status: row.status, title: row.prompt }
  },

  async getContent(userId, taskId) {
    const task = await db.first<{ id: string; status: string }>(
      `SELECT t.id, t.status
         FROM tasks t
         JOIN projects p ON p.id = t.project_id AND p.user_id = $1
        WHERE t.id = $2`,
      [userId, taskId],
    )
    if (!task) return null
    const prompts = await loadPromptsForTask(taskId)
    return { id: task.id, status: task.status, prompts }
  },

  async followup({ userId, taskId, prompt, extras }) {
    const hasPromptModel = await supportsPromptModel()
    const executor = typeof extras?.executor === 'string' ? extras.executor : 'claude'
    const model = typeof extras?.model === 'string' ? extras.model : null
    const row = await db.first<{ project_id: string }>(
      `SELECT t.project_id
         FROM tasks t
         JOIN projects p ON p.id = t.project_id AND p.user_id = $1
        WHERE t.id = $2`,
      [userId, taskId],
    )
    if (!row) return null

    const promptId = randomUUID()

    if (hasPromptModel) {
      await db.run(
        `INSERT INTO prompts (id, task_id, prompt, executor, model, status)
         VALUES ($1, $2, $3, $4, $5, 'running')`,
        [promptId, taskId, prompt, executor, model],
      )
    } else {
      await db.run(
        `INSERT INTO prompts (id, task_id, prompt, executor, status)
         VALUES ($1, $2, $3, $4, 'running')`,
        [promptId, taskId, prompt, executor],
      )
    }
    await db.run(
      `UPDATE tasks SET status = 'running', completed_at = NULL WHERE id = $1`,
      [taskId],
    )

    void runInBackground(taskId, row.project_id, prompt, promptId, executor)
    return { promptId }
  },

  async cancel({ userId, taskId }) {
    const rows = await db.all<{ id: string }>(
      `SELECT p.id
         FROM prompts p
         JOIN tasks t ON t.id = p.task_id
         JOIN projects pr ON pr.id = t.project_id AND pr.user_id = $1
        WHERE t.id = $2 AND p.status = 'running'`,
      [userId, taskId],
    )
    if (rows.length === 0) {
      const owned = await db.first(
        `SELECT 1 FROM tasks t
           JOIN projects pr ON pr.id = t.project_id AND pr.user_id = $1
          WHERE t.id = $2`,
        [userId, taskId],
      )
      if (!owned) return null
      return { canceled: 0 }
    }

    let canceled = 0
    for (const { id: promptId } of rows) {
      const child = runningChildren.get(promptId)
      if (child) {
        child.kill('SIGTERM')
        canceled += 1
        // The close handler does the markPromptTerminal write with status='canceled'.
      } else {
        // Stale row — the producer is gone. Flip the row directly.
        await markPromptTerminal(taskId, promptId, 'canceled', null)
        canceled += 1
      }
    }
    return { canceled }
  },

  async *streamFrames({ userId, promptId, fromSeq, signal }): AsyncIterable<StreamItem> {
    // Confirm ownership once. After this, plain SELECTs by promptId are
    // safe — the prompt's id is the secret.
    const owned = await db.first<{ task_id: string; status: string }>(
      `SELECT pr.task_id, pr.status
         FROM prompts pr
         JOIN tasks t ON t.id = pr.task_id
         JOIN projects p ON p.id = t.project_id AND p.user_id = $1
        WHERE pr.id = $2`,
      [userId, promptId],
    )
    if (!owned) return

    let cursor = fromSeq
    while (!signal.aborted) {
      const frames = await db.all<{ seq: string; data: unknown }>(
        `SELECT seq::text AS seq, data
           FROM frames
          WHERE prompt_id = $1 AND seq > $2
          ORDER BY seq
          LIMIT 200`,
        [promptId, cursor],
      )
      for (const f of frames) {
        cursor = Number(f.seq)
        yield { type: 'frame', seq: cursor, data: f.data }
      }

      if (frames.length === 0) {
        // Nothing new this tick — check status. Terminal + no more frames
        // means we're done.
        const cur = await db.first<{ status: string }>(
          `SELECT status FROM prompts WHERE id = $1`,
          [promptId],
        )
        if (!cur) return
        if (cur.status !== 'running' && cur.status !== 'pending') {
          yield { type: 'done', status: cur.status }
          return
        }
      }

      await abortableSleep(POLL_INTERVAL_MS, signal)
    }
  },
}

/** Boot-time recovery sweep. Child processes die with the server — any
 *  prompts left in 'running' after a restart are zombies. Flip them so
 *  the UI stops spinning. Runs once at startup from server/index.ts. */
export async function sweepZombiePromptsOnBoot(): Promise<void> {
  const r1 = await db.run(
    `UPDATE prompts
        SET status = 'failed', completed_at = NOW()
      WHERE status = 'running'`,
  )
  if (!r1.changes) return

  await db.run(
    `UPDATE tasks t
        SET status = latest.status, completed_at = NOW()
       FROM (
         SELECT DISTINCT ON (task_id) task_id, status
           FROM prompts
          ORDER BY task_id, submitted_at DESC
       ) latest
      WHERE t.id = latest.task_id
        AND t.status = 'running'
        AND latest.status != 'running'`,
  )
  console.log(`[localTaskRunner] boot sweep marked ${r1.changes} zombie prompt(s) failed`)
}
