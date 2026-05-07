/**
 * Sandbox SDK wrapper — ported from `functions/sandbox.ts`.
 *
 * Differences from the Cloudflare version:
 *   - D1 calls swapped for pg-flavored db helpers ($1 placeholders, NOW()).
 *   - `rebyteJSON(env, …)` → `rebyteJSON(…)` (env is module-level now).
 *   - `Context<{ Bindings: Env; … }>` → `Context<{ Variables: { userId } }>`.
 *
 * Hosted mode treats sandboxes as Lambda-style endpoints. We do not keep
 * long-lived connections, poll readiness, or maintain an in-process pool.
 * Each filesystem operation connects fresh and lets the platform resume on
 * demand.
 */

import { Sandbox } from 'rebyte-sandbox'
import { db } from '../../db.js'
import { rebyteJSON } from './rebyte.js'
import { requireUserRebyteKey } from './rebyte-auth.js'
import { ensureProjectFileServerInstalled } from './file-server-install.js'

const SANDBOX_RETRY_DELAYS_MS = [500, 1500, 3000] as const

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

export async function connectProjectSandbox(
  userId: string,
  projectId: string,
): Promise<Sandbox> {
  const sandboxId = await loadProjectSandboxId(userId, projectId)
  const { apiKey, baseUrl } = await getSandboxApiKey(userId)
  const domain = new URL(baseUrl).hostname
  const sbx = await Sandbox.connect(sandboxId, {
    apiUrl: baseUrl,
    apiKey,
    domain,
  })
  // One-time file-server bootstrap stays DB-gated, but no longer rides on a
  // pooled "prepared sandbox" assumption. Each hosted request can connect
  // fresh; the install check is an ordinary idempotent side task.
  await ensureProjectFileServerInstalled(userId, projectId, sbx)
  return sbx
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function isTransientSandboxLifecycleError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase()
  return msg.includes('sandbox not found')
    || msg.includes('http 404')
    || msg.includes('is pausing')
    || msg.includes('snapshot in progress')
    || msg.includes('resume failed')
    || msg.includes('transition failed')
}

async function withSandboxRetry<T>(
  opName: string,
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientSandboxLifecycleError(err) || attempt >= SANDBOX_RETRY_DELAYS_MS.length) {
        throw err
      }
      const delayMs = SANDBOX_RETRY_DELAYS_MS[attempt]
      console.warn(`[sandbox] ${opName} retrying after transient lifecycle error: ${errorMessage(err)}`)
      attempt += 1
      await sleep(delayMs)
    }
  }
}

export async function writeProjectFile(
  userId: string,
  projectId: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await withSandboxRetry('writeProjectFile', async () => {
    const sbx = await connectProjectSandbox(userId, projectId)
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
  return withSandboxRetry('readProjectFile', async () => {
    const sbx = await connectProjectSandbox(userId, projectId)
    return sbx.files.read(path, { format: 'bytes' })
  })
}

export async function removeProjectFile(
  userId: string,
  projectId: string,
  path: string,
): Promise<void> {
  await withSandboxRetry('removeProjectFile', async () => {
    const sbx = await connectProjectSandbox(userId, projectId)
    await sbx.files.remove(path)
  })
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
  return withSandboxRetry('listProjectFiles', async () => {
    const sbx = await connectProjectSandbox(userId, projectId)
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
