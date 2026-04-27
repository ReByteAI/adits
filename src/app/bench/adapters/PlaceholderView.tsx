/**
 * Blank-state editor used by file types that don't have a real preview yet.
 * Archive (zip), presentation, and the fallback type all route here. A real
 * per-type editor will replace this via getType(key).Editor as each file
 * type ships its viewer.
 */
import type { EditorViewProps } from '../types.ts'
import { getType } from '../../file-types'
import { BenchBackChip } from '../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../BenchFullscreenChip.tsx'

export default function PlaceholderView({ file, onClose }: EditorViewProps) {
  const def = getType(file.type)
  return (
    <div className="bench-placeholder-editor">
      <div className="bench-editor-toolbar">
        <BenchBackChip fileName={file.name} onClose={onClose} />
        <BenchFullscreenChip />
      </div>
      <div className="bench-placeholder-view">
        <div className="bench-placeholder-thumb">
          <def.Thumbnail file={{ name: file.name, src: file.src, thumb: file.thumb }} />
        </div>
        <div className="bench-placeholder-name">{file.name}</div>
        <div className="bench-placeholder-label">{def.label}</div>
      </div>
    </div>
  )
}
