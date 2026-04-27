import { FileType, type FileTypeSpec } from './types'

export const FALLBACK_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'

export const FallbackSpec: FileTypeSpec = {
  key: 'file',
  fileType: FileType.Office,  // fallback — treat unknown files as generic office/doc
  label: 'File',
  extensions: [],
  mimePatterns: [],
  needsThumb: false,
  needsSrc: false,
  icon: FALLBACK_ICON,
  templates: ['Describe this file', 'Convert to another format'],
  placeholder: () => 'Tell us what to do with this file…',
}
