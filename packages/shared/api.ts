/**
 * Shared authenticated API client.
 *
 * Platform bootstrap (done once at app start):
 *   setApiBase('/api/app')                        // web
 *   setApiBase('https://adits.ai/api/app')        // mobile
 *   setTokenGetter(() => clerk.getToken())        // both
 *
 * After that, all call sites just import the named endpoint helpers
 * (fetchProjects, uploadFile, editFile, ...) and they Just Work.
 *
 * Uses the standard fetch API only — no DOM-specific types, no RN
 * polyfills. Safe to use from web, React Native, and Cloudflare Workers.
 */

import type { AskDesignQuestionsPayload } from './ask-design-questions'

// ─── Bootstrap ───

let apiBase = ''
let getToken: (() => Promise<string | null>) | null = null

/** Set the base URL that every relative API call is prefixed with.
 *  Web: '/api/app'. Mobile: the absolute prod URL. */
export function setApiBase(base: string) {
  apiBase = base
}

/** Register a getter that returns the current Clerk JWT (or null). */
export function setTokenGetter(fn: () => Promise<string | null>) {
  getToken = fn
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken?.()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Fetch any URL with the current auth token attached. Takes a full URL,
 *  not a path — useful for file download URLs. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const auth = await authHeaders()
  for (const [k, v] of Object.entries(auth)) headers.set(k, v)
  return fetch(url, { ...init, headers })
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const auth = await authHeaders()
  for (const [k, v] of Object.entries(auth)) headers.set(k, v)
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${apiBase}${path}`, { ...init, headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? `API ${res.status}`)
  }
  return res
}

async function apiJSON<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init)
  return res.json() as Promise<T>
}

/** Build a full URL for a relative API path — useful for <img src>,
 *  <video src>, expo-image's source.uri, etc. Does NOT attach auth. */
export function apiUrl(path: string): string {
  return `${apiBase}${path}`
}

// ─── Projects ───

export interface ApiProject {
  id: string
  name: string
  workspace_id: string
  user_id: string
  /** HTTP origin that serves this project's file tree. Synthesized
   *  server-side from the project's `sandbox_config` (rebyte) or as a
   *  static localhost path (local). May be null for rebyte projects whose
   *  sandbox_config isn't populated yet (still provisioning). The
   *  sandbox is treated as a Lambda — the URL is safe to embed without
   *  pre-warming the VM; the first request resumes a paused VM via the
   *  sandbox gateway. */
  file_server_root: string | null
  created_at: string
  updated_at?: string
}

export async function fetchProjects(): Promise<ApiProject[]> {
  return apiJSON<ApiProject[]>('/projects')
}

/** Create a project. Accepts an optional client-supplied UUID v4 so the
 *  frontend can insert the project optimistically while the backend
 *  agent-computer provisioning round-trip (~10-15s) completes.
 *
 *  `designSystemId` and `buildingSkillId` are applied atomically by the
 *  server — passing either one writes files into the new project before
 *  the response returns. Unknown ids return 400; an apply failure rolls
 *  back the project entirely. */
export async function createProject(
  name: string,
  opts?: {
    id?: string
    designSystemId?: string | null
    buildingSkillId?: string | null
  },
): Promise<ApiProject> {
  return apiJSON<ApiProject>('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      id: opts?.id,
      designSystemId: opts?.designSystemId ?? null,
      buildingSkillId: opts?.buildingSkillId ?? null,
    }),
  })
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/projects/${id}`, { method: 'DELETE' })
}

/** Rename a project. The D1 row is updated immediately; the Rebyte
 *  agent-computer's name stays as originally created (Rebyte v1 has no
 *  rename endpoint). */
