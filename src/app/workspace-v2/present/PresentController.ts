/** Host-side controller for the Present lane. Page-side contract is
 *  defined in `system.md` § "Speaker notes for decks".
 *
 *  Present is the sixth page-tab control. Unlike Edit / Comment it
 *  doesn't mutate the file — it strips bench chrome so the iframe
 *  fills the viewport (`tab` mode) or escalates the iframe's
 *  container to native fullscreen (`fullscreen` mode). A separate
 *  `new tab` action lives in the toolbar UI and never enters the
 *  controller (external `window.open`; no in-app state change).
 *
 *  The controller owns:
 *    - The `mode` machine ('off' | 'tab' | 'fullscreen').
 *    - The host→iframe keydown forwarder (so ←/→/Space/etc. advance
 *      the deck without clicking into it first).
 *    - The `fullscreenchange` listener so OS-level Esc / F11 cleanly
 *      exits.
 *    - The speaker-notes popup window (opened with the user gesture
 *      chain for fullscreen's sake; closed on exit / slide-index
 *      forwarded to it on every change).
 *    - Subscribing to bridge `escape` / `slide-index` messages.
 *
 *  The controller does NOT decide whether the active file is a page,
 *  whether to swallow the dead-zone sub-toolbar, or open the New-tab
 *  URL — those are `Bench.tsx` / `PresentButton.tsx` concerns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IframeBridgeApi } from '../iframe/bridge.ts'
import type { IframeInMsg } from '../iframe/messages.ts'

export type PresentMode = 'off' | 'tab' | 'fullscreen'

export interface PresentControllerApi {
  mode: PresentMode
  /** Open the notes popup (if `openNotes`), flip into the requested
   *  mode, and wire host listeners. For fullscreen the caller's click
   *  handler MUST also run `containerRef.current.requestFullscreen()`
   *  inside the same user gesture — the controller doesn't call it
   *  itself so the stack trace stays "user-gesture-direct" (Safari
   *  otherwise rejects the request). */
  enter: (mode: 'tab' | 'fullscreen', openNotes: boolean) => void
  exit: () => void
}

/** Explicit allowlist of keys a deck actually advances on. Anything
 *  outside this set (Tab, F-keys, letters, etc.) falls through to the
 *  host so we don't accidentally eat F11, Tab navigation, devtools
 *  shortcuts, etc. The deck's own handlers still handle anything
 *  dispatched.
 *
 *  Note: `' '` is the Space bar's `e.key` value. Alpha keys are case-
 *  pairs because some decks use `B` (blank) / `W` (white).
 */
const FORWARD_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  ' ', 'PageUp', 'PageDown', 'Home', 'End',
  'Enter',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'b', 'B', 'w', 'W', 'f', 'F',
])

function shouldForwardKey(e: KeyboardEvent): boolean {
  if (!FORWARD_KEYS.has(e.key)) return false
  // Any modifier chord is the host's — let it through unaltered.
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  // Skip typing in a host-side input — the presenter might be editing
  // the chat composer in tab mode.
  const active = document.activeElement as HTMLElement | null
  if (active) {
    const tag = active.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
    if (active.isContentEditable) return false
  }
  return true
}

