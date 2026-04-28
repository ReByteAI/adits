/**
 * ImageEditorView — view / draw / comment on an image.
 *
 * Three modes:
 *   - View: plain display, no overlays.
 *   - Draw: freehand strokes on a MaskCanvas overlay. On stroke
 *     complete, we composite image + mask into a PNG and enqueue a
 *     round-buffer PromptPiece with `source: 'draw'`. The chip
 *     appears in the chat composer.
 *   - Comment: drag a rectangle; release → a "Comment" anchor appears
 *     on the rect (via CropOverlay's apply button) → clicking it
 *     opens CommentPopover → Send enqueues a PromptPiece with
 *     `source: 'comment'`, carrying the cropped PNG as `image`, the
 *     note as `text`, and `ref.path = "rect(x,y,w,h)"`.
 *
 * The editor no longer emits via `onOutput` — everything goes through
 * the shared round buffer (`workspace-v2/round/store`). Other editors
 * still use `onOutput`, so the prop remains on EditorViewProps.
 */

import { useCallback, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import type { EditorViewProps } from '../../types.ts'
import { MaskCanvas, type MaskCanvasHandle } from '../../draw/MaskCanvas.tsx'
import { DrawToolbar, BRUSH_SIZE_MAP, DEFAULT_BRUSH_COLOR, type BrushSize } from '../../draw/DrawToolbar.tsx'
import { exportImageWithDrawing, exportImageCrop } from '../../draw/export.ts'
import { blobToDataUrl } from '../../draw/dataUrl.ts'
import { CropOverlay, type CropRect } from '../../draw/CropOverlay.tsx'
import { useRoundStore } from '../../../workspace-v2/round/store.ts'
import CommentPopover from '../../../workspace-v2/comment/CommentPopover.tsx'
import { useBenchEditorSlot } from '../../../workspace-v2/bench-editor-slot.ts'
import { useFileBlob } from '../../../queries/useFileBlob.ts'

type Mode = 'view' | 'draw' | 'comment'

/** Host-viewport coords for the popover anchor. Top-right corner of
 *  the crop rect, clamped by the popover's own logic. */
function rectAnchor(img: HTMLImageElement, rect: CropRect): { x: number; y: number } {
  const box = img.getBoundingClientRect()
  return { x: box.left + rect.x + rect.w, y: box.top + rect.y }
}

function formatRect(rect: CropRect): string {
  return `rect(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)})`
}

export default function ImageEditorView({ file }: EditorViewProps) {
  const { t } = useTranslation('workspace')
  const imgRef = useRef<HTMLImageElement>(null)
  const maskRef = useRef<MaskCanvasHandle>(null)

  const [imgLoaded, setImgLoaded] = useState(false)
  const [mode, setMode] = useState<Mode>('view')

  const [brushSizeKey, setBrushSizeKey] = useState<BrushSize>('M')
  const brushSize = BRUSH_SIZE_MAP[brushSizeKey]
  const [brushColor, setBrushColor] = useState<string>(DEFAULT_BRUSH_COLOR)
  const [hasMask, setHasMask] = useState(false)

  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  /** Frozen crop + its host-viewport anchor at the moment the user
   *  clicked "Comment" on the rect. Drives the popover; cleared on
   *  send/cancel. Frozen so subsequent drags don't retarget the
   *  popover mid-edit. */
  const [commentPending, setCommentPending] = useState<
    { rect: CropRect; anchor: { x: number; y: number } } | null
  >(null)

  const [flashKey, setFlashKey] = useState(0)
  const lockedRef = useRef(false)

  // Reset on file change
  useEffect(() => {
    setImgLoaded(false)
    setHasMask(false)
    setCropRect(null)
    setCommentPending(null)
    maskRef.current?.clearWithoutUndo()
  }, [file.id])

  // Clear crop + pending popover when leaving comment mode so switching
  // away doesn't leave a stray popover or rect behind.
  useEffect(() => {
    if (mode !== 'comment') {
      setCropRect(null)
      setCommentPending(null)
    }
  }, [mode])

  // ─── Draw: auto-capture on stroke complete ───
  const handleStrokeComplete = useCallback(async () => {
    if (lockedRef.current) return
    const img = imgRef.current
    const maskCanvas = maskRef.current?.getCanvas()
    if (!img || !maskCanvas || maskRef.current?.isEmpty()) return
    lockedRef.current = true

    setFlashKey(k => k + 1)

    let blob: Blob
    try {
      blob = await exportImageWithDrawing(img, maskCanvas)
    } catch (err) {
      console.error('[image-editor] draw export failed', err)
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
        ref: { fileName: file.name },
        text: `Annotated ${file.name}`,
        image: dataUrl,
      })
    } catch (err) {
      console.error('[image-editor] draw data-url failed', err)
    } finally {
      lockedRef.current = false
    }
  }, [file.name])

  // ─── Comment: drag rect → click "Comment" → popover → Send ───
  const handleStartComment = useCallback(() => {
    const img = imgRef.current
    if (!img || !cropRect || cropRect.w < 1 || cropRect.h < 1) return
    setCommentPending({ rect: cropRect, anchor: rectAnchor(img, cropRect) })
  }, [cropRect])

  const handleSendComment = useCallback(async (note: string) => {
    const trimmed = note.trim()
    if (!trimmed || !commentPending || lockedRef.current) return
    const img = imgRef.current
    if (!img) return
    lockedRef.current = true

    setFlashKey(k => k + 1)

    let blob: Blob
    try {
      blob = await exportImageCrop(img, commentPending.rect)
    } catch (err) {
      console.error('[image-editor] comment crop export failed', err)
      lockedRef.current = false
      return
    }

    try {
      const dataUrl = await blobToDataUrl(blob)
      useRoundStore.getState().add({
        v: 1,
        source: 'comment',
        ref: { fileName: file.name, path: formatRect(commentPending.rect) },
        text: trimmed,
        image: dataUrl,
      })
      setCommentPending(null)
      setCropRect(null)
    } catch (err) {
      console.error('[image-editor] comment data-url failed', err)
    } finally {
      lockedRef.current = false
    }
  }, [commentPending, file.name])

  const handleCancelComment = useCallback(() => {
    setCommentPending(null)
  }, [])

  const handleUndo = useCallback(() => {
    if (mode === 'draw') maskRef.current?.undo()
    else setCropRect(null)
  }, [mode])

  const handleClear = useCallback(() => {
    if (mode === 'draw') {
      maskRef.current?.clear()
      setHasMask(false)
    } else {
      setCropRect(null)
    }
  }, [mode])

  // Fetch a same-origin blob URL with proper Bearer auth. Binding the
  // <img> directly to `file.src` (an `/api/app/files/<id>/download`
  // route) breaks because (a) browsers can't add an Authorization
  // header to <img> requests, and (b) `crossOrigin="anonymous"` strips
  // cookies too — so the request lands at the API with no creds and
  // 401s. The blob URL is same-origin, doesn't need crossOrigin, and
  // canvas pixel reads (export.ts) work cleanly.
  const { data: blobUrl } = useFileBlob(file.id)

  if (!file.src && !blobUrl) {
    return <div className="bench-editor-empty">No image preview available</div>
  }

  const hasCrop = Boolean(cropRect && cropRect.w > 0 && cropRect.h > 0)
  const hasContent = mode === 'draw' ? hasMask : hasCrop

  const hint =
    mode === 'draw'
      ? 'Draw to highlight a region — release to add it to your prompt.'
      : mode === 'comment'
      ? 'Drag a rectangle — then click Comment to attach a note and send it to your prompt.'
      : 'Viewing the image — zoom and pan freely. Switch to Draw or Comment to capture.'

  const slotEl = useBenchEditorSlot()

  const modeButtons = (
    <>
      <button
        type="button"
        className={`wsv2-btn-ghost${mode === 'view' ? ' is-active' : ''}`}
        onClick={() => setMode('view')}
        aria-pressed={mode === 'view'}
        title={t('viewer.viewImage')}
      >
        {t('bench.open')}
      </button>
      <button
        type="button"
        className={`wsv2-btn-ghost${mode === 'draw' ? ' is-active' : ''}`}
        onClick={() => setMode('draw')}
        aria-pressed={mode === 'draw'}
        title={t('viewer.drawFree')}
      >
        {t('bench.draw')}
      </button>
      <button
        type="button"
        className={`wsv2-btn-ghost${mode === 'comment' ? ' is-active' : ''}`}
        onClick={() => setMode('comment')}
        aria-pressed={mode === 'comment'}
        title={t('viewer.selectRegion')}
      >
        {t('bench.comment')}
      </button>
    </>
  )

  return (
    <div className="bench-image-editor">
      {slotEl && createPortal(modeButtons, slotEl)}

      {(mode === 'draw' || hasContent) && (
        <div className="bench-editor-contextbar">
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
      )}

      <div className="bench-image-editor-stage">
        <div className="bench-image-editor-frame">
          {blobUrl && (
            <img
              ref={imgRef}
              src={blobUrl}
              alt={file.name}
              className="bench-image-editor-img"
              draggable={false}
              onLoad={() => setImgLoaded(true)}
            />
          )}
          {imgLoaded && (
            <MaskCanvas
              ref={maskRef}
              targetRef={imgRef}
              brushSize={brushSize}
              brushColor={brushColor}
              mode="draw"
              visible={true}
              disabled={mode !== 'draw'}
              onMaskChange={setHasMask}
              onStrokeComplete={handleStrokeComplete}
            />
          )}
          {imgLoaded && (
            <CropOverlay
              targetRef={imgRef}
              active={mode === 'comment' && !commentPending}
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
