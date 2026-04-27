/**
 * Shared data types + pure helpers.
 * No DOM, no RN, no imports from platform code — safe to use from web,
 * mobile (Expo/RN), and Cloudflare Workers.
 */

import { detectType, getSpec, FallbackSpec, classifyPath, type FileRole } from './file-types'

export interface FileData {
  id: string
  name: string
  /** Project-relative path (e.g. `hello.html`, `scraps/idea.napkin`).
   *  Empty string for rows that aren't in the project filesystem (e.g.
   *  link entries). Server-authoritative — clients don't derive it. */
  path: string
  /** Location-derived role. `'page'` is the one strongly-enforced rule
   *  (HTML at project root); see `packages/shared/file-types/role.ts`.
   *  Everything else is a UI grouping label. */
  role: FileRole
  /** File-type registry key (e.g. 'image', 'pdf', 'doc', 'link'). */
  type: string
  size: string
  date: string
  /** image thumbnail URL (only for images) */
  thumb?: string
  /** source URL for bench viewer (PDFs, etc.) */
  src?: string
  /** True while an optimistic insert is still in flight (upload or link
   *  create). Preserved across background refreshes (`refreshOnFocus`,
   *  `onTaskEvent`) so the row doesn't flicker out between the optimistic
   *  insert and server confirmation. Cleared in the same update that
   *  swaps `tempId` for the server id. */
  pending?: boolean
}

/** A Page is the one strongly-typed file in adits: any HTML file in the
 *  project, regardless of location. APIs that open bench tabs, run
 *  Edit/Comment/Tweaks/Draw, or invoke Skills on a page MUST accept
 *  `PageFile`, not raw `FileData` — this makes "is this a page?" a
 *  compile-time check.
 *
 *  Construct via `asPageFile` / guard via `isPage` below. */
export interface PageFile extends FileData {
  role: 'page'
  type: 'html'
}

export function isPage(f: FileData): f is PageFile {
  return f.role === 'page'
}

/** Narrowing constructor — returns the input typed as `PageFile` when it
 *  qualifies, else `null`. Prefer this over post-hoc casts. */
export function asPageFile(f: FileData): PageFile | null {
  return isPage(f) ? f : null
}

export interface Project {
  id: string
  name: string
  files: FileData[]
  /** Rebyte workspace ID. Empty string while optimistically created. */
  workspaceId: string
  /** True while the optimistic create is in flight. */
  provisioning: boolean
  /** HTTP origin of the project's file server. Synthesized server-side
   *  from the project's `sandbox_config` (rebyte) or as a static
   *  localhost path (local), and shipped on the project row from GET
   *  /projects. Null when the backend can't resolve a sandbox origin
   *  (rebyte project still provisioning). Consumed by HTML `PageViewer`
   *  to set iframe `src`, and will expand to other file types over
   *  time. */
  fileServerRoot?: string | null
}

let _nextId = 0
export function fileId(): string {
  return 'f' + (++_nextId) + '-' + Date.now()
}

/** Convert an API file record to a FileData for display. */
export function apiFileToFileData(f: {
  id: string
  name: string
  type: string
  size: number
  fs_path?: string
  /** Project-relative path — present on sandbox files, absent (or empty)
   *  for links. Authoritative input for `role` classification. */
  path?: string
  /** Server-computed role. When absent (older clients/mobile, or links),
   *  fall back to client-side classification of `path`. */
  role?: FileRole
  thumb_path?: string | null
  kind?: 'sandbox' | 'link'
  created_at: string
}): FileData {
  // Prefer backend type if it's a known key; fall back to extension detection.
  const type = getSpec(f.type).key !== FallbackSpec.key ? f.type : detectType(f.name).key
  const isLink = f.kind === 'link'
  const path = f.path ?? ''
  const role: FileRole = f.role ?? (isLink ? 'other' : classifyPath(path))
  return {
    id: f.id,
    name: f.name,
    path,
    role,
    type,
    size: isLink ? '—' : formatSize(f.size),
    date: formatRelativeDate(f.created_at),
    thumb: isLink ? (f.thumb_path || undefined) : undefined,
    src: isLink ? f.fs_path : undefined,
  }
}

/** Terminal task statuses, shared with the backend's TERMINAL_STATUSES set.
 *  Anything not listed here is an in-flight state (running / queued /
 *  pending / processing / an unfamiliar Rebyte status) — the UI treats
 *  them uniformly so a stale D1 row's raw status can't split Chat from
 *  TasksPanel from the sidebar. */
export const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'canceled',
])

export function isNonTerminalStatus(status: string): boolean {
  return !TERMINAL_TASK_STATUSES.has(status)
}

/** Format a SQLite UTC datetime ("YYYY-MM-DD HH:MM:SS") as a compact
 *  relative time ("just now", "3m ago", "2d ago", "3mo ago"). Returns the
 *  original string if parsing fails. Used by the Tasks panel and the chat
 *  History tab. Kept in one place so the two views can't drift. */
export function formatSqliteRelative(sqlite: string | null): string {
  if (!sqlite) return ''
  const iso = sqlite.replace(' ', 'T') + 'Z'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return sqlite
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const m = Math.floor(diffSec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

export function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return 'Last week'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

/** Detect a file's type key from its filename. */
export function detectFileTypeKey(filename: string, mime?: string): string {
  return detectType(filename, mime).key
}
