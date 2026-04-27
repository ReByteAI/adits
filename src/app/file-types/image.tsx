import { lazy } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import { ImageSpec, IMAGE_ICON } from '../../../packages/shared/file-types/image'

const Editor = lazy(() => import('../bench/adapters/image/ImageEditorView'))

function Thumbnail({ file }: { file: FileChipFile }) {
  if (file.thumb) return <img src={file.thumb} alt={file.name} loading="lazy" />
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: IMAGE_ICON }} />
}

function ChipThumb({ file }: { file: FileChipFile }) {
  const src = file.thumb || file.src
  if (src) return <img src={src} alt="" className="bench-prompt-chip-thumb" />
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: IMAGE_ICON }} />
}

export const ImageType: FileTypeDefinition = {
  ...ImageSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
