/**
 * All HTTP routes. Ported from `functions/api/app/[[route]].ts` with the
 * mechanical substitutions this whole migration needs:
 *
 *   c.env.DB.prepare(sql).bind(a, b).first<T>()   →  db.first<T>(sql, [a, b])
 *   c.env.DB.prepare(sql).bind(a, b).all<T>()     →  db.all<T>(sql, [a, b])
 *   c.env.DB.prepare(sql).bind(a, b).run()        →  db.run(sql, [a, b])
 *   `?` placeholders                              →  `$1, $2, …`
 *   datetime('now')                               →  NOW()
 *   c.env.<SECRET>                                →  env.<SECRET>
 *   c.env.USER_HUB.get(...).fetch('/push')        →  pushToUser(userId, payload)
 *   c.env.ASSETS.fetch(...)                       →  fs.readFile under STATIC_DIR
 *   c.executionCtx.waitUntil(p)                   →  void p          (Node stays alive)
 *   rebyteJSON(c.env, path, opts)                 →  rebyteJSON(path, opts)
 *   result.meta.changes                           →  result.changes
 *   .all() → { results }                          →  .all() → array directly
 *   crypto.subtle.timingSafeEqual                 →  node:crypto timingSafeEqual
 *
 * Pg-specific quirks worth calling out:
 *   - TIMESTAMPTZ comes back from pg as a native Date. Hono's c.json
 *     serializes Date via toJSON() → ISO 8601, so frontend contracts
 *     (e.g. `created_at: string`) are preserved across the wire. When we
 *     need to do arithmetic in-server we call Date.prototype methods
 *     directly rather than parsing a sqlite-formatted string.
 */

import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'
import { requireAuth } from './auth.js'
import { db } from './db.js'
import { env } from './env.js'
import { rebyteJSON } from './backend/rebyte/rebyte.js'
import { requireUserRebyteKey } from './backend/rebyte/rebyte-auth.js'
import { fileServer, fileStore, taskRunner } from './backend/index.js'
import { classifyPath, detectType, type FileRole } from '../packages/shared/file-types/index.js'
import {
  type EditFileRef,
  EDIT_REF_TOKEN_RE,
  EDIT_REF_TOKEN_RE_G,
} from '../packages/shared/api.js'
import {
  TERMINAL_TASK_STATUSES,
  isNonTerminalStatus,
} from '../packages/shared/data.js'
import { getDesignSystem } from '../packages/shared/design-systems.js'
import { getBuildingSkill } from '../packages/shared/building-skills.js'

/** The shared context type used by every handler and every helper in
 *  sandbox.ts / rebyte-auth.ts. Having a single shape (no Bindings) keeps
 *  TS happy across module boundaries: two different `AppEnv` declarations
 *  with different shapes become two incompatible types under strict mode.
 *
 *  The SSE handler reaches the raw Node req/res via a per-call cast — that
 *  scoped escape hatch is cleaner than polluting the shape globally. */
type AppEnv = { Variables: { userId: string } }

export const app = new Hono<AppEnv>()

// ─── Global error handler ───

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  if (err instanceof SyntaxError) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  console.error('[api]', err.message)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/health', c => c.json({ ok: true }))

// ─── Webhook (no auth — Rebyte calls this directly) ───

/** Constant-time string comparison. HMAC-equalizes the lengths first so the
 *  raw inputs can be different sizes without leaking a length via the
 *  `timingSafeEqual` length check. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode('webhook-verify'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ])
  // Node's timingSafeEqual takes Buffer-likes; Uint8Array works.
  return nodeTimingSafeEqual(new Uint8Array(macA), new Uint8Array(macB))
}

app.post('/webhooks/rebyte', async (c) => {
  const secret = c.req.header('x-webhook-secret') ?? ''
  const expected = env.REBYTE_WEBHOOK_SECRET
  if (!expected || !await timingSafeEqual(secret, expected)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const payload = await c.req.json<{ taskId: string; event?: string }>()
  console.log(`[rebyte-webhook] ${payload.event ?? '(no event)'} task=${payload.taskId}`)

  const outcome = await reconcileTask(payload.taskId)
  if (outcome === 'failed') return c.json({ error: 'Upstream fetch failed' }, 502)

  return c.json({ ok: true })
})

// ─── Per-prompt content SSE ───
//
// One SSE per running prompt. The frontend opens this for any prompt with
// status='running' after fetching `/tasks/:tid/content`. Backend pulls
// frames from the active runner — local: poll Postgres; rebyte: forward
// relay's events SSE. When the runner yields `done` we close.
//
// `?fromSeq=N` skips frames already on the client (resume after disconnect).

app.get('/prompts/:pid/stream', requireAuth, async (c) => {
  const userId = c.get('userId')
  const promptId = c.req.param('pid')
  const fromSeq = Number(c.req.query('fromSeq') ?? c.req.header('Last-Event-ID') ?? 0) || 0

  return streamSSE(c, async (stream) => {
    const ctrl = new AbortController()
    stream.onAbort(() => ctrl.abort())

    try {
      for await (const item of taskRunner.streamFrames({ userId, promptId, fromSeq, signal: ctrl.signal })) {
        if (ctrl.signal.aborted) return
        if (item.type === 'frame') {
          await stream.write(`id: ${item.seq}\ndata: ${JSON.stringify(item.data)}\n\n`)
        } else {
          await stream.write(`event: done\ndata: ${JSON.stringify({ status: item.status })}\n\n`)
          return
        }
      }
    } catch (err) {
      console.warn(`[/prompts/${promptId}/stream] runner failed:`, (err as Error).message)
    }
  })
})

// ─── User sync (called on first load after login) ───

app.post('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ email: string; name?: string; avatarUrl?: string }>()
  if (typeof body.email !== 'string' || !body.email) {
    return c.json({ error: 'email is required' }, 400)
  }

  await db.run(
    `INSERT INTO users (id, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = NOW()`,
    [userId, body.email, body.name ?? null, body.avatarUrl ?? null],
  )

  if (env.ADITS_BACKEND === 'rebyte') {
    try {
      await requireUserRebyteKey(c.get('userId'))
    } catch (err) {
      console.warn('[/me] Rebyte provisioning deferred', (err as Error).message)
    }
  }

  return c.json({ ok: true })
})

// ─── i18n: locale detection + per-user language preference ───

/** The 20 locales we ship translations for (must mirror
 *  `src/app/i18n/index.ts#supportedLanguages`). */
