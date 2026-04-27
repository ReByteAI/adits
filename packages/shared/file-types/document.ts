import { FileType, type FileTypeSpec } from './types'

export const DOC_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'

export const DocumentSpec: FileTypeSpec = {
  key: 'doc',
  fileType: FileType.Office,
  label: 'Document',
  extensions: ['.doc', '.docx', '.txt', '.rtf', '.md'],
  mimePatterns: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'text/rtf'],
  needsThumb: false,
  needsSrc: true,  // docx-preview parses the file blob in the browser
  icon: DOC_ICON,
  templates: ['Summarize this document', 'Rewrite in a different tone', 'Extract key points', 'Translate to English'],
  placeholder: () => 'Tell us what to do with this document…',
}
