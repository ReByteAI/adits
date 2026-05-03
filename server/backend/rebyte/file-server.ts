import type { FileServer } from '../file-server.js'
import { db } from '../../db.js'

/** Rebyte FileServer: URL is the per-project subdomain on :8080 of the
 *  agent-computer VM. Pure URL synthesis — does NOT touch the VM. The
 *  first request to the URL (iframe, file fetch, etc.) hits the
 *  sandbox gateway, which auto-resumes the VM if paused. Returns
 *  null when the project has no `sandbox_config` yet (still provisioning,
 *  or local-mode rows that ended up here by mistake).
 *
 *  Gateway host comes from `sandboxBaseUrl` in sandbox_config (which is
 *  what /v1/agent-computers returned at provision time). No REBYTE_ENV
 *  dance — adits has one rebyte backend, the API tells us where its
 *  sandboxes live. See shared-memories/general/adits-environments.md. */
export const rebyteFileServer: FileServer = {
  async rootUrl({ userId, projectId }) {
    const row = await db.first<{ sandbox_config: string | null }>(
      'SELECT sandbox_config FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId],
    )
    if (!row?.sandbox_config) return null
    let parsed: { sandboxId?: string; sandboxBaseUrl?: string }
    try {
      parsed = JSON.parse(row.sandbox_config)
    } catch {
      return null
    }
    if (!parsed.sandboxId || !parsed.sandboxBaseUrl) return null
    const gatewayHost = new URL(parsed.sandboxBaseUrl).host
    return `https://8080-${parsed.sandboxId}.${gatewayHost}`
  },
}