export function usePresentController(
  bridge: IframeBridgeApi,
  iframeElRef: React.RefObject<HTMLIFrameElement | null>,
  getNotesSnapshot: () => { notes: string[]; slideIndex: number },
): PresentControllerApi {
  const [mode, setMode] = useState<PresentMode>('off')
  // modeRef MUST stay in sync with setMode() synchronously so the
  // fullscreen rollback path (`enter('fullscreen')` immediately
  // followed by `exit()` on a rejected requestFullscreen) sees the
  // latest state. A post-setState effect syncs only after render, and
  // a user-gesture rejection fires before that effect runs.
  const modeRef = useRef<PresentMode>('off')
  const setModeSync = useCallback((next: PresentMode) => {
    modeRef.current = next
    setMode(next)
  }, [])

  const notesWinRef = useRef<Window | null>(null)

  const closeNotesWin = useCallback(() => {
    const w = notesWinRef.current
    notesWinRef.current = null
    if (w && !w.closed) {
      try { w.close() } catch { /* ignore — opener access denied once popup navigates */ }
    }
  }, [])

  const doExit = useCallback(() => {
    if (modeRef.current === 'off') return
    closeNotesWin()
    bridge.postCmd({ type: 'present-exit' })
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => { /* non-fatal; still reset state */ })
    }
    setModeSync('off')
  }, [bridge, closeNotesWin, setModeSync])

  const doExitRef = useRef(doExit)
  useEffect(() => { doExitRef.current = doExit }, [doExit])

  const enter = useCallback((next: 'tab' | 'fullscreen', openNotes: boolean) => {
    if (modeRef.current !== 'off') return
    if (openNotes) {
      try {
        notesWinRef.current = window.open(
          '/speaker-notes.html',
          'adits-speaker-notes',
          'width=640,height=480',
        )
        if (!notesWinRef.current) {
          // Popup blocker. Surface in console so developers notice —
          // presenter continues without notes rather than failing the
          // whole enter.
          console.warn('[present] speaker-notes popup was blocked by the browser')
        }
      } catch (err) {
        notesWinRef.current = null
        console.warn('[present] speaker-notes popup failed to open', err)
      }
    }
    setModeSync(next)
    bridge.postCmd({ type: 'present-enter', mode: next })
    // Focus the iframe so keystrokes that AREN'T caught by the host
    // forwarder (clicks inside the iframe, etc.) still land on the
    // deck.
    iframeElRef.current?.contentWindow?.focus()
  }, [bridge, iframeElRef, setModeSync])

  // Subscribe to bridge for escape + slide-index + speaker-notes.
  // slide-index and speaker-notes both forward straight to the notes
  // popup so the MutationObserver path in the inject script (a deck
  // editing its notes tag live) keeps the popup in sync.
  useEffect(() => {
    const postToNotes = (payload: Record<string, unknown>) => {
      const w = notesWinRef.current
      if (!w || w.closed) return
      try { w.postMessage(payload, '*') } catch { /* popup navigated */ }
    }
    const unsub = bridge.subscribe({
      onMessage: (msg: IframeInMsg) => {
        if (msg.type === 'escape') {
          doExitRef.current()
          return
        }
        if (msg.type === 'slide-index') {
          postToNotes({ slideIndexChanged: msg.index })
          return
        }
        if (msg.type === 'speaker-notes') {
          postToNotes({ notes: msg.notes ?? [] })
        }
      },
      onDetach: () => {
        // iframe detached / reloaded — tear down present state too.
        if (modeRef.current !== 'off') doExitRef.current()
      },
    })
    return unsub
  }, [bridge])

  // Host-side keydown forwarder + ⌘\ / Ctrl+\ exit shortcut + Esc.
  // Forwarded keys get preventDefault on the host so Space / arrows /
  // PgUp/PgDn don't double-fire (scrolling the bench) alongside
  // advancing the deck.
  useEffect(() => {
    if (mode === 'off') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        doExitRef.current()
        return
      }
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        doExitRef.current()
        return
      }
      if (shouldForwardKey(e)) {
        e.preventDefault()
        bridge.postCmd({
          type: 'forward-keydown',
          key: e.key, code: e.code,
          ctrlKey: e.ctrlKey, altKey: e.altKey,
          shiftKey: e.shiftKey, metaKey: e.metaKey,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, bridge])

  // Fullscreenchange — user pressed OS-level Esc / F11.
  useEffect(() => {
    if (mode !== 'fullscreen') return
    const onFs = () => {
      if (document.fullscreenElement === null && modeRef.current === 'fullscreen') {
        doExitRef.current()
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [mode])

  // Listen for messages from the notes popup: `notes-ready` (popup
  // loaded, send it the current snapshot) and `notes-escape` (user
  // pressed Esc / ⌘\ inside the popup).
  useEffect(() => {
    if (mode === 'off') return
    const onMsg = (e: MessageEvent) => {
      const w = notesWinRef.current
      if (!w || e.source !== w) return
      const d = e.data as { type?: unknown } | null
      const type = d && (d as { type?: unknown }).type
      if (type === 'notes-escape') {
        doExitRef.current()
      } else if (type === 'notes-ready') {
        const snap = getNotesSnapshot()
        try {
          w.postMessage({ notes: snap.notes, slideIndexChanged: snap.slideIndex }, '*')
        } catch { /* popup closed in race */ }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [mode, getNotesSnapshot])

  return useMemo(() => ({ mode, enter, exit: doExit }), [mode, enter, doExit])
}
