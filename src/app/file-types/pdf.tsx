import { lazy, Suspense } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import { PdfSpec, PDF_ICON } from '../../../packages/shared/file-types/pdf'

const PdfThumb = lazy(() => import('../components/PdfThumb'))
const Editor = lazy(() => import('../bench/adapters/pdf/PdfEditorView'))

function Thumbnail({ file }: { file: FileChipFile }) {
  if (file.src) {
    return (
      <Suspense fallback={<span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: PDF_ICON }} />}>
        <PdfThumb src={file.src} />
      </Suspense>
    )
  }
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: PDF_ICON }} />
}

/** PDF chip thumb is just the icon — rendering a tiny PDF page in an 18px chip is wasteful. */
function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: PDF_ICON }} />
}

export const PdfType: FileTypeDefinition = {
  ...PdfSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
