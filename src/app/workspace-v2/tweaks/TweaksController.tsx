/** Host-side controller for the Tweaks lane.
 *
 *  Protocol (separate from the `__adits_iframe` bridge that Edit /
 *  Comment share — messages are top-level, no envelope):
 *    page → host:
 *      { type: '__edit_mode_available' }             // page has Tweaks declared
 *      { type: '__edit_mode_set_keys', edits: {…} }  // delta of knob values
 *    host → page:
 *      { type: '__activate_edit_mode' }
 *      { type: '__deactivate_edit_mode' }
 *
 *  MVP scope:
 *    - Enable the toolbar button on `__edit_mode_available`.
 *    - Toggle posts activate/deactivate.
 *    - Per-file dismissed flag in localStorage so auto-activate sticks
 *      across reloads unless the user explicitly closed Tweaks.
 *    - Deferred: `pendingEdits` accumulation + the chat-routed save
 *      path. Pages handle their own visual updates via CSS vars while
 *      Tweaks is operating; nothing here needs to read the deltas.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

/** Primitive value types the in-page panel posts back via
 *  `__edit_mode_set_keys`. Matches the schema of tweak-save
 *  prompt-piece `data.edits`. */
export type TweakValue = string | number | boolean

export interface TweaksControllerApi {
  /** Current file has announced `__edit_mode_available`. */
  available: boolean
  /** The toolbar toggle's pressed state for the current file. */
  active: boolean
  toggle: () => void
  /** Callback-ref for the page iframe. Mirrors the shape Bench uses
   *  for the shared picker bridge; Bench composes both. */
  setIframe: (el: HTMLIFrameElement | null) => void
  /** Accumulated delta from every `__edit_mode_set_keys` message
   *  received since the last reset. Non-authoritative cache — the
   *  iframe's CSS vars and panel state are the visual source of
   *  truth. Consumed by the "Save tweaks" action which emits a
   *  round-buffer node using these values. */
  pendingEdits: Record<string, TweakValue>
  /** Clear the pendingEdits cache. Called after the user emits a
   *  save-tweaks round node. */
  clearPending: () => void
}

const DISMISSED_KEY_PREFIX = 'adits:tweaks-dismissed:'

function isDismissed(fileId: string | null): boolean {
  if (!fileId) return false
  try { return localStorage.getItem(DISMISSED_KEY_PREFIX + fileId) === '1' } catch { return false }
}

function setDismissed(fileId: string | null, dismissed: boolean): void {
  if (!fileId) return
  try {
    if (dismissed) localStorage.setItem(DISMISSED_KEY_PREFIX + fileId, '1')
    else localStorage.removeItem(DISMISSED_KEY_PREFIX + fileId)
  } catch { /* private-mode quota etc. — silent */ }
}

export function useTweaksController(fileId: string | null): TweaksControllerApi {
  const [available, setAvailable] = useState(false)
  const [active, setActive] = useState(false)
  const [pendingEdits, setPendingEdits] = useState<Record<string, TweakValue>>({})

  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const postToIframe = useCallback((type: string) => {
    const win = iframeRef.current?.contentWindow
    if (win) win.postMessage({ type }, '*')
  }, [])

  const clearPending = useCallback(() => { setPendingEdits({}) }, [])

  const setIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el
    if (el === null) {
      // Detach: the old document is gone. Availability, active
      // state, and pendingEdits all belong to that document; reset.
      // The new document (file switch or reload) will re-announce
      // when its inline script runs.
      setAvailable(false)
      setActive(false)
      setPendingEdits({})
    }
  }, [])

  // Re-register the message listener whenever fileId changes so the
  // closure always reads the current file's dismissed flag.
  //
  // useLayoutEffect (not useEffect) is load-bearing: passive effects
  // run AFTER commit in a later microtask, leaving a window where
  // the OLD listener is still attached with its stale fileId closure
  // while the NEW iframe element is already in the ref. A fast
  // iframe load in that gap could post __edit_mode_available, the
  // old listener would pass the source check (iframeRef.current now
  // points at the new iframe), and then consult the old fileId's
  // dismissed flag. useLayoutEffect runs synchronously after DOM
  // mutation and before browser paint / iframe script execution,
  // so the listener swap completes before any message can land.
  useLayoutEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const iframe = iframeRef.current
      if (!iframe || e.source !== iframe.contentWindow) return
      const data = e.data as { type?: unknown; edits?: unknown } | null
      if (!data || typeof data.type !== 'string') return

      if (data.type === '__edit_mode_available') {
        setAvailable(true)
        if (!isDismissed(fileId)) {
          setActive(true)
          postToIframe('__activate_edit_mode')
        } else {
          setActive(false)
        }
      } else if (data.type === '__edit_mode_set_keys') {
        // Merge the delta into pendingEdits. The page has already
        // applied the change visually via its own CSS vars; we
        // accumulate here so the "Save tweaks" action can emit the
        // full current delta as a round-buffer node. Only accept
        // flat primitives per the protocol contract.
        const raw = (data as { edits?: unknown }).edits
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const next: Record<string, TweakValue> = {}
          for (const [k, v] of Object.entries(raw)) {
            if (typeof k !== 'string' || !k) continue
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              next[k] = v
            }
          }
          if (Object.keys(next).length > 0) {
            setPendingEdits(prev => ({ ...prev, ...next }))
          }
        }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [fileId, postToIframe])

  const toggle = useCallback(() => {
    if (!available) return
    setActive(prev => {
      const next = !prev
      postToIframe(next ? '__activate_edit_mode' : '__deactivate_edit_mode')
      setDismissed(fileId, !next)
      return next
    })
  }, [available, fileId, postToIframe])

  return useMemo(() => ({ available, active, toggle, setIframe, pendingEdits, clearPending }),
    [available, active, toggle, setIframe, pendingEdits, clearPending])
}
