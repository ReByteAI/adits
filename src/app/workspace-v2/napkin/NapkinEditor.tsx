/** Napkin editor — Canvas 2D drawing surface with a floating pill
 *  toolbar. Minimum viable scope: eight
 *  tools (Select / Pan / Pen / Text / Rect / Arrow / Sticky / Save),
 *  dotted-grid infinite canvas, save-to-disk via the existing upload
 *  endpoint (same-name overwrite).
 *
 *  Coord system: the canvas renders objects in WORLD space; the user's
 *  current pan offset (panX, panY) translates world → screen on render
 *  and screen → world on input.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileData } from '../../data.ts'
import { authFetch, fileDownloadUrl, apiUrl } from '../../api.ts'
import { useActiveProjectId, useStore } from '../../store.ts'
import { EMPTY_NAPKIN, makeObjectId } from './types.ts'
import type {
  NapkinFile,
  NapkinObject,
  StickyColor,
  StickyObject,
  TextObject,
} from './types.ts'

type Tool = 'select' | 'pan' | 'pen' | 'text' | 'rect' | 'arrow' | 'sticky'

const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select', h: 'pan', p: 'pen', t: 'text', r: 'rect', a: 'arrow', s: 'sticky',
}

/** Drawing palette — shared by Pen / Text / Shape / Arrow.
 *  Order matches the upstream sub-toolbar (rust, orange-brown, green, blue, black). */
const DRAWING_COLORS = ['#8B2500', '#C2622D', '#3D7C2F', '#2D7DD2', '#000000'] as const
type DrawingColor = typeof DRAWING_COLORS[number]

const PEN_SIZE_THIN = 2
const PEN_SIZE_THICK = 8
type PenSize = typeof PEN_SIZE_THIN | typeof PEN_SIZE_THICK

const SHAPE_STROKE_WIDTH = 2
const ARROW_STROKE_WIDTH = 2
const TEXT_FONT_SIZE = 16
const STICKY_SIZE = 150

/** Sticky palette — 6 pastel swatches. Distinct from the drawing palette
 *  both in shape (square in the UI) and in contents (pastels, not saturated). */
const STICKY_FILL: Record<StickyColor, string> = {
  yellow: '#FFF3B0',
  pink:   '#FAD4D4',
  blue:   '#D6E4F5',
  green:  '#D5EBD5',
  purple: '#E6D6F2',
  orange: '#FCDCC2',
}
const STICKY_COLORS: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange']

const STICKY_PLACEHOLDER = 'Jot a thought...'
const HISTORY_CAP = 50

/** In-progress drag state for tools that need a press + drag + release. */
type Drag =
  | { kind: 'pen'; points: { x: number; y: number }[] }
  | { kind: 'rect'; x: number; y: number; cx: number; cy: number }
  | { kind: 'arrow'; x: number; y: number; cx: number; cy: number }
  | { kind: 'pan'; startX: number; startY: number; startPanX: number; startPanY: number }
  /** Select-tool drag-to-move. `origObj` is the snapshot taken on mousedown so
   *  we always offset from a clean origin regardless of how many mousemove
   *  events fire in between. `moved` starts false and flips on the first
   *  mousemove — we push history only at that moment, not on the initial
   *  click, so a plain click on an object doesn't pollute the undo stack with
   *  a phantom no-op entry. */
  | { kind: 'move'; id: string; startWX: number; startWY: number; origObj: NapkinObject; moved: boolean }

