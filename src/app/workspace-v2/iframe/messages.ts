/** Shared wire types for the page-iframe bridge. Bridge + subscribers
 *  are typed against these unions, so payload drift between host-side
 *  consumers is a compile error. The inject script (inject-core.ts)
 *  is a stringified IIFE that TypeScript can't check against these
 *  types — keep the two hand-aligned, and let each controller narrow
 *  the union when decoding messages.
 *
 *  Every message flows through the single `__adits_iframe` postMessage
 *  namespace defined in `bridge.ts`.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface XY { x: number; y: number }

/** Computed styles the Edit panel exposes. Values are the raw CSS
 *  strings (e.g. `rgb(255, 0, 0)`, `16px`). */
export interface SelectionStyles {
  fontFamily: string
  fontSize: string
  color: string
  lineHeight: string
  fontWeight: string
  textAlign: string
  letterSpacing: string
  width: string
  height: string
  opacity: string
  padding: string
  margin: string
  borderRadius: string
  backgroundColor: string
}

export type IframeOutMsg =
  | { type: 'enter'; mode: 'edit' | 'comment' }
  | { type: 'exit' }
  | { type: 'setStyle'; selector: string; prop: string; value: string }
  | { type: 'present-enter'; mode: 'tab' | 'fullscreen' }
  | { type: 'present-exit' }
  /** Host forwards synthetic keyboard events into the iframe so the
   *  deck's own keybindings (←/→, Space, PgUp/PgDn, Home/End, 1-9)
   *  advance even when the iframe hasn't been clicked into. */
  | { type: 'forward-keydown'; key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

export type EditSelect = {
  type: 'select'
  mode: 'edit'
  selector: string
  tag: string
  rect: Rect
  inline: boolean
  styles: SelectionStyles
}

export type CommentSelect = {
  type: 'select'
  mode: 'comment'
  selector: string
  tag: string
  rect: Rect
  /** Click coordinates relative to the element's bounding rect —
   *  preserved for future detached-pin reconciliation. */
  anchor: XY
  /** Click in the iframe's viewport; the host translates to host
   *  viewport coords via bridge.toHostCoords(). */
  clickViewport: XY
  /** `cc-N` handle stamped on the element; surfaced in the
   *  `<mentioned-element>` id: line. Session-local. */
  ccId: string
  /** Human-readable ancestry (with data-screen-label surfaced) for
   *  the `<mentioned-element>` dom: line. */
  dom: string
}

export type IframeInMsg =
  | { type: 'ready'; version: number }
  | EditSelect
  | CommentSelect
  /** Comment-only: the pinned element's bounding rect shifted (iframe
   *  scroll, resize, or layout change) — recompute `popoverAnchor`
   *  from the new `clickViewport`. The iframe side posts this until
   *  the host sends `exit`. */
  | { type: 'reanchor'; clickViewport: XY }
  | { type: 'deselect' }
  | { type: 'escape' }
  /** Present-only: the page's `#speaker-notes` JSON payload. Posted
   *  on iframe ready (with `notes: null` if absent) and whenever a
   *  MutationObserver sees the tag appear or its content change. */
  | { type: 'speaker-notes'; notes: string[] | null }
  /** Present-only: rebroadcast of the deck's bare
   *  `window.postMessage({slideIndexChanged: N})` (contract from
   *  `system.md` § Speaker notes for decks). */
  | { type: 'slide-index'; index: number }
