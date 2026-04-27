import { useEffect, useRef, useState, type ReactNode } from 'react'
import { renderAsync } from 'docx-preview'
import { authFetch } from '../api.ts'

interface DocxThumbProps {
  src: string
  /** Rendered until the docx finishes loading and after a parse failure. */
  fallback: ReactNode
}

/**
 * Renders the first page of a .docx file as a card thumbnail.
 *
 * Mirrors PdfThumb: fetches the bytes, runs docx-preview's renderAsync into
 * a hidden container, and lets CSS scale + clip the result. The container
 * is anchored to the top so the document title and opening paragraphs are
 * visible (the rendered doc is taller than the card's 4:3 aspect ratio).
 *
 * The fallback (the document icon supplied by the type's Thumbnail wrapper)
 * stays visible during fetch/parse and after any failure — Suspense only
 * catches lazy-import suspension, not runtime errors, so the loading and
 * error states are tracked here explicitly.
 *
 * Each effect run renders into its **own detached slot element** and only
 * swaps it into the visible container after the render finishes and the
 * generation guard confirms it is still current. Stale generations never
 * touch live content, so a slow render from a previous src can't wipe out
 * a newer one's pages.
 */
export default function DocxThumb({ src, fallback }: DocxThumbProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Bumped on every effect run AND on unmount/cleanup so any in-flight
  // renderAsync can detect that it has been superseded before swapping.
  const generationRef = useRef(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const myGen = ++generationRef.current
    setReady(false)

    authFetch(src)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(async blob => {
        if (myGen !== generationRef.current) return
        // Render into a detached element so concurrent generations get
        // independent slots — stale renders touch only their own slot.
        const slot = document.createElement('div')
        await renderAsync(blob, slot, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: false, // single stream — CSS clips to the card's box
          experimental: false,
          useBase64URL: true,
        })
        if (myGen !== generationRef.current) return
        const target = containerRef.current
        if (!target) return
        target.replaceChildren(slot)
        setReady(true)
      })
      .catch(() => {
        // Leave the fallback visible.
      })

    return () => {
      // Bump the generation so any still-pending render bails before swap.
      generationRef.current++
    }
  }, [src])

  return (
    <div className="app-card-thumb-docx">
      <div ref={containerRef} className="app-card-thumb-docx-pages" aria-hidden="true" />
      {!ready && <div className="app-card-thumb-docx-fallback">{fallback}</div>}
    </div>
  )
}
