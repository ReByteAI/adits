import { lazy } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import { LinkSpec, LINK_ICON } from '../../../packages/shared/file-types/link'

const Editor = lazy(() => import('../bench/adapters/link/LinkEditorView'))

function Thumbnail({ file }: { file: FileChipFile }) {
  if (file.thumb) return <img src={file.thumb} alt={file.name} loading="lazy" />
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: LINK_ICON }} />
}

function ChipThumb({ file }: { file: FileChipFile }) {
  if (file.thumb) return <img src={file.thumb} alt="" className="bench-prompt-chip-thumb" />
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: LINK_ICON }} />
}

export const LinkType: FileTypeDefinition = {
  ...LinkSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
