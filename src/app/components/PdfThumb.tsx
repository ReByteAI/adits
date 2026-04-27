import { useState, useEffect, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { authFetch } from '../api.ts'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface PdfThumbProps {
  src: string
}

/**
 * Renders page 1 of a PDF as a card thumbnail.
 *
 * Sizes the page to the card's actual width (via ResizeObserver) and anchors
 * the canvas to the top so titles on letter-size pages aren't clipped out by
 * the card's 4:3 aspect ratio.
 */
export default function PdfThumb({ src }: PdfThumbProps) {
  const [fileData, setFileData] = useState<{ data: Uint8Array } | null>(null)
  const [width, setWidth] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    authFetch(src)
      .then(r => r.arrayBuffer())
      .then(buf => {
        if (!cancelled && buf.byteLength > 0) {
          setFileData({ data: new Uint8Array(buf) })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [src])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={wrapperRef} className="app-card-thumb-pdf">
      {fileData && width > 0 && (
        <Document file={fileData} loading={null} error={null}>
          <Page
            pageNumber={1}
            width={width}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        </Document>
      )}
    </div>
  )
}
