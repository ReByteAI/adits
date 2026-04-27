/**
 * Web-side API client.
 *
 * The real implementation lives in `packages/shared/api.ts` — this file
 * re-exports it, wires the web API base (`/api/app`), and adds a thin
 * `uploadFile(File)` wrapper for call sites that pass a DOM File object.
 */

import { setApiBase, uploadFile as uploadFileForm, type ApiFile } from '../../packages/shared/api'

setApiBase('/api/app')

export {
  setTokenGetter,
  authFetch,
  apiUrl,
  fileDownloadUrl,
  fetchProjects,
  createProject,
  deleteProject,
  renameProject,
  duplicateProject,
  fetchFiles,
  deleteFile,
  fetchFileBlob,
  fetchProjectAllTasks,
  fetchTask,
  cancelTask,
  createTask,
  sendTaskPrompt,
  fetchTaskContent,
  syncUser,
} from '../../packages/shared/api'

export type {
  ApiProject,
  ApiFile,
  ApiTask,
  TaskContent,
  TaskPrompt,
} from '../../packages/shared/api'

/** Web convenience wrapper — takes a DOM File, wraps it in a FormData,
 *  delegates to the shared multipart uploader.
 *
 *  `opts.path` is an optional sandbox-relative destination (no leading
 *  slash). Without it the server defaults to `uploads/<file.name>`.
 *  Callers that need a specific destination — Napkin save, New Sketch
 *  — pass it explicitly. */
export async function uploadFile(
  projectId: string,
  file: File,
  opts?: { path?: string },
): Promise<ApiFile> {
  const form = new FormData()
  form.append('file', file)
  if (opts?.path) form.append('path', opts.path)
  return uploadFileForm(projectId, form)
}
