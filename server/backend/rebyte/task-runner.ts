/**
 * Rebyte TaskRunner. Tasks live on the relay; adits keeps a thin local row
 * for the project sidebar and proxies streaming through.
 *
 *   create()       → POST /v1/tasks; learn promptId from /content; INSERT prompts row
 *   followup()     → POST /v1/tasks/:tid/prompts (relay returns promptId)
 *   getContent()   → passthrough relay /v1/tasks/:tid/content?include=events,
 *                    map relay event shape to TaskContent.frames
 *   streamFrames() → open relay /v1/tasks/:tid/events SSE, forward each event
 *                    as a frame, terminate on relay's `done`
 *   cancel()       → POST relay's cancel + abort any in-flight stream pipes
 */

import { db } from '../../db.js'
import { env } from '../../env.js'
import { rebyteFetch, RebyteError, rebyteJSON } from './rebyte.js'
import { requireUserRebyteKey } from './rebyte-auth.js'
import type { CreateTaskResult, StreamItem, TaskContent, TaskRunner } from '../task-runner.js'

async function resolveWorkspace(userId: string, projectId: string): Promise<{ wid: string; key: string } | null> {
  const row = await db.first<{ workspace_id: string; owns_workspace: number; rebyte_api_key: string | null }>(
    `SELECT p.workspace_id, p.owns_workspace, u.rebyte_api_key
     FROM projects p JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [projectId, userId],
  )
  if (!row) return null
  if (!row.owns_workspace) return { wid: row.workspace_id, key: env.REBYTE_API_KEY }
  if (row.rebyte_api_key) return { wid: row.workspace_id, key: row.rebyte_api_key }
  const key = await requireUserRebyteKey(userId)
  return { wid: row.workspace_id, key }
}

async function resolveOwnedTask(userId: string, taskId: string): Promise<{ key: string; projectId: string } | null> {
  const row = await db.first<{ owns_workspace: number; rebyte_api_key: string | null; project_id: string }>(
    `SELECT p.owns_workspace, u.rebyte_api_key, p.id AS project_id
       FROM tasks t
       JOIN projects p ON p.id = t.project_id AND p.user_id = $1
       JOIN users u ON u.id = p.user_id
      WHERE t.id = $2`,
    [userId, taskId],
  )
  if (!row) return null
  const key = row.owns_workspace && row.rebyte_api_key ? row.rebyte_api_key : env.REBYTE_API_KEY
  return { key, projectId: row.project_id }
}

async function resolveOwnedPrompt(userId: string, promptId: string): Promise<{ key: string; taskId: string } | null> {
  const row = await db.first<{ task_id: string; owns_workspace: number; rebyte_api_key: string | null }>(
    `SELECT pr.task_id, p.owns_workspace, u.rebyte_api_key
       FROM prompts pr
       JOIN tasks t ON t.id = pr.task_id
       JOIN projects p ON p.id = t.project_id AND p.user_id = $1
       JOIN users u ON u.id = p.user_id
      WHERE pr.id = $2`,
    [userId, promptId],
  )
  if (!row) return null
  const key = row.owns_workspace && row.rebyte_api_key ? row.rebyte_api_key : env.REBYTE_API_KEY
  return { key, taskId: row.task_id }
}

/** Relay's /content?include=events response shape. We pluck what we need
 *  and ignore the rest; the relay's `events` array becomes our `frames`. */
interface RelayContent {
  id: string
  status: string
  prompts: Array<{
    id: string
    status: string
    userPrompt: string
    submittedAt: string
    completedAt: string | null
    events?: Array<{ seq?: number; [k: string]: unknown }>
  }>
}

interface PromptMeta {
  executor: string
  model: string | null
}

let promptModelColumnPromise: Promise<boolean> | null = null

function supportsPromptModel(): Promise<boolean> {
  promptModelColumnPromise ??= db.columnExists('prompts', 'model')
  return promptModelColumnPromise
}

function normalizeStatus(s: string): string {
  if (s === 'succeeded') return 'completed'
  return s
}

function mapRelayContent(rc: RelayContent, promptMeta: Map<string, PromptMeta>): TaskContent {
  return {
    id: rc.id,
    status: normalizeStatus(rc.status),
    prompts: rc.prompts.map(p => {
      const meta = promptMeta.get(p.id)
      return {
        id: p.id,
        userPrompt: p.userPrompt,
        executor: meta?.executor ?? 'claude',
        model: meta?.model ?? null,
        status: normalizeStatus(p.status),
        submittedAt: p.submittedAt,
        completedAt: p.completedAt,
        frames: (p.events ?? []).map((ev, i) => ({
          seq: typeof ev.seq === 'number' ? ev.seq : i + 1,
          data: ev,
        })),
        formPayload: null,
      }
    }),
  }
}

async function loadPromptMeta(taskId: string): Promise<Map<string, PromptMeta>> {
  const hasPromptModel = await supportsPromptModel()
  const rows = await db.all<{ id: string; executor: string; model: string | null }>(
    `SELECT id, executor, ${hasPromptModel ? 'model' : 'NULL::text AS model'} FROM prompts WHERE task_id = $1`,
    [taskId],
  )
  return new Map(rows.map(row => [row.id, { executor: row.executor, model: row.model }]))
}

export const rebyteTaskRunner: TaskRunner = {
  async create({ userId, projectId, prompt, extras }) {
    const hasPromptModel = await supportsPromptModel()
    const ws = await resolveWorkspace(userId, projectId)
    if (!ws) throw new Error(`Project ${projectId} not found for user ${userId}`)

    const task = await rebyteJSON<{ id: string; status?: string; url?: string }>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ ...(extras ?? {}), prompt, workspaceId: ws.wid }),
      apiKey: ws.key,
    })

    const displayPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 200)
    await db.run(
      `INSERT INTO tasks (id, workspace_id, project_id, prompt, status, url, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [task.id, ws.wid, projectId, displayPrompt, task.status ?? 'running', task.url ?? null],
    )

    // Discover the relay-assigned promptId so adits's per-prompt SSE can
    // find a row to authorize against. One round-trip; the relay creates
    // the prompt row inside the task creation transaction so this is
    // immediate. If the lookup fails we still return the task — the
    // frontend can re-derive from a /content fetch later.
    try {
      const content = await rebyteJSON<RelayContent>(
        `/tasks/${task.id}/content`,
        { apiKey: ws.key },
      )
      const first = content.prompts[0]
      if (first) {
        const executor = typeof extras?.executor === 'string' ? extras.executor : 'claude'
        const model = typeof extras?.model === 'string' ? extras.model : null
        if (hasPromptModel) {
          await db.run(
            `INSERT INTO prompts (id, task_id, prompt, executor, model, status, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [first.id, task.id, prompt, executor, model, first.status ?? 'running'],
          )
        } else {
          await db.run(
            `INSERT INTO prompts (id, task_id, prompt, executor, status, submitted_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [first.id, task.id, prompt, executor, first.status ?? 'running'],
          )
        }
      }
    } catch (err) {
      console.warn(`[rebyteTaskRunner.create] promptId lookup failed for ${task.id}:`, (err as Error).message)
    }

    const result: CreateTaskResult = { id: task.id, status: task.status, url: task.url, workspaceId: ws.wid }
    return result
  },

  async get(userId, taskId) {
    const owned = await resolveOwnedTask(userId, taskId)
    if (!owned) return null
    try {
      const task = await rebyteJSON<{ id: string; status?: string; title?: string }>(`/tasks/${taskId}`, { apiKey: owned.key })
      return { id: task.id, status: task.status ?? 'running', title: task.title }
    } catch (err) {
      if (err instanceof RebyteError && err.status === 404) return null
      throw err
    }
  },

  async getContent(userId, taskId) {
    const hasPromptModel = await supportsPromptModel()
    const owned = await resolveOwnedTask(userId, taskId)
    if (!owned) return null
    try {
      const rc = await rebyteJSON<RelayContent>(
        `/tasks/${taskId}/content?include=events`,
        { apiKey: owned.key },
      )
      const promptMeta = await loadPromptMeta(taskId)
      const content = mapRelayContent(rc, promptMeta)

      // Mirror prompts onto adits' table so the per-prompt SSE has a row
      // to authorize against. Idempotent — repeated /content reads just
      // upsert. Don't store frames here; streaming reads fresh from relay.
      for (const p of content.prompts) {
        if (hasPromptModel) {
          await db.run(
            `INSERT INTO prompts (id, task_id, prompt, executor, model, status, submitted_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()), $8::timestamptz)
             ON CONFLICT (id) DO UPDATE
               SET status = EXCLUDED.status,
                   completed_at = EXCLUDED.completed_at`,
            [p.id, taskId, p.userPrompt, p.executor, p.model, p.status, p.submittedAt, p.completedAt],
          )
        } else {
          await db.run(
            `INSERT INTO prompts (id, task_id, prompt, executor, status, submitted_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7::timestamptz)
             ON CONFLICT (id) DO UPDATE
               SET status = EXCLUDED.status,
                   completed_at = EXCLUDED.completed_at`,
            [p.id, taskId, p.userPrompt, p.executor, p.status, p.submittedAt, p.completedAt],
          )
        }
      }
      return content
    } catch (err) {
      if (err instanceof RebyteError && err.status === 404) return null
      throw err
    }
  },

  async followup({ userId, taskId, prompt, extras }) {
    const hasPromptModel = await supportsPromptModel()
    const owned = await resolveOwnedTask(userId, taskId)
    if (!owned) return null
    try {
      const result = await rebyteJSON<{ promptId: string }>(`/tasks/${taskId}/prompts`, {
        method: 'POST',
        body: JSON.stringify({ ...(extras ?? {}), prompt }),
        apiKey: owned.key,
      })

      const executor = typeof extras?.executor === 'string' ? extras.executor : 'claude'
      const model = typeof extras?.model === 'string' ? extras.model : null
      if (hasPromptModel) {
        await db.run(
          `INSERT INTO prompts (id, task_id, prompt, executor, model, status, submitted_at)
           VALUES ($1, $2, $3, $4, $5, 'running', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [result.promptId, taskId, prompt, executor, model],
        )
      } else {
        await db.run(
          `INSERT INTO prompts (id, task_id, prompt, executor, status, submitted_at)
           VALUES ($1, $2, $3, $4, 'running', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [result.promptId, taskId, prompt, executor],
        )
      }
      await db.run(
        `UPDATE tasks SET status = 'running', completed_at = NULL WHERE id = $1`,
        [taskId],
      )
      return result
    } catch (err) {
      if (err instanceof RebyteError && err.status === 404) return null
      throw err
    }
  },

  async cancel({ userId, taskId }) {
    const owned = await resolveOwnedTask(userId, taskId)
    if (!owned) return null
    try {
      await rebyteJSON(`/tasks/${taskId}/cancel`, { method: 'POST', apiKey: owned.key })
    } catch (err) {
      if (err instanceof RebyteError && err.status === 404) return null
      console.warn(`[rebyteTaskRunner.cancel] upstream cancel failed for ${taskId}:`, (err as Error).message)
    }
    // Abort any in-flight stream pipes (see streamFrames below).
    abortStreamPipesForTask(taskId)
    const result = await db.run(
      `UPDATE tasks SET status = 'canceled', completed_at = COALESCE(completed_at, NOW())
         WHERE id = $1 AND status != 'canceled'`,
      [taskId],
    )
    await db.run(
      `UPDATE prompts SET status = 'canceled', completed_at = COALESCE(completed_at, NOW())
         WHERE task_id = $1 AND status = 'running'`,
      [taskId],
    )
    return { canceled: result.changes }
  },

  async *streamFrames({ userId, promptId, fromSeq, signal }): AsyncIterable<StreamItem> {
    const owned = await resolveOwnedPrompt(userId, promptId)
    if (!owned) return

    // Open the relay's task-events SSE. The relay always streams the
    // *latest* prompt for the task (it ignores promptId), which is the
    // common case here (we open the stream as soon as the user sends).
    // If the prompt being viewed is no longer the latest, the relay
    // stream will be a different prompt's events and we just close
    // immediately on the first `done` — frontend will refetch /content.
    const ctrl = new AbortController()
    const inner = ctrl
    const onAbort = () => inner.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    registerStreamPipe(owned.taskId, inner)

    try {
      const res = await rebyteFetch(
        `/tasks/${owned.taskId}/events`,
        { apiKey: owned.key, signal: inner.signal },
      )
      if (!res.ok || !res.body) {
        console.warn(`[rebyteTaskRunner.streamFrames] relay events open failed: ${res.status}`)
        // Final-status fallback: if the prompt is already terminal in our
        // DB, emit done so the client can stop spinning.
        const cur = await db.first<{ status: string }>(
          `SELECT status FROM prompts WHERE id = $1`,
          [promptId],
        )
        if (cur && cur.status !== 'running' && cur.status !== 'pending') {
          yield { type: 'done', status: cur.status }
        }
        return
      }

      let seqCursor = fromSeq
      for await (const ev of parseRelaySSE(res.body, inner.signal)) {
        if (ev.event === 'event') {
          const data = ev.data
          // Relay events carry a `seq` field per `streamTaskEvents`'s
          // upstream contract. Honor it; fall back to a monotonic counter.
          const seq = (data && typeof data === 'object' && typeof (data as any).seq === 'number')
            ? (data as any).seq as number
            : seqCursor + 1
          if (seq <= fromSeq) continue
          seqCursor = seq
          yield { type: 'frame', seq, data }
        } else if (ev.event === 'done') {
          const status = (ev.data && typeof ev.data === 'object' && typeof (ev.data as any).status === 'string')
            ? mapRelayDoneStatus((ev.data as any).status)
            : 'completed'
          // Mirror the terminal status onto our prompt row so subsequent
          // /content reads reflect it immediately.
          await db.run(
            `UPDATE prompts SET status = $1, completed_at = NOW()
               WHERE id = $2 AND status = 'running'`,
            [status, promptId],
          ).catch(() => { /* non-fatal */ })
          yield { type: 'done', status }
          return
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      console.warn(`[rebyteTaskRunner.streamFrames] relay pipe error:`, (err as Error).message)
    } finally {
      signal.removeEventListener('abort', onAbort)
      unregisterStreamPipe(owned.taskId, inner)
    }
  },
}

function mapRelayDoneStatus(s: string): string {
  if (s === 'succeeded') return 'completed'
  if (s === 'failed' || s === 'canceled' || s === 'completed') return s
  return 'failed'
}

// ─── Per-task in-flight stream-pipe registry ───
//
// Used by cancel() to abort any open relay events SSE for the task. One
// task can have multiple readers in theory (multi-tab); we register each
// AbortController separately and abort all of them on cancel.

const streamPipes = new Map<string, Set<AbortController>>()

function registerStreamPipe(taskId: string, ctrl: AbortController): void {
  let set = streamPipes.get(taskId)
  if (!set) {
    set = new Set()
    streamPipes.set(taskId, set)
  }
  set.add(ctrl)
}

function unregisterStreamPipe(taskId: string, ctrl: AbortController): void {
  const set = streamPipes.get(taskId)
  if (!set) return
  set.delete(ctrl)
  if (set.size === 0) streamPipes.delete(taskId)
}

function abortStreamPipesForTask(taskId: string): void {
  const set = streamPipes.get(taskId)
  if (!set) return
  for (const ctrl of set) ctrl.abort()
  streamPipes.delete(taskId)
}

// ─── Minimal SSE parser ───
//
// Reads a ReadableStream of bytes, accumulates lines, yields each
// dispatched event as `{ event, data }`. Spec-compliant enough for the
// relay's output (event: <name>\ndata: <json>\n\n).

interface ParsedSSE {
  event: string
  data: unknown
}

async function* parseRelaySSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<ParsedSSE> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  let event = 'message'
  let dataLines: string[] = []

  const flush = (): ParsedSSE | null => {
    if (dataLines.length === 0 && event === 'message') return null
    const dataStr = dataLines.join('\n')
    let data: unknown = null
    if (dataStr) {
      try { data = JSON.parse(dataStr) } catch { data = dataStr }
    }
    const ev: ParsedSSE = { event, data }
    event = 'message'
    dataLines = []
    return ev
  }

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const rawLine = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        // Strip trailing \r for CRLF SSE.
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

        if (line === '') {
          const ev = flush()
          if (ev) yield ev
          continue
        }
        if (line.startsWith(':')) continue // comment / heartbeat
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') dataLines.push(value)
        // Ignore `id`, `retry`, etc.
      }
    }
    // Stream closed — try to flush any trailing event.
    if (buf.length > 0) {
      const line = buf.endsWith('\r') ? buf.slice(0, -1) : buf
      if (line && !line.startsWith(':')) {
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') dataLines.push(value)
      }
    }
    const ev = flush()
    if (ev) yield ev
  } finally {
    try { reader.releaseLock() } catch { /* */ }
  }
}
