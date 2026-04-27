import { FileType, type FileTypeSpec } from './types'

export const PDF_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 13H8v4h2a1 1 0 0 0 0-2H8"/></svg>'

export const PdfSpec: FileTypeSpec = {
  key: 'pdf',
  fileType: FileType.PDF,
  label: 'PDF',
  extensions: ['.pdf'],
  mimePatterns: ['application/pdf'],
  needsThumb: false,
  needsSrc: true,
  icon: PDF_ICON,
  templates: ['Summarize this document', 'Extract all text', 'Compress file size', 'Convert to Word', 'Translate to English'],
  placeholder: () => 'Tell us what to do with this PDF…',
}
