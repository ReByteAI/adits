import { FileType, type FileTypeSpec } from './types'

export const AUDIO_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'

export const AudioSpec: FileTypeSpec = {
  key: 'audio',
  fileType: FileType.Audio,
  label: 'Audio',
  extensions: ['.mp3', '.wav', '.aac', '.ogg', '.flac', '.m4a', '.wma', '.aiff'],
  mimePatterns: ['audio/*'],
  needsThumb: false,
  needsSrc: true,  // <audio> needs a blob URL to play
  icon: AUDIO_ICON,
  templates: ['Transcribe this audio', 'Extract a clip', 'Convert to MP3', 'Remove background noise'],
  placeholder: () => 'Tell us what to do with this audio…',
}
