/**
 * BenchFullscreenChip — toolbar button that expands the bench to cover the
 * full viewport and collapses it back.
 *
 * Lives next to BenchBackChip in every editor's `.bench-editor-toolbar` so
 * users can view PDFs, images, HTML, docs, and spreadsheets at full size
 * regardless of the file type. State is owned by BenchMode via
 * `BenchFullscreenContext` — this button is a thin consumer.
 *
 * Rendering nothing when the context is missing is deliberate: any editor
 * rendered outside a BenchFullscreenProvider (e.g. in isolated tests) just
 * skips the button instead of crashing.
 */

import { createContext, useContext } from 'react'

export interface BenchFullscreenContextValue {
  isFullscreen: boolean
  toggle: () => void
}

export const BenchFullscreenContext =
  createContext<BenchFullscreenContextValue | null>(null)

export function BenchFullscreenChip() {
  const ctx = useContext(BenchFullscreenContext)
  if (!ctx) return null

  const { isFullscreen, toggle } = ctx
  const label = isFullscreen ? 'Exit fullscreen' : 'View fullscreen'

  return (
    <button
      type="button"
      className="bench-editor-btn bench-fullscreen-btn"
      onClick={toggle}
      aria-pressed={isFullscreen}
      aria-label={label}
      title={label}
    >
      {isFullscreen ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 3v4a1 1 0 0 1-1 1H3" />
          <path d="M21 8h-4a1 1 0 0 1-1-1V3" />
          <path d="M3 16h4a1 1 0 0 1 1 1v4" />
          <path d="M16 21v-4a1 1 0 0 1 1-1h4" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8V5a2 2 0 0 1 2-2h3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
        </svg>
      )}
    </button>
  )
}
