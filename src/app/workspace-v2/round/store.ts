/** Round buffer — shared state between Bench lane controllers
 *  (producers) and the Lexical composer (consumer).
 *
 *  Every round-buffer entry is a **PromptPiece** — one unified shape
 *  for Comment, Edit, Tweak, and future per-file-type selections
 *  (Draw, PDF region, image crop, …). The composer renders pieces as
 *  chips; on Send, each chip's `getTextContent()` walks the piece's
 *  fields to produce the agent-facing text. Producers don't touch
 *  Lexical — `RoundBufferPlugin` mirrors the store into the tree and
 *  back.
 *
 *  Source-specific structured state lives under `data`; the composer
 *  treats `data` as opaque. Only the node's LLM serializer reads it,
 *  keyed off `source`.
 *
 *  In-memory only — no cross-reload persistence. Cleared on project
 *  switch and after a successful send. `v: 1` is the schema version.
 */
import { create } from 'zustand'

/** Stable set of known sources. String-typed (not a literal union) so
 *  new file-type adapters can add their own without a central edit. */
export type PromptPieceSource = string

export interface PromptPieceRef {
  fileName: string
  /** Human-readable address within the file: a CSS selector for HTML,
   *  `page 6 rect(100,200,300,400)` for PDF, a tweak key, etc. Omit
   *  when the piece refers to the whole file. */
  path?: string
}

/** One visible chip in the composer. `text` / `image` are what the
 *  chip renders; `data` is source-specific structured state read by
 *  the node's LLM serializer. */
export interface PromptPiece {
  v: 1
  id: string
  source: PromptPieceSource
  ref: PromptPieceRef
  /** User note or derived summary. Rendered as the chip snippet and
   *  as the full text on hover. */
  text?: string
  /** Base64 data URL; inline so the chip renders without external
   *  dependencies. Rendered as the chip thumb and hover preview. */
  image?: string
  /** Source-specific structured payload. Opaque to the composer;
   *  consumed by `PromptPieceNode.getTextContent()` when assembling
   *  the agent message. */
  data?: Record<string, unknown>
}

export type PromptPieceInput = Omit<PromptPiece, 'id'>

export function isPromptPiece(x: unknown): x is PromptPiece {
  if (!x || typeof x !== 'object') return false
  const p = x as Partial<PromptPiece>
  if (p.v !== 1) return false
  if (typeof p.id !== 'string' || !p.id) return false
  if (typeof p.source !== 'string' || !p.source) return false
  if (!p.ref || typeof p.ref !== 'object') return false
  const ref = p.ref as Partial<PromptPieceRef>
  if (typeof ref.fileName !== 'string' || !ref.fileName) return false
  if (ref.path !== undefined && typeof ref.path !== 'string') return false
  if (p.text !== undefined && typeof p.text !== 'string') return false
  if (p.image !== undefined && typeof p.image !== 'string') return false
  if (p.data !== undefined && (typeof p.data !== 'object' || p.data === null || Array.isArray(p.data))) return false
  return true
}

interface RoundState {
  pieces: PromptPiece[]
  /** Returns the generated id on success, null on validation failure
   *  (prod). In dev, throws instead so producers hear the problem loudly. */
  add: (input: PromptPieceInput) => string | null
  remove: (id: string) => void
  clear: () => void
}

function genId(): string {
  return 'r_' + Math.random().toString(36).slice(2, 10)
}

export const useRoundStore = create<RoundState>((set) => ({
  pieces: [],
  add: (input) => {
    const piece: PromptPiece = { ...input, id: genId() }
    if (!isPromptPiece(piece)) {
      const msg = `[round] invalid prompt piece from source=${String(input.source)}`
      console.error(msg, piece)
      if (import.meta.env.DEV) throw new Error(msg)
      return null
    }
    set(s => ({ pieces: [...s.pieces, piece] }))
    return piece.id
  },
  remove: (id) => set(s => ({ pieces: s.pieces.filter(n => n.id !== id) })),
  clear: () => set({ pieces: [] }),
}))
