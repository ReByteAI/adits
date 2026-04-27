/** Single Lexical DecoratorNode for every round-buffer chip. Replaces
 *  the old per-kind CommentNode / EditBatchNode / TweakSaveNode with
 *  one unified node whose appearance derives from the piece's `text` /
 *  `image` and whose `getTextContent()` branches on `source` to
 *  produce the agent-facing LLM text.
 *
 *  Adding a new source: push a `PromptPiece` with that source to the
 *  round store and extend `serializeForLLM` below. Chip rendering
 *  works out of the box for any source that fills `text` and/or
 *  `image`.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import type { PromptPiece, PromptPieceSource } from '../store'
import { useRoundStore } from '../store'

type SerializedPromptPieceNode = Spread<{ piece: PromptPiece }, SerializedLexicalNode>

const EXCERPT_LEN = 80

const KIND_LABEL: Record<string, string> = {
  comment: 'Comment',
  edit: 'Edit',
  tweak: 'Tweaks',
  draw: 'Draw',
  'pdf-region': 'Region',
  'image-region': 'Region',
}

function labelFor(source: PromptPieceSource): string {
  return KIND_LABEL[source] ?? source
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function summary(piece: PromptPiece): string {
  if (piece.text) return truncate(piece.text, EXCERPT_LEN)
  if (piece.ref.path) return truncate(piece.ref.path, EXCERPT_LEN)
  return piece.ref.fileName
}

/** Margin from the viewport edge the preview will keep on clamp. */
const PREVIEW_MARGIN = 8
/** Gap between chip and preview. */
const PREVIEW_GAP = 6

function PromptPieceChip({ piece }: { piece: PromptPiece }) {
  const { t } = useTranslation('workspace')
  const label = labelFor(piece.source)
  const addr = piece.ref.path
    ? `${piece.ref.fileName} · ${piece.ref.path}`
    : piece.ref.fileName

  const chipRef = useRef<HTMLSpanElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  /** Null until the preview mounts and we measure its size — keeps
   *  it `visibility: hidden` on the first paint so the user never
   *  sees a flash at (0,0). */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // The preview is portaled to <body> so it escapes
  // `.wsv2-composer-editor { overflow: auto }`. Position is `fixed`
  // in viewport coords: prefer above the chip, flip below if there's
  // no room, and clamp horizontally. useLayoutEffect so we measure
  // and place before paint.
  useLayoutEffect(() => {
    if (!hover) { setPos(null); return }
    const chip = chipRef.current
    const preview = previewRef.current
    if (!chip || !preview) return
    const cr = chip.getBoundingClientRect()
    const pr = preview.getBoundingClientRect()

    let top = cr.top - pr.height - PREVIEW_GAP
    if (top < PREVIEW_MARGIN) top = cr.bottom + PREVIEW_GAP
    if (top + pr.height > window.innerHeight - PREVIEW_MARGIN) {
      top = Math.max(PREVIEW_MARGIN, window.innerHeight - pr.height - PREVIEW_MARGIN)
    }

    let left = cr.left
    if (left + pr.width > window.innerWidth - PREVIEW_MARGIN) {
      left = window.innerWidth - pr.width - PREVIEW_MARGIN
    }
    if (left < PREVIEW_MARGIN) left = PREVIEW_MARGIN

    setPos({ top, left })
  }, [hover])

  return (
    <span
      ref={chipRef}
      className={`wsv2-round-chip wsv2-round-chip--${piece.source}`}
      role="img"
      aria-label={`${label}: ${summary(piece)}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      {piece.image && (
        <img
          className="wsv2-round-chip-thumb"
          src={piece.image}
          alt=""
          aria-hidden="true"
        />
      )}
      <span className="wsv2-round-chip-kind">{label}</span>
      <span className="wsv2-round-chip-summary">{summary(piece)}</span>
      <button
        type="button"
        className="wsv2-round-chip-remove"
        aria-label={t('viewer.removePromptPiece')}
        title={t('viewer.remove')}
        // stopPropagation on mousedown too — Lexical treats pointerdown
        // inside a decorator as a selection gesture, which would steal
        // focus away from the chip before the click fires.
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          useRoundStore.getState().remove(piece.id)
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {hover && createPortal(
        <div
          ref={previewRef}
          className="wsv2-round-chip-preview"
          role="tooltip"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {piece.image && (
            <img className="wsv2-round-chip-preview-img" src={piece.image} alt="" />
          )}
          {piece.text && <span className="wsv2-round-chip-preview-text">{piece.text}</span>}
          <span className="wsv2-round-chip-preview-ref">{addr}</span>
        </div>,
        document.body,
      )}
    </span>
  )
}

/** Assemble the agent-facing text for a piece. Source-specific — the
 *  composer treats `data` as opaque, but this reads it to preserve
 *  the LLM contracts the old per-kind nodes had. Unknown sources fall
 *  back to `text + ref`.
 *
 *  This is the per-source body. The send-time wrapper
 *  `serializePromptPiece` below appends a `Screenshot:` line when
 *  the composer has uploaded the piece's image to the project.
 *  Lexical's plain `getTextContent()` calls this directly (no
 *  screenshot path available outside the send pipeline). */
function serializeForLLM(piece: PromptPiece): string {
  const { source, ref, text, data } = piece

  if (source === 'comment') {
    // HTML-element comment carries ccId/dom in `data`; crop-based
    // comment (PDF region, image region) carries only the rect in
    // `ref.path`. When data is empty we skip the mentioned-element
    // block — the path in the head line is the reference.
    const d = (data ?? {}) as { ccId?: string; dom?: string }
    const mentioned = d.ccId || d.dom
      ? [
          '<mentioned-element>',
          d.dom ? `dom:   ${d.dom}` : undefined,
          d.ccId ? `id:    data-cc-id="${d.ccId}"` : undefined,
          '</mentioned-element>',
        ].filter(Boolean).join('\n')
      : ''
    const addr = ref.path ? ` at ${ref.path}` : ''
    const head = text
      ? `Comment on ${ref.fileName}${addr}: ${text}`
      : `Comment on ${ref.fileName}${addr}`
    return mentioned ? [head, '', mentioned].join('\n') : head
  }

  if (source === 'draw') {
    // Freehand annotation over an image / PDF page. The annotated
    // pixels live in `piece.image`; this line is the textual cue
    // Claude sees.
    const addr = ref.path ? ` (${ref.path})` : ''
    return text ?? `Annotated ${ref.fileName}${addr}.`
  }

  if (source === 'edit') {
    const edits = ((data ?? {}) as {
      edits?: Array<{ selector: string; prop: string; value: string }>
    }).edits ?? []
    if (edits.length === 0) return text ?? `Apply direct edits in ${ref.fileName}.`
    const lines = edits.map(
      e => `In ${ref.fileName} at ${e.selector}: set the inline style to \`${e.prop}: ${e.value}\`.`,
    )
    if (lines.length === 1) return `Apply a direct edit. ${lines[0]}`
    return `Apply ${lines.length} direct edits:\n` + lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
  }

  if (source === 'tweak') {
    const d = (data ?? {}) as { edits?: Record<string, string | number | boolean> }
    const json = JSON.stringify(d.edits ?? {}, null, 2)
    return `Save the current tweaks in ${ref.fileName}: merge these values into the /*EDITMODE-BEGIN*/.../*EDITMODE-END*/ block: ${json}`
  }

  const addr = ref.path ? `${ref.fileName} · ${ref.path}` : ref.fileName
  return text ? `${text} (${addr})` : addr
}

