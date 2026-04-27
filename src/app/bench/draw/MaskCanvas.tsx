/**
 * MaskCanvas — HTML5 Canvas overlay for freehand annotation drawing.
 *
 * Sits on top of an image or PDF page container. User draws annotations,
 * which are composited onto the source for export.
 *
 * Handles: DPR scaling, resize recovery, undo stack (capped), visibility toggle.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const DEFAULT_MASK_COLOR = 'rgb(255, 0, 0)'
export const MASK_OPACITY = 0.75
const MAX_UNDO_STEPS = 15
const MIN_STROKE_BBOX = 20

export interface MaskCanvasHandle {
  clear: () => void
  clearWithoutUndo: () => void
  undo: () => void
  isEmpty: () => boolean
  getCanvas: () => HTMLCanvasElement | null
}

interface MaskCanvasProps {
  /** The element this canvas overlays (img or div) — uses clientWidth/clientHeight. */
  targetRef: React.RefObject<HTMLElement | null>
  brushSize: number
  brushColor?: string
  mode: 'draw' | 'erase'
  visible: boolean
  disabled?: boolean
  onMaskChange?: (hasMask: boolean) => void
  onStrokeComplete?: () => void
}

export const MaskCanvas = forwardRef<MaskCanvasHandle, MaskCanvasProps>(
  function MaskCanvas(
    { targetRef, brushSize, brushColor = DEFAULT_MASK_COLOR, mode, visible, disabled, onMaskChange, onStrokeComplete },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawingRef = useRef(false)
    const strokeBboxRef = useRef({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    const lastDrawnPosRef = useRef<{ x: number; y: number } | null>(null)
    const lastTrackedPosRef = useRef<{ x: number; y: number } | null>(null)
    const undoStackRef = useRef<ImageData[]>([])
    const hadMaskRef = useRef(false)

    const getCtx = useCallback((canvas: HTMLCanvasElement) => {
      return canvas.getContext('2d', { willReadFrequently: true })
    }, [])

    // ─── Canvas sizing (DPR-aware) ───
    const syncCanvasSize = useCallback(() => {
      const canvas = canvasRef.current
      const target = targetRef.current
      if (!canvas || !target) return

      const dpr = window.devicePixelRatio || 1
      const w = target.clientWidth
      const h = target.clientHeight
      if (canvas.width === w * dpr && canvas.height === h * dpr) return

      const ctx = getCtx(canvas)
      let savedData: ImageData | null = null
      const oldW = canvas.width
      const oldH = canvas.height
      if (ctx && oldW > 0 && oldH > 0) {
        savedData = ctx.getImageData(0, 0, oldW, oldH)
      }

      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      const newCtx = getCtx(canvas)
      if (!newCtx) return
      newCtx.scale(dpr, dpr)

      if (savedData && oldW > 0 && oldH > 0) {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = oldW
        tempCanvas.height = oldH
        const tmpCtx = tempCanvas.getContext('2d')
        if (tmpCtx) {
          tmpCtx.putImageData(savedData, 0, 0)
          newCtx.drawImage(tempCanvas, 0, 0, w, h)
        }
      }
    }, [targetRef, getCtx])

    useEffect(() => {
      const target = targetRef.current
      if (!target) return
      const ro = new ResizeObserver(() => syncCanvasSize())
      ro.observe(target)
      syncCanvasSize()
      return () => ro.disconnect()
    }, [targetRef, syncCanvasSize])

    // ─── Drawing helpers ───
    const getCanvasPos = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }, [])

    const drawCircle = useCallback(
      (x: number, y: number, currentMode: 'draw' | 'erase') => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = getCtx(canvas)
        if (!ctx) return
        ctx.save()
        ctx.globalCompositeOperation = currentMode === 'draw' ? 'source-over' : 'destination-out'
        ctx.fillStyle = brushColor
        ctx.beginPath()
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      },
      [brushSize, brushColor, getCtx],
    )

    const drawStroke = useCallback(
      (
        from: { x: number; y: number },
        to: { x: number; y: number },
        currentMode: 'draw' | 'erase',
        control?: { x: number; y: number },
      ) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = getCtx(canvas)
        if (!ctx) return
        ctx.save()
        ctx.globalCompositeOperation = currentMode === 'draw' ? 'source-over' : 'destination-out'
        ctx.strokeStyle = brushColor
        ctx.lineWidth = brushSize
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        if (control) ctx.quadraticCurveTo(control.x, control.y, to.x, to.y)
        else ctx.lineTo(to.x, to.y)
        ctx.stroke()
        ctx.restore()
      },
      [brushSize, brushColor, getCtx],
    )

    const pushUndo = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = getCtx(canvas)
      if (!ctx) return
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const stack = undoStackRef.current
      if (stack.length >= MAX_UNDO_STEPS) stack.shift()
      stack.push(data)
    }, [getCtx])

    const isCanvasEmpty = useCallback((): boolean => {
      const canvas = canvasRef.current
      if (!canvas) return true
      const ctx = getCtx(canvas)
      if (!ctx) return true
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return false
      }
      return true
    }, [getCtx])

    const checkMaskChange = useCallback(() => {
      const hasMask = !isCanvasEmpty()
      if (hasMask !== hadMaskRef.current) {
        hadMaskRef.current = hasMask
        onMaskChange?.(hasMask)
      }
    }, [isCanvasEmpty, onMaskChange])

    // ─── Pointer events ───
    const expandBbox = (x: number, y: number) => {
      const b = strokeBboxRef.current
      if (x < b.minX) b.minX = x
      if (y < b.minY) b.minY = y
      if (x > b.maxX) b.maxX = x
      if (y > b.maxY) b.maxY = y
    }

    const onPointerDown = useCallback(
      (e: ReactPointerEvent<HTMLCanvasElement>) => {
        e.preventDefault()
        isDrawingRef.current = true
        strokeBboxRef.current = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        const pos = getCanvasPos(e)
        expandBbox(pos.x, pos.y)
        lastDrawnPosRef.current = pos
        lastTrackedPosRef.current = pos
        pushUndo()
        drawCircle(pos.x, pos.y, mode)
      },
      [getCanvasPos, pushUndo, drawCircle, mode],
    )

    const onPointerMove = useCallback(
      (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current) return
        e.preventDefault()
        const pos = getCanvasPos(e)
        expandBbox(pos.x, pos.y)
        const lastDrawn = lastDrawnPosRef.current
        const lastTracked = lastTrackedPosRef.current
        if (lastDrawn && lastTracked) {
          const mid = { x: (lastTracked.x + pos.x) / 2, y: (lastTracked.y + pos.y) / 2 }
          drawStroke(lastDrawn, mid, mode, lastTracked)
          lastDrawnPosRef.current = mid
        }
        lastTrackedPosRef.current = pos
      },
      [getCanvasPos, drawStroke, mode],
    )

    const onPointerUp = useCallback(() => {
      const lastDrawn = lastDrawnPosRef.current
      const lastTracked = lastTrackedPosRef.current
      const wasDrawing = isDrawingRef.current
      if (wasDrawing && lastDrawn && lastTracked) {
        drawStroke(lastDrawn, lastTracked, mode)
      }
      isDrawingRef.current = false
      lastDrawnPosRef.current = null
      lastTrackedPosRef.current = null
      checkMaskChange()
      if (wasDrawing) {
        const b = strokeBboxRef.current
        const bboxSize = Math.max(b.maxX - b.minX, b.maxY - b.minY)
        if (bboxSize >= MIN_STROKE_BBOX) onStrokeComplete?.()
      }
    }, [checkMaskChange, drawStroke, mode, onStrokeComplete])

    // ─── Imperative handle ───
    useImperativeHandle(ref, () => ({
      clear: () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = getCtx(canvas)
        if (!ctx) return
        pushUndo()
        const dpr = window.devicePixelRatio || 1
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
        checkMaskChange()
      },
      clearWithoutUndo: () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = getCtx(canvas)
        if (!ctx) return
        const dpr = window.devicePixelRatio || 1
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
        undoStackRef.current = []
        checkMaskChange()
      },
      undo: () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = getCtx(canvas)
        if (!ctx) return
        const prev = undoStackRef.current.pop()
        if (prev) ctx.putImageData(prev, 0, 0)
        checkMaskChange()
      },
      isEmpty: isCanvasEmpty,
      getCanvas: () => canvasRef.current,
    }))

    // Circle cursor that matches brush size
    const half = Math.round(brushSize / 2)
    const sz = half * 2
    const cursorSvg = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${sz}' height='${sz}'>` +
        `<circle cx='${half}' cy='${half}' r='${half - 1}' fill='none' stroke='white' stroke-width='2'/>` +
        `<circle cx='${half}' cy='${half}' r='${half - 1}' fill='none' stroke='black' stroke-width='1'/>` +
        `</svg>`,
    )
    const brushCursor = `url("data:image/svg+xml,${cursorSvg}") ${half} ${half}, crosshair`

    return (
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={mode === 'draw' ? 'Drawing canvas' : 'Eraser canvas'}
        className="bench-mask-canvas"
        style={{
          opacity: visible ? MASK_OPACITY : 0,
          cursor: disabled ? 'default' : brushCursor,
          pointerEvents: visible && !disabled ? 'auto' : 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    )
  },
)
