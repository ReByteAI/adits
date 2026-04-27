import { create } from 'zustand'
import { fetchProjects, createProject, fetchFiles, uploadFile, fetchFileBlob, syncUser, fetchProjectAllTasks, deleteFile as apiDeleteFile, cancelTask as apiCancelTask, renameProject as apiRenameProject, deleteProject as apiDeleteProject, createTask as apiCreateTask, sendTaskPrompt as apiSendTaskPrompt, duplicateProject as apiDuplicateProject } from './api.ts'
import type { ApiProject, ApiTask } from './api.ts'
import { formatSize, fileId, apiFileToFileData } from './data.ts'
import { detectType, classifyPath } from '../../packages/shared/file-types'
import type { FileData, Project } from './data.ts'
import { generateProjectName } from './name-generator.ts'
import type { AskDesignQuestionsPayload } from '../../packages/shared/ask-design-questions'
import { queryClient } from './query-client.ts'
import { clearLoadedProjects } from './components/ProjectGate.tsx'
import {
  updateProjectFiles,
  mergeServerFiles,
  cancelTaskOptimistic,
} from '../../packages/shared/store'

// ─── Types ───

interface ProjectStore {
  // State
  projects: Project[]
  /** Sidebar's project list — owned by the store. Per-project VM-warm +
   *  file-list status is owned by `ProjectGate`, not this store. */
  projectsStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Single source of truth for task lists, keyed by projectId. The Sidebar reads from
   *  here; webhook events refresh the affected project's slice. */
  tasksByProject: Record<string, ApiTask[]>
  activeProjectId: string | null
  activeFileId: string | null
  sidebarOpen: boolean
  promptDirty: boolean
  pendingProjectSwitch: string | null  // project ID waiting for user confirmation
  pendingBenchLeave: boolean           // Escape/close pressed with dirty prompt
  /** Monotonic counter — bumped by ChatPanel when any prompt reaches
   *  terminal status. Bench's `PageViewer` consumes it as a cache-buster
   *  query param on the iframe `src`, forcing a reload so the user sees
   *  the agent's edits to whatever HTML file is open. The file id stays
   *  the same when an agent overwrites a path, so without this bump the
   *  iframe just keeps showing whatever it loaded first. */
  iframeReloadKey: number
  bumpIframeReloadKey: () => void
  /** Active `ask-design-questions` form payload, published by ChatPanel
   *  when the latest terminal prompt in the loaded task has
   *  `formPayload` set and no follow-up prompt has been sent yet. The
   *  Bench pane reads this and takes over the right-hand surface with
   *  the `QuestionForm` renderer. Cleared when the user submits (a
   *  follow-up arrives) or when the task / project changes. */
  activeForm: { taskId: string; promptId: string; payload: AskDesignQuestionsPayload } | null
  setActiveForm: (next: { taskId: string; promptId: string; payload: AskDesignQuestionsPayload } | null) => void

  // Navigation
  selectProject: (id: string) => void
  confirmProjectSwitch: () => void
  cancelProjectSwitch: () => void
  requestBenchLeave: () => void
  confirmBenchLeave: () => void
  cancelBenchLeave: () => void
  setPromptDirty: (dirty: boolean) => void
  selectFile: (projectId: string, fileId: string) => void
  toggleSidebar: () => void

  // Data loading
  init: (user: { email: string; name?: string; avatarUrl?: string }) => Promise<void>
  /** Fetch files + tasks for one project, replacing the project's `files`
   *  array with the server listing. Always fetches — no guard. Called by
   *  `ProjectGate` on mount. Throws on failure so the caller can flip into
   *  an error state. */
  loadProjectFiles: (projectId: string) => Promise<void>
  /** Force-refresh the active project's files + tasks, and `tasksByProject`
   *  for every loaded project. Merges by id via `mergeServerFiles` so
   *  in-flight optimistic uploads (`pending: true`) and existing blob
   *  URLs survive the refresh. Used as the tab-focus safety net that
   *  catches task events the SSE push may have dropped while the tab
   *  was hidden. Best-effort: errors are logged and swallowed. */
  refreshOnFocus: () => Promise<void>

