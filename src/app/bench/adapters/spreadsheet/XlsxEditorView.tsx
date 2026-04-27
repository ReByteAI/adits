/**
 * XlsxEditorView — render an .xlsx / .xls / .csv / .tsv in the bench using
 * SheetJS, with crop + draw via the shared RenderedHtmlEditor shell.
 *
 * Each workbook sheet becomes its own HTML table; a tab strip switches
 * between sheets and is rendered in the shell's `footer` slot. Switching
 * sheets bumps the shell's resetKey so any in-progress crop/mask is
 * dropped — otherwise a rectangle dragged on Sheet1 would carry over to
 * Sheet2 at meaningless coordinates.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { EditorViewProps } from '../../types.ts'
import { authFetch } from '../../../api.ts'
import {
  RenderedHtmlEditor,
  type RenderBodyProps,
} from '../rendered-html/RenderedHtmlEditor.tsx'

interface RenderedSheet {
  name: string
  html: string
}

export default function XlsxEditorView({ file, onOutput, onClose }: EditorViewProps) {
  const [sheets, setSheets] = useState<RenderedSheet[] | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── Load + parse the workbook ───
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSheets(null)
    setActiveSheet(0)

    authFetch(file.src)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => {
        if (cancelled) return
        const wb = XLSX.read(buf, { type: 'array' })
        const rendered: RenderedSheet[] = wb.SheetNames.map(name => ({
          name,
          // SheetJS emits a complete <table> with cell strings + a few inline styles.
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }),
        }))
        if (!cancelled) {
          setSheets(rendered)
          setLoading(false)
        }
      })
      .catch(err => {
        if (cancelled) return
        console.error('[xlsx-editor] parse failed', err)
        setError(err instanceof Error ? err.message : 'Failed to parse spreadsheet')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file.src])

  const activeHtml = useMemo(() => sheets?.[activeSheet]?.html ?? '', [sheets, activeSheet])

  // SheetJS renders a full HTML doc — strip everything outside <table>…</table>
  // so we don't drop a stray <html><body> into our DOM.
  const tableOnly = useMemo(() => {
    const m = activeHtml.match(/<table[\s\S]*?<\/table>/i)
    return m?.[0] ?? activeHtml
  }, [activeHtml])

  const renderBody = useCallback(
    ({ docRef, overlays }: RenderBodyProps) => (
      <div className="bench-xlsx-sheet-frame">
        <div
          ref={docRef}
          className="bench-xlsx-table-host"
          dangerouslySetInnerHTML={{ __html: tableOnly }}
        />
        {overlays}
      </div>
    ),
    [tableOnly],
  )

  const sheetSlug = sheets?.[activeSheet]?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() ?? 'sheet'
  const baseName = file.name.replace(/\.(xlsx|xls|csv|tsv)$/i, '')

  const footer =
    sheets && sheets.length > 1 && !error ? (
      <div className="bench-xlsx-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((sheet, i) => (
          <button
            key={`${sheet.name}-${i}`}
            type="button"
            role="tab"
            aria-selected={i === activeSheet}
            className={`bench-xlsx-tab${i === activeSheet ? ' is-active' : ''}`}
            onClick={() => setActiveSheet(i)}
            title={sheet.name}
          >
            {sheet.name}
          </button>
        ))}
      </div>
    ) : null

  return (
    <RenderedHtmlEditor
      file={file}
      onOutput={onOutput}
      onClose={onClose}
      loading={loading}
      error={error}
      renderBody={renderBody}
      outputNameBase={`${baseName}-${sheetSlug}`}
      footer={footer}
      resetKey={activeSheet}
    />
  )
}
