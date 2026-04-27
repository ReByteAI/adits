/**
 * PdfEditorView — page-by-page PDF viewer with draw and comment modes.
 *
 * Three modes (parity with ImageEditorView):
 *   - View: selectable text, annotations, links.
 *   - Draw: freehand strokes on the rendered page. On stroke complete,
 *     composite page + mask → PNG → enqueue a `source: 'draw'`
 *     PromptPiece with `ref.path = "page N"`.
 *   - Comment: drag a rect on the page; click the anchored "Comment"
 *     button → CommentPopover → Send → `source: 'comment'`
 *     PromptPiece with the crop as `image`, the note as `text`, and
 *     `ref.path = "page N rect(x,y,w,h)"`.
 *
 * Emits via the shared round buffer (`workspace-v2/round/store`);
 * `onOutput` is no longer called from here.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import type { EditorViewProps } from '../../types.ts'
import { authFetch } from '../../../api.ts'
import { MaskCanvas, type MaskCanvasHandle } from '../../draw/MaskCanvas.tsx'
import { DrawToolbar, BRUSH_SIZE_MAP, DEFAULT_BRUSH_COLOR, type BrushSize } from '../../draw/DrawToolbar.tsx'
import { exportPdfPageWithDrawing, exportPdfPageCrop } from '../../draw/export.ts'
import { blobToDataUrl } from '../../draw/dataUrl.ts'
import { CropOverlay, type CropRect } from '../../draw/CropOverlay.tsx'
import { useRoundStore } from '../../../workspace-v2/round/store.ts'
import CommentPopover from '../../../workspace-v2/comment/CommentPopover.tsx'
import { useBenchEditorSlot } from '../../../workspace-v2/bench-editor-slot.ts'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

type PdfMode = 'view' | 'draw' | 'comment'

const MIN_SCALE = 0.5
const MAX_SCALE = 3.0
const SCALE_STEP = 0.25
const THUMB_HEIGHT = 64

function rectAnchor(host: HTMLElement, rect: CropRect): { x: number; y: number } {
  const box = host.getBoundingClientRect()
  return { x: box.left + rect.x + rect.w, y: box.top + rect.y }
}

function formatRect(rect: CropRect): string {
  return `rect(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)})`
}

const LazyPageThumb = memo(function LazyPageThumb({
  pageNum,
  isActive,
  onSelect,
  thumbRefsMap,
}: {
  pageNum: number
  isActive: boolean
  onSelect: (page: number) => void
  thumbRefsMap: React.RefObject<Map<number, HTMLButtonElement>>
}) {
  const [containerEl, setContainerEl] = useState<HTMLButtonElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!containerEl) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '0px 400px' },
    )
    observer.observe(containerEl)
    return () => observer.disconnect()
  }, [containerEl])

  return (
    <button
      type="button"
      ref={el => {
        setContainerEl(el)
        if (el) thumbRefsMap.current.set(pageNum, el)
        else thumbRefsMap.current.delete(pageNum)
      }}
      onClick={() => onSelect(pageNum)}
      className={`bench-pdf-thumb${isActive ? ' is-active' : ''}`}
      aria-label={`Page ${pageNum}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="bench-pdf-thumb-inner">
        {isVisible ? (
          <Page
            pageNumber={pageNum}
            height={THUMB_HEIGHT}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        ) : (
          <div className="bench-pdf-thumb-placeholder" />
        )}
        <span className="bench-pdf-thumb-label">{pageNum}</span>
      </div>
    </button>
  )
})

export default function PdfEditorView({ file }: EditorViewProps) {
  const { t } = useTranslation('workspace')
  const [fileData, setFileData] = useState<{ data: Uint8Array } | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [error, setError] = useState<string | null>(null)

  const maskRef = useRef<MaskCanvasHandle>(null)
  const pageContainerRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<PdfMode>('view')
  const [brushSizeKey, setBrushSizeKey] = useState<BrushSize>('M')
  const brushSize = BRUSH_SIZE_MAP[brushSizeKey]
  const [brushColor, setBrushColor] = useState<string>(DEFAULT_BRUSH_COLOR)
  const [hasMask, setHasMask] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  /** Frozen crop + page + anchor at the moment the user clicked
   *  "Comment". Drives the popover; cleared on send/cancel. */
  const [commentPending, setCommentPending] = useState<
    { rect: CropRect; page: number; anchor: { x: number; y: number } } | null
  >(null)
  const lockedRef = useRef(false)
  const [flashKey, setFlashKey] = useState(0)

  const drawActive = mode === 'draw'
  const commentActive = mode === 'comment'

  const thumbRefsMap = useRef<Map<number, HTMLButtonElement>>(new Map())

  // ─── Load PDF data ───
  useEffect(() => {
    let cancelled = false
    setFileData(null)
    setError(null)
    setNumPages(0)
    setCurrentPage(1)
    thumbRefsMap.current.clear()

    authFetch(file.src)
      .then(r => r.arrayBuffer())
      .then(buf => {
        if (cancelled) return
        if (buf.byteLength === 0) {
          setError('PDF file is empty')
          return
        }
        setFileData({ data: new Uint8Array(buf) })
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load PDF')
      })
    return () => { cancelled = true }
  }, [file.src])

  // ─── Clear mask + crop + popover on page change ───
  useEffect(() => {
    maskRef.current?.clearWithoutUndo()
    setHasMask(false)
    setCropRect(null)
    setCommentPending(null)
    const el = thumbRefsMap.current.get(currentPage)
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [currentPage])

  // Drop any pending crop / popover when leaving comment mode.
  useEffect(() => {
    if (!commentActive) {
      setCropRect(null)
      setCommentPending(null)
    }
  }, [commentActive])

  // ─── Debounced mask + crop clear on zoom ───
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prevScaleRef = useRef(scale)
  useEffect(() => {
    if (prevScaleRef.current === scale) return
    prevScaleRef.current = scale
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current)
    zoomTimeoutRef.current = setTimeout(() => {
      maskRef.current?.clearWithoutUndo()
      setHasMask(false)
      setCropRect(null)
      setCommentPending(null)
    }, 300)
    return () => {
      if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current)
    }
  }, [scale])

  // ─── Keyboard nav ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!fileData || !numPages) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCurrentPage(p => Math.max(1, p - 1))
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCurrentPage(p => Math.min(numPages, p + 1))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fileData, numPages])

  // ─── Draw: auto-capture on stroke complete ───
  const handleStrokeComplete = useCallback(async () => {
    if (!drawActive || lockedRef.current) return
    const maskCanvas = maskRef.current?.getCanvas()
    const pdfCanvas = pageContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null
    if (!maskCanvas || !pdfCanvas || maskRef.current?.isEmpty()) return
    lockedRef.current = true

    setFlashKey(k => k + 1)

    let blob: Blob
    try {
      blob = await exportPdfPageWithDrawing(pdfCanvas, maskCanvas)
    } catch (err) {
      console.error('[pdf-editor] draw export failed', err)
      lockedRef.current = false
      return
    }

    maskRef.current?.clearWithoutUndo()
    setHasMask(false)

    try {
      const dataUrl = await blobToDataUrl(blob)
      useRoundStore.getState().add({
        v: 1,
        source: 'draw',
        ref: { fileName: file.name, path: `page ${currentPage}` },
        text: `Annotated ${file.name}, page ${currentPage}`,
        image: dataUrl,
      })
    } catch (err) {
      console.error('[pdf-editor] draw data-url failed', err)
    } finally {
      lockedRef.current = false
    }
  }, [drawActive, currentPage, file.name])

  // ─── Comment: drag rect → click "Comment" → popover → Send ───
  const handleStartComment = useCallback(() => {
    const host = pageContainerRef.current
    if (!host || !cropRect || cropRect.w < 1 || cropRect.h < 1) return
    setCommentPending({
      rect: cropRect,
      page: currentPage,
      anchor: rectAnchor(host, cropRect),
    })
  }, [cropRect, currentPage])

  const handleSendComment = useCallback(async (note: string) => {
    const trimmed = note.trim()
    if (!trimmed || !commentPending || lockedRef.current) return
    const pdfCanvas = pageContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null
    if (!pdfCanvas) return
    lockedRef.current = true

    setFlashKey(k => k + 1)

    let blob: Blob
    try {
      blob = await exportPdfPageCrop(pdfCanvas, commentPending.rect)
    } catch (err) {
      console.error('[pdf-editor] comment crop export failed', err)
      lockedRef.current = false
      return
    }

    try {
      const dataUrl = await blobToDataUrl(blob)
      useRoundStore.getState().add({
        v: 1,
        source: 'comment',
        ref: {
          fileName: file.name,
          path: `page ${commentPending.page} ${formatRect(commentPending.rect)}`,
        },
        text: trimmed,
        image: dataUrl,
      })
      setCommentPending(null)
      setCropRect(null)
    } catch (err) {
      console.error('[pdf-editor] comment data-url failed', err)
    } finally {
      lockedRef.current = false
    }
  }, [commentPending, file.name])

  const handleCancelComment = useCallback(() => {
    setCommentPending(null)
  }, [])

  const slotEl = useBenchEditorSlot()

  const modeButtons = (
    <>
      <button
        type="button"
        className={`wsv2-btn-ghost${mode === 'view' ? ' is-active' : ''}`}
        onClick={() => setMode('view')}
        aria-pressed={mode === 'view'}
        title={t('viewer.viewPdf')}
      >
        {t('bench.open')}
      </button>
      <button
        type="button"
        className={`wsv2-btn-ghost${drawActive ? ' is-active' : ''}`}
        onClick={() => setMode('draw')}
        aria-pressed={drawActive}
        title={t('viewer.drawFree')}
      >
        {t('bench.draw')}
      </button>
      <button
        type="button"
        className={`wsv2-btn-ghost${commentActive ? ' is-active' : ''}`}
        onClick={() => setMode('comment')}
        aria-pressed={commentActive}
        title={t('viewer.selectRegion')}
      >
        {t('bench.comment')}
      </button>
    </>
  )

  return (
    <div className="bench-pdf-viewer">
      {slotEl && createPortal(modeButtons, slotEl)}

      <div className="bench-editor-contextbar">
        {drawActive && (
          <DrawToolbar
            color={brushColor}
            onColorChange={setBrushColor}
            size={brushSizeKey}
            onSizeChange={setBrushSizeKey}
          />
        )}
        {drawActive && hasMask && (
          <>
            <button type="button" className="bench-editor-btn" onClick={() => maskRef.current?.undo()} aria-label={t('viewer.undo')} title={t('viewer.undo')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
            </button>
            <button type="button" className="bench-editor-btn" onClick={() => { maskRef.current?.clear(); setHasMask(false) }} aria-label={t('viewer.clear')} title={t('viewer.clear')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </>
        )}

        <div className="bench-editor-toolbar-spacer" />

        <button
          type="button"
          className="bench-editor-btn"
          onClick={() => setScale(s => Math.max(s - SCALE_STEP, MIN_SCALE))}
          disabled={scale <= MIN_SCALE}
          aria-label={t('viewer.zoomOut')}
          title={t('viewer.zoomOut')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <span className="bench-pdf-toolbar-scale">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="bench-editor-btn"
          onClick={() => setScale(s => Math.min(s + SCALE_STEP, MAX_SCALE))}
          disabled={scale >= MAX_SCALE}
          aria-label={t('viewer.zoomIn')}
          title={t('viewer.zoomIn')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button
          type="button"
          className="bench-editor-btn"
          onClick={() => setScale(1.0)}
          aria-label={t('viewer.resetZoom')}
          title={t('viewer.resetZoom')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>

        {numPages > 1 && (
          <div className="bench-pdf-toolbar-nav">
            <button
              type="button"
              className="bench-editor-btn"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label={t('viewer.prevPage')}
              title={t('viewer.prevPage')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="bench-pdf-toolbar-pages">{currentPage} / {numPages}</span>
            <button
              type="button"
              className="bench-editor-btn"
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              aria-label={t('viewer.nextPage')}
              title={t('viewer.nextPage')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}
      </div>

      <div className="bench-pdf-content">
        {!fileData && !error && (
          <div className="bench-pdf-loading">
            <div className="app-card-loading">
              <div className="app-card-loading-ring" />
              <div className="app-card-loading-ring app-card-loading-ring--inner" />
            </div>
          </div>
        )}
        {error && <div className="bench-pdf-error">Failed to load PDF: {error}</div>}
        {fileData && !error && (
          <Document
            className="bench-pdf-document"
            file={fileData}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            onLoadError={err => setError(err.message)}
            loading={
              <div className="bench-pdf-loading">
                <div className="app-card-loading">
                  <div className="app-card-loading-ring" />
                </div>
              </div>
            }
          >
            <div className="bench-pdf-page-stage">
              <div ref={pageContainerRef} className="bench-pdf-page-container">
                <Page
                  pageNumber={currentPage}
                  scale={scale}
                  renderTextLayer={!drawActive && !commentActive}
                  renderAnnotationLayer={!drawActive && !commentActive}
                />
                {drawActive && (
                  <MaskCanvas
                    ref={maskRef}
                    targetRef={pageContainerRef}
                    brushSize={brushSize}
                    brushColor={brushColor}
                    mode="draw"
                    visible={true}
                    onMaskChange={setHasMask}
                    onStrokeComplete={handleStrokeComplete}
                  />
                )}
                {commentActive && (
                  <CropOverlay
                    targetRef={pageContainerRef}
                    active={!commentPending}
                    rect={cropRect}
                    onChange={setCropRect}
                    onApply={handleStartComment}
                    applyLabel="Comment"
                  />
                )}
                {flashKey > 0 && (
                  <div
                    key={flashKey}
                    className="bench-editor-flash"
                    onAnimationEnd={() => setFlashKey(0)}
                  />
                )}
              </div>
            </div>

            {numPages > 1 && (
              <div className="bench-pdf-thumbs">
                {Array.from({ length: numPages }, (_, i) => (
                  <LazyPageThumb
                    key={i + 1}
                    pageNum={i + 1}
                    isActive={currentPage === i + 1}
                    onSelect={setCurrentPage}
                    thumbRefsMap={thumbRefsMap}
                  />
                ))}
              </div>
            )}
          </Document>
        )}
      </div>

      {commentPending && (
        <CommentPopover
          anchor={commentPending.anchor}
          onSend={handleSendComment}
          onCancel={handleCancelComment}
        />
      )}
    </div>
  )
}
