/**
 * Sandbox SDK wrapper — ported from `functions/sandbox.ts`.
 *
 * Differences from the Cloudflare version:
 *   - D1 calls swapped for pg-flavored db helpers ($1 placeholders, NOW()).
 *   - `rebyteJSON(env, …)` → `rebyteJSON(…)` (env is module-level now).
 *   - `Context<{ Bindings: Env; … }>` → `Context<{ Variables: { userId } }>`.
 *
 * Everything else — the connect retry loop, envd readiness poll, etc. —
 * is verbatim because it's pure SDK behavior.
 */

import { ErrorCode, Sandbox, SandboxError, TimeoutError } from 'rebyte-sandbox'
import { db } from '../../db.js'
import { rebyteJSON } from './rebyte.js'
import { requireUserRebyteKey } from './rebyte-auth.js'
import { ensureProjectFileServerInstalled } from './file-server-install.js'
import { withProjectSandbox } from './sandbox-pool.js'

const SANDBOX_TIMEOUT_MS = 5 * 60 * 1000
const SANDBOX_CONNECT_BUDGET_MS = 120_000
const SANDBOX_POLL_INTERVAL_MS = 200

export interface AgentComputerCreateResponse {
  id: string
  status: string
  sandboxId: string
  sandboxBaseUrl: string
  sandboxApiKey: string
}

export async function loadProjectSandboxId(
  userId: string,
  projectId: string,
): Promise<string> {
  const row = await db.first<{ sandbox_config: string | null }>(
    'SELECT sandbox_config FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId],
  )

  if (!row) throw new Error(`Project ${projectId} not found`)
  if (!row.sandbox_config) throw new Error(`Project ${projectId} has no sandbox_config`)

  const parsed = JSON.parse(row.sandbox_config) as Partial<AgentComputerCreateResponse>
  if (!parsed.sandboxId) {
    throw new Error(`Project ${projectId} sandbox_config missing sandboxId`)
  }
  return parsed.sandboxId
}

async function getSandboxApiKey(
  userId: string,
): Promise<{ apiKey: string; baseUrl: string }> {
  const cached = await db.first<{ sandbox_api_key: string | null; sandbox_base_url: string | null }>(
    'SELECT sandbox_api_key, sandbox_base_url FROM users WHERE id = $1',
    [userId],
  )

  if (cached?.sandbox_api_key && cached.sandbox_base_url) {
    return { apiKey: cached.sandbox_api_key, baseUrl: cached.sandbox_base_url }
  }

  const userKey = await requireUserRebyteKey(userId)
  const fresh = await rebyteJSON<{ apiKey: string; baseUrl: string }>(
    '/sandbox/api-key', { apiKey: userKey },
  )

  await db.run(
    `UPDATE users
     SET sandbox_api_key = $1, sandbox_base_url = $2, updated_at = NOW()
     WHERE id = $3`,
    [fresh.apiKey, fresh.baseUrl, userId],
  )

  return { apiKey: fresh.apiKey, baseUrl: fresh.baseUrl }
}

export async function waitForEnvdReady(sbx: Sandbox, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await sbx.isRunning()) return
    } catch {
      // transient errors during resume are expected; keep polling
    }
    await new Promise(r => setTimeout(r, 200))
  }
  // Throw TimeoutError (SDK type) rather than a bare Error so the
  // sandbox-pool classifier (`isSandboxNotReady`) recognizes the
  // failure and invalidates the cache. A raw Error here would leave
  // callers with a stale inflight result.
  throw new TimeoutError(`envd readiness timed out after ${timeoutMs}ms`)
}

export async function connectProjectSandbox(
  userId: string,
  projectId: string,
): Promise<Sandbox> {
  const sandboxId = await loadProjectSandboxId(userId, projectId)
  const { apiKey, baseUrl } = await getSandboxApiKey(userId)
  const domain = new URL(baseUrl).hostname
  const deadline = Date.now() + SANDBOX_CONNECT_BUDGET_MS
  let sbx: Sandbox
  let pauseWaitAttempts = 0
  while (true) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(`Sandbox ${sandboxId} stayed in the pausing state for longer than ${SANDBOX_CONNECT_BUDGET_MS}ms`)
    }
    try {
      sbx = await Sandbox.connect(sandboxId, {
        apiUrl: baseUrl,
        apiKey,
        domain,
        requestTimeoutMs: remainingMs,
      })
      if (pauseWaitAttempts > 0) {
        console.log(`[sandbox] ${sandboxId} resumed after ${pauseWaitAttempts * SANDBOX_POLL_INTERVAL_MS}ms of pause-waiting`)
      }
      break
    } catch (err) {
      if (!(err instanceof SandboxError) || err.errorCode !== ErrorCode.SANDBOX_PAUSING) {
        console.warn(`[sandbox] ${sandboxId} connect threw non-pause error:`, (err as Error).name, (err as Error).message)
        throw err
      }
      pauseWaitAttempts++
      await new Promise(r => setTimeout(r, Math.min(SANDBOX_POLL_INTERVAL_MS, remainingMs)))
    }
  }
  await sbx.setTimeout(SANDBOX_TIMEOUT_MS).catch((err: Error) => {
    console.warn(`[sandbox] setTimeout failed for project ${projectId}:`, err.message)
  })
  await waitForEnvdReady(sbx)
  // One-time install per project (DB-gated — 99%+ of calls stop at a
  // ~1 ms lookup). Failure throws, which surfaces to whichever caller
  // first hit the sandbox (file read/write/list). The stamp column stays
  // NULL so the next call re-runs the slow path. Not wrapped in
  // `.catch()` because letting connectProjectSandbox silently succeed
  // while the file-server failed to install would let the next read
  // hand the browser a :8080 URL that ECONNREFUSES.
  await ensureProjectFileServerInstalled(userId, projectId, sbx)
  return sbx
}

export async function writeProjectFile(
  userId: string,
  projectId: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await withProjectSandbox(userId, projectId, async sbx => {
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash > 0) {
      await sbx.files.makeDir(path.slice(0, lastSlash))
    }
    // @eng0/sdk's files.write takes ArrayBuffer; peel the Uint8Array view.
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    await sbx.files.write(path, ab)
  })
}

export async function readProjectFile(
  userId: string,
  projectId: string,
  path: string,
): Promise<Uint8Array> {
  return withProjectSandbox(userId, projectId, sbx => sbx.files.read(path, { format: 'bytes' }))
}

export async function removeProjectFile(
  userId: string,
  projectId: string,
  path: string,
): Promise<void> {
  await withProjectSandbox(userId, projectId, sbx => sbx.files.remove(path))
}

export interface SandboxFileEntry {
  path: string
  name: string
  size: number
  mtime: string | null
}

export async function listProjectFiles(
  userId: string,
  projectId: string,
  root: string,
  depth = 5,
): Promise<SandboxFileEntry[]> {
  return withProjectSandbox(userId, projectId, async sbx => {
    await sbx.files.makeDir(root)
    const entries = await sbx.files.list(root, { depth })
    return entries
      .filter(e => e.type === 'file')
      .map(e => ({
        path: e.path,
        name: e.name,
        size: e.size,
        mtime: e.modifiedTime ? e.modifiedTime.toISOString() : null,
      }))
  })
}