const SUPPORTED_LOCALES = new Set([
  'en', 'zh', 'ja', 'ru',
  'pl', 'es', 'it', 'pt', 'ca',
  'de', 'fr', 'nl', 'tr', 'sv', 'da',
  'ko', 'ar', 'hi', 'th', 'vi',
])

/** Parse Accept-Language and pick the highest-q supported base tag.
 *  e.g. "zh-CN,zh;q=0.9,en;q=0.5" → "zh". */
function pickAcceptLanguage(header: string | undefined): string | null {
  if (!header) return null
  const parts = header.split(',').map((p) => {
    const [tag, ...params] = p.trim().split(';')
    const qParam = params.find((s) => s.trim().startsWith('q='))
    const q = qParam ? parseFloat(qParam.split('=')[1]) || 0 : 1
    return { tag: tag.trim().toLowerCase().split('-')[0], q }
  })
  parts.sort((a, b) => b.q - a.q)
  for (const { tag } of parts) {
    if (SUPPORTED_LOCALES.has(tag)) return tag
  }
  return null
}

/** Public — called by `src/app/i18n/index.ts` on first visit (no cookie /
 *  no localStorage). Returns the best Accept-Language match if any, else
 *  null + source: 'fallback' so the client keeps its navigator default. */
app.get('/locale/detect', (c) => {
  const lang = pickAcceptLanguage(c.req.header('Accept-Language'))
  if (lang) return c.json({ language: lang, source: 'accept-language' })
  return c.json({ language: null, source: 'fallback' })
})

/** Persist user's language choice on Clerk's `publicMetadata` for
 *  cross-device sync. No-op in local mode (no Clerk user to update). */
app.put('/user/language', requireAuth, async (c) => {
  const body = await c.req.json<{ language?: string }>()
  const lang = body.language?.split('-')[0]
  if (!lang || !SUPPORTED_LOCALES.has(lang)) {
    return c.json({ error: 'unsupported language' }, 400)
  }
  if (env.ADITS_BACKEND === 'local') {
    return c.json({ ok: true, persisted: false })
  }
  try {
    const { createClerkClient } = await import('@clerk/backend')
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
    await clerk.users.updateUserMetadata(c.get('userId'), {
      publicMetadata: { language: lang },
    })
    return c.json({ ok: true, persisted: true })
  } catch (err) {
    console.error('[/user/language] Clerk update failed', (err as Error).message)
    return c.json({ error: 'Failed to persist language' }, 500)
  }
})

// ─── Projects ───

