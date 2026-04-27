/**
 * MediaTimeline — neutral horizontal timeline strip used by both the audio
 * and video editors. Knows nothing about audio/video specifics.
 *
 *  - shows a track and a playhead positioned at `currentSec`
 *  - lets the user drag-select a [start, end] window
 *  - on pointerup, fires `onSelectionComplete(startSec, endSec)`
 *  - clicks (no drag) on the track call `onSeek(sec)` so users can scrub
 *  - hover follows the cursor and shows the time at that position
 *  - if `peaks` (normalized 0..1 floats) is provided, draws a waveform behind
 *    the playhead and selection
 *
 * No file/type knowledge. The hosting editor passes neutral numbers + an
 * already-computed peaks array.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

export interface MediaTimelineProps {
  /** Total duration in seconds. 0 disables interaction. */
  durationSec: number
  /** Current playhead position in seconds (0..durationSec). */
  currentSec: number
  /** Called on pointerup if the user dragged a meaningful range (>= MIN_RANGE_SEC). */
  onSelectionComplete: (startSec: number, endSec: number) => void
  /** Called when the user clicks the track without dragging — single seek. */
  onSeek?: (sec: number) => void
  /** Optional waveform peaks, normalized 0..1. Length is independent of pixel
   *  width — the renderer interpolates. Pass null/empty to skip. */
  peaks?: number[] | null
}

const MIN_RANGE_SEC = 0.25
const MIN_DRAG_PX = 4

