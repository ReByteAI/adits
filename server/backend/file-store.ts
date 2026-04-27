/**
 * The `FileStore` seam — owns every per-project backend resource.
 *
 * Route handlers call `fileStore.*` (from `./index.ts`) instead of reaching
 * into `server/sandbox.ts` directly, so the underlying storage can be swapped
 * at boot via `ADITS_BACKEND`. The seam covers two responsibilities:
 *
 *   1. Per-file I/O     — list / read / write / remove
 *   2. Per-project lifecycle — createProject / deleteProject / duplicateProject
 *
 * Lifecycle methods own the `projects` row INSERT/DELETE AND the backend-
 * specific side effects (local: mkdir the project dir; rebyte: provision
 * an agent-computer VM and persist its id as `vm_id`). This keeps the
 * `projects` row's backend-shaped fields (`vm_id`, `sandbox_config`) from
 * leaking into route handlers.
 */

export interface FileEntry {
  path: string
  name: string
  size: number
  mtime: string | null
}

/** Shape returned from every project-lifecycle method. Matches the JSON
 *  the routes already send to the frontend for `POST /projects` etc.
 *
 *  `vm_id` is NULL on local rows and the agent-computer id on rebyte rows.
 *  On rebyte it is required (createProject throws before INSERT if the
 *  provisioning response has no id) — see migration 003_vm_id.sql. */
export interface ProjectRow {
  id: string
  name: string
  user_id: string
  workspace_id: string
  vm_id: string | null
  created_at: string
}

export interface FileStore {
  list(userId: string, projectId: string, path: string, opts?: { depth?: number }): Promise<FileEntry[]>
  read(userId: string, projectId: string, path: string): Promise<Uint8Array>
  write(userId: string, projectId: string, path: string, bytes: Uint8Array): Promise<void>
  remove(userId: string, projectId: string, path: string): Promise<void>

  /** Create a project: provision backend storage, insert the `projects`
   *  row, return it. Rebyte must populate `vm_id` before INSERT. Throws
   *  on failure — callers assume either the project exists fully or not
   *  at all. */
  createProject(opts: { userId: string; projectId: string; name: string }): Promise<ProjectRow>

  /** Delete a project: remove the `projects` row and tear down backend
   *  storage (local: rm -rf; rebyte: DELETE /agent-computers/:vm_id).
   *  Returns false if the row did not exist (caller maps to 404). */
  deleteProject(opts: { userId: string; projectId: string }): Promise<boolean>

  /** Duplicate a project: copy storage from `sourceId` into a new row,
   *  return it. Rebyte may throw 501 (not implemented); local copies the
   *  project dir with fs.cp. Returns null if the source row is missing. */
  duplicateProject(opts: { userId: string; sourceId: string }): Promise<ProjectRow | null>

  /** Apply a design system to an existing project: write the preset's
   *  `impeccable.md` to the project root as `.impeccable.md` and copy any
   *  assets into `.skills/design-systems/<id>/`. The `id` must match a
   *  `DESIGN_SYSTEMS` entry AND have backing content on disk — unknown
   *  ids and missing content are hard errors. Rebyte throws 501. */
  applyDesignSystem(opts: { userId: string; projectId: string; id: string }): Promise<void>

  /** Apply a building skill to an existing project: copy the skill's
   *  directory into `.skills/building/<id>/`. Same contract as
   *  `applyDesignSystem` — no defaults, no fallback. Rebyte throws 501. */
  applyBuildingSkill(opts: { userId: string; projectId: string; id: string }): Promise<void>
}
