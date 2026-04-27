import { lazy, Suspense } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import type { EditorViewProps } from '../bench/types'
import { SpreadsheetSpec, SHEET_ICON } from '../../../packages/shared/file-types/spreadsheet'

const XlsxThumb = lazy(() => import('../components/XlsxThumb'))
const SheetEditor = lazy(() => import('../bench/adapters/spreadsheet/XlsxEditorView'))
const OfficeEditor = lazy(() => import('../bench/adapters/office/OfficeIframePreview'))

/** .xlsx → Rebyte iframe preview (read-only); .csv/.tsv → existing SheetJS editor */
function Editor(props: EditorViewProps) {
  const isOffice = /\.xlsx$/i.test(props.file.name)
  const Comp = isOffice ? OfficeEditor : SheetEditor
  return <Suspense fallback={null}><Comp {...props} /></Suspense>
}

const SheetIcon = () => (
  <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: SHEET_ICON }} />
)

function Thumbnail({ file }: { file: FileChipFile }) {
  // Pre-upload cards (no src) fall back to the icon. FileCard's outer
  // Suspense catches XlsxThumb's lazy import — XlsxThumb itself shows the
  // same icon during fetch/parse and after a parse failure.
  if (file.src) {
    return <XlsxThumb src={file.src} fallback={<SheetIcon />} />
  }
  return <SheetIcon />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: SHEET_ICON }} />
}

export const SpreadsheetType: FileTypeDefinition = {
  ...SpreadsheetSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
