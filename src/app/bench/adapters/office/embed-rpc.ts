/**
 * embed-rpc — promise-based client for the Rebyte preview-embed RPC channel.
 *
 * The iframe at `/preview-embed` exposes a generic `call` / `result` pair
 * on top of the existing lifecycle messages (ready / file / loaded / error).
 * This module wraps that into a typed async API so bench editors don't have
 * to manage ids + pending-promise maps themselves.
 *
 * Usage:
 *   const rpc = createEmbedRpc(() => iframeRef.current)
 *   rpc.attach()                             // installs the message listener
 *   const info = await rpc.call('getInfo')   // returns whatever the handler returned
 *   rpc.detach()                             // on unmount
 *
 * Message shape must stay in sync with Rebyte's `preview-embed`:
 *   parent → iframe   { type: 'rebyte-preview:call',   id, method, args? }
 *   iframe → parent   { type: 'rebyte-preview:result', id, value? | error? }
 */

type CallMessage = {
  type: 'rebyte-preview:call'
  id: string
  method: string
  args?: unknown
}

type ResultMessage = {
  type: 'rebyte-preview:result'
  id: string
  value?: unknown
  error?: string
}

export interface EmbedRpc {
  /** Invoke a remote method. Rejects on unknown method, handler throw, or
   *  timeout (default 10s). Resolves with whatever the handler returned. */
  call<T = unknown>(method: string, args?: unknown, opts?: { timeoutMs?: number }): Promise<T>
  attach(): void
  detach(): void
}

export function createEmbedRpc(getIframe: () => HTMLIFrameElement | null): EmbedRpc {
  let nextId = 1
  const pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  function onMessage(event: MessageEvent) {
    const iframe = getIframe()
    if (!iframe || event.source !== iframe.contentWindow) return
    const data = event.data as ResultMessage | undefined
    if (!data || typeof data !== 'object' || data.type !== 'rebyte-preview:result') return
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    clearTimeout(entry.timer)
    if (typeof data.error === 'string') {
      entry.reject(new Error(data.error))
    } else {
      entry.resolve(data.value)
    }
  }

  return {
    attach() {
      window.addEventListener('message', onMessage)
    },
    detach() {
      window.removeEventListener('message', onMessage)
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('embed-rpc: detached'))
      }
      pending.clear()
    },
    call<T = unknown>(method: string, args?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
      const iframe = getIframe()
      if (!iframe || !iframe.contentWindow) {
        return Promise.reject(new Error('embed-rpc: iframe not mounted'))
      }
      const id = `c${nextId++}`
      const timeoutMs = opts?.timeoutMs ?? 10_000
      const message: CallMessage = { type: 'rebyte-preview:call', id, method, args }
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`embed-rpc: ${method} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
        iframe.contentWindow!.postMessage(message, '*')
      })
    },
  }
}
