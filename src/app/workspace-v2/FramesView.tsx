/**
 * Renders a prompt's opaque frame list. For terminal prompts the frames come
 * from `/content`; for running prompts we open ONE SSE to
 * `/api/app/prompts/:pid/stream?fromSeq=N` and append live frames as they
 * arrive. When the server emits `event: done` we call `onTerminal` so the
 * parent (ChatPanel) can refetch `/content` for the authoritative snapshot.
 *
 * The render is minimal but type-aware: text deltas concatenate, tool calls
 * show as inline one-liners. Anything we don't recognize falls through.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source'
import type { TaskFrame } from '../../../packages/shared/api'

const EMPTY_FRAMES: TaskFrame[] = []

export function FramesView({
  promptId,
  initialFrames: rawInitialFrames,
  isRunning,
  onTerminal,
  authToken,
}: {
  promptId: string
  initialFrames: TaskFrame[] | null | undefined
  isRunning: boolean
  /** Called once when the server emits `event: done`. Parent should
   *  refetch `/content` for the authoritative final transcript. */
  onTerminal?: (status: string) => void
  /** Current Clerk JWT, threaded down from ChatPanel via useAuthToken().
   *  Null while Clerk is still resolving the session — we hold the SSE
   *  open until a token is available so the connect doesn't 401. */
  authToken?: string | null
}) {
  const initialFrames = rawInitialFrames ?? EMPTY_FRAMES
  const [liveFrames, setLiveFrames] = useState<TaskFrame[]>([])

  const initialFramesRef = useRef(initialFrames)
  initialFramesRef.current = initialFrames
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal

  // Reset live buffer on prompt switch.
  useEffect(() => {
    setLiveFrames([])
  }, [promptId])

  useEffect(() => {
    if (!isRunning) return
    // Wait for Clerk to hand us a token before we connect — the
    // requireAuth middleware accepts `?token=<jwt>`, and connecting
    // without one returns 401 + aborts the retry loop, losing the
    // stream. Re-runs cheaply when authToken eventually flips
    // null → string on first session resolve.
    if (!authToken) return
    const ctrl = new AbortController()
    const initial = initialFramesRef.current
    const fromSeq = initial.length ? initial[initial.length - 1].seq : 0
    let cursor = fromSeq

    const url = `/api/app/prompts/${promptId}/stream?fromSeq=${fromSeq}&token=${encodeURIComponent(authToken)}`

    void fetchEventSource(url, {
      signal: ctrl.signal,
      openWhenHidden: true,
      async onopen(res) {
        if (res.ok && res.headers.get('content-type')?.startsWith(EventStreamContentType)) return
        throw new Error(`SSE open failed: ${res.status}`)
      },
      onmessage(ev) {
        if (ev.event === 'done') {
          let status = 'completed'
          try { status = JSON.parse(ev.data).status ?? 'completed' } catch { /* */ }
          onTerminalRef.current?.(status)
          ctrl.abort()
          return
        }
        if (!ev.data) return
        const seq = ev.id ? Number(ev.id) : cursor + 1
        if (!Number.isFinite(seq) || seq <= cursor) return
        cursor = seq
        let data: unknown
        try { data = JSON.parse(ev.data) } catch { return }
        setLiveFrames(prev => [...prev, { seq, data }])
      },
      onerror(err) {
        console.warn('[framesview] SSE error', err)
        throw err  // bail out of the retry loop; parent refetches /content
      },
    }).catch(() => { /* aborted or open-failed; no further action */ })

    return () => { ctrl.abort() }
  }, [promptId, isRunning, authToken])

  // Merge: history + live (live frames have higher seq than the last
  // initial frame, so straight concat is in order).
  const frames = useMemo(() => {
    if (liveFrames.length === 0) return initialFrames
    return [...initialFrames, ...liveFrames]
  }, [initialFrames, liveFrames])

  const parts = useMemo(() => dispatchFrames(frames), [frames])

  if (parts.length === 0 && isRunning) {
    return <div className="wsv2-msg-body wsv2-msg-muted">✦ Working…</div>
  }
  return (
    <div className="wsv2-msg-body">
      {parts.map((p, i) => (
        <FramePart key={i} part={p} />
      ))}
    </div>
  )
}