  // Project actions
  /** Create a new project. Optimistically inserts into the sidebar, then
   *  awaits backend provisioning. Returns the project id once fully ready.
   *  Callers must await before doing dependent ops (upload, link, edit).
   *
   *  `designSystemId` and `buildingSkillId` flow through to the server,
   *  which applies them atomically — if either fails, the project row
   *  and its files are deleted before the promise rejects. Both ids are
   *  optional; unset = empty project. */
  addProject: (
    name?: string,
    opts?: { designSystemId?: string | null; buildingSkillId?: string | null },
  ) => Promise<string>
  /** Rename an existing project. Optimistically updates the sidebar and
   *  PATCHes /projects/:id; rolls back on failure. The Rebyte agent-
   *  computer's name is not renamed (Rebyte v1 has no rename endpoint). */
  renameProject: (id: string, name: string) => Promise<void>
  /** Delete a project immediately. Optimistically drops the row from the
   *  sidebar and DELETEs /projects/:id; rolls back on failure. Prefer
   *  `scheduleProjectDelete` for user-initiated deletes — that one adds a
   *  5-second undo window so the user can recover from an accidental click. */
  removeProject: (id: string) => Promise<void>
  /** Duplicate a project (server copies the project dir + DB row).
   *  Returns the new project's id so the caller can navigate to it.
   *  Inserts the new row at the top of the sidebar on success. */
  duplicateProject: (id: string) => Promise<string>

  /** Soft-delete: hide the row from the sidebar and stash it in
   *  `pendingDelete` for a 5-second undo window. The real DELETE API call
   *  only fires when the window expires (via `commitPendingDelete`). While
   *  a pending delete is active, the sidebar renders an undo bar. */
  pendingDelete: {
    project: Project
    index: number
    /** Restored if the user hits Undo — only meaningful when the deleted
     *  project was the one being viewed. */
    wasActive: boolean
    activeFileId: string | null
    expiresAt: number
  } | null
  scheduleProjectDelete: (id: string) => void
  /** Cancel the pending delete and restore the row at its original index.
   *  No-op if there's nothing pending. */
  undoPendingDelete: () => void
  /** Fire the real DELETE API and clear `pendingDelete`. Called by the
   *  5-second timer, and also synchronously when a new delete is scheduled
   *  while another one is still pending. */
  commitPendingDelete: () => Promise<void>
  addFile: (projectId: string, file: File, opts?: { folder?: string }) => Promise<void>
  removeFile: (projectId: string, fileId: string) => Promise<void>
  /** Start a new chat-side task. Optimistically inserts a 'running' row
   *  at the top of the project's task list and POSTs to /projects/:pid/tasks.
   *  On success, swaps the optimistic id for the server-assigned one and
   *  returns that id so the caller can load the task into the Chat tab.
   *  Rolls back on failure. */
  createChatTask: (projectId: string, prompt: string, opts?: { executor?: string; model?: string }) => Promise<string>
  /** Send a follow-up prompt to an existing task. Thin wrapper around the
   *  API call — doesn't touch the task list (the task row keeps its id and
   *  status; only its internal prompts grow). The caller is responsible
   *  for any session-scoped UI state (e.g., echoing the prompt in the
   *  active thread) since we don't store per-task message lists yet. */
  sendFollowUp: (taskId: string, prompt: string, opts?: { executor?: string; model?: string }) => Promise<string | null>
  /** Cancel a running task. Optimistically transitions the row in
   *  tasksByProject to 'canceled'. Rolls back if the API call fails.
   *  The eventual task.canceled webhook is a no-op against the terminal row. */
  cancelTask: (taskId: string) => Promise<void>
}

// ─── Helpers ───

/** Timer handle for the pending delete's undo window. Lives at module
 *  scope (not in Zustand state) because it's a Node/browser timeout id,
 *  not UI state. The data about *what* is pending lives in the store's
 *  `pendingDelete` field — this is purely the handle we need to cancel. */
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null
/** How long the undo toolbar stays visible before the delete is committed.
 *  Matches Gmail / Linear / macOS Mail. Change here to tune. */
export const PENDING_DELETE_MS = 5000

/** Create a blob URL and track it for cleanup. */
const blobUrls = new Set<string>()
function createBlobUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  blobUrls.add(url)
  return url
}

// updateProjectFiles, mergeServerFiles — imported from shared/store