export default function NapkinEditor({ file }: { file: FileData }) {
  const { t } = useTranslation('workspace')
  const projectId = useActiveProjectId()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [doc, setDoc] = useState<NapkinFile | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Per-tool style selections. One source of truth across all tools that
   * share the drawing palette — switching tools keeps the last color, matching
   * upstream behavior. Pen keeps its own size (thin/thick); other tools use a
   * fixed width. Sticky uses its own palette. */
  const [drawColor, setDrawColor] = useState<DrawingColor>(DRAWING_COLORS[0])
  const [penSize, setPenSize] = useState<PenSize>(PEN_SIZE_THIN)
  const [stickyColor, setStickyColor] = useState<StickyColor>('yellow')
  /** Currently selected object id (Select tool). Null = no selection. */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Object currently in inline-edit mode (text or sticky). Null = no editor open. */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Undo stack — snapshots of prior `doc.objects`. Pushed before every mutation;
   *  capped at HISTORY_CAP entries. No redo. */
  const historyRef = useRef<NapkinObject[][]>([])
  // True while editing a text object that was CREATED by the current
  // edit session (i.e., the Text tool's one-shot click). If the user then
  // commits empty content, we pop the pre-add history snapshot so the
  // whole tap-T → Escape gesture is net-zero in the undo stack. For an
  // edit session that started by dblclicking an existing text, this stays
  // false and an empty commit routes through deleteObject normally so the
  // deletion is itself recorded in history.
  const editingFromAddRef = useRef(false)
  // Refs so the window-keydown effect can be attached once and still reach
  // the latest state/callbacks without re-attaching on every mutation.
  const selectedIdRef = useRef<string | null>(null)
  const editingIdRef = useRef<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const undoRef = useRef<() => void>(() => {})
  const deleteRef = useRef<(id: string) => void>(() => {})
  useEffect(() => { selectedIdRef.current = selectedId })
  useEffect(() => { editingIdRef.current = editingId })
  useEffect(() => { dragRef.current = drag })

  /* ----- load -----
   *  Empty file → treat as a brand-new napkin (EMPTY_NAPKIN). Anything
   *  else must parse + pass structural validation; on failure we fail
   *  CLOSED (surface the error and refuse to edit) rather than silently
   *  replace the document with an empty one — that would overwrite the
   *  user's unreadable file on the next Save. */
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    authFetch(fileDownloadUrl(file.id))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then(text => {
        if (cancelled) return
        if (!text.trim()) { setDoc(EMPTY_NAPKIN()); return }
        let parsed: unknown
        try { parsed = JSON.parse(text) }
        catch { setError('Napkin file is not valid JSON — editing disabled.'); return }
        if (!isNapkinFile(parsed)) { setError('Napkin file has an unexpected shape — editing disabled.'); return }
        if (parsed.version > 1) { setError(`Napkin version ${parsed.version} is newer than this editor supports.`); return }
        setDoc(parsed)
      })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [file.id])

  /* ----- keyboard shortcuts -----
   *  The inline-edit overlay owns its own Escape + Cmd+Z behavior via
   *  stopPropagation, so the window handler only fires when focus is OUTSIDE
   *  the overlay. That lets us skip target-sniffing and keep one clean
   *  precedence order here:
   *   1. Cmd/Ctrl+Z → undo.
   *   2. Escape → deselect, or revert to Select if nothing is selected.
   *   3. Backspace / Delete → remove the current selection (but bail out
   *      inside any text field so the chat composer keeps working).
   *   4. Single-char tool shortcut (V/H/P/T/R/A/S). */
  useEffect(() => {
    const isTextField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoRef.current()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'Escape') {
        // editingId path is handled by the overlay itself (stopPropagation).
        if (selectedIdRef.current !== null) { setSelectedId(null); return }
        setTool('select')
        return
      }

      if (isTextField(e.target)) return

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const sel = selectedIdRef.current
        if (sel !== null && !dragRef.current) {
          e.preventDefault()
          deleteRef.current(sel)
          setSelectedId(null)
        }
        return
      }

      const k = e.key.toLowerCase()
      if (TOOL_SHORTCUTS[k]) setTool(TOOL_SHORTCUTS[k])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ----- canvas size + DPR -----
   *  Depends on `doc` because the canvas isn't in the DOM while doc is
   *  still loading (we render a placeholder in that window). Re-running
   *  on the null→loaded transition is what actually attaches the
   *  ResizeObserver to the real canvas and syncs its backing store to
   *  the container size. With `[]` deps the effect fires once on mount,
   *  sees a null canvasRef, and never retries.
   *
   *  drawRef always holds the latest `draw` closure so the ResizeObserver
   *  callback paints with current doc/pan/drag state — not the stale
   *  initial closure from when the effect first ran. */
  const drawRef = useRef(() => {})
  useEffect(() => { drawRef.current = draw })
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const sync = () => {
      const { clientWidth, clientHeight } = container
      canvas.width = clientWidth * dpr
      canvas.height = clientHeight * dpr
      canvas.style.width = `${clientWidth}px`
      canvas.style.height = `${clientHeight}px`
      drawRef.current()
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [doc])

  /* ----- redraw whenever state changes ----- */
  useEffect(() => { draw() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [doc, panX, panY, drag, drawColor, penSize, selectedId, editingId])

  /* ----- drawing ----- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    // dot-grid background
    ctx.fillStyle = '#faf7f1'
    ctx.fillRect(0, 0, w, h)
    drawDotGrid(ctx, w, h, panX, panY)

    // world transform
    ctx.translate(panX, panY)
    if (doc) for (const obj of doc.objects) {
      // Skip the object being edited inline — the overlay renders on top and
      // we don't want a ghost underneath showing the pre-edit content.
      if (obj.id === editingId) continue
      drawObject(ctx, obj)
    }

    // in-progress drag preview
    if (drag && drag.kind !== 'move') drawDragPreview(ctx, drag, { color: drawColor, penSize })

    // selection overlay — drawn last so it sits on top of the object. Skip
    // when we're editing the same object inline (the overlay has its own
    // thin-border affordance; the dashed BB would just overlap confusingly).
    if (doc && selectedId && selectedId !== editingId) {
      const sel = doc.objects.find(o => o.id === selectedId)
      if (sel) drawSelection(ctx, sel)
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [doc, panX, panY, drag, drawColor, penSize, selectedId, editingId])

  /* ----- pointer handling ----- */
  const screenToWorld = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left - panX, y: e.clientY - rect.top - panY }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (!doc) return
    const { x, y } = screenToWorld(e)

    if (tool === 'pen')   { setDrag({ kind: 'pen', points: [{ x, y }] }); return }
    if (tool === 'rect')  { setDrag({ kind: 'rect', x, y, cx: x, cy: y }); return }
    if (tool === 'arrow') { setDrag({ kind: 'arrow', x, y, cx: x, cy: y }); return }
    if (tool === 'pan')   { setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY }); return }

    if (tool === 'text') {
      // One-shot: create an empty text object at the click, enter edit mode,
      // revert tool to Select. Flag this as a "from add" edit session so
      // an Escape-without-typing commit cleanly reverts the addObject
      // history entry instead of leaving a phantom no-op to undo.
      const id = makeObjectId()
      addObject({
        id, type: 'text', x, y,
        width: 4, height: TEXT_FONT_SIZE + 6,
        data: { content: '', fontSize: TEXT_FONT_SIZE, color: drawColor, bold: false },
      })
      setSelectedId(id)
      setEditingId(id)
      editingFromAddRef.current = true
      setTool('select')
      return
    }

    if (tool === 'sticky') {
      // One-shot: drop the sticky with empty content (placeholder renders
      // until the user double-clicks to edit), revert tool to Select. The
      // sticky is placed, but NOT selected — matches upstream.
      const id = makeObjectId()
      addObject({
        id, type: 'sticky',
        x: x - STICKY_SIZE / 2, y: y - STICKY_SIZE / 2,
        width: STICKY_SIZE, height: STICKY_SIZE,
        data: { content: '', color: stickyColor },
      })
      setTool('select')
      return
    }

    // Select tool — hit-test from the top of the stack down. If we hit an
    // object we select it AND start a move-drag (even on the first click).
    // Empty canvas click deselects.
    const hit = hitTest(doc.objects, x, y)
    if (hit) {
      setSelectedId(hit.id)
      setDrag({ kind: 'move', id: hit.id, startWX: x, startWY: y, origObj: hit, moved: false })
    } else {
      setSelectedId(null)
    }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return
    if (drag.kind === 'pen') {
      const { x, y } = screenToWorld(e)
      setDrag({ ...drag, points: [...drag.points, { x, y }] })
    } else if (drag.kind === 'rect' || drag.kind === 'arrow') {
      const { x, y } = screenToWorld(e)
      setDrag({ ...drag, cx: x, cy: y })
    } else if (drag.kind === 'pan') {
      setPanX(drag.startPanX + (e.clientX - drag.startX))
      setPanY(drag.startPanY + (e.clientY - drag.startY))
    } else if (drag.kind === 'move') {
      const { x, y } = screenToWorld(e)
      const dx = x - drag.startWX, dy = y - drag.startWY
      // Push history on the FIRST real movement — a mousedown + immediate
      // mouseup (plain click, no drag) then skips the history push entirely.
      if (!drag.moved) {
        pushHistory()
        setDrag({ ...drag, moved: true })
      }
      // Apply the offset to the snapshot (not the current object) so compound
      // mousemove events stay consistent.
      updateObject(drag.id, offsetObject(drag.origObj, dx, dy), false)
    }
  }

  const onMouseUp = () => {
    if (!drag) return
    if (drag.kind === 'pen' && drag.points.length > 1) {
      addObject({
        id: makeObjectId(), type: 'stroke', x: 0, y: 0,
        data: { points: drag.points, color: drawColor, size: penSize },
      })
    } else if (drag.kind === 'rect') {
      const x = Math.min(drag.x, drag.cx), y = Math.min(drag.y, drag.cy)
      const width = Math.abs(drag.cx - drag.x), height = Math.abs(drag.cy - drag.y)
      if (width > 2 && height > 2) {
        addObject({
          id: makeObjectId(), type: 'rect', x, y, width, height,
          data: { fill: null, stroke: drawColor, strokeWidth: SHAPE_STROKE_WIDTH },
        })
      }
    } else if (drag.kind === 'arrow') {
      const dx = drag.cx - drag.x, dy = drag.cy - drag.y
      if (dx * dx + dy * dy > 9) {
        addObject({
          id: makeObjectId(), type: 'line', x: drag.x, y: drag.y, endX: drag.cx, endY: drag.cy,
          data: { fill: null, stroke: drawColor, strokeWidth: ARROW_STROKE_WIDTH, arrowHead: true },
        })
      }
    }
    // 'move' commits each position via onMouseMove; nothing to do on release.
    // 'pan' is also a no-op — panX/panY already updated on each mousemove.
    setDrag(null)
  }

  const pushHistory = () => {
    if (!doc) return
    const snap = doc.objects
    historyRef.current = [...historyRef.current, snap].slice(-HISTORY_CAP)
  }

  const addObject = (obj: NapkinObject) => {
    pushHistory()
    setDoc(d => d ? { ...d, objects: [...d.objects, obj], modified: new Date().toISOString() } : d)
    setDirty(true)
  }

  /** Replace one object in-place by id. Used by move-drag and inline-edit commit. */
  const updateObject = (id: string, next: NapkinObject, withHistory = true) => {
    if (withHistory) pushHistory()
    setDoc(d => d ? { ...d, objects: d.objects.map(o => o.id === id ? next : o), modified: new Date().toISOString() } : d)
    setDirty(true)
  }

  const deleteObject = (id: string) => {
    pushHistory()
    setDoc(d => d ? { ...d, objects: d.objects.filter(o => o.id !== id), modified: new Date().toISOString() } : d)
    setDirty(true)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!doc || tool !== 'select') return
    const { x, y } = screenToWorld(e)
    const hit = hitTest(doc.objects, x, y)
    if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
      setSelectedId(hit.id)
      setEditingId(hit.id)
      editingFromAddRef.current = false  // re-editing existing, not a fresh add
    }
  }

  /** Commit the inline editor's current content back into the object, or
   *  remove the object outright if the content is empty.
   *
   *  Text + empty is subtle, and branches on how this edit session started:
   *  - If we entered edit mode via the Text tool's one-shot click
   *    (`editingFromAddRef`), the pre-create history snapshot pushed by
   *    `addObject` is a phantom — the user perceives the whole tap-T →
   *    Escape gesture as a no-op, so we pop that snapshot AND remove the
   *    placeholder in a single setDoc (net-zero history delta).
   *  - If we entered via dblclick on an existing text object, an empty
   *    commit means the user cleared the content — route through
   *    `deleteObject` so the deletion is itself recorded in history and
   *    Cmd+Z can bring the text back. */
  const commitEdit = (content: string) => {
    // Guard against double-fire: Escape in the overlay commits + unmounts,
    // then the unmounting contenteditable blurs and re-triggers `onCommit`.
    // `editingIdRef` is synced via effect, but we consume + clear it at the
    // top of the FIRST commit so the second commit bails cleanly even before
    // React has re-rendered.
    const id = editingIdRef.current
    if (id === null || !doc) return
    editingIdRef.current = null
    const obj = doc.objects.find(o => o.id === id)
    if (!obj) { setEditingId(null); editingFromAddRef.current = false; return }
    if (obj.type === 'text') {
      if (!content.trim()) {
        if (editingFromAddRef.current) {
          historyRef.current = historyRef.current.slice(0, -1)
          setDoc(d => d ? { ...d, objects: d.objects.filter(o => o.id !== id), modified: new Date().toISOString() } : d)
        } else {
          deleteObject(id)
        }
        setSelectedId(null); setEditingId(null); editingFromAddRef.current = false; return
      }
      // Re-measure width against the edited content via the canvas's own text
      // metrics so the bounding box hugs the rendered text exactly — the old
      // `content.length * 9` heuristic visibly mis-hugs wide / bold chars.
      const ctx = canvasRef.current?.getContext('2d')
      let width = 4
      if (ctx) {
        ctx.save()
        ctx.font = `${obj.data.bold ? 'bold ' : ''}${obj.data.fontSize}px sans-serif`
        width = Math.max(4, Math.ceil(ctx.measureText(content).width))
        ctx.restore()
      }
      updateObject(id, { ...obj, width, data: { ...obj.data, content } })
    } else if (obj.type === 'sticky') {
      updateObject(id, { ...obj, data: { ...obj.data, content } })
    }
    setEditingId(null)
    editingFromAddRef.current = false
  }

  const undo = () => {
    const stack = historyRef.current
    if (!stack.length) return
    const prev = stack[stack.length - 1]
    historyRef.current = stack.slice(0, -1)
    setDoc(d => d ? { ...d, objects: prev, modified: new Date().toISOString() } : d)
    setDirty(true)
    setEditingId(null)
    editingFromAddRef.current = false
    // Keep selection if the restored object set still contains it (undoing a
    // move shouldn't drop your selection); drop it only when the restore
    // removed the object — e.g. undoing an add.
    setSelectedId(curr => (curr && prev.some(o => o.id === curr) ? curr : null))
  }
  useEffect(() => { undoRef.current = undo })
  useEffect(() => { deleteRef.current = deleteObject })

  /* ----- save -----
   *  Overwrite in place — direct POST to /projects/:id/files with the
   *  existing filename. Do NOT go through `store.addFile`: that path is
   *  for NEW files and does an optimistic-prepend with a temp id. A
   *  same-name overwrite would add a second row (temp → server id which
   *  already exists) and duplicate the file in the sidebar.
   *
   *  After the overwrite succeeds, re-fetch the project's file list so
   *  size/date metadata refresh without touching tab identity. */
  const onSave = async () => {
    if (!doc || !projectId || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated: typeof doc = { ...doc, modified: new Date().toISOString() }
      const form = new FormData()
      form.append(
        'file',
        new File([JSON.stringify(updated, null, 2)], file.name, { type: 'application/json' }),
      )
      // Overwrite at the napkin's existing path. Without this, the
      // server's default would write to uploads/<name>.napkin and
      // duplicate the file instead of overwriting in scraps/.
      form.append('path', file.path)
      const res = await authFetch(apiUrl(`/projects/${projectId}/files`), { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDoc(updated)
      setDirty(false)
      // Refresh metadata in the store (size, date). Doesn't change ids.
      void useStore.getState().loadProjectFiles(projectId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /* ----- auto-save -----
   *  Any mutation flips `dirty=true`; this effect fires and saves. If a
   *  new mutation lands while a save is in-flight, `saving=true` guards
   *  the effect until the save resolves, then re-fires for the new state.
   *  Manual Save button is redundant but kept for explicit user intent. */
  const saveRef = useRef(onSave)
  useEffect(() => { saveRef.current = onSave })
  useEffect(() => {
    if (!dirty || saving) return
    void saveRef.current()
  }, [dirty, saving, doc])

  if (error) return <div className="wsv2-editor-placeholder">Napkin error: {error}</div>
  if (!doc) return <div className="wsv2-editor-placeholder">Loading napkin…</div>

  return (
    <div
      className="wsv2-napkin"
      ref={containerRef}
      style={{ cursor: cursorForTool(tool) }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <canvas ref={canvasRef} className="wsv2-napkin-canvas" />
      {/* stopPropagation on the toolbar's mousedown/move/up so tool-button
          clicks don't also drive the canvas pointer handlers one layer up. */}
      <div
        className="wsv2-napkin-toolbar"
        onMouseDown={e => e.stopPropagation()}
        onMouseMove={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
      >
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')} label="Select (V)"><SelectIcon /></ToolButton>
        <ToolButton active={tool === 'pan'}    onClick={() => setTool('pan')}    label="Pan (H)"><HandIcon /></ToolButton>
        <span className="wsv2-napkin-toolsep" />
        <ToolButton active={tool === 'pen'}    onClick={() => setTool('pen')}    label="Pen (P)"><PencilIcon /></ToolButton>
        <ToolButton active={tool === 'text'}   onClick={() => setTool('text')}   label="Text (T)"><TextIcon /></ToolButton>
        <ToolButton active={tool === 'rect'}   onClick={() => setTool('rect')}   label="Shape (R)"><ShapeIcon /></ToolButton>
        <ToolButton active={tool === 'arrow'}  onClick={() => setTool('arrow')}  label="Arrow (A)"><ArrowIcon /></ToolButton>
        <ToolButton active={tool === 'sticky'} onClick={() => setTool('sticky')} label="Sticky (S)"><StickyIcon /></ToolButton>
        <span className="wsv2-napkin-toolsep" />
        <button
          type="button"
          className="wsv2-napkin-save"
          onClick={onSave}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      {doc && editingId && (() => {
        const obj = doc.objects.find(o => o.id === editingId)
        if (!obj || (obj.type !== 'text' && obj.type !== 'sticky')) return null
        const editable = obj as TextObject | StickyObject
        // World → container-local CSS coords: (world + pan) is already in
        // CSS pixels relative to the container, because the canvas fills the
        // container and its CSS size equals container clientWidth/Height.
        const left = editable.x + panX, top = editable.y + panY
        return (
          <InlineEditor
            obj={editable}
            left={left}
            top={top}
            stickyFill={STICKY_FILL}
            onCommit={commitEdit}
          />
        )
      })()}
      {subToolbarFor(tool) && (
        <div
          className="wsv2-napkin-subtoolbar"
          onMouseDown={e => e.stopPropagation()}
          onMouseMove={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
        >
          {tool === 'pen' && (
            <>
              <button
                type="button"
                className={`wsv2-napkin-weight${penSize === PEN_SIZE_THIN ? ' is-active' : ''}`}
                onClick={() => setPenSize(PEN_SIZE_THIN)}
                aria-label={t('viewer.napkinThin')}
                title={t('viewer.napkinThin')}
              >
                <svg viewBox="0 0 24 10" width="24" height="10"><path d="M1 5 C 6 1, 12 9, 18 5 S 23 5, 23 5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"/></svg>
              </button>
              <button
                type="button"
                className={`wsv2-napkin-weight${penSize === PEN_SIZE_THICK ? ' is-active' : ''}`}
                onClick={() => setPenSize(PEN_SIZE_THICK)}
                aria-label={t('viewer.napkinThick')}
                title={t('viewer.napkinThick')}
              >
                <svg viewBox="0 0 24 10" width="24" height="10"><path d="M1 5 C 6 1, 12 9, 18 5 S 23 5, 23 5" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round"/></svg>
              </button>
              <span className="wsv2-napkin-toolsep" />
            </>
          )}
          {(tool === 'pen' || tool === 'text' || tool === 'rect' || tool === 'arrow') &&
            DRAWING_COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`wsv2-napkin-swatch${drawColor === c ? ' is-active' : ''}`}
                onClick={() => setDrawColor(c)}
                aria-label={`Color ${c}`}
                title={c}
                style={{ background: c }}
              />
            ))}
          {tool === 'sticky' &&
            STICKY_COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`wsv2-napkin-sticky-swatch${stickyColor === c ? ' is-active' : ''}`}
                onClick={() => setStickyColor(c)}
                aria-label={`Sticky ${c}`}
                title={c}
                style={{ background: STICKY_FILL[c] }}
              />
            ))}
        </div>
      )}
    </div>
  )
}

/** Which tools open a sub-toolbar. Select / Pan / Save have no options. */
function subToolbarFor(tool: Tool): boolean {
  return tool === 'pen' || tool === 'text' || tool === 'rect' || tool === 'arrow' || tool === 'sticky'
}

/** Inline contentEditable overlay for the Text and Sticky editors. Positioned
 *  absolutely over the canvas at the object's world→screen coords. Commits on
 *  blur (click-away) or Escape. The parent owns editingId; InlineEditor only
 *  reports back via onCommit. */
function InlineEditor({
  obj,
  left,
  top,
  stickyFill,
  onCommit,
}: {
  obj: TextObject | StickyObject
  left: number
  top: number
  stickyFill: Record<StickyColor, string>
  onCommit: (content: string) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Autofocus + place caret at the end of existing content on mount.
    const el = ref.current
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    if (sel) { sel.removeAllRanges(); sel.addRange(range) }
  }, [])

  if (obj.type === 'text') {
    return (
      <div
        ref={ref}
        className="wsv2-napkin-editoverlay wsv2-napkin-editoverlay--text"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={e => {
          if (e.key === 'Enter') e.preventDefault()  // single-line
          if (e.key === 'Escape') {
            // Own the Escape completely — stop propagation so the window
            // keydown handler doesn't also re-run the commit path.
            e.preventDefault(); e.stopPropagation()
            onCommit(e.currentTarget.textContent ?? '')
          }
        }}
        onBlur={e => onCommit(e.currentTarget.textContent ?? '')}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          font: `${obj.data.bold ? 'bold ' : ''}${obj.data.fontSize}px sans-serif`,
          color: obj.data.color,
        }}
      >
        {obj.data.content}
      </div>
    )
  }

  // sticky
  return (
    <div
      ref={ref}
      className="wsv2-napkin-editoverlay wsv2-napkin-editoverlay--sticky"
      contentEditable
      suppressContentEditableWarning
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation()
          onCommit(e.currentTarget.textContent ?? '')
        }
      }}
      onBlur={e => onCommit(e.currentTarget.textContent ?? '')}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${obj.width}px`,
        height: `${obj.height}px`,
        background: stickyFill[obj.data.color] ?? stickyFill.yellow,
      }}
    >
      {obj.data.content}
    </div>
  )
}

function ToolButton({
  active, onClick, label, children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`wsv2-napkin-tool${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  )
}

