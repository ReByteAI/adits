import { FileType, type FileTypeSpec } from './types'

export const LINK_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'

export const LinkSpec: FileTypeSpec = {
  key: 'link',
  fileType: FileType.Link,
  label: 'Link',
  // URLs are detected at paste time, not via extension/mime matching.
  extensions: [],
  mimePatterns: [],
  needsThumb: false,
  needsSrc: false,
  icon: LINK_ICON,
  templates: ['Summarize the content', 'Extract key points', 'Translate to English'],
  placeholder: (name) => `What should we do with ${name}?`,
}
