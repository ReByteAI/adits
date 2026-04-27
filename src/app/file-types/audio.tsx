import { lazy } from 'react'
import type { FileTypeDefinition } from './types'
import { AudioSpec, AUDIO_ICON } from '../../../packages/shared/file-types/audio'

const Editor = lazy(() => import('../bench/adapters/audio/AudioEditorView'))

function Thumbnail() {
  return <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: AUDIO_ICON }} />
}

function ChipThumb() {
  return <span className="bench-prompt-chip-icon" dangerouslySetInnerHTML={{ __html: AUDIO_ICON }} />
}

export const AudioType: FileTypeDefinition = {
  ...AudioSpec,
  Thumbnail,
  ChipThumb,
  Editor,
}
