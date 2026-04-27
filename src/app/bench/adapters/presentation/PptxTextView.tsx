/**
 * PptxTextView — extract and display text from PPTX files.
 *
 * PPTX files are ZIP archives containing XML slides at ppt/slides/slide*.xml.
 * Text lives in <a:t> tags (DrawingML namespace). We extract it with JSZip
 * (already a transitive dep of docx-preview) + the browser's DOMParser.
 * Zero new dependencies.
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import JSZip from 'jszip'
import type { EditorViewProps } from '../../types.ts'
import { fetchFileBlob } from '../../../api.ts'
import { BenchBackChip } from '../../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../../BenchFullscreenChip.tsx'

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

interface SlideText {
  number: number
  paragraphs: string[]
}

async function extractPptxSlides(blob: Blob): Promise<SlideText[]> {
  const buf = await blob.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)

  // Collect slide filenames, sorted numerically
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0')
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0')
      return numA - numB
    })

  const parser = new DOMParser()
  const slides: SlideText[] = []

  for (const path of slideFiles) {
    const xml = await zip.files[path].async('text')
    const doc = parser.parseFromString(xml, 'application/xml')

    // Each <a:p> is a paragraph; collect <a:t> text runs within each
    const pElements = doc.getElementsByTagNameNS(DRAWING_NS, 'p')
    const paragraphs: string[] = []

    for (let i = 0; i < pElements.length; i++) {
      const runs = pElements[i].getElementsByTagNameNS(DRAWING_NS, 't')
      const parts: string[] = []
      for (let j = 0; j < runs.length; j++) {
        const t = runs[j].textContent
        if (t) parts.push(t)
      }
      const line = parts.join('')
      if (line.trim()) paragraphs.push(line)
    }

    const num = parseInt(path.match(/slide(\d+)/)?.[1] ?? '0')
    slides.push({ number: num, paragraphs })
  }

  return slides
}

export default function PptxTextView({ file, onClose }: EditorViewProps) {
  const { t } = useTranslation('workspace')
  const [slides, setSlides] = useState<SlideText[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchFileBlob(file.id)
      .then(blob => extractPptxSlides(blob))
      .then(result => {
        if (cancelled) return
        setSlides(result)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[PptxTextView] extraction failed', err)
        setError(err instanceof Error ? err.message : 'Failed to extract text')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [file.id])

  return (
    <div className="bench-placeholder-editor">
      <div className="bench-editor-toolbar">
        <BenchBackChip fileName={file.name} onClose={onClose} />
        <BenchFullscreenChip />
      </div>

      <div className="bench-pptx-text-body">
        {loading && (
          <div className="bench-pptx-text-loading">
            <svg className="upload-dialog-cloud-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <span>{t('viewer.extracting')}</span>
          </div>
        )}

        {error && (
          <div className="bench-pptx-text-error">{error}</div>
        )}

        {slides && slides.length === 0 && (
          <div className="bench-pptx-text-empty">{t('viewer.presEmpty')}</div>
        )}

        {slides && slides.map(slide => (
          <div key={slide.number} className="bench-pptx-slide">
            <div className="bench-pptx-slide-number">Slide {slide.number}</div>
            {slide.paragraphs.length > 0 ? (
              slide.paragraphs.map((p, i) => (
                <p key={i} className="bench-pptx-slide-text">{p}</p>
              ))
            ) : (
              <p className="bench-pptx-slide-empty">(no text)</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