/** Format seconds as m:ss (or h:mm:ss for long media). */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MediaTimeline({ durationSec, currentSec, onSelectionComplete, onSeek, peaks }: MediaTimelineProps) {
  const { t } = useTranslation('workspace')
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragStartRef = useRef<{ pxFraction: number; clientX: number } | null>(null)
  const draggedRef = useRef(false)
  const [selection, setSelection] = useState<{ startFrac: number; endFrac: number } | null>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)

  const fractionFromEvent = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (!rect.width) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  // ─── Waveform drawing ───
  // Repaints whenever the peaks change or the track resizes.
  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    if (!canvas || !track) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = track.clientWidth
      const cssH = track.clientHeight
      if (cssW <= 0 || cssH <= 0) return
      // Resize backing store to match
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        canvas.style.width = `${cssW}px`
        canvas.style.height = `${cssH}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, cssW, cssH)

      if (!peaks || peaks.length === 0) {
        ctx.restore()
        return
      }

      // Render peaks as vertical bars centered vertically. Skip 1px on left/right
      // so bars don't kiss the playhead at the edges.
      const inset = 2
      const drawW = cssW - inset * 2
      const drawH = cssH - 4
      const midY = cssH / 2
      const barW = 2
      const gap = 1
      const slot = barW + gap
      const cols = Math.max(1, Math.floor(drawW / slot))
      ctx.fillStyle = getComputedStyle(canvas).color || 'rgba(128, 128, 128, 0.4)'
      for (let i = 0; i < cols; i++) {
        // Sample the peaks array proportionally to fill all cols
        const peakIdx = Math.floor((i / cols) * peaks.length)
        const peak = peaks[peakIdx] ?? 0
        const h = Math.max(1, peak * drawH)
        const x = inset + i * slot
        const y = midY - h / 2
        ctx.fillRect(x, y, barW, h)
      }
      ctx.restore()
    }

    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(track)

    return () => {
      ro.disconnect()
    }
  }, [peaks])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (durationSec <= 0) return
      const track = trackRef.current
      if (!track) return
      e.preventDefault()
      const frac = fractionFromEvent(e.clientX)
      dragStartRef.current = { pxFraction: frac, clientX: e.clientX }
      draggedRef.current = false
      setSelection({ startFrac: frac, endFrac: frac })
      // Capture on the track itself (not e.target — which may be a child like
      // the playhead) so move/up land on the same element regardless of where
      // the pointer ends up.
      try { track.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    },
    [durationSec, fractionFromEvent],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Always update hover position, regardless of whether a drag is in progress
      const frac = fractionFromEvent(e.clientX)
      setHoverFrac(frac)
      const start = dragStartRef.current
      if (!start) return
      e.preventDefault()
      if (Math.abs(e.clientX - start.clientX) >= MIN_DRAG_PX) draggedRef.current = true
      setSelection({
        startFrac: Math.min(start.pxFraction, frac),
        endFrac: Math.max(start.pxFraction, frac),
      })
    },
    [fractionFromEvent],
  )

  const onPointerLeave = useCallback(() => setHoverFrac(null), [])

  /** Shared cleanup for pointerup and pointercancel. */
  const finishGesture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, emit: boolean) => {
      const start = dragStartRef.current
      if (!start) return
      const track = trackRef.current
      if (track) {
        try { track.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      dragStartRef.current = null
      const wasDragged = draggedRef.current
      draggedRef.current = false

      if (!emit) {
        setSelection(null)
        return
      }

      if (!wasDragged) {
        // Plain click → seek
        const frac = fractionFromEvent(e.clientX)
        setSelection(null)
        onSeek?.(frac * durationSec)
        return
      }

      // Dragged → emit selection if it's meaningful
      const sel = selection
      setSelection(null)
      if (!sel) return
      const startSec = sel.startFrac * durationSec
      const endSec = sel.endFrac * durationSec
      if (endSec - startSec >= MIN_RANGE_SEC) {
        onSelectionComplete(startSec, endSec)
      }
    },
    [durationSec, fractionFromEvent, onSelectionComplete, onSeek, selection],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finishGesture(e, true),
    [finishGesture],
  )

  /** Cancel = the gesture was aborted (browser stole focus, etc). Don't emit. */
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finishGesture(e, false),
    [finishGesture],
  )

  const playheadPct = durationSec > 0 ? Math.min(100, Math.max(0, (currentSec / durationSec) * 100)) : 0
  const selStartPct = selection ? selection.startFrac * 100 : 0
  const selEndPct = selection ? selection.endFrac * 100 : 0
  const hoverPct = hoverFrac !== null ? hoverFrac * 100 : null
  const hoverSec = hoverFrac !== null ? hoverFrac * durationSec : null

  return (
    <div className="bench-media-timeline">
      <div
        ref={trackRef}
        className="bench-media-timeline-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        role="slider"
        aria-label={t('viewer.mediaTimeline')}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.ceil(durationSec))}
        aria-valuenow={Math.floor(currentSec)}
      >
        {/* Waveform layer (canvas, positioned underneath the playhead/selection) */}
        <canvas ref={canvasRef} className="bench-media-timeline-waveform" aria-hidden="true" />
        {/* Playhead */}
        <div
          className="bench-media-timeline-playhead"
          style={{ left: `${playheadPct}%` }}
          aria-hidden="true"
        />
        {/* Live drag selection band */}
        {selection && selection.endFrac > selection.startFrac && (
          <div
            className="bench-media-timeline-selection"
            style={{ left: `${selStartPct}%`, width: `${selEndPct - selStartPct}%` }}
            aria-hidden="true"
          />
        )}
        {/* Hover marker — only when not dragging (to keep the visual clean) */}
        {hoverPct !== null && hoverSec !== null && durationSec > 0 && !selection && (
          <>
            <div
              className="bench-media-timeline-hover"
              style={{ left: `${hoverPct}%` }}
              aria-hidden="true"
            />
            <div
              className="bench-media-timeline-hover-label"
              style={{ left: `${hoverPct}%` }}
              aria-hidden="true"
            >
              {formatTime(hoverSec)}
            </div>
          </>
        )}
      </div>
      <div className="bench-media-timeline-labels">
        <span className="bench-media-timeline-label">{formatTime(currentSec)}</span>
        <span className="bench-media-timeline-hint">drag to reference a slice</span>
        <span className="bench-media-timeline-label">{formatTime(durationSec)}</span>
      </div>
    </div>
  )
}
