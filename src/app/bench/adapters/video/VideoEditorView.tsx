/**
 * VideoEditorView — native <video> player + a draggable timeline strip that
 * lets the user reference a [start, end] slice. Same UX shape as the audio
 * editor but kept as its own per-type adapter (typed not mixed) — see
 * CLAUDE.md File Type Architecture.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorViewProps } from '../../types.ts'
import { MediaTimeline } from '../../media/MediaTimeline.tsx'
import { computePeaks } from '../../media/computePeaks.ts'
import { BenchBackChip } from '../../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../../BenchFullscreenChip.tsx'

export default function VideoEditorView({ file, onSegment, onClose }: EditorViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  // Decode the video's audio track to compute waveform peaks (best-effort).
  // Browsers' decodeAudioData reads the audio track from MP4/WebM containers
  // for codecs they support; failure returns null and the timeline skips it.
  useEffect(() => {
    setPeaks(null)
    if (!file.src) return
    const ctrl = new AbortController()
    computePeaks(file.src, ctrl.signal).then(p => {
      if (!ctrl.signal.aborted) setPeaks(p)
    })
    return () => ctrl.abort()
  }, [file.src])

  // Sync duration + currentTime from the player. Resets on file change so
  // a freshly-mounted timeline doesn't briefly show stale values from the
  // previous file before loadedmetadata fires. Also reads any
  // already-loaded values up front, because loadedmetadata can fire BEFORE
  // this effect runs for cached/local blob URLs (the listener would miss it).
  useEffect(() => {
    setError(null)
    const el = videoRef.current
    if (!el) return
    setDuration(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0)
    setCurrentTime(el.currentTime || 0)

    const onLoaded = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    const onTime = () => setCurrentTime(el.currentTime)
    const onErr = () => setError('This video file could not be loaded.')
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('durationchange', onLoaded)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('error', onErr)
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('durationchange', onLoaded)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('error', onErr)
    }
  }, [file.src])

  const handleSelectionComplete = useCallback((startSec: number, endSec: number) => {
    onSegment?.({ startSec, endSec })
  }, [onSegment])

  const handleSeek = useCallback((sec: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = sec
  }, [])

  if (!file.src) {
    return (
      <div className="bench-media-editor">
        <div className="bench-editor-toolbar">
          <BenchBackChip fileName={file.name} onClose={onClose} />
          <BenchFullscreenChip />
        </div>
        <div className="bench-editor-empty">No video preview available</div>
      </div>
    )
  }

  return (
    <div className="bench-media-editor">
      <div className="bench-editor-toolbar">
        <BenchBackChip fileName={file.name} onClose={onClose} />
        <BenchFullscreenChip />
      </div>
      <div className="bench-media-editor-stage">
        <div className="bench-media-player bench-media-player--video">
          <video
            ref={videoRef}
            src={file.src}
            controls
            preload="metadata"
            crossOrigin="anonymous"
            playsInline
          />
        </div>
        {error ? (
          <div className="bench-media-error">{error}</div>
        ) : (
          <MediaTimeline
            durationSec={duration}
            currentSec={currentTime}
            peaks={peaks}
            onSelectionComplete={handleSelectionComplete}
            onSeek={handleSeek}
          />
        )}
      </div>
    </div>
  )
}
