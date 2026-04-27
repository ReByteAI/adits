import { lazy, Suspense } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import type { EditorViewProps } from '../bench/types'
import { DocumentSpec, DOC_ICON } from '../../../packages/shared/file-types/document'

const DocxThumb = lazy(() => import('../components/DocxThumb'))
const TextEditor = lazy(() => import('../bench/adapters/document/DocxEditorView'))
const OfficeEditor = lazy(() => import('../bench/adapters/office/OfficeIframePreview'))

/** .docx → Rebyte iframe preview (read-only); .txt/.md/.rtf → existing text editor */
function Editor(props: EditorViewProps) {
  const isOffice = /\.docx$/i.test(props.file.name)
  const Comp = isOffice ? OfficeEditor : TextEditor
  return <Suspense fallback={null}><Comp {...props} /></Suspense>
}

const DocIcon = () => (
  <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: DOC_ICON }} />
)

function isDocx(name: string | undefined): boolean {
  return !!name && /\.docx$/i.test(name)
}

function Thumbnail({ file }: { file: FileChipFile }) {
  // Non-.docx documents (.txt/.md/.rtf/.doc) and pre-upload cards (no src)
  // fall back to the icon. FileCard's outer Suspense catches DocxThumb's
  // lazy import — DocxThumb itself shows the same icon during fetch/parse
  // and after a render failure.
  if (file.src && isDocx(file.name)) {
    return <DocxThumb src={file.src} fallback={<DocIcon />} />
  }
  return <DocIcon />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: DOC_ICON }} />
}

export const DocumentType: FileTypeDefinition = {
  ...DocumentSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
