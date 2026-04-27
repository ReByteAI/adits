/**
 * The canonical file types that adits can process.
 * URI is not here — it's an input method that resolves to one of these.
 */
export enum FileType {
  Image = 'image',
  PDF = 'pdf',
  Office = 'office',
  Audio = 'audio',
  Video = 'video',
  HTML = 'html',
  /** Binary archive (zip, tar.gz, 7z, rar, …). Opaque until extracted. */
  Archive = 'archive',
  /** A URL to external content. Bytes live elsewhere; we store only the
   *  reference and let the agent fetch/process it. */
  Link = 'link',
  /** `.napkin` sketch — custom Canvas 2D drawing format. Input
   *  artifact: Claude reads the sibling thumbnail PNG, not the raw JSON. */
  Napkin = 'napkin',
}

/** Non-UI definition for a file type — shared between web and mobile. */
export interface FileTypeSpec {
  /** Unique key stored in FileData.type */
  key: string
  /** Which canonical FileType this spec belongs to */
  fileType: FileType
  /** Human label ('Image', 'PDF', ...) */
  label: string
  /** Lowercase extensions including dot: ['.png', '.jpg'] */
  extensions: string[]
  /** MIME patterns: 'image/*' or 'application/pdf' */
  mimePatterns: string[]
  /** Whether this type needs a blob URL for thumbnail (e.g. images) */
  needsThumb: boolean
  /** Whether this type needs a blob URL for src preview (e.g. PDFs) */
  needsSrc: boolean
  /** SVG icon markup */
  icon: string
  /** Suggested prompt templates */
  templates: string[]
  /** Prompt placeholder text */
  placeholder: (fileName: string) => string
}
