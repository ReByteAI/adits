/**
 * Web-side data layer.
 *
 * Pure types + helpers live in `packages/shared/data.ts` — re-exported here
 * so the 15+ existing `import { ... } from './data'` call sites don't need
 * touching. This file adds only the things that depend on web-specific APIs
 * (File, React components from the web file-type registry).
 */

import { detectType } from '../../packages/shared/file-types'
import { getType } from './file-types'

export type {
  FileData,
  PageFile,
  Project,
} from '../../packages/shared/data'

export {
  fileId,
  apiFileToFileData,
  formatRelativeDate,
  formatSqliteRelative,
  formatSize,
  detectFileTypeKey,
  isNonTerminalStatus,
  TERMINAL_TASK_STATUSES,
  isPage,
  asPageFile,
} from '../../packages/shared/data'

/** @deprecated Use getType(type).icon instead */
export function fileTypeIcon(type: string): string {
  return getType(type).icon
}

/** Detect file type from a File object. Returns the type key. */
export function detectFileType(file: File): string {
  return detectType(file.name).key
}

/** Back-compat alias for code that still imports `FileType` as a string type. */
export type FileType = string
