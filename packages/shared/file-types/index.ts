export { FileType, type FileTypeSpec } from './types'
export {
  type FileRole,
  RESERVED_FOLDERS,
  type ReservedFolder,
  classifyPath,
  isPagePath,
  isHtmlFilename,
} from './role'

import { ImageSpec } from './image'
import { PdfSpec } from './pdf'
import { SpreadsheetSpec } from './spreadsheet'
import { PresentationSpec } from './presentation'
import { VideoSpec } from './video'
import { AudioSpec } from './audio'
import { HtmlSpec } from './html'
import { DocumentSpec } from './document'
import { ArchiveSpec } from './archive'
import { LinkSpec } from './link'
import { NapkinSpec } from './napkin'
import { FallbackSpec } from './fallback'
import type { FileTypeSpec } from './types'

/**
 * All registered file types, ordered by priority.
 * First extension/MIME match wins — put specific types before broad ones.
 * FallbackSpec must be last.
 */
const FILE_TYPES: FileTypeSpec[] = [
  ImageSpec,
  PdfSpec,
  SpreadsheetSpec,
  PresentationSpec,
  AudioSpec,
  VideoSpec,
  HtmlSpec,       // text/html — before DocumentSpec's text/* patterns
  DocumentSpec,   // text/plain, text/markdown — broad text types
  ArchiveSpec,    // zip/tar/7z/rar/… — opaque binary
  NapkinSpec,     // .napkin — opaque to the other specs, has its own editor
  LinkSpec,       // URL-based refs; detection happens at paste time, not via ext/mime
  FallbackSpec,
]

/** Key lookup — O(1). */
const byKey = new Map<string, FileTypeSpec>()
for (const ft of FILE_TYPES) byKey.set(ft.key, ft)

/** Extension lookup — O(1). First registration wins. */
const byExt = new Map<string, FileTypeSpec>()
for (const ft of FILE_TYPES) {
  if (ft === FallbackSpec) continue
  for (const ext of ft.extensions) {
    if (!byExt.has(ext)) byExt.set(ext, ft)
  }
}

/** Look up a file type spec by its key. */
export function getSpec(key: string): FileTypeSpec {
  return byKey.get(key) ?? FallbackSpec
}

/** Detect file type from filename (and optional MIME). */
export function detectType(filename: string, mime?: string): FileTypeSpec {
  const dot = filename.lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : ''

  if (ext) {
    const match = byExt.get(ext)
    if (match) return match
  }

  if (mime) {
    for (const ft of FILE_TYPES) {
      if (ft === FallbackSpec) continue
      for (const pattern of ft.mimePatterns) {
        if (pattern.endsWith('/*')) {
          if (mime.startsWith(pattern.slice(0, -1))) return ft
        } else if (mime === pattern) return ft
      }
    }
  }

  return FallbackSpec
}

// Re-export all specs for direct access
export { ImageSpec } from './image'
export { PdfSpec } from './pdf'
export { DocumentSpec } from './document'
export { VideoSpec } from './video'
export { AudioSpec } from './audio'
export { HtmlSpec } from './html'
export { SpreadsheetSpec } from './spreadsheet'
export { PresentationSpec } from './presentation'
export { ArchiveSpec } from './archive'
export { LinkSpec } from './link'
export { FallbackSpec } from './fallback'
