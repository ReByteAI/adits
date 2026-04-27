/**
 * File-role classification — single source of truth for server and client.
 *
 * A Page is a first-class artifact: any HTML file in the project,
 * regardless of location. That's the one rule adits actively enforces —
 * extension-based, uniform across folders. Anything else the user puts in
 * the project is tolerated; `classifyPath` records *where* non-HTML files
 * live so the UI can group them. Reserved folder names (`scraps/`,
 * `uploads/`, `screenshots/`) are conventional, not mandatory, and only
 * affect the role of NON-HTML files.
 *
 * Keep this file pure and dependency-free: it ships to web, mobile, and
 * the Hono server, and its result is the contract between them.
 */

/** Location-derived role. Paired with `FileData.type` (extension-derived
 *  in `./index.ts`) — role and type are orthogonal: a `.js` inside
 *  `scraps/` has `role: 'sketch'` and `type: 'js'`. */
export type FileRole =
  | 'page'
  | 'sketch'
  | 'upload'
  | 'screenshot'
  | 'script'
  | 'other'

/** Reserved folder names with UI semantics. Contents are ordinary
 *  files; only the location label is special. */
export const RESERVED_FOLDERS = {
  scraps: 'scraps',
  uploads: 'uploads',
  screenshots: 'screenshots',
} as const

export type ReservedFolder = (typeof RESERVED_FOLDERS)[keyof typeof RESERVED_FOLDERS]

const FOLDER_TO_ROLE: Record<ReservedFolder, FileRole> = {
  scraps: 'sketch',
  uploads: 'upload',
  screenshots: 'screenshot',
}

/** The Page rule — exported so server and client share the same check.
 *  Any HTML file in the project is a Page, regardless of folder. */
export function isPagePath(path: string): boolean {
  const clean = normalizePath(path)
  if (!clean) return false
  const basename = clean.slice(clean.lastIndexOf('/') + 1)
  return isHtmlFilename(basename)
}

/** Derive the role of a project-relative path. Case-insensitive on the
 *  first segment so `Scraps/foo` and `scraps/foo` classify the same.
 *  HTML always wins — a `.html` under any folder is a Page. */
export function classifyPath(path: string): FileRole {
  const clean = normalizePath(path)
  if (!clean) return 'other'

  const basename = clean.slice(clean.lastIndexOf('/') + 1)
  if (isHtmlFilename(basename)) return 'page'

  const slash = clean.indexOf('/')
  if (slash < 0) {
    if (isScriptFilename(clean)) return 'script'
    return 'other'
  }

  const first = clean.slice(0, slash).toLowerCase() as ReservedFolder
  return FOLDER_TO_ROLE[first] ?? 'other'
}

/** Strip a leading slash (some callers pass absolute paths from the
 *  sandbox, others already-relative ones). Reject obvious traversal. */
function normalizePath(path: string): string {
  const s = path.replace(/^\/+/, '').trim()
  if (!s) return ''
  if (s.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return ''
  return s
}

export function isHtmlFilename(name: string): boolean {
  return /\.html?$/i.test(name)
}

function isScriptFilename(name: string): boolean {
  return /\.(m|c)?jsx?$|\.tsx?$/i.test(name)
}