/** Lazy thumbnail-fetch loop. Walks the given files, kicks off a
 *  fetchFileBlob for each that needs a thumb/src, and on each blob arrival
 *  patches that one file's thumb (or src) into the store. Fire-and-forget;
 *  caller doesn't await. Used by both loadProjectFiles (initial load) and
 *  onTaskEvent's post-task refresh.
 *
 *  The blob fetch updates only the file inside the matching project, so
 *  cross-project navigation mid-fetch doesn't cause incorrect renders —
 *  the blob still lands on its original project's card and the user sees
 *  it next time they visit. */
function lazyFetchFileBlobs(
  setStore: (fn: (s: ProjectStore) => Partial<ProjectStore>) => void,
  projectId: string,
  files: FileData[],
): void {
  for (const fd of files) {
    if (fd.thumb || fd.src) continue  // already have one (e.g. preserved across a merge)
    const ft = detectType(fd.name)
    if (!ft.needsThumb && !ft.needsSrc) continue

    // Share one blob fetch across every caller for this file id: the
    // cache branch of loadProjectFiles, the live branch, the
    // onTaskEvent refresh, and any mounted `FileCard`'s `useFileBlob`
    // query. `ensureQueryData` is React Query's native primitive for
    // "run this queryFn, or return the cached value, or share the
    // currently-in-flight promise" — keyed by `queryKey`, so all
    // three paths converge on a single fetch and a single URL string.
    // This is what actually fixes the flicker: the historical bug was
    // two independent fetches producing two different createObjectURL
    // strings that overwrote each other in state.
    queryClient.ensureQueryData<string>({
      queryKey: ['file-blob', fd.id],
      queryFn: async () => createBlobUrl(await fetchFileBlob(fd.id)),
      staleTime: Infinity,
    }).then(url => {
      setStore(s => ({
        projects: updateProjectFiles(s.projects, projectId, fs =>
          fs.map(f => {
            if (f.id !== fd.id) return f
            return ft.needsThumb ? { ...f, thumb: url } : { ...f, src: url }
          })
        ),
      }))
    }).catch(() => { /* non-critical */ })
  }
}

// ─── Store ───

