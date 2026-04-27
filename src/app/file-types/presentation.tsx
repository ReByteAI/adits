import { lazy } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import { PresentationSpec, PRES_ICON } from '../../../packages/shared/file-types/presentation'

const PptxThumb = lazy(() => import('../components/PptxThumb'))
const Editor = lazy(() => import('../bench/adapters/office/OfficeIframePreview'))

const PresIcon = () => (
  <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: PRES_ICON }} />
)

function Thumbnail({ file }: { file: FileChipFile }) {
  if (file.src && /\.pptx$/i.test(file.name ?? '')) {
    return <PptxThumb src={file.src} fallback={<PresIcon />} />
  }
  return <PresIcon />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: PRES_ICON }} />
}

export const PresentationType: FileTypeDefinition = {
  ...PresentationSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