app.get('/projects', requireAuth, async (c) => {
  const userId = c.get('userId')
  const results = await db.all(
    'SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  )
  // Inline the file-server origin per row — synthesized, no VM touch. The
  // frontend uses it to set <iframe src> for HTML files, etc. Sandboxes
  // resume on first real request, so we don't wait on liveness here.
  const withRoots = await Promise.all(results.map(async (row: any) => ({
    ...row,
    file_server_root: await fileServer.rootUrl({ userId, projectId: row.id }).catch(() => null),
  })))
  return c.json(withRoots)
})

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Create a project. Optional `designSystemId` and `buildingSkillId` are
 *  applied atomically — on any apply failure the project is deleted so
 *  the client never sees a half-initialized row. Both ids are validated
 *  against the shared registries before touching the file store; unknown
 *  ids return 400. */
app.post('/projects', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    name: string
    id?: string
    designSystemId?: string | null
    buildingSkillId?: string | null
  }>()
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  const name = body.name
  let id: string
  if (body.id !== undefined) {
    if (typeof body.id !== 'string' || !UUID_V4_RE.test(body.id)) {
      return c.json({ error: 'id must be a UUID v4' }, 400)
    }
    id = body.id
  } else {
    id = crypto.randomUUID()
  }

  const designSystemId = typeof body.designSystemId === 'string' && body.designSystemId.trim()
    ? body.designSystemId.trim() : null
  const buildingSkillId = typeof body.buildingSkillId === 'string' && body.buildingSkillId.trim()
    ? body.buildingSkillId.trim() : null
  if (designSystemId && !getDesignSystem(designSystemId)) {
    return c.json({ error: `Unknown design system: ${designSystemId}` }, 400)
  }
  if (buildingSkillId && !getBuildingSkill(buildingSkillId)) {
    return c.json({ error: `Unknown building skill: ${buildingSkillId}` }, 400)
  }

  const row = await fileStore.createProject({ userId, projectId: id, name })
  try {
    if (designSystemId) {
      await fileStore.applyDesignSystem({ userId, projectId: id, id: designSystemId })
    }
    if (buildingSkillId) {
      await fileStore.applyBuildingSkill({ userId, projectId: id, id: buildingSkillId })
    }
  } catch (err) {
    await fileStore.deleteProject({ userId, projectId: id }).catch(() => {})
    throw err
  }
  const file_server_root = await fileServer.rootUrl({ userId, projectId: id }).catch(() => null)
  return c.json({ ...row, file_server_root }, 201)
})