/* ---------- toolbar icons ----------
 * All icons share a 24-unit viewBox. Outline icons use `currentColor` so
 * the active/inactive CSS state drives stroke color. Pencil and Sticky are
 * filled illustrations per the design spec, with their own palette. */

function SelectIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M5 3 L5 17 L9.2 13.2 L12 19.5 L14 18.7 L11.2 12.5 L17 12.2 Z" />
    </svg>
  )
}

function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M7 11V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M10 11V5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M13 11V6a1.5 1.5 0 0 1 3 0v6" />
      <path d="M16 11V8a1.5 1.5 0 0 1 3 0v7c0 3-2 6-6 6h-1c-2 0-3.5-1-4.5-2.5L4 13a1.5 1.5 0 0 1 2.2-2L8 12.5" />
    </svg>
  )
}

/** Pencil: filled illustration, white body, dark maroon tip, brown band
 *  at the base. Rendered slightly bigger than the outline icons so it reads
 *  as the toolbar's primary action (per design spec). */
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 28" width="22" height="26">
      <path d="M12 2 L7.5 11 L16.5 11 Z" fill="#5A2818" />
      <rect x="7.5" y="11" width="9" height="2.5" fill="#8B4513" />
      <rect x="7.5" y="13.5" width="9" height="11" fill="#FAF6EE" stroke="#B8A88E" strokeWidth="0.6" />
      <rect x="7.5" y="24.5" width="9" height="2" fill="#C2622D" />
    </svg>
  )
}

