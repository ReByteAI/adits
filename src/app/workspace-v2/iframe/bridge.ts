/** Generic host-side bridge for a page-viewer iframe.
 *
 *  Post file-server v2, the inject script is served by the VM's
 *  `/_adits/inject.js` route and spliced into every HTML response by
 *  the file server. The host no longer reaches into
 *  `iframe.contentDocument` — that path
 *  can't work cross-origin. This bridge now only plumbs the
 *  postMessage transport:
 *    - setIframe callback-ref with attach/detach bookkeeping
 *    - ready handshake + FIFO command queue (drain on `ready` from
 *      the injected script)
 *    - namespaced postMessage send/recv (`__adits_iframe`)
 *    - multi-subscriber fan-out (Edit + Comment consume one
 *      transport; each narrows on the messages it cares about)
 *    - coordinate transform: iframe-viewport → host-viewport
 *
 *  The transport is typed over a shared `IframeInMsg` / `IframeOutMsg`
 *  union (iframe/messages.ts); controllers narrow against that union,
 *  so payload drift between the injected script (served by the file
 *  server) and a controller is a type error.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IframeInMsg, IframeOutMsg, XY } from './messages.ts'

export const NAMESPACE = '__adits_iframe'

export interface BridgeSubscriber {
  onMessage: (msg: IframeInMsg) => void
  /** Called when the iframe detaches OR a real (new-document) reload
   *  is detected — both mean the old document is gone and any
   *  selector-anchored state should reset. */
  onDetach?: () => void
}

export interface IframeBridgeApi {
  setIframe: (el: HTMLIFrameElement | null) => void
  postCmd: (msg: IframeOutMsg) => void
  subscribe: (sub: BridgeSubscriber) => () => void
  /** Translate a point from the iframe's viewport to the host
   *  viewport. Returns null when the iframe isn't attached. Used by
   *  Comment to position its popover at the click site. */
  toHostCoords: (pointInIframe: XY) => XY | null
}

export function useIframeBridge(): IframeBridgeApi {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const iframeReadyRef = useRef(false)
  const pendingCmdsRef = useRef<IframeOutMsg[]>([])
  const subsRef = useRef<Set<BridgeSubscriber>>(new Set())

  // Bumps on every attach/detach so the inject-on-load effect re-binds
  // to the current iframe element. (React refs aren't reactive on
  // their own, and useEffect deps can miss a late-arriving iframe.)
  const [attachTick, setAttachTick] = useState(0)

  const notifyDetach = useCallback(() => {
    for (const s of subsRef.current) s.onDetach?.()
  }, [])

  const setIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el
    iframeReadyRef.current = false
    if (el === null) {
      // Detach: wipe bridge state so the next mount starts fresh.
      pendingCmdsRef.current = []
      notifyDetach()
    }
    setAttachTick(n => n + 1)
  }, [notifyDetach])

  const postCmd = useCallback((msg: IframeOutMsg) => {
    const win = iframeRef.current?.contentWindow
    if (iframeReadyRef.current && win) {
      win.postMessage({ [NAMESPACE]: msg }, '*')
    } else {
      pendingCmdsRef.current.push(msg)
    }
  }, [])

  const subscribe = useCallback((sub: BridgeSubscriber) => {
    subsRef.current.add(sub)
    return () => { subsRef.current.delete(sub) }
  }, [])

  const toHostCoords = useCallback((p: XY): XY | null => {
    const iframe = iframeRef.current
    if (!iframe) return null
    const r = iframe.getBoundingClientRect()
    // Account for CSS transform (zoom): the iframe's internal
    // clickViewport coords are unscaled, but the bounding rect is
    // in host pixels. Ratio of rendered width to offsetWidth gives
    // the effective scale factor — covers zoom via transform without
    // the bridge having to know about zoom.
    const sx = iframe.offsetWidth > 0 ? r.width / iframe.offsetWidth : 1
    const sy = iframe.offsetHeight > 0 ? r.height / iframe.offsetHeight : 1
    return { x: r.left + p.x * sx, y: r.top + p.y * sy }
  }, [])

  // Reset ready-state on every iframe `load` event. The injected
  // script (baked into the HTML by the file server) posts a `ready`
  // frame on DOMContentLoaded; until then, `postCmd` queues. A user-
  // triggered reload of the iframe fires `load` again with a fresh
  // document — we treat it as a detach + re-init.
  useLayoutEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    let firstLoad = true
    const onLoad = () => {
      if (!firstLoad) {
        // Real reload: the document we queued against is gone.
        pendingCmdsRef.current = []
        notifyDetach()
        iframeReadyRef.current = false
      }
      firstLoad = false
    }
    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachTick])

  // Message listener: only accept messages from this iframe's
  // contentWindow and only inside our namespace.
  useLayoutEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const iframe = iframeRef.current
      if (!iframe || e.source !== iframe.contentWindow) return
      const envelope = e.data as { [k: string]: unknown } | null
      const raw = envelope?.[NAMESPACE]
      if (!raw || typeof (raw as { type?: unknown }).type !== 'string') return
      const msg = raw as IframeInMsg

      if (msg.type === 'ready') {
        iframeReadyRef.current = true
        const queued = pendingCmdsRef.current
        pendingCmdsRef.current = []
        const win = iframe.contentWindow
        if (win) for (const q of queued) win.postMessage({ [NAMESPACE]: q }, '*')
      }
      // Copy the Set before iterating so unsubscribe-during-dispatch
      // (e.g. a subscriber that cleans up on 'escape') doesn't
      // corrupt the iteration.
      const subs = Array.from(subsRef.current)
      for (const s of subs) s.onMessage(msg)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return useMemo(
    () => ({ setIframe, postCmd, subscribe, toHostCoords }),
    [setIframe, postCmd, subscribe, toHostCoords],
  )
}
