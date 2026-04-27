/**
 * LinkEditorView — bench editor for link-typed files.
 *
 * If the URL has a known embed form (e.g. YouTube), renders the native
 * iframe player so the user can actually watch it inside the bench.
 * Otherwise shows a card with "Open in new tab" — honest about the limits.
 */

import type { EditorViewProps } from '../../types.ts'
import { previewUrl } from '../../link/previewUrl.ts'
import { LINK_ICON } from '../../../../../packages/shared/file-types/link'
import { BenchBackChip } from '../../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../../BenchFullscreenChip.tsx'

export default function LinkEditorView({ file, onClose }: EditorViewProps) {
  const preview = previewUrl(file.src)

  return (
    <div className="bench-link-editor">
      <div className="bench-editor-toolbar">
        <BenchBackChip fileName={file.name} onClose={onClose} />
        <BenchFullscreenChip />
      </div>
      <div className="bench-link-editor-stage">
        {preview.embedUrl ? (
          <div className="bench-link-embed">
            <iframe
              src={preview.embedUrl}
              title={file.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          // Fallback: preview card. The agent still gets the URL in the prompt.
          <div className="bench-link-card">
            <div
              className="bench-link-card-title"
              dangerouslySetInnerHTML={{ __html: LINK_ICON }}
              aria-hidden="true"
            />
            <div className="bench-link-card-name">{file.name}</div>
            <a
              href={file.src}
              target="_blank"
              rel="noopener noreferrer"
              className="bench-link-card-url"
              title={file.src}
            >
              {file.src}
            </a>
            <a
              href={file.src}
              target="_blank"
              rel="noopener noreferrer"
              className="bench-link-card-btn"
            >
              Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
