import { lazy } from 'react'
import type { FileTypeDefinition } from './types'
import { NapkinSpec, NAPKIN_ICON } from '../../../packages/shared/file-types/napkin'

// V2 Bench.tsx mounts the real napkin editor directly (see
// workspace-v2/napkin/NapkinEditor.tsx). The V1 `EditorViewProps`
// contract is not the right shape for a canvas surface, so the
// registry Editor here is the placeholder view — same pattern as
// FallbackType. V1 is reference-only; V2 is canonical for napkins.
const Editor = lazy(() => import('../bench/adapters/PlaceholderView'))

const NapkinIcon = () => (
  <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: NAPKIN_ICON }} />
)

function Thumbnail() {
  // No live preview for MVP — napkin thumbnails are deferred. Icon
  // stands in until we generate `.{filename}.thumbnail.png` siblings
  // on save.
  return <NapkinIcon />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: NAPKIN_ICON }} />
}

export const NapkinType: FileTypeDefinition = {
  ...NapkinSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