// ─── Frame dispatch ───────────────────────────────────────────────────────

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; inputPreview: string }
  | { kind: 'error'; text: string }

function dispatchFrames(frames: TaskFrame[]): Part[] {
  const out: Part[] = []
  let textBuf = ''
  const flushText = () => {
    if (!textBuf) return
    out.push({ kind: 'text', text: textBuf })
    textBuf = ''
  }
  for (const f of frames) {
    const d: any = f.data
    if (!d || typeof d !== 'object') continue

    if (d.__adits_error) { flushText(); out.push({ kind: 'error', text: String(d.__adits_error) }); continue }
    if (d.__adits_stderr) { flushText(); out.push({ kind: 'error', text: String(d.__adits_stderr) }); continue }

    // claude content_block_delta.text_delta
    if (d.type === 'stream_event'
        && d.event?.type === 'content_block_delta'
        && d.event?.delta?.type === 'text_delta'
        && typeof d.event?.delta?.text === 'string') {
      textBuf += d.event.delta.text
      continue
    }
    // claude content_block_start for tool_use
    if (d.type === 'stream_event'
        && d.event?.type === 'content_block_start'
        && d.event?.content_block?.type === 'tool_use') {
      flushText()
      const name = d.event.content_block.name ?? 'tool'
      const input = d.event.content_block.input ?? {}
      out.push({ kind: 'tool', name, inputPreview: summarizeToolInput(name, input) })
      continue
    }
    // tool_use in assistant messages
    if (d.type === 'assistant' && Array.isArray(d.message?.content)) {
      for (const block of d.message.content) {
        if (block?.type === 'tool_use') {
          flushText()
          out.push({
            kind: 'tool',
            name: block.name ?? 'tool',
            inputPreview: summarizeToolInput(block.name, block.input),
          })
        }
      }
    }
    // Relay's normalized event shape (rebyte mode passthrough).
    if (typeof d.eventType === 'string' && d.payload) {
      const p = d.payload
      if (d.eventType === 'text' && typeof p.content === 'string') {
        if (p.is_delta) textBuf += p.content
        else { flushText(); textBuf = p.content }
        continue
      }
      if (d.eventType === 'tool_use' && typeof p.name === 'string') {
        flushText()
        out.push({
          kind: 'tool',
          name: p.name,
          inputPreview: summarizeToolInput(p.name, p.input ?? p.arguments ?? {}),
        })
        continue
      }
      if (d.eventType === 'result' && typeof p.result === 'string') {
        flushText()
        textBuf = p.result
        continue
      }
    }
  }
  flushText()
  return out
}

function summarizeToolInput(name: string, input: any): string {
  if (!input || typeof input !== 'object') return ''
  if (name === 'Bash' && typeof input.command === 'string') return input.command.slice(0, 120)
  if (name === 'Read' && typeof input.file_path === 'string') return input.file_path
  if (name === 'Write' && typeof input.file_path === 'string') return input.file_path
  if (name === 'Edit' && typeof input.file_path === 'string') return input.file_path
  if (name === 'Grep' && typeof input.pattern === 'string') return input.pattern
  if (name === 'Glob' && typeof input.pattern === 'string') return input.pattern
  const firstStr = Object.values(input).find(v => typeof v === 'string') as string | undefined
  return (firstStr ?? '').slice(0, 120)
}

function FramePart({ part }: { part: Part }) {
  if (part.kind === 'text') {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{part.text}</span>
  }
  if (part.kind === 'tool') {
    return (
      <div className="wsv2-msg-tool">
        <span className="wsv2-msg-tool-name">🛠 {part.name}</span>
        {part.inputPreview && <span className="wsv2-msg-tool-arg"> · {part.inputPreview}</span>}
      </div>
    )
  }
  return <div className="wsv2-msg-muted" style={{ whiteSpace: 'pre-wrap' }}>— {part.text}</div>
}
