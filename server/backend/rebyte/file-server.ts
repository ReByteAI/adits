import type { FileServer } from '../file-server.js'
import { db } from '../../db.js'

const REBYTE_ENV = process.env.REBYTE_ENV ?? 'dev'

/** Rebyte FileServer: URL is the per-project subdomain on :8080 of the
 *  agent-computer VM. Pure URL synthesis — does NOT touch the VM. The
 *  first request to the URL (iframe, file fetch, etc.) hits the
 *  sandbox gateway, which auto-resumes the VM if paused. Returns
 *  null when the project has no `sandbox_config` yet (still provisioning,
 *  or local-mode rows that ended up here by mistake). */
export const rebyteFileServer: FileServer = {
  async rootUrl({ userId, projectId }) {
    const row = await db.first<{ sandbox_config: string | null }>(
      'SELECT sandbox_config FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId],
    )
    if (!row?.sandbox_config) return null
    let sandboxId: string | null = null
    try {
      sandboxId = (JSON.parse(row.sandbox_config) as { sandboxId?: string }).sandboxId ?? null
    } catch {
      return null
    }
    if (!sandboxId) return null
    return `https://8080-${sandboxId}.${REBYTE_ENV}.rebyte.app`
  },
}