app.patch('/projects/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const { name } = await c.req.json<{ name: string }>()
  if (typeof name !== 'string' || !name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const result = await db.run(
    `UPDATE projects SET name = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [name, projectId, userId],
  )

  if (!result.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

/** Duplicate a project. Local: copies the project dir and inserts a new
 *  row with "<name> (Copy)". Rebyte: throws HTTPException(501) — see
 *  `rebyteFileStore.duplicateProject`. */
app.post('/projects/:id/duplicate', requireAuth, async (c) => {
  const userId = c.get('userId')
  const sourceId = c.req.param('id')
  const row = await fileStore.duplicateProject({ userId, sourceId })
  if (!row) return c.json({ error: 'Not found' }, 404)
  const file_server_root = await fileServer.rootUrl({ userId, projectId: row.id }).catch(() => null)
  return c.json({ ...row, file_server_root }, 201)
})

app.delete('/projects/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const deleted = await fileStore.deleteProject({ userId, projectId })
  if (!deleted) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

/** Apply a registered design system to the project. Writes
 *  `.impeccable.md` at the project root from the preset's content, and
 *  copies any preset assets into `.skills/design-systems/<id>/`. The
 *  caller's `id` must exist in `DESIGN_SYSTEMS` AND have backing content
 *  on disk — see `localFileStore.applyDesignSystem` for the exact rules.
 *  Rebyte: HTTPException(501). */
app.post('/projects/:id/design-system', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const body = (await c.req.json<{ id?: unknown }>().catch(() => ({}))) as { id?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return c.json({ error: 'id is required' }, 400)
  if (!getDesignSystem(id)) return c.json({ error: `Unknown design system: ${id}` }, 400)
  await fileStore.applyDesignSystem({ userId, projectId, id })
  return c.json({ ok: true })
})

/** Apply a registered building skill to the project. Copies the skill's
 *  directory into `.skills/building/<id>/`. Same id-validation rules as
 *  the design-system endpoint. Rebyte: HTTPException(501). */
app.post('/projects/:id/skills', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const body = (await c.req.json<{ id?: unknown }>().catch(() => ({}))) as { id?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return c.json({ error: 'id is required' }, 400)
  if (!getBuildingSkill(id)) return c.json({ error: `Unknown building skill: ${id}` }, 400)
  await fileStore.applyBuildingSkill({ userId, projectId, id })
  return c.json({ ok: true })
})

// ─── Files ───

const SANDBOX_FILE_ROOT = '/code'

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function sbxId(projectId: string, absPath: string): string {
  return 'sbx_' + b64url(JSON.stringify([projectId, absPath]))
}

function isSafeSandboxPath(path: string): boolean {
  if (!path.startsWith(SANDBOX_FILE_ROOT + '/')) return false
  if (path.endsWith('/')) return false
  if (/[\x00-\x1f\x7f]/.test(path)) return false
  const rel = path.slice(SANDBOX_FILE_ROOT.length + 1)
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false
  }
  return true
}

const MAX_LIST_DEPTH = 3

const HIDDEN_FILE_NAMES = new Set([
  'agent.md',
  'agents.md',
  'claude.md',
  'claude.local.md',
  'gemini.md',
])

function isVisibleSandboxFile(absPath: string): boolean {
  if (!absPath.startsWith(SANDBOX_FILE_ROOT + '/')) return false
  const rel = absPath.slice(SANDBOX_FILE_ROOT.length + 1)
  const parts = rel.split('/')
  if (parts.length < 1 || parts.length > MAX_LIST_DEPTH) return false
  const name = parts[parts.length - 1]
  if (HIDDEN_FILE_NAMES.has(name.toLowerCase())) return false
  if (detectType(name).key === 'file') return false
  return true
}

function sbxIdParse(id: string): [string, string] | null {
  if (!id.startsWith('sbx_')) return null
  try {
    const parsed = JSON.parse(b64urlDecode(id.slice(4)))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    if (typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null
    if (!isSafeSandboxPath(parsed[1])) return null
    return [parsed[0], parsed[1]]
  } catch {
    return null
  }
}

interface ApiFileResponse {
  id: string
  name: string
  /** Project-relative path (empty for link rows). Single source of truth
   *  for client-side folder grouping. */
  path: string
  /** Server-computed role. See `packages/shared/file-types/role.ts` —
   *  `'page'` is the only location-enforced role; anything else is a
   *  UI grouping label. */
  role: FileRole
  type: string
  size: number
  fs_path: string
  thumb_path: string | null
  kind: 'sandbox' | 'link'
  created_at: string
}

async function selectLinkRows(projectId: string, userId: string): Promise<ApiFileResponse[]> {
  const results = await db.all<{
    id: string
    name: string
    fs_path: string
    thumb_path: string | null
    created_at: Date
  }>(
    "SELECT id, name, fs_path, thumb_path, created_at FROM files WHERE project_id = $1 AND user_id = $2 AND kind = 'link' ORDER BY created_at DESC",
    [projectId, userId],
  )
  return results.map(r => ({
    id: 'link_' + r.id,
    name: r.name,
    path: '',
    role: 'other' as FileRole,
    type: 'link',
    size: 0,
    fs_path: r.fs_path,
    thumb_path: r.thumb_path,
    kind: 'link' as const,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}

app.get('/projects/:projectId/files', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('projectId')

  const project = await db.first(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId],
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const links = await selectLinkRows(projectId, userId)
  const sandboxEntries = await fileStore.list(c.get('userId'), projectId, SANDBOX_FILE_ROOT)
  const visibleEntries = sandboxEntries.filter(e => isVisibleSandboxFile(e.path))

  const nowIso = new Date().toISOString()
  const sandboxFiles: ApiFileResponse[] = visibleEntries.map(e => {
    const relPath = e.path.slice(SANDBOX_FILE_ROOT.length + 1)
    return {
      id: sbxId(projectId, e.path),
      name: e.name,
      path: relPath,
      role: classifyPath(relPath),
      type: detectType(e.name).key,
      size: e.size,
      fs_path: e.path,
      thumb_path: null,
      kind: 'sandbox' as const,
      created_at: e.mtime ?? nowIso,
    }
  })

  sandboxFiles.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return c.json([...sandboxFiles, ...links])
})

app.post('/projects/:projectId/files', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('projectId')

  const project = await db.first(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId],
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const formData = await c.req.formData()
  const fileEntry = formData.get('file')
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'No file provided' }, 400)
  }
  const file = fileEntry as File

  // Optional `path` form field (relative to the project's sandbox root,
  // no leading slash). Without it we default to `uploads/<name>` so
  // drag-and-drop / paste uploads land in the reserved uploads/ folder.
  // Callers that need a specific destination — Napkin save (overwrite
  // at existing scraps/ path), New Sketch (`scraps/<name>.napkin`) —
  // supply path explicitly.
  const pathField = formData.get('path')
  const relPath = (typeof pathField === 'string' && pathField.trim())
    ? pathField.trim().replace(/^\/+/, '')
    : `uploads/${file.name}`

  const fsPath = `${SANDBOX_FILE_ROOT}/${relPath}`

  if (!isSafeSandboxPath(fsPath)) {
    return c.json({ error: 'Invalid filename or path' }, 400)
  }

  await fileStore.write(c.get('userId'), projectId, fsPath, new Uint8Array(await file.arrayBuffer()))

  await db.run(
    `UPDATE projects SET updated_at = NOW() WHERE id = $1`,
    [projectId],
  )

  const type = detectType(file.name, file.type).key
  const createdAt = new Date().toISOString()

  const response: ApiFileResponse = {
    id: sbxId(projectId, fsPath),
    name: file.name,
    path: relPath,
    role: classifyPath(relPath),
    type,
    size: file.size,
    fs_path: fsPath,
    thumb_path: null,
    kind: 'sandbox',
    created_at: createdAt,
  }
  return c.json(response, 201)
})

/** Thin write endpoint for prompt artifacts (screenshots, draw
 *  exports, comment crops). Unlike POST /files, this does NOT
 *  register the upload as a user-visible project file or bump
 *  `updated_at` — the caller specifies the destination path under
 *  /code, and the only response is the path that was written.
 *
 *  Both backends fulfill this through the shared FileStore.write,
 *  so local vs. rebyte selection happens automatically per
 *  ADITS_BACKEND. */
app.post('/projects/:projectId/blobs', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('projectId')

  const project = await db.first(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId],
  )
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const formData = await c.req.formData()
  const fileEntry = formData.get('file')
  const pathEntry = formData.get('path')
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'No file provided' }, 400)
  }
  if (typeof pathEntry !== 'string' || !pathEntry) {
    return c.json({ error: 'No path provided' }, 400)
  }
  const file = fileEntry as File

  const fsPath = `${SANDBOX_FILE_ROOT}/${pathEntry}`
  if (!isSafeSandboxPath(fsPath)) {
    return c.json({ error: 'Invalid path' }, 400)
  }

  await fileStore.write(userId, projectId, fsPath, new Uint8Array(await file.arrayBuffer()))

  return c.json({ path: pathEntry }, 201)
})

async function resolveFileId(
  c: Context<AppEnv>,
  fileId: string,
): Promise<
  | { kind: 'sandbox'; projectId: string; fsPath: string; name: string }
  | { kind: 'link'; rowId: string; projectId: string; fsPath: string; name: string }
  | null
> {
  const userId = c.get('userId')

  if (fileId.startsWith('link_')) {
    const rowId = fileId.slice(5)
    const row = await db.first<{ id: string; name: string; fs_path: string; project_id: string }>(
      "SELECT id, name, fs_path, project_id FROM files WHERE id = $1 AND user_id = $2 AND kind = 'link'",
      [rowId, userId],
    )
    if (!row) return null
    return { kind: 'link', rowId: row.id, projectId: row.project_id, fsPath: row.fs_path, name: row.name }
  }

  const parsed = sbxIdParse(fileId)
  if (!parsed) return null
  const [projectId, fsPath] = parsed

  const project = await db.first(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId],
  )
  if (!project) return null

  const name = fsPath.split('/').pop() ?? fsPath
  return { kind: 'sandbox', projectId, fsPath, name }
}

app.get('/files/:id/download', requireAuth, async (c) => {
  const fileId = c.req.param('id')
  const file = await resolveFileId(c, fileId)
  if (!file) return c.json({ error: 'Not found' }, 404)

  if (file.kind === 'link') return c.redirect(file.fsPath, 302)

  let bytes: Uint8Array
  try {
    bytes = await fileStore.read(c.get('userId'), file.projectId, file.fsPath)
  } catch (err) {
    console.warn(`[/files/:id/download] read failed for ${file.fsPath}:`, (err as Error).message)
    return c.json({ error: 'File missing from storage' }, 404)
  }

  const contentType = detectType(file.name).mimePatterns[0] ?? 'application/octet-stream'
  const disposition = contentType.startsWith('image/') ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
  return new Response(bytes, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
})

app.delete('/files/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const fileId = c.req.param('id')
  const file = await resolveFileId(c, fileId)
  if (!file) return c.json({ error: 'Not found' }, 404)

  if (file.kind === 'link') {
    await db.run(
      "DELETE FROM files WHERE id = $1 AND user_id = $2 AND kind = 'link'",
      [file.rowId, userId],
    )
    return c.json({ ok: true })
  }

  await fileStore.remove(c.get('userId'), file.projectId, file.fsPath)
  return c.json({ ok: true })
})

// ─── Helpers for the tasks routes ───

async function requireWorkspace(c: Context<AppEnv>, projectId: string): Promise<{ wid: string; userKey: string; ownsWorkspace: boolean }> {
  const userId = c.get('userId')
  const row = await db.first<{ workspace_id: string; owns_workspace: number; rebyte_api_key: string | null }>(
    `SELECT p.workspace_id, p.owns_workspace, u.rebyte_api_key
     FROM projects p JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [projectId, userId],
  )
  if (!row) throw new HTTPException(404, { message: 'Project not found' })

  if (!row.owns_workspace) return { wid: row.workspace_id, userKey: env.REBYTE_API_KEY, ownsWorkspace: false }

  if (row.rebyte_api_key) return { wid: row.workspace_id, userKey: row.rebyte_api_key, ownsWorkspace: true }

  const key = await requireUserRebyteKey(c.get('userId'))
  return { wid: row.workspace_id, userKey: key, ownsWorkspace: true }
}

// ─── Tasks (proxy to Rebyte) ───

const DEFAULT_SKILLS: readonly string[] = []

function withDefaultSkills(extra?: string[]): string[] {
  return Array.from(new Set([...DEFAULT_SKILLS, ...(extra ?? [])]))
}

app.post('/projects/:pid/tasks', requireAuth, async (c) => {
  const pid = c.req.param('pid')
  const userId = c.get('userId')
  const body = await c.req.json<{ prompt: string; executor?: string; model?: string; files?: unknown[]; skills?: string[] }>()
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  // Ownership check — both runners expect the caller to have verified that
  // this user owns the project. Cheap, avoids pushing that into the runner.
  const owned = await db.first(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [pid, userId],
  )
  if (!owned) return c.json({ error: 'Project not found' }, 404)

  // Extras: everything Rebyte accepts beyond `prompt`. Default skills are
  // applied here (not in the runner) so local doesn't see them.
  const extras: Record<string, unknown> = {
    ...(body.executor !== undefined && { executor: body.executor }),
    ...(body.model !== undefined && { model: body.model }),
    ...(body.files !== undefined && { files: body.files }),
    skills: withDefaultSkills(body.skills),
  }

  const result = await taskRunner.create({ userId, projectId: pid, prompt: body.prompt, extras })
  return c.json(result, 201)
})

app.get('/tasks/:tid', requireAuth, async (c) => {
  const state = await taskRunner.get(c.get('userId'), c.req.param('tid'))
  if (!state) return c.json({ error: 'Task not found' }, 404)
  return c.json(state)
})

app.get('/tasks/:tid/content', requireAuth, async (c) => {
  const content = await taskRunner.getContent(c.get('userId'), c.req.param('tid'), c.req.query('include'))
  if (!content) return c.json({ error: 'Task not found' }, 404)
  return c.json(content)
})

app.post('/tasks/:tid/prompts', requireAuth, async (c) => {
  const userId = c.get('userId')
  const tid = c.req.param('tid')

  const body = await c.req.json<{ prompt?: string; executor?: string; model?: string; skills?: string[] }>()
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  // Extras shape mirrors `POST /projects/:pid/tasks` — rebyte forwards
  // the whole bag; local reads `executor` and ignores the rest.
  const extras: Record<string, unknown> = {
    ...(body.executor !== undefined && { executor: body.executor }),
    ...(body.model !== undefined && { model: body.model }),
    skills: withDefaultSkills(body.skills),
  }

  const result = await taskRunner.followup({ userId, taskId: tid, prompt: body.prompt, extras })
  if (!result) return c.json({ error: 'Task not found' }, 404)
  return c.json(result, 201)
})

app.post('/tasks/:tid/cancel', requireAuth, async (c) => {
  const taskId = c.req.param('tid')
  const userId = c.get('userId')
  const result = await taskRunner.cancel({ userId, taskId })
  if (!result) return c.json({ error: 'Task not found' }, 404)
  return c.json({ id: taskId, status: 'canceled', ...result })
})

// ─── Task reconciliation (Stripe-style cache: Rebyte is source of truth) ───

function isTerminal(status: string): boolean {
  return !isNonTerminalStatus(status)
}

const KNOWN_NON_TERMINAL_STATUSES = new Set(['running', 'pending', 'queued', 'processing'])

function normalizeStatus(rebyteStatus: string | undefined, taskId?: string): string {
  if (!rebyteStatus) return 'running'
  if (TERMINAL_TASK_STATUSES.has(rebyteStatus)) return rebyteStatus
  if (!KNOWN_NON_TERMINAL_STATUSES.has(rebyteStatus)) {
    console.warn(`[reconcileTask] unknown Rebyte status "${rebyteStatus}" for task ${taskId ?? '?'} — collapsing to running`)
  }
  return 'running'
}

async function reconcileTask(taskId: string, signal?: AbortSignal): Promise<'updated' | 'noop' | 'unknown' | 'failed'> {
  const local = await db.first<{
    workspace_id: string
    status: string
    project_id: string
    owns_workspace: number
    user_id: string
    rebyte_api_key: string | null
  }>(
    `SELECT t.workspace_id, t.status, t.project_id, p.owns_workspace,
            u.id AS user_id, u.rebyte_api_key
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     JOIN users u ON u.id = p.user_id
     WHERE t.id = $1`,
    [taskId],
  )
  if (!local) return 'unknown'
  if (isTerminal(local.status)) return 'noop'

  const apiKey = local.owns_workspace && local.rebyte_api_key ? local.rebyte_api_key : env.REBYTE_API_KEY

  let task: { status?: string; title?: string }
  try {
    task = await rebyteJSON<{ status?: string; title?: string }>(`/tasks/${taskId}`, { apiKey, signal })
  } catch (err) {
    console.warn(`[reconcileTask] upstream fetch failed for ${taskId}:`, (err as Error).message)
    return 'failed'
  }

  const newStatus = normalizeStatus(task.status, taskId)

  await db.run(
    `UPDATE tasks
     SET status = $1,
         title = COALESCE($2, title),
         completed_at = CASE WHEN $3 IN ('completed','failed','canceled') THEN NOW() ELSE completed_at END,
         last_synced_at = NOW()
     WHERE id = $4 AND status NOT IN ('completed','failed','canceled')`,
    [newStatus, task.title ?? null, newStatus, taskId],
  )

  return 'updated'
}

// ─── Tasks (all tasks for a project — pending, completed, failed) ───

const READ_THROUGH_STALENESS_SECONDS = 5
const READ_THROUGH_MAX_RECONCILES = 5
const READ_THROUGH_BUDGET_MS = 3000

/** Whether a row is missing a sync timestamp or is older than the staleness
 *  window. Works with native Date (pg returns TIMESTAMPTZ as Date). */
function isStale(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return true
  return (Date.now() - lastSyncedAt.getTime()) > READ_THROUGH_STALENESS_SECONDS * 1000
}

app.get('/projects/:pid/all-tasks', requireAuth, async (c) => {
  const userId = c.get('userId')
  const projectId = c.req.param('pid')
  const project = await db.first<{ owns_workspace: number; rebyte_api_key: string | null }>(
    `SELECT p.owns_workspace, u.rebyte_api_key
     FROM projects p JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [projectId, userId],
  )
  if (!project) return c.json({ error: 'Not found' }, 404)

  const selectTasks = () => db.all<{
    id: string
    workspace_id: string
    prompt: string
    title: string | null
    status: string
    created_at: Date
    completed_at: Date | null
    last_synced_at: Date | null
  }>(
    `SELECT id, workspace_id, prompt, title, status, created_at, completed_at, last_synced_at
     FROM tasks WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  )

  let results = await selectTasks()

  const staleIds = results
    .filter(t => !isTerminal(t.status))
    .filter(t => isStale(t.last_synced_at))
    .sort((a, b) =>
      (a.last_synced_at?.getTime() ?? 0) - (b.last_synced_at?.getTime() ?? 0),
    )
    .slice(0, READ_THROUGH_MAX_RECONCILES)
    .map(t => t.id)

  if (staleIds.length > 0) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), READ_THROUGH_BUDGET_MS)
    let outcomes: Array<'updated' | 'noop' | 'unknown' | 'failed'>
    try {
      outcomes = await Promise.all(staleIds.map(id => reconcileTask(id, controller.signal)))
    } finally {
      clearTimeout(timer)
    }
    if (outcomes.some(o => o === 'updated')) {
      results = await selectTasks()
    }
  }

  const consoleApiKey = project.owns_workspace === 1 ? project.rebyte_api_key : null
  const tasks = results.map(t => ({
    id: t.id,
    prompt: t.prompt,
    title: t.title,
    status: t.status,
    url: consoleApiKey ? buildShareTaskUrl(t.id, consoleApiKey) : null,
    created_at: t.created_at instanceof Date ? t.created_at.toISOString() : t.created_at,
    completed_at: t.completed_at instanceof Date ? t.completed_at.toISOString() : t.completed_at,
  }))
  return c.json(tasks)
})

