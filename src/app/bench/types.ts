/** File type key — any string registered in the file-types registry. */
export type BenchFileType = string

export interface BenchFile {
  id: string
  name: string
  src: string    // blob URL or remote URL
  thumb: string  // thumbnail (same as src for images)
  type: BenchFileType
}

/** A reference to a time slice of a media file (audio or video).
 *  Pure metadata — no bytes are extracted; the agent receives the full
 *  file plus the [start, end] window and decides what to do. */
export interface MediaSegment {
  startSec: number
  endSec: number
}

export interface EditorViewProps {
  file: BenchFile
  /** Emit a new derived file (e.g. an annotated PNG from the image draw flow). */
  onOutput: (file: BenchFile) => void
  /** Close the bench and return to the project card grid. Rendered as the back chip
   *  in the editor's own toolbar so the bench has a single unified action band. */
  onClose: () => void
  /** Emit a time-range reference for the current media file (audio/video).
   *  Optional — only media editors call it. */
  onSegment?: (segment: MediaSegment) => void
}

let _benchFileId = 0
export function benchFileId(): string {
  return 'bf' + (++_benchFileId) + '-' + Date.now()
}

export const SAMPLE_BENCH_IMAGES: BenchFile[] = [
  { id: benchFileId(), name: 'mountain-lake.jpg', src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&h=1200&fit=crop', thumb: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop', type: 'image' },
  { id: benchFileId(), name: 'city-sunset.jpg', src: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1600&h=1200&fit=crop', thumb: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&h=300&fit=crop', type: 'image' },
  { id: benchFileId(), name: 'forest-path.jpg', src: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1600&h=1200&fit=crop', thumb: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&h=300&fit=crop', type: 'image' },
  { id: benchFileId(), name: 'ocean-waves.jpg', src: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1600&h=1200&fit=crop', thumb: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=400&h=300&fit=crop', type: 'image' },
  { id: benchFileId(), name: 'desert-dunes.jpg', src: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1600&h=1200&fit=crop', thumb: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=400&h=300&fit=crop', type: 'image' },
]