/** Send-time wrapper used by the ChatComposer walker. Appends a
 *  `Screenshot:` reference line when the composer uploaded the
 *  piece's image to the project's `screenshots/` dir, so the agent
 *  can read the file like any other project file. */
export function serializePromptPiece(piece: PromptPiece, screenshotPath?: string): string {
  const body = serializeForLLM(piece)
  if (!screenshotPath) return body
  return `${body}\nScreenshot: ${screenshotPath}`
}

export class PromptPieceNode extends DecoratorNode<React.JSX.Element> {
  /** Round-buffer id — the plugin keys on this to dedupe between the
   *  store and the editor tree. Duplicated from `__piece.id` so the
   *  plugin can do a cheap property read without a nested access. */
  __id: string
  __piece: PromptPiece

  static getType(): string { return 'prompt-piece' }

  static clone(node: PromptPieceNode): PromptPieceNode {
    return new PromptPieceNode(node.__piece, node.__key)
  }

  static importJSON(serialized: SerializedPromptPieceNode): PromptPieceNode {
    return $createPromptPieceNode(serialized.piece)
  }

  constructor(piece: PromptPiece, key?: NodeKey) {
    super(key)
    this.__id = piece.id
    this.__piece = piece
  }

  exportJSON(): SerializedPromptPieceNode {
    return { piece: this.__piece, type: 'prompt-piece', version: 1 }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement('span')
  }

  updateDOM(): false { return false }

  getTextContent(): string {
    return serializeForLLM(this.__piece)
  }

  decorate(): React.JSX.Element {
    return <PromptPieceChip piece={this.__piece} />
  }
}

export function $createPromptPieceNode(piece: PromptPiece): PromptPieceNode {
  return $applyNodeReplacement(new PromptPieceNode(piece))
}

export function $isPromptPieceNode(node: LexicalNode | null | undefined): node is PromptPieceNode {
  return node instanceof PromptPieceNode
}
