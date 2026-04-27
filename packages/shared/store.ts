/**
 * Shared store logic — pure state transformations.
 *
 * These functions take state in, return state out. Zero platform
 * dependencies: no DOM, no fetch, no timers, no React. Safe to use
 * from web (Zustand), mobile (Zustand), and tests.
 *
 * The rule: the store owns the file list. Network fetches feed data
 * INTO the store. Optimistic mutations happen IN the store. Background
 * refreshes go THROUGH mergeServerFiles so they don't stomp local state.
 */

import type { FileData, Project } from './data'
import type { ApiTask } from './api'

// ─── Pure helpers ───

/** Map over a project list, update one project's files. */
export function updateProjectFiles(
  projects: Project[],
  projectId: string,
  updater: (files: FileData[]) => FileData[],
): Project[] {
  return projects.map(p =>
    p.id === projectId ? { ...p, files: updater(p.files) } : p
  )
}

/**
 * Merge a fresh server file listing with the current local list.
 *
 * Preserves:
 *  1. Pending uploads (pending === true) — removed by upload success/failure
 *  2. Blob URLs (thumb/src) on matching ids — avoid re-fetch flicker
 */
export function mergeServerFiles(oldFiles: FileData[], refreshed: FileData[]): FileData[] {
  const oldById = new Map(oldFiles.map(f => [f.id, f]))
  const serverNames = new Set(refreshed.map(f => f.name))
  const pendingLocal = oldFiles.filter(f =>
    f.pending && !serverNames.has(f.name)
  )
  const merged = refreshed.map(fd => {
    const prev = oldById.get(fd.id)
    if (prev?.thumb) fd = { ...fd, thumb: prev.thumb }
    if (prev?.src) fd = { ...fd, src: prev.src }
    return fd
  })
  return [...pendingLocal, ...merged]
}

// ─── Optimistic file mutations ───

/** Insert a file optimistically. Returns new projects array. */
export function addFileOptimistic(
  projects: Project[],
  projectId: string,
  file: FileData,
): Project[] {
  return updateProjectFiles(projects, projectId, files => [file, ...files])
}

/** Swap a temp client ID for the real server ID after upload succeeds. */
export function swapFileId(
  projects: Project[],
  projectId: string,
  tempId: string,
  serverId: string,
): Project[] {
  return updateProjectFiles(projects, projectId, files =>
    files.map(f => {
      if (f.id !== tempId) return f
      const { pending: _, ...rest } = f
      return { ...rest, id: serverId }
    })
  )
}

/** Remove a file optimistically. Returns new projects array. */
export function removeFileOptimistic(
  projects: Project[],
  projectId: string,
  fileId: string,
): Project[] {
  return updateProjectFiles(projects, projectId, files =>
    files.filter(f => f.id !== fileId)
  )
}

// ─── Optimistic task management ───

/** Build an optimistic ApiTask row for sidebar display. */
export function buildOptimisticTask(
  taskId: string,
  displayPrompt: string,
  taskUrl: string | null,
): ApiTask {
  const nowSqlite = new Date().toISOString().replace('T', ' ').slice(0, 19)
  return {
    id: taskId,
    prompt: displayPrompt,
    title: null,
    status: 'running',
    url: taskUrl,
    created_at: nowSqlite,
    completed_at: null,
  }
}

/** Optimistically cancel a task. Returns updated tasksByProject. */
export function cancelTaskOptimistic(
  tasksByProject: Record<string, ApiTask[]>,
  taskId: string,
): {
  tasksByProject: Record<string, ApiTask[]>
  ownerProjectId: string | null
} {
  const ownerProjectId = Object.keys(tasksByProject).find(pid =>
    tasksByProject[pid].some(t => t.id === taskId)
  ) ?? null

  if (!ownerProjectId) {
    return { tasksByProject, ownerProjectId: null }
  }

  const nowSqlite = new Date().toISOString().replace('T', ' ').slice(0, 19)
  return {
    tasksByProject: {
      ...tasksByProject,
      [ownerProjectId]: (tasksByProject[ownerProjectId] ?? []).map(t =>
        t.id === taskId ? { ...t, status: 'canceled', completed_at: nowSqlite } : t
      ),
    },
    ownerProjectId,
  }
}
