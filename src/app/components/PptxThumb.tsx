import { useEffect, useState, type ReactNode } from 'react'
import JSZip from 'jszip'
import { authFetch } from '../api.ts'

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

interface PptxThumbProps {
  src: string
  /** Rendered until the pptx finishes loading and after a parse failure. */
  fallback: ReactNode
}

/**
 * Renders extracted text from the first few slides of a .pptx as a card
 * thumbnail.
 *
 * Mirrors DocxThumb / XlsxThumb: fetches the bytes, parses with JSZip +
 * DOMParser, and renders slide text. The CSS clips overflow so only the
 * first visible paragraphs show in the card's 4:3 box.
 */
export default function PptxThumb({ src, fallback }: PptxThumbProps) {
  const [slides, setSlides] = useState<{ number: number; text: string }[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setSlides(null)

    authFetch(src)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(async blob => {
        if (cancelled) return
        const buf = await blob.arrayBuffer()
        const zip = await JSZip.loadAsync(buf)

        const slideFiles = Object.keys(zip.files)
          .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0')
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0')
            return numA - numB
          })
          .slice(0, 4) // Only parse first 4 slides for the thumbnail

        const parser = new DOMParser()
        const result: { number: number; text: string }[] = []

        for (const path of slideFiles) {
          const xml = await zip.files[path].async('text')
          const doc = parser.parseFromString(xml, 'application/xml')
          const pElements = doc.getElementsByTagNameNS(DRAWING_NS, 'p')
          const lines: string[] = []
          for (let i = 0; i < pElements.length; i++) {
            const runs = pElements[i].getElementsByTagNameNS(DRAWING_NS, 't')
            const parts: string[] = []
            for (let j = 0; j < runs.length; j++) {
              const t = runs[j].textContent
              if (t) parts.push(t)
            }
            const line = parts.join('')
            if (line.trim()) lines.push(line)
          }
          const num = parseInt(path.match(/slide(\d+)/)?.[1] ?? '0')
          result.push({ number: num, text: lines.join(' · ') })
        }

        if (!cancelled) setSlides(result)
      })
      .catch(() => {
        // Leave the fallback visible.
      })

    return () => { cancelled = true }
  }, [src])

  if (!slides || slides.length === 0) return <>{fallback}</>

  return (
    <div className="app-card-thumb-pptx" aria-hidden="true">
      {slides.map(s => (
        <div key={s.number} className="app-card-thumb-pptx-slide">
          <span className="app-card-thumb-pptx-num">{s.number}</span>
          <span className="app-card-thumb-pptx-text">{s.text || '(no text)'}</span>
        </div>
      ))}
    </div>
  )
}
