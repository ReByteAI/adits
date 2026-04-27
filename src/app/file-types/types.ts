import type { ComponentType } from 'react'
import type { EditorViewProps } from '../bench/types'
import type { FileTypeSpec } from '../../../packages/shared/file-types'

/** Compact file shape passed to rendering components. */
export interface FileChipFile {
  thumb?: string
  src?: string
  name: string
  /** HTTP origin of the project's file server, when the renderer needs
   *  to construct a `<root>/<file.name>` URL (HTML preview iframe).
   *  Optional because most thumbnails ignore it. Callers that have
   *  project context (FileCard, Bench) populate it; chip-rendering code
   *  paths that don't (e.g., generic prompt chips) leave it undefined
   *  and the renderer falls back to its icon. */
  fileServerRoot?: string | null
}

/** Web-specific file type definition — extends shared spec with React DOM components. */
export interface FileTypeDefinition extends FileTypeSpec {
  /** Card thumbnail — full size, may render actual content (e.g. PDF first page). */
  Thumbnail: ComponentType<{ file: FileChipFile }>
  /** Inline chip thumb — compact icon/avatar for prompt chips, mention chips, etc. */
  ChipThumb: ComponentType<{ file: FileChipFile }>
  /** Bench editor viewport — lazy loaded */
  Editor: ComponentType<EditorViewProps>
}