/** Serif capital "T" next to a text-cursor bar. */
function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6 L15 6" />
      <path d="M9.5 6 L9.5 18" />
      <path d="M7.5 18 L11.5 18" />
      <path d="M18 8 L18 18" />
    </svg>
  )
}

/** Two overlapping rounded squares — the "union / duplicate shape" idiom. */
function ShapeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
    </svg>
  )
}

/** Diagonal arrow pointing top-right. */
function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18 L18 6" />
      <path d="M10 6 L18 6 L18 14" />
    </svg>
  )
}

/** Pink sticky note stacked over a lavender card, with a small squiggle
 *  mark on the front — filled flat-pastel illustration per spec. */
function StickyIcon() {
  return (
    <svg viewBox="0 0 28 28" width="26" height="26">
      <rect x="9" y="4" width="15" height="15" rx="1.5" fill="#E6D6F2" stroke="#C7B3DB" strokeWidth="0.6" />
      <rect x="4" y="8" width="15" height="15" rx="1.5" fill="#FAD4D4" stroke="#D8ACAC" strokeWidth="0.6" />
      <path d="M7.5 16 C 8.3 14.7, 9.7 14.7, 10.5 16 S 12.2 17.3, 13 16 S 14.7 14.7, 15.5 16" stroke="#3A2418" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** Per-tool cursor so the active tool is readable from the canvas itself. */
function cursorForTool(tool: Tool): string {
  switch (tool) {
    case 'select': return 'default'
    case 'pan':    return 'grab'
    case 'text':   return 'text'
    default:       return 'crosshair'
  }
}

/* ---------- rendering helpers ---------- */

function drawDotGrid(ctx: CanvasRenderingContext2D, w: number, h: number, panX: number, panY: number) {
  const GRID = 20
  ctx.fillStyle = 'rgba(15, 12, 8, 0.22)'
  const ox = ((panX % GRID) + GRID) % GRID
  const oy = ((panY % GRID) + GRID) % GRID
  for (let y = oy; y < h; y += GRID) {
    for (let x = ox; x < w; x += GRID) {
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** Runtime shape check for the top-level NapkinFile envelope. */
function isNapkinFile(v: unknown): v is NapkinFile {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.version !== 'number') return false
  if (typeof o.created !== 'string' || typeof o.modified !== 'string') return false
  if (!Array.isArray(o.objects)) return false
  return true
}

const _warnedUnknownTypes = new Set<string>()
function warnUnknownType(t: string) {
  if (_warnedUnknownTypes.has(t)) return
  _warnedUnknownTypes.add(t)
  // Forward-compat: a file from a newer editor may include types we
  // don't render. Warn once and skip, don't throw.
  console.warn(`[napkin] unknown object type: ${t}`)
}

function drawObject(ctx: CanvasRenderingContext2D, obj: NapkinObject) {
  if (obj.type === 'stroke') {
    const { points, color, size } = obj.data
    if (points.length < 2) return
    ctx.strokeStyle = color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
  } else if (obj.type === 'rect') {
    const { fill, stroke, strokeWidth } = obj.data
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(obj.x, obj.y, obj.width, obj.height) }
    if (stroke) {
      ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
    }
  } else if (obj.type === 'line') {
    const { stroke, strokeWidth, arrowHead } = obj.data
    ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth
    ctx.beginPath(); ctx.moveTo(obj.x, obj.y); ctx.lineTo(obj.endX, obj.endY); ctx.stroke()
    if (arrowHead) drawArrowHead(ctx, obj.x, obj.y, obj.endX, obj.endY, stroke)
  } else if (obj.type === 'text') {
    ctx.fillStyle = obj.data.color
    ctx.font = `${obj.data.bold ? 'bold ' : ''}${obj.data.fontSize}px sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(obj.data.content, obj.x, obj.y)
  } else if (obj.type === 'sticky') {
    ctx.fillStyle = STICKY_FILL[obj.data.color] ?? STICKY_FILL.yellow
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height)
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
    ctx.textBaseline = 'top'
    if (obj.data.content) {
      ctx.fillStyle = '#111'
      ctx.font = '14px sans-serif'
      wrapText(ctx, obj.data.content, obj.x + 12, obj.y + 12, obj.width - 24, 18)
    } else {
      // Empty sticky — render the placeholder in grey italic until the user
      // double-clicks to edit.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)'
      ctx.font = 'italic 14px sans-serif'
      ctx.fillText(STICKY_PLACEHOLDER, obj.x + 12, obj.y + 12)
    }
  } else {
    // Forward-compat: unknown type from a newer file format. Warn once
    // and skip instead of crashing.
    warnUnknownType((obj as { type: string }).type)
  }
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  const SIZE = 10
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - SIZE * Math.cos(angle - Math.PI / 7), y2 - SIZE * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(x2 - SIZE * Math.cos(angle + Math.PI / 7), y2 - SIZE * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

function drawDragPreview(
  ctx: CanvasRenderingContext2D,
  drag: Drag,
  style: { color: string; penSize: number },
) {
  if (drag.kind === 'pen' && drag.points.length > 1) {
    drawObject(ctx, {
      id: 'preview', type: 'stroke', x: 0, y: 0,
      data: { points: drag.points, color: style.color, size: style.penSize },
    })
  } else if (drag.kind === 'rect') {
    const x = Math.min(drag.x, drag.cx), y = Math.min(drag.y, drag.cy)
    const width = Math.abs(drag.cx - drag.x), height = Math.abs(drag.cy - drag.y)
    drawObject(ctx, {
      id: 'preview', type: 'rect', x, y, width, height,
      data: { fill: null, stroke: style.color, strokeWidth: SHAPE_STROKE_WIDTH },
    })
  } else if (drag.kind === 'arrow') {
    drawObject(ctx, {
      id: 'preview', type: 'line', x: drag.x, y: drag.y, endX: drag.cx, endY: drag.cy,
      data: { fill: null, stroke: style.color, strokeWidth: ARROW_STROKE_WIDTH, arrowHead: true },
    })
  }
}

/* ---------- selection + hit-testing ---------- */

interface Bounds { x: number; y: number; w: number; h: number }

/** Axis-aligned bounding box of an object in world coords. Tightness per
 *  type matches the design: stroke BB wraps actual point extent; rect / sticky
 *  / text use the envelope; line/arrow spans start + end. */
function boundsOf(obj: NapkinObject): Bounds {
  if (obj.type === 'stroke') {
    const pts = obj.data.points
    if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 }
    let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  if (obj.type === 'rect' || obj.type === 'sticky' || obj.type === 'text') {
    return { x: obj.x, y: obj.y, w: obj.width, h: obj.height }
  }
  // line
  const x1 = Math.min(obj.x, obj.endX), x2 = Math.max(obj.x, obj.endX)
  const y1 = Math.min(obj.y, obj.endY), y2 = Math.max(obj.y, obj.endY)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Hit-test: topmost object whose bounds contain the world-space point, or
 *  null if nothing is under the cursor. Bounds are padded a few px so thin
 *  strokes / lines stay grabbable. */
function hitTest(objects: NapkinObject[], x: number, y: number): NapkinObject | null {
  const PAD = 4
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    const b = boundsOf(o)
    if (x >= b.x - PAD && x <= b.x + b.w + PAD && y >= b.y - PAD && y <= b.y + b.h + PAD) return o
  }
  return null
}

/** Return a new object translated by (dx, dy). For strokes we offset every
 *  point (envelope stays at 0,0 per the file-format convention). For lines
 *  we offset both endpoints. Everything else just moves (x, y). */
function offsetObject(obj: NapkinObject, dx: number, dy: number): NapkinObject {
  if (obj.type === 'stroke') {
    return { ...obj, data: { ...obj.data, points: obj.data.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } }
  }
  if (obj.type === 'line') {
    return { ...obj, x: obj.x + dx, y: obj.y + dy, endX: obj.endX + dx, endY: obj.endY + dy }
  }
  return { ...obj, x: obj.x + dx, y: obj.y + dy }
}

/** Dashed blue bounding box + 8 square handles (4 corners, 4 midpoints).
 *  Handles are visual only — resize-by-handle is out of scope for this pass. */
function drawSelection(ctx: CanvasRenderingContext2D, obj: NapkinObject) {
  const { x, y, w, h } = boundsOf(obj)
  const PAD = 4
  const bx = x - PAD, by = y - PAD, bw = w + PAD * 2, bh = h + PAD * 2
  ctx.save()
  ctx.strokeStyle = '#2D7DD2'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.strokeRect(bx, by, bw, bh)
  ctx.setLineDash([])
  // handles
  const HS = 6
  const pts: [number, number][] = [
    [bx, by], [bx + bw / 2, by], [bx + bw, by],
    [bx, by + bh / 2],                [bx + bw, by + bh / 2],
    [bx, by + bh], [bx + bw / 2, by + bh], [bx + bw, by + bh],
  ]
  for (const [hx, hy] of pts) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(hx - HS / 2, hy - HS / 2, HS, HS)
    ctx.strokeStyle = '#2D7DD2'
    ctx.strokeRect(hx - HS / 2 + 0.5, hy - HS / 2 + 0.5, HS - 1, HS - 1)
  }
  ctx.restore()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(/\s+/)
  let line = ''
  let yy = y
  for (const w of words) {
    const tryLine = line ? line + ' ' + w : w
    if (ctx.measureText(tryLine).width > maxWidth && line) {
      ctx.fillText(line, x, yy)
      line = w
      yy += lineHeight
    } else {
      line = tryLine
    }
  }
  if (line) ctx.fillText(line, x, yy)
}