function buildShareTaskUrl(taskId: string, apiKey: string): string {
  const base = env.REBYTE_CONSOLE_URL.replace(/\/+$/, '')
  return `${base}/${taskId}?key=${encodeURIComponent(apiKey)}`
}

// ─── Edit (agentic file editing) ───

function formatTimeRange(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const total = Math.max(0, Math.round(s))
    const m = Math.floor(total / 60)
    const rem = total % 60
    return `${m}:${rem.toString().padStart(2, '0')}`
  }
  return `(use segment from ${fmt(startSec)} to ${fmt(endSec)})`
}

function validateEditRef(ref: unknown): EditFileRef | null {
  if (!ref || typeof ref !== 'object') return null
  const r = ref as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0) return null
  if (typeof r.token !== 'string') return null
  if (!EDIT_REF_TOKEN_RE.test(r.token)) return null
  if (r.kind === 'file') return { kind: 'file', id: r.id, token: r.token }
  if (r.kind === 'segment') {
    const startSec = Number(r.startSec)
    const endSec = Number(r.endSec)
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null
    if (startSec < 0 || endSec < 0 || endSec < startSec) return null
    return { kind: 'segment', id: r.id, token: r.token, startSec, endSec }
  }
  return null
}

app.post('/projects/:pid/edit', requireAuth, async (c) => {
  const pid = c.req.param('pid')
  const userId = c.get('userId')
  const body = await c.req.json<{
    fileId: string
    prompt: string
    references?: unknown
    executor?: string
    model?: string
  }>()
  if (!body.fileId || typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return c.json({ error: 'fileId and prompt are required' }, 400)
  }

  const file = await resolveFileId(c, body.fileId)
  if (!file || file.projectId !== pid) return c.json({ error: 'File not found' }, 404)

  // Rebyte-only: pre-resolve the workspace + user key. Local mode doesn't
  // need either — the project dir and taskRunner own everything.
  let wid: string | undefined
  let userKey: string | undefined
  let ownsWorkspace = false
  if (env.ADITS_BACKEND === 'rebyte') {
    const ws = await requireWorkspace(c, pid)
    wid = ws.wid
    userKey = ws.userKey
    ownsWorkspace = ws.ownsWorkspace
  }

  interface ResolvedRef { token: string; replacement: string }
  const resolvedRefs: ResolvedRef[] = []
  const rawRefs = Array.isArray(body.references) ? body.references : []
  const seenTokens = new Set<string>()
  for (const raw of rawRefs) {
    const ref = validateEditRef(raw)
    if (!ref) continue
    if (seenTokens.has(ref.token)) continue
    if (!body.prompt.includes(ref.token)) continue
    seenTokens.add(ref.token)

    const r = await resolveFileId(c, ref.id)
    if (!r || r.projectId !== pid) {
      resolvedRefs.push({ token: ref.token, replacement: `[missing: ${ref.id}]` })
      continue
    }
    if (ref.kind === 'segment') {
      const annotation = formatTimeRange(ref.startSec, ref.endSec)
      resolvedRefs.push({ token: ref.token, replacement: `${r.fsPath} ${annotation}` })
      continue
    }
    resolvedRefs.push({ token: ref.token, replacement: r.fsPath })
  }

  const refTokens = new Set(resolvedRefs.map(r => r.token))
  let rewrittenPrompt = body.prompt.replace(EDIT_REF_TOKEN_RE_G, (match) =>
    refTokens.has(match) ? match : '',
  )
  for (const ref of resolvedRefs) {
    rewrittenPrompt = rewrittenPrompt.split(ref.token).join(ref.replacement)
  }

  const agentPrompt = [
    rewrittenPrompt,
    ``,
    `RULES:`,
    `0. EVERYTHING YOU PRODUCE REACHES THE USER THROUGH FILES IN /code/.`,
    `   The user has no access to your chat output — they only see files`,
    `   in their project grid. If you don't write a file, the user sees`,
    `   NOTHING. This is the most important rule.`,
    `   - If the task naturally produces output (edit, convert, crop,`,
    `     redraw, transcribe, extract, etc.): save that output under`,
    `     /code/ per rule 3.`,
    `   - If the task is a question, explanation, or analysis that`,
    `     wouldn't normally produce a file ("what is this?", "summarize",`,
    `     "compare", "explain"): write your answer as a single,`,
    `     beautifully-formatted HTML file and save it under /code/ (e.g.`,
    `     /code/answer.html). Make it editorial-quality — a self-`,
    `     contained single-page report the user can open and read. Never`,
    `     answer in chat alone; without a file, your response is invisible.`,
    `1. YOU RUN IN ONE-OFF MODE. This is a single, non-interactive`,
    `   invocation — there is no conversation, no follow-up turn, no way`,
    `   for the user to answer you. Never ask questions, never request`,
    `   clarification, never offer choices, never pause for confirmation.`,
    `   If a step would normally prompt the user, make a reasonable`,
    `   default decision yourself and proceed. If the request is`,
    `   genuinely ambiguous, pick the most likely interpretation, do the`,
    `   work, and note the assumption in the output file (the HTML`,
    `   report or a brief header comment in the produced file). Finishing`,
    `   with an unanswered question means the user gets nothing.`,
    `2. Read the input(s) from the path(s) above.`,
    `3. Save only the FINAL result(s) the user asked for under /code/ (top`,
    `   level or a subdirectory you create). The user sees anything new`,
    `   there after you finish — no upload step needed.`,
    `4. Put all intermediate or temporary files you generate OUTSIDE /code/`,
    `   (e.g. under /tmp/). /code/ must contain inputs and final outputs`,
    `   only — never scratch state, working copies, build artifacts, or`,
    `   tool state. Anything in /code/ shows up in the user's file grid.`,
  ].join('\n')

  const stripped = body.prompt.replace(EDIT_REF_TOKEN_RE_G, '').replace(/\s+/g, ' ').trim()
  const displayPrompt = (stripped.length > 0 ? stripped : `Edit ${file.name}`).slice(0, 200)

  if (env.ADITS_BACKEND === 'local') {
    // Claude Code runs with cwd = project dir, so every `/code/<x>` in the
    // hosted prompt maps to `<x>` on disk. Strip the prefix so the rules
    // still read naturally and claude doesn't try to write to the FS root.
    const localPrompt = agentPrompt.replace(/\/code\//g, './').replace(/\/code\b/g, '.')
    const created = await taskRunner.create({ userId, projectId: pid, prompt: localPrompt })
    return c.json({ ...created, consoleUrl: null, displayPrompt }, 201)
  }

  const task = await rebyteJSON<{ id: string; workspaceId: string; status: string; url?: string }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      prompt: agentPrompt,
      executor: body.executor ?? 'claude',
      model: body.model ?? 'deepseek-v4-pro',
      workspaceId: wid,
      skills: withDefaultSkills(),
    }),
    apiKey: userKey,
  })

  const consoleUrl = ownsWorkspace ? buildShareTaskUrl(task.id, userKey!) : null

  await db.run(
    `INSERT INTO tasks (id, workspace_id, project_id, prompt, status, url, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [task.id, wid, pid, displayPrompt, 'running', consoleUrl],
  )

  return c.json({ ...task, url: consoleUrl }, 201)
})
