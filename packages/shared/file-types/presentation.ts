import { FileType, type FileTypeSpec } from './types'

export const PRES_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'

export const PresentationSpec: FileTypeSpec = {
  key: 'powerpoint',
  fileType: FileType.Office,
  label: 'Presentation',
  extensions: ['.pptx', '.ppt'],
  mimePatterns: ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  needsThumb: false,
  needsSrc: true,
  icon: PRES_ICON,
  templates: ['Summarize slides', 'Convert to PDF', 'Extract text from all slides'],
  placeholder: () => 'Tell us what to do with this presentation…',
}
