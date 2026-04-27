import { FileType, type FileTypeSpec } from './types'

export const NAPKIN_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12a0 0 0 0 1 0 0H4z"/><path d="M16 4v4h4"/><path d="M7 14l2-4 2 3 3-5 2 6"/></svg>'

/** `.napkin` sketch file — custom Canvas 2D drawing format. Rendered
 *  by the in-project napkin editor (not an HTML iframe); no blob URL
 *  needed — the editor fetches its content directly via authFetch +
 *  fileDownloadUrl. */
export const NapkinSpec: FileTypeSpec = {
  key: 'napkin',
  fileType: FileType.Napkin,
  label: 'Sketch',
  extensions: ['.napkin'],
  mimePatterns: ['application/vnd.adits.napkin+json'],
  needsThumb: false,
  needsSrc: false,
  icon: NAPKIN_ICON,
  templates: ['Turn this sketch into a wireframe', 'Describe what I drew', 'Build a page from this sketch'],
  placeholder: () => 'Tell us what to do with this sketch…',
}
