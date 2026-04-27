/**
 * DocxEditorView — render a document file in the bench, with crop + draw
 * support via the shared RenderedHtmlEditor shell.
 *
 * Three render strategies, picked by extension:
 *   .docx       → docx-preview (full Word fidelity, page breaks, images)
 *   .txt / .md  → plain <pre> rendered from the file's UTF-8 contents
 *   .doc / .rtf → "Preview not available" (legacy binary formats)
 *
 * The frame element holding docx-preview's output (or the text <pre>) is
 * the docRef the shell captures via html-to-image. docx-preview writes
 * imperatively into the ref, so the shell mounts the body element even
 * while loading=true — see RenderedHtmlEditor for the always-mount
 * contract.
 */

import { useCallback, useEffect, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { EditorViewProps } from '../../types.ts'
import { authFetch } from '../../../api.ts'
import {
  RenderedHtmlEditor,
  type RenderBodyProps,
} from '../rendered-html/RenderedHtmlEditor.tsx'

type RenderKind = 'docx' | 'text' | 'unsupported'

function classify(name: string): RenderKind {
  if (/\.docx$/i.test(name)) return 'docx'
  if (/\.(txt|md|markdown)$/i.test(name)) return 'text'
  return 'unsupported'
}

export default function DocxEditorView({ file, onOutput, onClose }: EditorViewProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [textBody, setTextBody] = useState<string | null>(null)

  const kind = classify(file.name)

  // Hold the docRef the shell hands us so the load effect can write into it
  // imperatively (docx-preview path). React's standard useRef pattern doesn't
  // work because the ref is owned by the shell — we capture it via a setter
  // when renderBody runs.
  const [docEl, setDocEl] = useState<HTMLDivElement | null>(null)

  // ─── Load + render the document ───
  useEffect(() => {
    setTextBody(null)

    if (kind === 'unsupported') {
      setLoading(false)
      setError('Preview for legacy .doc / .rtf files is not available. Convert to .docx to preview.')
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    if (kind === 'text') {
      authFetch(file.src)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.text()
        })
        .then(body => {
          if (cancelled) return
          setTextBody(body)
          setLoading(false)
        })
        .catch(err => {
          if (cancelled) return
          console.error('[docx-editor] text load failed', err)
          setError(err instanceof Error ? err.message : 'Failed to load file')
          setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    // kind === 'docx' — wait for the shell to mount the body so we have a
    // target to write into.
    if (!docEl) return

    authFetch(file.src)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(async blob => {
        if (cancelled) return
        docEl.innerHTML = ''
        await renderAsync(blob, docEl, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          experimental: false,
          useBase64URL: true,
        })
        if (!cancelled) setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[docx-editor] render failed', err)
        setError(err instanceof Error ? err.message : 'Failed to render document')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file.src, file.name, kind, docEl])

  const renderBody = useCallback(
    ({ docRef, overlays }: RenderBodyProps) => (
      <div className="bench-docx-frame">
        <div
          ref={el => {
            // Forward to both the shell's ref (for capture/overlays) and our
            // local state (so the docx load effect can imperatively write
            // into it). React 19's RefObject .current is writable.
            docRef.current = el
            setDocEl(el)
          }}
          className={`bench-docx-doc${kind === 'text' ? ' is-text' : ''}`}
        >
          {kind === 'text' && textBody !== null && <pre>{textBody}</pre>}
        </div>
        {overlays}
      </div>
    ),
    [kind, textBody],
  )

  return (
    <RenderedHtmlEditor
      file={file}
      onOutput={onOutput}
      onClose={onClose}
      loading={loading}
      error={error}
      renderBody={renderBody}
      outputNameBase={file.name.replace(/\.(docx|txt|md|markdown)$/i, '')}
      resetKey={kind}
    />
  )
}