export async function renameProject(id: string, name: string): Promise<void> {
  await apiFetch(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

/** Duplicate a project. Server copies the project dir (local mode) +
 *  inserts a new row with name "<original> (Copy)". Returns the new
 *  ApiProject so callers get the synthesized `file_server_root` for free. */
export async function duplicateProject(id: string): Promise<ApiProject> {
  return apiJSON<ApiProject>(`/projects/${id}/duplicate`, {
    method: 'POST',
  })
}

// ─── Files ───

export interface ApiFile {
  id: string
  name: string
  type: string
  size: number
  fs_path: string
  thumb_path?: string | null
  kind?: 'sandbox' | 'link'
  created_at: string
}

/** Fetch a project's live file list from the sandbox. */
export async function fetchFiles(projectId: string): Promise<ApiFile[]> {
  return apiJSON<ApiFile[]>(`/projects/${projectId}/files`)
}

/** Upload a file as multipart form-data. Caller constructs the FormData
 *  (web appends a File, RN appends { uri, name, type }). */
export async function uploadFile(projectId: string, form: FormData): Promise<ApiFile> {
  const res = await apiFetch(`/projects/${projectId}/files`, { method: 'POST', body: form })
  return res.json() as Promise<ApiFile>
}

/** Write raw bytes to a caller-specified path under the project's
 *  sandbox root (`/code/<path>`). Unlike `uploadFile`, this does
 *  NOT register the upload as a user-visible file — used for prompt
 *  artifacts (screenshots, draw exports, comment crops) that the
 *  agent reads from disk but the user shouldn't see in the file grid. */
export async function uploadBlob(
  projectId: string,
  path: string,
  blob: Blob,
  fileName?: string,
): Promise<{ path: string }> {
  const form = new FormData()
  form.append('path', path)
  form.append('file', new File([blob], fileName ?? path.split('/').pop() ?? 'blob', { type: blob.type }))
  const res = await apiFetch(`/projects/${projectId}/blobs`, { method: 'POST', body: form })
  return res.json() as Promise<{ path: string }>
}

export async function deleteFile(id: string): Promise<void> {
  await apiFetch(`/files/${id}`, { method: 'DELETE' })
}

export async function fetchFileBlob(id: string): Promise<Blob> {
  const res = await apiFetch(`/files/${id}/download`)
  return res.blob()
}

/** Authenticated download URL — prefer authFetch or fetchFileBlob for
 *  programmatic use; this helper is for constructing a URL to hand to a
 *  native image component that also needs an Authorization header. */
export function fileDownloadUrl(id: string): string {
  return `${apiBase}/files/${id}/download`
}

// ─── Active tasks ───

export interface ApiTask {
  id: string
  prompt: string
  title: string | null
  status: string
  url: string | null
  created_at: string
  completed_at: string | null
}

export async function fetchProjectAllTasks(projectId: string): Promise<ApiTask[]> {
  return apiJSON<ApiTask[]>(`/projects/${projectId}/all-tasks`)
}

// ─── Edit (agentic file editing) ───

export interface EditResult {
  id: string
  workspaceId: string
  status: string
  url: string
}

/** Structured reference shape shared by the bench walker (frontend), the
 *  API client, and the `/projects/:pid/edit` backend handler. One source
 *  of truth — keep imports pointing here rather than redeclaring. */
export type EditFileRef =
  | { kind: 'file'; id: string; token: string }
  | { kind: 'segment'; id: string; token: string; startSec: number; endSec: number }

export interface EditFilePayload {
  text: string
  references: EditFileRef[]
}

/** Regex matching the reference-token format used by the bench walker and
 *  the backend's substitution pass. `\u27E6` = ⟦ and `\u27E7` = ⟧ — Unicode
 *  math brackets chosen so natural prose can never collide. Exported as a
 *  single constant so callers use the same shape on both sides. Use
 *  `makeEditRefToken(n)` to generate tokens. */
export const EDIT_REF_TOKEN_RE = /^\u27E6adit:\d+\u27E7$/
export const EDIT_REF_TOKEN_RE_G = /\u27E6adit:\d+\u27E7/g
export function makeEditRefToken(n: number): string {
  return `\u27E6adit:${n}\u27E7`
}

export async function editFile(
  projectId: string,
  fileId: string,
  payload: EditFilePayload,
): Promise<EditResult> {
  return apiJSON<EditResult>(`/projects/${projectId}/edit`, {
    method: 'POST',
    body: JSON.stringify({
      fileId,
      prompt: payload.text,
      references: payload.references,
    }),
  })
}

// ─── Tasks ───

export async function fetchTask(taskId: string): Promise<{ id: string; status: string; title: string }> {
  return apiJSON(`/tasks/${taskId}`)
}

export interface TaskFrame {
  /** Per-prompt monotonic sequence number. The SSE endpoint accepts
   *  `?fromSeq=N` to skip frames the client already has. */
  seq: number
  data: unknown
}

export interface TaskPrompt {
  id: string
  status: string
  userPrompt: string
  executor: string
  model: string | null
  submittedAt: string
  completedAt: string | null
  frames: TaskFrame[]
  /** Structured question form the agent emitted on this turn via the
   *  `ask-design-questions` skill. `null` / undefined when the turn was
   *  a normal prose response. Shape mirrors
   *  `AskDesignQuestionsPayload` from packages/shared. */
  formPayload?: AskDesignQuestionsPayload | null
}

export interface TaskContent {
  id: string
  status: string
  prompts: TaskPrompt[]
}

/** Full transcript (user prompts + agent responses) for a task. */
export async function fetchTaskContent(taskId: string): Promise<TaskContent> {
  return apiJSON<TaskContent>(`/tasks/${taskId}/content`)
}

export interface CancelTaskResult {
  id: string
  status: string
  canceledPrompts?: number
}

/** Cancel a running task. Forwards to the backend which in turn calls
 *  Rebyte's `POST /v1/tasks/:id/cancel`. Safe to call against an already
 *  terminal task — the backend's monotonic guard makes it a no-op. */
export async function cancelTask(taskId: string): Promise<CancelTaskResult> {
  return apiJSON<CancelTaskResult>(`/tasks/${taskId}/cancel`, { method: 'POST' })
}

/** Rebyte's response shape from POST /tasks. Camel-case, no prompt field —
 *  the caller already knows the prompt it sent. */
export interface CreateTaskResponse {
  id: string
  workspaceId?: string
  url?: string
  status?: string
  createdAt?: string
}

/** Create a new task on a project (a.k.a. "start a new chat"). */
export async function createTask(
  projectId: string,
  body: { prompt: string; executor?: string; model?: string; skills?: string[] },
): Promise<CreateTaskResponse> {
  return apiJSON<CreateTaskResponse>(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Send a follow-up prompt to an existing task. */
export async function sendTaskPrompt(
  taskId: string,
  body: { prompt: string; executor?: string; model?: string; skills?: string[] },
): Promise<{ promptId?: string }> {
  return apiJSON<{ promptId?: string }>(`/tasks/${taskId}/prompts`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ─── User sync ───

export async function syncUser(email: string, name?: string, avatarUrl?: string): Promise<void> {
  await apiFetch('/me', {
    method: 'POST',
    body: JSON.stringify({ email, name, avatarUrl }),
  })
}
