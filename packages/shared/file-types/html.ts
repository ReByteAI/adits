import { FileType, type FileTypeSpec } from './types'

export const HTML_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'

export const HtmlSpec: FileTypeSpec = {
  key: 'html',
  fileType: FileType.HTML,
  label: 'Web Page',
  extensions: ['.html', '.htm'],
  mimePatterns: ['text/html'],
  needsThumb: false,
  needsSrc: true,  // Viewer loads the file text into a sandboxed iframe via authFetch
  icon: HTML_ICON,
  templates: ['Extract the main content', 'Convert to PDF', 'Summarize this page', 'Clean up formatting'],
  placeholder: () => 'Tell us what to do with this web page…',
}
