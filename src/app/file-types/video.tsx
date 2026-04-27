import { lazy } from 'react'
import type { FileTypeDefinition } from './types'
import { VideoSpec, VIDEO_ICON } from '../../../packages/shared/file-types/video'

const Editor = lazy(() => import('../bench/adapters/video/VideoEditorView'))

function Thumbnail() {
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: VIDEO_ICON }} />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: VIDEO_ICON }} />
}

export const VideoType: FileTypeDefinition = {
  ...VideoSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
