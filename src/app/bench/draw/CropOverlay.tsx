/**
 * CropOverlay — click-and-drag rectangular selection for cropping images or PDF pages.
 *
 * Sits on top of the same target element MaskCanvas uses (image or PDF page container).
 * Reports the selection as a rect in target CSS pixels. No move/resize handles — the
 * user just drags out a new rect to replace the current one. Parent component reads
 * the rect and commits the crop via an "Apply" action.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'

/** Crop rectangle in target CSS pixels (origin top-left, aligned with target.clientWidth/clientHeight). */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

interface CropOverlayProps {
  /** The element this overlay sits on top of — its clientWidth/clientHeight define the coord space. */
  targetRef: React.RefObject<HTMLElement | null>
  active: boolean
  rect: CropRect | null
  onChange: (rect: CropRect | null) => void
  /** Commit the current crop. When provided, a floating action button appears
   *  anchored to the rect's bottom-right corner — close to where the user just dragged. */
  onApply?: () => void
  applyLabel?: string
  /** Rectangles smaller than this on either axis are discarded as accidental taps. */
  minSize?: number
}

/** Estimated apply-button footprint, used for edge-flip math. The actual button
 *  is sized by CSS — these constants are just upper bounds for clamping. */
const APPLY_BTN_W = 110
const APPLY_BTN_H = 30
const APPLY_GAP = 8

export function CropOverlay({
  targetRef,
  active,
  rect,
  onChange,
  onApply,
  applyLabel = 'Apply crop',
  minSize = 12,
}: CropOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [isDragging, setIsDragging] = useState(false)
  // Bumped on every scroll/resize so the apply button reflows to stay inside the
  // currently visible region of the (possibly scrollable) editor stage.
  const [viewportTick, setViewportTick] = useState(0)
  const draggingRef = useRef(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  // Keep overlay sized to target so coordinates match the image/canvas exactly.
  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    const update = () => setSize({ w: target.clientWidth, h: target.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(target)
    return () => ro.disconnect()
  }, [targetRef])

  // Re-compute the apply-button position whenever any ancestor scrolls or the
  // window resizes — the editor stage scrolls independently of the page when
  // the PDF page or image is taller than its container.
  useEffect(() => {
    if (!onApply) return
    const bump = () => setViewportTick(t => t + 1)
    window.addEventListener('scroll', bump, { capture: true, passive: true })
    window.addEventListener('resize', bump, { passive: true })
    return () => {
      window.removeEventListener('scroll', bump, { capture: true } as EventListenerOptions)
      window.removeEventListener('resize', bump)
    }
  }, [onApply])

  const getPos = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current
    if (!overlay) return { x: 0, y: 0 }
    const r = overlay.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
      y: Math.max(0, Math.min(r.height, e.clientY - r.top)),
    }
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active) return
      e.preventDefault()
      overlayRef.current?.setPointerCapture(e.pointerId)
      draggingRef.current = true
      setIsDragging(true)
      const p = getPos(e)
      startRef.current = p
      onChange({ x: p.x, y: p.y, w: 0, h: 0 })
    },
    [active, getPos, onChange],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const start = startRef.current
      if (!start) return
      const p = getPos(e)
      onChange({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      })
    },
    [getPos, onChange],
  )

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setIsDragging(false)
      startRef.current = null
      try {
        overlayRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        // pointer already released
      }
      // Drop tiny rectangles (accidental taps).
      if (rect && (rect.w < minSize || rect.h < minSize)) {
        onChange(null)
      }
    },
    [rect, minSize, onChange],
  )

  if (!active && !rect) return null

  const hasRect = rect && rect.w > 0 && rect.h > 0
  const showApply = Boolean(
    !isDragging && onApply && rect && rect.w >= minSize && rect.h >= minSize,
  )

  // Anchor the apply button to the rect's bottom-right corner in **viewport**
  // coordinates so the editor stage's scrollbar can never clip it. The rect is
  // stored in overlay-local coords, so we add the overlay's viewport rect to
  // translate. Prefer below-right of the rect; flip above or tuck inside if the
  // rect sits at the bottom edge of the visible viewport.
  let applyPos: { left: number; top: number; tick: number } | null = null
  if (showApply && rect && overlayRef.current) {
    const oRect = overlayRef.current.getBoundingClientRect()
    const rL = oRect.left + rect.x
    const rT = oRect.top + rect.y
    const rR = rL + rect.w
    const rB = rT + rect.h
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Default: just below the rect, button's right edge aligned to rect's right
    let left = rR - APPLY_BTN_W
    let top = rB + APPLY_GAP

    // Below doesn't fit → try above
    if (top + APPLY_BTN_H > vh - APPLY_GAP) {
      top = rT - APPLY_BTN_H - APPLY_GAP
      // Above doesn't fit either → tuck inside the bottom-right of the rect
      if (top < APPLY_GAP) {
        top = Math.max(APPLY_GAP, rB - APPLY_BTN_H - APPLY_GAP)
        left = Math.max(APPLY_GAP, rR - APPLY_BTN_W - APPLY_GAP)
      }
    }

    // Clamp horizontally so the button never clips outside the visible viewport
    if (left < APPLY_GAP) left = APPLY_GAP
    if (left + APPLY_BTN_W > vw - APPLY_GAP) left = vw - APPLY_BTN_W - APPLY_GAP

    // tick is bundled into the position object purely so React's reconciler sees
    // a fresh prop on every scroll/resize and re-applies inline styles.
    applyPos = { left, top, tick: viewportTick }
  }

  return (
    <div
      ref={overlayRef}
      className="bench-crop-overlay"
      style={{
        width: size.w || '100%',
        height: size.h || '100%',
        cursor: active ? 'crosshair' : 'default',
        pointerEvents: active ? 'auto' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {hasRect && (
        <div
          className="bench-crop-rect"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
          }}
        />
      )}
      {applyPos && createPortal(
        <button
          type="button"
          className="bench-editor-btn bench-capture-btn bench-crop-apply-btn"
          style={{ left: applyPos.left, top: applyPos.top }}
          onClick={e => {
            e.stopPropagation()
            onApply?.()
          }}
          onPointerDown={e => e.stopPropagation()}
          aria-label={applyLabel}
          title={applyLabel}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2v14a2 2 0 0 0 2 2h14"/>
            <path d="M18 22V8a2 2 0 0 0-2-2H2"/>
          </svg>
          <span>{applyLabel}</span>
        </button>,
        document.body,
      )}
    </div>
  )
}
