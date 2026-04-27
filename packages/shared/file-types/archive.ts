import { FileType, type FileTypeSpec } from './types'

export const ARCHIVE_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>'

export const ArchiveSpec: FileTypeSpec = {
  key: 'archive',
  fileType: FileType.Archive,
  label: 'Archive',
  // Note: `detectType` matches only the last dot, so compound extensions
  // like `.tar.gz` resolve to `.gz` — that's covered by listing both the
  // single-suffix (.gz) and the combined shorthand (.tgz) explicitly.
  extensions: ['.zip', '.tar', '.gz', '.tgz', '.bz2', '.tbz2', '.xz', '.txz', '.7z', '.rar', '.zst'],
  mimePatterns: [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-tar',
    'application/gzip',
    'application/x-gzip',
    'application/x-bzip2',
    'application/x-xz',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/vnd.rar',
    'application/zstd',
  ],
  needsThumb: false,
  needsSrc: false,
  icon: ARCHIVE_ICON,
  templates: ['List the files inside', 'Summarize the contents', 'Extract and describe the structure'],
  placeholder: () => 'Tell us what to do with this archive…',
}
