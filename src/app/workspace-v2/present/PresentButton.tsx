/** Present dropdown — three destinations: "In this tab", "Fullscreen",
 *  "New tab". The subtitle under "In this tab" is gated on `hasNotes`
 *  — only decks that ship a `<script id="speaker-notes">` JSON block
 *  get the notes popup.
 *
 *  This component is presentation only. The three intents are emitted
 *  as callbacks; Bench.tsx does the work (exits active lane, resets
 *  zoom, calls `presentCtrl.enter(...)` / `requestFullscreen()` /
 *  `window.open(...)`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'

/** Mac → `⌘\`; everyone else → `Ctrl+\`. Both chord forms trigger the
 *  same handler server-side. */
function exitShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+\\'
  const p = navigator.platform || ''
  const ua = navigator.userAgent || ''
  const isMac = /Mac|iPhone|iPad|iPod/.test(p) || /Mac OS X/.test(ua)
  return isMac ? '⌘\\' : 'Ctrl+\\'
}

export default function PresentButton({
  hasNotes, onTab, onFullscreen, onNewTab,
}: {
  hasNotes: boolean
  onTab: () => void
  onFullscreen: () => void
  onNewTab: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const kbdLabel = useMemo(() => exitShortcutLabel(), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (fn: () => void) => () => { setOpen(false); fn() }

  return (
    <div className="wsv2-present-wrap" ref={wrapRef}>
      <button
        className="wsv2-btn-ghost"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        Present
      </button>
      {open && (
        <div className="wsv2-present-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="wsv2-present-item"
            onClick={pick(onTab)}
          >
            <span className="wsv2-present-item-title">In this tab</span>
            {hasNotes && (
              <span className="wsv2-present-item-sub">Speaker notes in popup window</span>
            )}
            <span className="wsv2-present-item-kbd" aria-hidden="true">{kbdLabel}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="wsv2-present-item"
            onClick={pick(onFullscreen)}
          >
            <span className="wsv2-present-item-title">Fullscreen</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="wsv2-present-item"
            onClick={pick(onNewTab)}
          >
            <span className="wsv2-present-item-title">New tab</span>
          </button>
        </div>
      )}
    </div>
  )
}
