import { FileType, type FileTypeSpec } from './types'

export const VIDEO_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'

export const VideoSpec: FileTypeSpec = {
  key: 'video',
  fileType: FileType.Video,
  label: 'Video',
  extensions: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
  mimePatterns: ['video/*'],
  needsThumb: false,
  needsSrc: true,  // <video> needs a blob URL to play
  icon: VIDEO_ICON,
  templates: ['Extract audio', 'Create thumbnail', 'Trim to first 30 seconds', 'Convert to MP4'],
  placeholder: () => 'Tell us what to do with this video…',
}
