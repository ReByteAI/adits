/** Host-side controller for the Comment lane.
 *
 *  Comment is the natural-language sibling of Edit: same element-picking
 *  plumbing (shared via iframe/bridge.ts + inject-core.ts), but after
 *  select it opens a floating popover for a freeform note instead of
 *  knobs. On "Send to Adits" the controller enqueues a PromptPiece
 *  with `source: 'comment'`. The composer renders the chip, and
 *  `PromptPieceNode.getTextContent()` (source=comment branch) owns
 *  the LLM-side shape — the note plus a `<mentioned-element>` block
 *  so Claude can resolve which element the user is talking about.
 *
 *  MVP scope:
 *    - Canvas-pin flow only (no sidebar tab, no unpinned project notes).
 *    - Single action: "Send to Adits". Save-only / teammate-visible
 *      persistence is deferred until VM `/code/.comments/` + the
 *      sidebar land.
 *    - No always-visible pins when Comment mode is off; the popover is
 *      the only surface for now.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IframeBridgeApi } from '../iframe/bridge.ts'
import type { IframeInMsg, Rect, XY } from '../iframe/messages.ts'
import { useLaneExit } from '../iframe/lane.ts'
import { useRoundStore } from '../round/store.ts'

export interface CommentPin {
  selector: string
  tag: string
  rect: Rect
  anchor: XY
  /** Click in the iframe's viewport at pin time. Preserved for future
   *  detached-pin reconciliation work; the host-viewport coords the
   *  popover actually renders from live in `popoverAnchor`. */
  clickViewport: XY
  ccId: string
  dom: string
  /** Popover position in host-viewport coords. Kept in sync with the
   *  element as it moves: updated on iframe `reanchor` (inner scroll
   *  / resize inside the iframe) and on host window scroll / resize
   *  (the iframe itself shifting in the bench). Null only if the
   *  iframe detached between select and state commit. */
  popoverAnchor: XY | null
}

type Mode = 'off' | 'placement' | 'pinned'

export interface CommentControllerApi {
  mode: Mode
  pin: CommentPin | null
  enter: () => void
  exit: () => void
  sendToClaude: (note: string) => void
}

export function useCommentController(
  fileName: string,
  bridge: IframeBridgeApi,
): CommentControllerApi {
  const [mode, setMode] = useState<Mode>('off')
  const [pin, setPin] = useState<CommentPin | null>(null)

  const modeRef = useRef<Mode>('off')
  useEffect(() => { modeRef.current = mode }, [mode])

  const fileNameRef = useRef(fileName)
  useEffect(() => { fileNameRef.current = fileName }, [fileName])

  const resetLocalState = useCallback(() => {
    setPin(null)
    setMode('off')
  }, [])

  const doExit = useCallback(() => {
    if (modeRef.current === 'off') return
    bridge.postCmd({ type: 'exit' })
    resetLocalState()
  }, [bridge, resetLocalState])

  const exitRef = useLaneExit(doExit, useCallback(() => modeRef.current !== 'off', []))

  useEffect(() => {
    const unsubscribe = bridge.subscribe({
      onMessage: (msg: IframeInMsg) => {
        if (msg.type === 'select' && msg.mode === 'comment') {
          // Iframe auto-freezes after posting select: click listener
          // is torn down, crosshair cursor cleared. It ALSO installs
          // scroll/resize listeners that post `reanchor` so the
          // popover tracks the element's bounding rect. Send / Cancel
          // later posts `exit` which strips the stamp + stops tracking.
          setPin({
            selector: msg.selector,
            tag: msg.tag,
            rect: msg.rect,
            anchor: msg.anchor,
            clickViewport: msg.clickViewport,
            ccId: msg.ccId,
            dom: msg.dom,
            popoverAnchor: bridge.toHostCoords(msg.clickViewport),
          })
          setMode('pinned')
        } else if (msg.type === 'reanchor') {
          // Element moved inside the iframe (scroll / resize). Update
          // the stored clickViewport AND re-apply toHostCoords for the
          // popover. Ignore when we've already left pinned.
          setPin(curr => curr == null ? null : {
            ...curr,
            clickViewport: msg.clickViewport,
            popoverAnchor: bridge.toHostCoords(msg.clickViewport),
          })
        } else if (msg.type === 'deselect') {
          // Two paths post deselect into comment mode:
          //   - After our own `exit` (Send / Cancel). By the time
          //     deselect arrives, resetLocalState has already flipped
          //     mode to 'off' and cleared pin; keep it off.
          //   - Stray deselect in 'placement'. Stay in placement so
          //     the user can keep picking.
          // The iframe can't post deselect while we're 'pinned'
          // because the auto-freeze-on-select detaches its click
          // listener — so we never collapse a pinned state from a
          // deselect.
          setMode(curr => curr === 'pinned' ? 'pinned' : curr)
        } else if (msg.type === 'escape') {
          exitRef.current()
        }
      },
      onDetach: resetLocalState,
    })
    return unsubscribe
  }, [bridge, resetLocalState, exitRef])

  // Host-side scroll/resize re-run toHostCoords so the popover stays
  // glued to the click point when the iframe itself moves in the
  // host viewport (e.g. user scrolls the outer bench). The
  // iframe-side listener handles the inner case (element moves
  // inside the iframe, posted back via `reanchor`).
  //
  // Uses a functional `setPin` update so the handler always reads
  // the latest committed pin, even if an iframe `reanchor` landed
  // in the same tick but a snapshotted ref hadn't synced yet —
  // otherwise this could overwrite the newer clickViewport with a
  // stale one.
  useEffect(() => {
    if (mode !== 'pinned') return
    const update = () => {
      setPin(cur => {
        if (!cur) return cur
        const next = bridge.toHostCoords(cur.clickViewport)
        if (!next) return cur
        if (cur.popoverAnchor && next.x === cur.popoverAnchor.x && next.y === cur.popoverAnchor.y) {
          return cur
        }
        return { ...cur, popoverAnchor: next }
      })
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [mode, bridge])

  const enter = useCallback(() => {
    if (modeRef.current !== 'off') return
    setPin(null)
    setMode('placement')
    bridge.postCmd({ type: 'enter', mode: 'comment' })
  }, [bridge])

  const sendToClaude = useCallback((note: string) => {
    const trimmed = note.trim()
    const currentPin = pin
    const name = fileNameRef.current
    if (!trimmed || !currentPin || !name) return
    const id = useRoundStore.getState().add({
      v: 1,
      source: 'comment',
      ref: { fileName: name, path: currentPin.selector },
      text: trimmed,
      data: { ccId: currentPin.ccId, dom: currentPin.dom },
    })
    // On validation failure (prod returns null; dev throws), keep the
    // popover open with the typed note so the user can retry.
    if (id === null) return
    exitRef.current()
  }, [pin, exitRef])

  return useMemo(() => ({ mode, pin, enter, exit: doExit, sendToClaude }),
    [mode, pin, doExit, enter, sendToClaude])
}
