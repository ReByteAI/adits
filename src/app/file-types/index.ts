/**
 * Web-specific file type registry.
 * Extends shared FileTypeSpec with React DOM components (Thumbnail, Editor).
 */
export type { FileTypeDefinition } from './types'
export { getSpec, detectType } from '../../../packages/shared/file-types'
export type { FileTypeSpec } from '../../../packages/shared/file-types'

import { ImageType } from './image'
import { PdfType } from './pdf'
import { DocumentType } from './document'
import { VideoType } from './video'
import { AudioType } from './audio'
import { HtmlType } from './html'
import { SpreadsheetType } from './spreadsheet'
import { PresentationType } from './presentation'
import { ArchiveType } from './archive'
import { LinkType } from './link'
import { NapkinType } from './napkin'
import { FallbackType } from './fallback'
import type { FileTypeDefinition } from './types'

/** Web-specific registry — extends shared specs with DOM Thumbnail/Editor.
 *
 *  HTML and Napkin are "editor-bypass" types: HTML opens through
 *  `PageViewer`, Napkin through `NapkinEditor`. Their registry
 *  entries exist purely so the card grid can render a file-typed
 *  thumbnail and the prompt composer can render a file-typed chip —
 *  the `Editor` binding for these types is never reached. */
const WEB_TYPES: FileTypeDefinition[] = [
  ImageType,
  PdfType,
  SpreadsheetType,
  PresentationType,
  AudioType,
  VideoType,
  HtmlType,
  DocumentType,
  ArchiveType,
  NapkinType,
  LinkType,
  FallbackType,
]

const byKey = new Map<string, FileTypeDefinition>()
for (const ft of WEB_TYPES) byKey.set(ft.key, ft)

/** Get the web-specific type definition (includes Thumbnail + Editor). */
export function getType(key: string): FileTypeDefinition {
  return byKey.get(key) ?? FallbackType
}
