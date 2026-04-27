import { useEffect, useState, type ReactNode } from 'react'
import * as XLSX from 'xlsx'
import { authFetch } from '../api.ts'

interface XlsxThumbProps {
  src: string
  /** Rendered until the workbook finishes loading and after a parse failure. */
  fallback: ReactNode
}

/**
 * Renders the first sheet of an .xlsx/.xls/.csv/.tsv as a card thumbnail.
 *
 * Mirrors PdfThumb / DocxThumb: fetches the bytes, parses with SheetJS,
 * and emits the first sheet's table as inline HTML. The .app-card-thumb-xlsx
 * CSS rule anchors the table to the top-left and clips overflow so only
 * the header row and first data rows are visible.
 *
 * Like DocxThumb, the loading and error states are tracked here explicitly
 * — Suspense only catches lazy-import suspension, so a fetch or parse
 * failure leaves the fallback icon visible instead of a blank box.
 */
export default function XlsxThumb({ src, fallback }: XlsxThumbProps) {
  const [tableHtml, setTableHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setTableHtml(null)
    authFetch(src)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => {
        if (cancelled) return
        // `sheets: 0` parses only the first sheet (skipping every other
        // sheet entirely); `sheetRows: 30` caps that sheet's row parse to
        // the visible region of the thumb. Together they bound the work
        // to "first 30 rows of sheet 0" regardless of workbook size.
        const wb = XLSX.read(buf, { type: 'array', sheets: 0, sheetRows: 30 })
        const firstSheetName = wb.SheetNames[0]
        if (!firstSheetName) return
        const html = XLSX.utils.sheet_to_html(wb.Sheets[firstSheetName], { editable: false })
        // SheetJS emits a full <html><body><table>… document — strip to the
        // <table> only so we don't drop a stray html/body into the card.
        const m = html.match(/<table[\s\S]*?<\/table>/i)
        setTableHtml(m?.[0] ?? html)
      })
      .catch(() => {
        // Leave the fallback visible.
      })
    return () => {
      cancelled = true
    }
  }, [src])

  if (!tableHtml) return <>{fallback}</>
  return (
    <div
      className="app-card-thumb-xlsx"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: tableHtml }}
    />
  )
}
