import { lazy } from 'react'
import type { FileTypeDefinition } from './types'
import { ArchiveSpec, ARCHIVE_ICON } from '../../../packages/shared/file-types/archive'

const Editor = lazy(() => import('../bench/adapters/PlaceholderView'))

function Thumbnail() {
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: ARCHIVE_ICON }} />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: ARCHIVE_ICON }} />
}

export const ArchiveType: FileTypeDefinition = {
  ...ArchiveSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
