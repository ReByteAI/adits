/**
 * RenderedHtmlEditor — shared editor shell for file types whose preview is
 * a DOM tree captured via html-to-image (HTML, DOCX, XLSX, plain text…).
 *
 * Owns the toolbar, mode toggle (crop / draw), CropOverlay, MaskCanvas, and
 * the html-to-image capture+composite pipeline. Each adapter only writes the
 * loader and the body element — everything else is shared so all
 * rendered-html editors look and behave identically.
 *
 * Body contract:
 *   `renderBody({ docRef, overlays })` returns the positioned frame element.
 *   The body MUST:
 *     - attach `docRef` to the element it wants captured (the same element
 *       CropOverlay/MaskCanvas use as their coordinate space),
 *     - apply `position: relative` (or similar) to that element,
 *     - render `overlays` somewhere inside it (the shell injects MaskCanvas,
 *       CropOverlay, and the flash effect through this prop).
 *
 * This indirection lets each body type its own frame styling — the html
 * adapter sizes the frame to the iframe's measured scrollHeight, the xlsx
 * adapter shrink-wraps a SheetJS table, the docx adapter delegates sizing to
 * docx-preview's page sections — without the shell needing to know.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toCanvas } from 'html-to-image'
import type { BenchFile } from '../../types.ts'
import { benchFileId } from '../../types.ts'
import { BenchBackChip } from '../../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../../BenchFullscreenChip.tsx'
import { MaskCanvas, type MaskCanvasHandle } from '../../draw/MaskCanvas.tsx'
import {
  DrawToolbar,
  BRUSH_SIZE_MAP,
  DEFAULT_BRUSH_COLOR,
  type BrushSize,
} from '../../draw/DrawToolbar.tsx'
import { CropOverlay, type CropRect } from '../../draw/CropOverlay.tsx'
import { exportHtmlCrop, exportHtmlWithDrawing } from '../../draw/export.ts'

/**
 * Available editor modes.
 *
 * - `view` is the default — all capture overlays go inert so pointer events
 *   hit the underlying body directly. The user can scroll, click, hover, and
 *   interact with the document (including live HTML with charts, scripts, or
 *   form controls) the same way they would in a normal browser.
 * - `crop` and `draw` are opt-in capture modes the user enters when they want
 *   to add a region of the document to their prompt.
 */
type Mode = 'view' | 'crop' | 'draw'
const MODE_ORDER: Mode[] = ['view', 'crop', 'draw']

export interface RenderBodyProps {
  /** Attach to the element the shell should capture and overlay. */
  docRef: React.RefObject<HTMLDivElement | null>
  /** Render somewhere inside the docRef element — shell mounts MaskCanvas,
   *  CropOverlay, and the success flash through here. */
  overlays: ReactNode
}

export interface RenderedHtmlEditorProps {
  file: BenchFile
  onOutput: (file: BenchFile) => void
  onClose: () => void
  loading?: boolean
  error?: string | null
  renderBody: (props: RenderBodyProps) => ReactNode
  /** Prefix for generated chip filenames, e.g. "sp500_test". */
  outputNameBase: string
  /** Optional content rendered below the stage, e.g. xlsx sheet tabs. */
  footer?: ReactNode
  /** When this changes, all editor state (mode/cropRect/mask) resets. Use it
   *  for in-file context switches like xlsx sheet selection. */
  resetKey?: string | number
  /** Override the viewer wrapper class for content-specific styling
   *  (e.g. text-mode font sizing). Defaults to bench-rendered-html-viewer. */
  viewerClassName?: string
}

