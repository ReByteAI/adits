import { lazy } from 'react'
import type { FileTypeDefinition } from './types'
import { FallbackSpec, FALLBACK_ICON } from '../../../packages/shared/file-types/fallback'

const Editor = lazy(() => import('../bench/adapters/PlaceholderView'))

function Thumbnail() {
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: FALLBACK_ICON }} />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: FALLBACK_ICON }} />
}

export const FallbackType: FileTypeDefinition = {
  ...FallbackSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