export const useStore = create<ProjectStore>((set, get) => ({
  // Initial state
  projects: [],
  projectsStatus: 'idle',
  tasksByProject: {},
  activeProjectId: null,
  activeFileId: null,
  sidebarOpen: false,
  promptDirty: false,
  pendingProjectSwitch: null,
  pendingBenchLeave: false,
  pendingDelete: null,
  iframeReloadKey: 0,
  bumpIframeReloadKey: () => set(s => ({ iframeReloadKey: s.iframeReloadKey + 1 })),
  activeForm: null,
  setActiveForm: (next) => set({ activeForm: next }),

  // ─── Navigation ───

  selectProject: (id) => {
    const { activeProjectId, promptDirty, projects } = get()
    if (id === activeProjectId) return
    // Empty id = clear selection (user hit the home button / navigated
    // to /projects). No project-list validation needed. We don't route
    // through pendingProjectSwitch because that state is tracked as a
    // concrete id elsewhere; "go home" is a direct, explicit user action
    // that clears the pending-switch dialog outright.
    if (!id) {
      set({ activeProjectId: null, activeFileId: null, pendingProjectSwitch: null })
      return
    }
    // Only select projects that belong to this user. The `projects.length === 0`
    // case is the init-race window: hash sets activeProjectId before init's
    // fetchProjects returns. We let the speculative selection through here,
    // and init() validates against the loaded list when it's done.
    if (projects.length > 0 && !projects.some(p => p.id === id)) return
    if (promptDirty) {
      set({ pendingProjectSwitch: id })
      return
    }
    // Just flip activeProjectId. `ProjectGate` is keyed on the id and
    // owns the VM-warm + file-list boot on mount — nothing to call here.
    set({ activeProjectId: id, activeFileId: null })
  },

  confirmProjectSwitch: () => {
    const { pendingProjectSwitch, projects } = get()
    if (!pendingProjectSwitch) return
    // Re-validate against the loaded list — the project might have been
    // deleted (e.g., from another tab) while the dialog was open. Drop
    // the pending switch but keep promptDirty so the user's unsent prompt
    // isn't silently abandoned the next time they try to switch.
    if (!projects.some(p => p.id === pendingProjectSwitch)) {
      set({ pendingProjectSwitch: null })
      return
    }
    // `ProjectGate` picks up the new activeProjectId and runs its own
    // sequenced boot — no loadProjectFiles call here.
    set({ activeProjectId: pendingProjectSwitch, activeFileId: null, pendingProjectSwitch: null, promptDirty: false })
  },

  cancelProjectSwitch: () => set({ pendingProjectSwitch: null }),

  requestBenchLeave: () => {
    if (get().promptDirty) {
      set({ pendingBenchLeave: true })
    } else {
      (window as any).__closeBench?.()
    }
  },

  confirmBenchLeave: () => {
    set({ pendingBenchLeave: false, promptDirty: false })
    ;(window as any).__closeBench?.()
  },

  cancelBenchLeave: () => set({ pendingBenchLeave: false }),

  setPromptDirty: (dirty) => set({ promptDirty: dirty }),

  selectFile: (projectId, fid) => set({ activeProjectId: projectId, activeFileId: fid }),

  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),

  // ─── Data loading ───
  //
  // Two scopes, each with a single owner:
  //
  //   - projectsStatus / projects[] — owned here. init() loads the list
  //     from D1 and sets projectsStatus: 'ready'. Sidebar reads it.
  //     `fileServerRoot` is part of the row from the server, so HTML
  //     iframes / image previews have it the moment the sidebar lights up.
  //   - Per-project file list — owned by `ProjectGate`. The gate calls
  //     `loadProjectFiles` on mount and tracks its own booting/ready/error
  //     state. Sandboxes are Lambdas: the file fetch resumes a paused VM
  //     transparently via the sandbox gateway, no pre-warm needed.
  //
  // No global loading flag, no auto-select. The user explicitly opts into
  // a project via the sidebar or URL hash; we never speculatively warm a
  // project they didn't ask for.

  init: async (user) => {
    set({ projectsStatus: 'loading' })
    // Reset the gate's session-scoped "already loaded" set so a sign-
    // out/sign-in (or any re-init) forces every ProjectGate mount to
    // re-run its sequenced boot against the freshly fetched project
    // list. Without this, stale ids could short-circuit the boot and
    // leave the right pane empty.
    clearLoadedProjects()
    try {
      await syncUser(user.email, user.name, user.avatarUrl)
      const apiProjects = await fetchProjects()
      const projects: Project[] = apiProjects.map((p: ApiProject) => ({
        id: p.id,
        name: p.name,
        workspaceId: p.workspace_id,
        files: [],
        // Fetched projects are already on the server — never in flight.
        provisioning: false,
        fileServerRoot: p.file_server_root,
      }))

      // Populate tasksByProject upfront so the sidebar's per-project
      // running-task badge ((N) next to the count) shows for every project,
      // not just the ones the user has clicked. fetchProjectAllTasks is
      // D1-only with a capped read-through reconcile — cheap relative to
      // the SDK file-list cost. Reset (don't merge) to avoid leaking the
      // previous user's task lists across a sign-out/sign-in cycle.
      const tasksByProject: Record<string, ApiTask[]> = {}
      await Promise.all(apiProjects.map(async (p: ApiProject) => {
        try {
          tasksByProject[p.id] = await fetchProjectAllTasks(p.id)
        } catch {
          tasksByProject[p.id] = []
        }
      }))

      // If there's already an activeProjectId (set by URL hash before init
      // ran), validate it against the loaded list. Clear if it's stale.
      // Don't fire loadProjectFiles here — `ProjectGate` owns the per-
      // project file load and will fetch on mount.
      const activeId = get().activeProjectId
      const validActiveId = activeId && projects.some(p => p.id === activeId) ? activeId : null
      const patch: Partial<ProjectStore> = {
        projects,
        projectsStatus: 'ready',
        tasksByProject,
      }
      if (validActiveId !== activeId) patch.activeProjectId = validActiveId
      set(patch)
    } catch (err) {
      console.error('Failed to load projects:', err)
      // Reset tasksByProject too — if init() ran before for a different
      // user and we're failing on the new user's first request, we mustn't
      // leave the previous user's task lists hanging around.
      set({ projectsStatus: 'error', tasksByProject: {} })
    }
  },

  loadProjectFiles: async (projectId) => {
    // Page-reload race: V2App's selectProject(URL) sets activeProjectId
    // before init()'s fetchProjects resolves, so ProjectGate may call us
    // while `projects` is still []. Previously `projects.find(…) return`
    // bailed silently here, leaving the gate in 'ready' with no files and
    // no retry (flaky empty-state bug). Wait for init to finish so the
    // row exists by the time we apply.
    const firstStatus = get().projectsStatus
    if (firstStatus === 'idle' || firstStatus === 'loading') {
      await new Promise<void>(resolve => {
        const unsub = useStore.subscribe(s => {
          if (s.projectsStatus === 'ready' || s.projectsStatus === 'error') {
            unsub()
            resolve()
          }
        })
        const now = useStore.getState().projectsStatus
        if (now === 'ready' || now === 'error') {
          unsub()
          resolve()
        }
      })
    }

    const project = get().projects.find(p => p.id === projectId)
    if (!project) {
      // Project genuinely doesn't exist for this user (or init failed).
      // Throw so ProjectGate's catch flips to its error-with-Retry state
      // instead of leaving the bench in a stuck empty state.
      throw new Error(`Project ${projectId} not found`)
    }
    // No status tracking here — `ProjectGate` owns the booting/ready/error
    // state. Sandboxes are Lambdas: /files lands on a paused VM the
    // sandbox gateway auto-resumes. Throws on failure; the gate flips
    // into its error state and shows Retry.
    const [apiFiles, tasks] = await Promise.all([
      fetchFiles(projectId),
      fetchProjectAllTasks(projectId).catch(() => [] as ApiTask[]),
    ])
    const liveFiles = apiFiles.map(apiFileToFileData)
    const serverNames = new Set(liveFiles.map(f => f.name))
    set(s => ({
      projects: s.projects.map(p => {
        if (p.id !== projectId) return p
        // Preserve any optimistic rows whose upload is still in flight
        // (`pending: true`) AND whose name isn't in the server listing
        // yet. This is the "create project + drop file immediately"
        // flow: the provisioning wait resolves and the gate calls us
        // while `uploadFile` is still running, so /files doesn't
        // include the new file yet. Without this preservation the
        // pending row gets wiped and the upload success handler
        // no-ops (its tempId is gone), leaving the user staring at an
        // empty project. Same name-dedupe as `mergeServerFiles` so we
        // don't flash a duplicate if the upload already landed.
        const pendingLocal = p.files.filter(f =>
          f.pending && !serverNames.has(f.name)
        )
        return { ...p, files: [...pendingLocal, ...liveFiles] }
      }),
      tasksByProject: { ...s.tasksByProject, [projectId]: tasks },
    }))
    lazyFetchFileBlobs(set, projectId, liveFiles)
  },

  refreshOnFocus: async () => {
    // Catch-up safety net for missed SSE pushes. When the tab becomes
    // visible again, the backend may have terminal events we never
    // received (fetchEventSource drops the connection on hidden), so we
    // re-fetch every project's task list (cheap: D1-only with capped
    // read-through reconcile) and, for the currently-open project,
    // also re-fetch its files so any newly-produced agent outputs show
    // up. Per-project failures are swallowed so one stale workspace
    // can't block the rest.
    const { projects, activeProjectId } = get()
    if (projects.length === 0) return

    // Parallel task refresh for every project. Each call also runs the
    // backend read-through, so this doubles as a "reconcile-all" pass.
    const taskResults = await Promise.all(
      projects.map(p =>
        fetchProjectAllTasks(p.id).then(
          tasks => ({ id: p.id, tasks }),
          () => null,
        )
      )
    )
    const freshTasksByProject: Record<string, ApiTask[]> = {}
    for (const r of taskResults) if (r) freshTasksByProject[r.id] = r.tasks

    set(s => ({
      tasksByProject: { ...s.tasksByProject, ...freshTasksByProject },
    }))

    // For the active project only, also refresh the file listing so
    // new agent-produced outputs appear. Other projects' file grids
    // re-fetch when they're next opened via `ProjectGate`. Cheap
    // focus-refresh shouldn't hammer every project's sandbox.
    if (!activeProjectId) return
    const activeProject = get().projects.find(p => p.id === activeProjectId)
    // Skip still-provisioning projects — there's no backend row to list
    // against yet. `ProjectGate` (not this path) handles the first load.
    if (!activeProject || activeProject.provisioning) return
    try {
      const apiFiles = await fetchFiles(activeProjectId)
      const refreshed = apiFiles.map(apiFileToFileData)
      set(s => ({
        projects: updateProjectFiles(s.projects, activeProjectId, oldFiles =>
          mergeServerFiles(oldFiles, refreshed)
        ),
      }))
      lazyFetchFileBlobs(set, activeProjectId, refreshed)
    } catch (err) {
      console.warn('[refreshOnFocus] active project file refresh failed:', err)
    }
  },

  // ─── Project actions ───

  addProject: async (nameArg, opts) => {
    const id = crypto.randomUUID()
    const trimmed = nameArg?.trim()
    const name = trimmed && trimmed.length > 0 ? trimmed : generateProjectName()
    const project: Project = {
      id,
      name,
      workspaceId: '',
      files: [],
      provisioning: true,
    }

    // Optimistic insert — sidebar shows the project immediately. Do
    // NOT flip activeProjectId here: the row isn't on the server yet,
    // so any consumer that mounts on activeProjectId change (e.g.
    // ProjectGate's GET /files) would race POST /projects and the
    // server's lookup 404s with `Project not found`. Callers already
    // call selectProject(id) AFTER awaiting addProject, which is the
    // correct moment to flip activeProjectId.
    set(s => ({
      projects: [project, ...s.projects],
    }))

    try {
      const p = await createProject(name, {
        id,
        designSystemId: opts?.designSystemId ?? null,
        buildingSkillId: opts?.buildingSkillId ?? null,
      })
      set(s => ({
        projects: s.projects.map(pr =>
          pr.id === id
            ? { ...pr, workspaceId: p.workspace_id, fileServerRoot: p.file_server_root, provisioning: false }
            : pr
        ),
      }))
      return id
    } catch (err) {
      console.error('Failed to create project:', err)
      set(s => ({
        projects: s.projects.filter(pr => pr.id !== id),
        activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
      }))
      throw err
    }
  },

  renameProject: async (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const before = get().projects.find(p => p.id === id)
    if (!before || before.name === trimmed) return
    // Optimistic rename: sidebar row updates instantly, rolled back on
    // failure so we don't leave the user staring at a phantom name.
    set(s => ({
      projects: s.projects.map(p => p.id === id ? { ...p, name: trimmed } : p),
    }))
    try {
      await apiRenameProject(id, trimmed)
    } catch (err) {
      console.error('Failed to rename project:', err)
      set(s => ({
        projects: s.projects.map(p => p.id === id ? { ...p, name: before.name } : p),
      }))
      throw err
    }
  },

  duplicateProject: async (id) => {
    const resp = await apiDuplicateProject(id)
    // Prepend the new project to the sidebar so it shows up without a
    // round-trip. Full refresh still happens on the next focus/fetch.
    set(s => {
      // If the server name differs (it appends " (Copy)"), insert a row
      // synthesized from the source project's files as a placeholder —
      // a subsequent loadProjectFiles will replace it.
      const source = s.projects.find(p => p.id === id)
      if (!source) return s
      const created: Project = {
        ...source,
        id: resp.id,
        name: resp.name,
        workspaceId: resp.workspace_id,
        files: [],
        provisioning: false,
        fileServerRoot: resp.file_server_root,
      }
      return { projects: [created, ...s.projects] }
    })
    return resp.id
  },

  removeProject: async (id) => {
    const before = get().projects
    const target = before.find(p => p.id === id)
    if (!target) return
    // Optimistic remove: drop the row immediately; if the deleted project
    // was the active one, clear activeProjectId so the welcome screen
    // takes over. Rollback restores the full list (including ordering).
    set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
      activeFileId: s.activeProjectId === id ? null : s.activeFileId,
    }))
    try {
      await apiDeleteProject(id)
    } catch (err) {
      console.error('Failed to delete project:', err)
      set({ projects: before })
      throw err
    }
  },

  scheduleProjectDelete: (id) => {
    const state = get()
    const index = state.projects.findIndex(p => p.id === id)
    if (index < 0) return
    const project = state.projects[index]

    // If another delete is already pending, commit it now so only one
    // undo bar is ever visible. We fire-and-forget here — the user has
    // already moved on and the API call is async.
    if (state.pendingDelete) {
      void get().commitPendingDelete()
    }

    // Snapshot the active-selection state so Undo restores not just the
    // row but the user's place in the app (they were editing files in
    // this project when they hit delete).
    const wasActive = state.activeProjectId === id
    const activeFileId = wasActive ? state.activeFileId : null

    set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      activeProjectId: wasActive ? null : s.activeProjectId,
      activeFileId: wasActive ? null : s.activeFileId,
      pendingDelete: {
        project,
        index,
        wasActive,
        activeFileId,
        expiresAt: Date.now() + PENDING_DELETE_MS,
      },
    }))

    if (pendingDeleteTimer !== null) clearTimeout(pendingDeleteTimer)
    pendingDeleteTimer = setTimeout(() => {
      void get().commitPendingDelete()
    }, PENDING_DELETE_MS)
  },

  undoPendingDelete: () => {
    const pending = get().pendingDelete
    if (!pending) return
    if (pendingDeleteTimer !== null) {
      clearTimeout(pendingDeleteTimer)
      pendingDeleteTimer = null
    }
    // Restore the project at its original index. If the list has shifted
    // during the undo window (e.g. a new project was added at the top),
    // `index` may no longer be the "right" slot — clamp it so we at least
    // re-insert into a valid position.
    set(s => {
      const insertAt = Math.min(pending.index, s.projects.length)
      const next = [...s.projects]
      next.splice(insertAt, 0, pending.project)
      return {
        projects: next,
        activeProjectId: pending.wasActive ? pending.project.id : s.activeProjectId,
        activeFileId: pending.wasActive ? pending.activeFileId : s.activeFileId,
        pendingDelete: null,
      }
    })
  },

  commitPendingDelete: async () => {
    const pending = get().pendingDelete
    if (!pending) return
    if (pendingDeleteTimer !== null) {
      clearTimeout(pendingDeleteTimer)
      pendingDeleteTimer = null
    }
    // Clear the pending slot before the network round-trip so the UI
    // stops showing the undo bar immediately; the project is already
    // gone from `projects`, so nothing else moves.
    set({ pendingDelete: null })
    try {
      await apiDeleteProject(pending.project.id)
    } catch (err) {
      console.error('Failed to commit project delete:', err)
      // Restore the row — the user thought it was gone but the server
      // still has it. Better to un-delete than to leave a phantom.
      set(s => {
        const insertAt = Math.min(pending.index, s.projects.length)
        const next = [...s.projects]
        next.splice(insertAt, 0, pending.project)
        return {
          projects: next,
          activeProjectId: pending.wasActive ? pending.project.id : s.activeProjectId,
          activeFileId: pending.wasActive ? pending.activeFileId : s.activeFileId,
        }
      })
    }
  },

  addFile: async (projectId, file, opts) => {
    const ft = detectType(file.name)
    const type = ft.key
    let thumb: string | undefined
    let src: string | undefined
    if (ft.needsThumb) thumb = createBlobUrl(file)
    else if (ft.needsSrc) src = createBlobUrl(file)

    const tempId = fileId()
    // Compose the destination path. Caller-supplied folder (e.g.
    // `uploads`, `scraps`) prefixes the file name; otherwise we mirror
    // the server's default of `uploads/<name>` so the optimistic
    // FileData matches what the server will actually write — no
    // role-flash when the response lands.
    const folder = opts?.folder ?? 'uploads'
    const path = `${folder}/${file.name}`
    const fileData: FileData = { id: tempId, name: file.name, path, role: classifyPath(path), type, size: formatSize(file.size), date: 'Just now', thumb, src, pending: true }

    // Optimistic add — file appears in grid immediately
    set(s => ({ projects: updateProjectFiles(s.projects, projectId, files => [fileData, ...files]) }))

    // Upload in background. We always pass the resolved path so the
    // server's behavior matches the optimistic state exactly.
    try {
      const uploaded = await uploadFile(projectId, file, { path })
      // Swap tempId → server id, clear pending
      set(s => ({
        projects: updateProjectFiles(s.projects, projectId, files =>
          files.map(f => {
            if (f.id !== tempId) return f
            const { pending: _p, ...rest } = f
            return { ...rest, id: uploaded.id }
          })
        ),
      }))
    } catch {
      set(s => ({
        projects: updateProjectFiles(s.projects, projectId, files =>
          files.filter(f => f.id !== tempId)
        ),
      }))
    }
  },

  removeFile: async (projectId, fileIdVal) => {
    const project = get().projects.find(p => p.id === projectId)
    if (!project) return
    const file = project.files.find(f => f.id === fileIdVal)
    if (!file) return

    // Snapshot for rollback
    const snapshot = project.files

    // Optimistic remove
    set(s => ({ projects: updateProjectFiles(s.projects, projectId, files => files.filter(f => f.id !== fileIdVal)) }))

    // Close bench if the open file was just deleted
    if (get().activeFileId === fileIdVal) {
      set({ activeFileId: null })
      ;(window as any).__closeBench?.()
    }

    try {
      await apiDeleteFile(fileIdVal)
    } catch (err) {
      console.error('[adit] Delete failed:', err)
      // Rollback
      set(s => ({ projects: updateProjectFiles(s.projects, projectId, () => snapshot) }))
      throw err
    }
  },

  createChatTask: async (projectId, prompt, opts) => {
    const trimmed = prompt.trim()
    if (!trimmed) throw new Error('prompt is required')
    const resp = await apiCreateTask(projectId, { prompt: trimmed, executor: opts?.executor, model: opts?.model })
    // Refresh the project's task list so History / TasksPanel show the
    // new task. ChatPanel keys off `loadedTaskId`; once we return `resp.id`
    // it'll fetch /content for the first prompt row and open the per-prompt
    // SSE for live frames.
    try {
      const fresh = await fetchProjectAllTasks(projectId)
      set(s => ({
        tasksByProject: { ...s.tasksByProject, [projectId]: fresh },
      }))
    } catch (err) {
      console.warn('[createChatTask] post-submit refresh failed:', err)
    }
    return resp.id
  },

  sendFollowUp: async (taskId, prompt, opts) => {
    const trimmed = prompt.trim()
    if (!trimmed) throw new Error('prompt is required')
    const res = await apiSendTaskPrompt(taskId, { prompt: trimmed, executor: opts?.executor, model: opts?.model })
    // Refresh tasksByProject for any panels (TasksPanel, History) that
    // key off it. ChatPanel triggers its own /content refetch via
    // `localRefetch` after handleSend resolves.
    const ownerProjectId = Object.keys(get().tasksByProject).find(pid =>
      get().tasksByProject[pid]?.some(t => t.id === taskId),
    )
    if (ownerProjectId) {
      try {
        const fresh = await fetchProjectAllTasks(ownerProjectId)
        set(s => ({ tasksByProject: { ...s.tasksByProject, [ownerProjectId]: fresh } }))
      } catch (err) {
        console.warn('[sendFollowUp] post-submit refresh failed:', err)
      }
    }
    return res.promptId ?? null
  },

  cancelTask: async (taskId) => {
    const { tasksByProject } = get()
    const snapshot = tasksByProject
    const result = cancelTaskOptimistic(tasksByProject, taskId)

    if (result.ownerProjectId) {
      set({ tasksByProject: result.tasksByProject })
    }

    try {
      await apiCancelTask(taskId)
    } catch (err) {
      console.error('[adit] Cancel failed:', err)
      if (result.ownerProjectId) {
        set({ tasksByProject: snapshot })
      }
      throw err
    }
  },
}))

// ─── Selectors (for performance — components only re-render when their slice changes) ───

/** Stable empty array reference so the selector below doesn't churn renders for
 *  projects with no tasks. */
const EMPTY_TASKS: ApiTask[] = []

export const useProjects = () => useStore(s => s.projects)
export const useProjectTasks = (projectId: string | null) =>
  useStore(s => (projectId ? s.tasksByProject[projectId] ?? EMPTY_TASKS : EMPTY_TASKS))
export const useActiveProjectId = () => useStore(s => s.activeProjectId)
export const useActiveFileId = () => useStore(s => s.activeFileId)
export const useProjectsStatus = () => useStore(s => s.projectsStatus)
export const useSidebarOpen = () => useStore(s => s.sidebarOpen)
export const usePendingProjectSwitch = () => useStore(s => s.pendingProjectSwitch)
export const usePendingBenchLeave = () => useStore(s => s.pendingBenchLeave)
export const useIframeReloadKey = () => useStore(s => s.iframeReloadKey)

// Derived selector — use useMemo in the component to avoid infinite loops
// Components should do: const files = useActiveProject()?.files ?? []
export const useActiveProject = () => useStore(s =>
  s.activeProjectId ? s.projects.find(p => p.id === s.activeProjectId) ?? null : null
)