export function RenderedHtmlEditor({
  file,
  onOutput,
  onClose,
  loading,
  error,
  renderBody,
  outputNameBase,
  footer,
  resetKey,
  viewerClassName = 'bench-rendered-html-viewer',
}: RenderedHtmlEditorProps) {
  const { t } = useTranslation('workspace')
  const docRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<MaskCanvasHandle>(null)

  const [mode, setMode] = useState<Mode>('view')
  const [brushSizeKey, setBrushSizeKey] = useState<BrushSize>('M')
  const brushSize = BRUSH_SIZE_MAP[brushSizeKey]
  const [brushColor, setBrushColor] = useState<string>(DEFAULT_BRUSH_COLOR)
  const [hasMask, setHasMask] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [flashKey, setFlashKey] = useState(0)
  const lockedRef = useRef(false)

  // Reset editor state on file or context change.
  useEffect(() => {
    setMode('view')
    setCropRect(null)
    setHasMask(false)
    maskRef.current?.clearWithoutUndo()
  }, [file.src, resetKey])

  // Leaving crop mode clears any in-progress rectangle.
  useEffect(() => {
    if (mode !== 'crop') setCropRect(null)
  }, [mode])

  // Snapshot the docRef into a canvas via html-to-image. Centralized so the
  // crop and draw paths use identical capture options.
  const captureDoc = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const target = docRef.current
    if (!target) return null
    return toCanvas(target, {
      cacheBust: true,
      pixelRatio: window.devicePixelRatio || 1,
      backgroundColor: '#ffffff',
      width: target.clientWidth,
      height: target.clientHeight,
    })
  }, [])

  const emitChip = useCallback(
    (blob: Blob, suffix: string) => {
      const url = URL.createObjectURL(blob)
      onOutput({
        id: benchFileId(),
        name: `${outputNameBase}-${suffix}-${Date.now()}.png`,
        src: url,
        thumb: url,
        type: 'image',
      })
    },
    [outputNameBase, onOutput],
  )

  const handleApplyCrop = useCallback(async () => {
    if (lockedRef.current || !cropRect) return
    const target = docRef.current
    if (!target || cropRect.w < 1 || cropRect.h < 1) return
    lockedRef.current = true
    setFlashKey(k => k + 1)
    try {
      const cssW = target.clientWidth
      const cssH = target.clientHeight
      const canvas = await captureDoc()
      if (!canvas) throw new Error('capture returned null')
      const blob = await exportHtmlCrop(canvas, cropRect, cssW, cssH)
      setCropRect(null)
      emitChip(blob, 'crop')
    } catch (err) {
      console.error('[rendered-html-editor] crop export failed', err)
    } finally {
      lockedRef.current = false
    }
  }, [cropRect, captureDoc, emitChip])

  const handleStrokeComplete = useCallback(async () => {
    if (lockedRef.current) return
    const maskCanvas = maskRef.current?.getCanvas()
    if (!maskCanvas || maskRef.current?.isEmpty()) return
    lockedRef.current = true
    setFlashKey(k => k + 1)
    try {
      const canvas = await captureDoc()
      if (!canvas) throw new Error('capture returned null')
      const blob = await exportHtmlWithDrawing(canvas, maskCanvas)
      maskRef.current?.clearWithoutUndo()
      setHasMask(false)
      emitChip(blob, 'draw')
    } catch (err) {
      console.error('[rendered-html-editor] draw export failed', err)
    } finally {
      lockedRef.current = false
    }
  }, [captureDoc, emitChip])

  const handleClear = useCallback(() => {
    if (mode === 'draw') {
      maskRef.current?.clear()
      setHasMask(false)
    } else {
      setCropRect(null)
    }
  }, [mode])

  const handleUndo = useCallback(() => {
    if (mode === 'draw') {
      maskRef.current?.undo()
    } else {
      setCropRect(null)
    }
  }, [mode])

  const hasCrop = Boolean(cropRect && cropRect.w > 0 && cropRect.h > 0)
  const hasContent = mode === 'draw' ? hasMask : hasCrop

  const hint = error
    ? error
    : loading
    ? 'Loading…'
    : mode === 'draw'
    ? 'Draw to highlight a region — release to add it to your prompt.'
    : mode === 'crop'
    ? 'Drag a rectangle on the page — then apply to add a cropped clip to your prompt.'
    : 'Viewing the live document — scroll, click, hover. Switch to Crop or Draw to capture.'

  // Overlays the body splices into its frame element. Suppressed while
  // loading or in error state — the docRef is still mounted (so adapters
  // like docx-preview can imperatively write into it), but no interactive
  // overlay attaches to an empty target.
  const overlays = !loading && !error ? (
    <>
      <MaskCanvas
        ref={maskRef}
        targetRef={docRef}
        brushSize={brushSize}
        brushColor={brushColor}
        mode="draw"
        visible={mode === 'draw'}
        disabled={mode !== 'draw'}
        onMaskChange={setHasMask}
        onStrokeComplete={handleStrokeComplete}
      />
      <CropOverlay
        targetRef={docRef}
        active={mode === 'crop'}
        rect={cropRect}
        onChange={setCropRect}
        onApply={handleApplyCrop}
        applyLabel="Add crop"
      />
      {flashKey > 0 && (
        <div
          key={flashKey}
          className="bench-editor-flash"
          onAnimationEnd={() => setFlashKey(0)}
        />
      )}
    </>
  ) : null

  return (
    <div className={viewerClassName}>
      <div className="bench-editor-toolbar">
        <BenchBackChip fileName={file.name} onClose={onClose} />
        <BenchFullscreenChip />

        <div
          className="bench-mode-group"
          data-mode={mode}
          data-mode-index={MODE_ORDER.indexOf(mode)}
          data-count={MODE_ORDER.length}
          role="group"
          aria-label={t('viewer.annotationMode')}
        >
          <button
            type="button"
            className={`bench-editor-btn bench-mode-btn${mode === 'view' ? ' is-active' : ''}`}
            onClick={() => setMode('view')}
            aria-pressed={mode === 'view'}
            title={t('viewer.viewLive')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>{t('bench.open')}</span>
          </button>
          <button
            type="button"
            className={`bench-editor-btn bench-mode-btn${mode === 'crop' ? ' is-active' : ''}`}
            onClick={() => setMode('crop')}
            aria-pressed={mode === 'crop'}
            title={t('viewer.selectRegion')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>
            <span>{t('bench.comment')}</span>
          </button>
          <button
            type="button"
            className={`bench-editor-btn bench-mode-btn${mode === 'draw' ? ' is-active' : ''}`}
            onClick={() => setMode('draw')}
            aria-pressed={mode === 'draw'}
            title={t('viewer.drawFree')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            <span>{t('bench.draw')}</span>
          </button>
        </div>

        {mode === 'draw' && (
          <DrawToolbar
            color={brushColor}
            onColorChange={setBrushColor}
            size={brushSizeKey}
            onSizeChange={setBrushSizeKey}
          />
        )}

        <span className="bench-editor-toolbar-hint">{hint}</span>

        <div className="bench-editor-toolbar-spacer" />

        <button
          type="button"
          className="bench-editor-btn"
          onClick={handleUndo}
          disabled={!hasContent}
          aria-label={t('viewer.undo')}
          title={t('viewer.undo')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
        </button>
        <button
          type="button"
          className="bench-editor-btn"
          onClick={handleClear}
          disabled={!hasContent}
          aria-label={t('viewer.clear')}
          title={t('viewer.clear')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>

      <div className="bench-rendered-html-stage">
        {error ? (
          <div className="bench-pdf-error">{error}</div>
        ) : (
          <>
            {/* Always mount the body so docRef is available for adapters
             *  that imperatively write into it (e.g. docx-preview's
             *  renderAsync). The loading indicator overlays the body until
             *  the adapter signals loading=false. */}
            {renderBody({ docRef, overlays })}
            {loading && (
              <div className="bench-rendered-html-loading">
                <div className="app-card-loading">
                  <div className="app-card-loading-ring" />
                  <div className="app-card-loading-ring app-card-loading-ring--inner" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {footer}
    </div>
  )
}
