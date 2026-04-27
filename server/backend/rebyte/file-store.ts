import { HTTPException } from 'hono/http-exception'
import {
  listProjectFiles,
  readProjectFile,
  removeProjectFile,
  writeProjectFile,
  type AgentComputerCreateResponse,
} from './sandbox.js'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { rebyteFetch, rebyteJSON } from './rebyte.js'
import { requireUserRebyteKey } from './rebyte-auth.js'
import type { FileStore, ProjectRow } from '../file-store.js'

interface ProjectDbRow {
  id: string
  name: string
  user_id: string
  workspace_id: string
  vm_id: string | null
  created_at: Date
}

function rowToJSON(row: ProjectDbRow): ProjectRow {
  return {
    id: row.id,
    name: row.name,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    vm_id: row.vm_id,
    created_at: row.created_at.toISOString(),
  }
}

/** Provision a rebyte agent-computer and wait for it to finish booting.
 *  Polls /agent-computers/:id every 2s until `sandboxId` is populated
 *  (that's the signal the VM is addressable). Throws if provisioning
 *  doesn't finish within ~60s. */
async function provisionAgentComputer(
  userId: string,
  name: string,
): Promise<AgentComputerCreateResponse> {
  const userKey = await requireUserRebyteKey(userId)
  const created = await rebyteJSON<AgentComputerCreateResponse>('/agent-computers', {
    method: 'POST',
    body: JSON.stringify({ name }),
    apiKey: userKey,
  })
  if (created.sandboxId) return created

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const fresh = await rebyteJSON<AgentComputerCreateResponse>(
      `/agent-computers/${created.id}`, { apiKey: userKey },
    )
    if (fresh.sandboxId) return { ...created, ...fresh }
  }
  throw new Error(`Agent computer ${created.id} did not finish provisioning within 60s`)
}

export const rebyteFileStore: FileStore = {
  list: (userId, projectId, path, opts) =>
    listProjectFiles(userId, projectId, path, opts?.depth),
  read: (userId, projectId, path) => readProjectFile(userId, projectId, path),
  write: (userId, projectId, path, bytes) => writeProjectFile(userId, projectId, path, bytes),
  remove: (userId, projectId, path) => removeProjectFile(userId, projectId, path),

  /** Rebyte createProject: provision a VM, INSERT the row, return it. The
   *  vm_id invariant — non-null for every rebyte row — is enforced here:
   *  if provisioning returns an agent-computer without an id we throw
   *  before the INSERT so no NULL-vm_id row ever gets written on rebyte. */
  async createProject({ userId, projectId, name }) {
    const ac = await provisionAgentComputer(userId, name)
    if (!ac.id) throw new Error('rebyteFileStore.createProject: agent-computer response missing id')

    try {
      const row = await db.first<ProjectDbRow>(
        `INSERT INTO projects (id, user_id, name, workspace_id, vm_id, owns_workspace, sandbox_config)
         VALUES ($1, $2, $3, $4, $4, 1, $5)
         RETURNING id, user_id, name, workspace_id, vm_id, created_at`,
        [projectId, userId, name, ac.id, JSON.stringify(ac)],
      )
      if (!row) throw new Error('rebyteFileStore.createProject: INSERT returned no row')
      return rowToJSON(row)
    } catch (err) {
      // Compensating action: tear down the freshly-provisioned VM if we
      // can't persist the row, so we don't leak agent-computers.
      const userKey = await requireUserRebyteKey(userId).catch(() => null)
      if (userKey) {
        await rebyteFetch(`/agent-computers/${ac.id}`, { method: 'DELETE', apiKey: userKey }).catch(() => {})
      }
      throw err
    }
  },

  /** Rebyte deleteProject: DELETE the row, fire-and-forget DELETE on the
   *  agent-computer. The key choice (user's vs. partner) mirrors the
   *  historic behavior in routes.ts — use the user's key if they own the
   *  workspace, else fall back to the partner key. */
  async deleteProject({ userId, projectId }) {
    const project = await db.first<{ vm_id: string | null; owns_workspace: number; rebyte_api_key: string | null }>(
      `SELECT p.vm_id, p.owns_workspace, u.rebyte_api_key
       FROM projects p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.user_id = $2`,
      [projectId, userId],
    )
    if (!project) return false

    const result = await db.run(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId],
    )
    if (!result.changes) return false

    if (project.vm_id) {
      const deleteKey = project.owns_workspace && project.rebyte_api_key ? project.rebyte_api_key : env.REBYTE_API_KEY
      if (deleteKey) {
        await rebyteFetch(`/agent-computers/${project.vm_id}`, { method: 'DELETE', apiKey: deleteKey }).catch(() => {})
      }
    }
    return true
  },

  /** Rebyte duplicateProject: not implemented. Cloning a VM would require
   *  either a rebyte-side `/agent-computers/:id/clone` endpoint or streaming
   *  the entire /code tree through this process — both are outside current
   *  scope. Throws 501 so the route surfaces the correct status. */
  async duplicateProject() {
    throw new HTTPException(501, { message: 'Duplicate is only available in local mode' })
  },

  /** Rebyte applyDesignSystem: no-op for now. Preset content delivery into
   *  the VM isn't wired yet; the route still succeeds so project creation
   *  doesn't fail. The agent can be told about the design system through
   *  other channels (chat prompt) in the meantime. */
  async applyDesignSystem({ id }) {
    console.warn(`[rebyteFileStore.applyDesignSystem] skipped — not yet wired (id="${id}")`)
  },

  /** Rebyte applyBuildingSkill: no-op for now. Same reason as
   *  applyDesignSystem — the scaffold-into-VM delivery path isn't built. */
  async applyBuildingSkill({ id }) {
    console.warn(`[rebyteFileStore.applyBuildingSkill] skipped — not yet wired (id="${id}")`)
  },
}
