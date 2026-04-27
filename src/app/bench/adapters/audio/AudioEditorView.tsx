/**
 * AudioEditorView — native <audio> player + a draggable timeline strip that
 * lets the user reference a [start, end] slice. Pure reference UX.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorViewProps } from '../../types.ts'
import { MediaTimeline } from '../../media/MediaTimeline.tsx'
import { computePeaks } from '../../media/computePeaks.ts'
import { BenchBackChip } from '../../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../../BenchFullscreenChip.tsx'

export default function AudioEditorView({ file, onSegment, onClose }: EditorViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  // Decode the audio file once to compute waveform peaks (best-effort).
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
    const el = audioRef.current
    if (!el) return
    // Capture whatever the element already knows. readyState >= 1 means
    // HAVE_METADATA which guarantees duration is finite for normal media.
    setDuration(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0)
    setCurrentTime(el.currentTime || 0)

    const onLoaded = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    const onTime = () => setCurrentTime(el.currentTime)
    const onErr = () => setError('This audio file could not be loaded.')
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
    const el = audioRef.current
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
        <div className="bench-editor-empty">No audio preview available</div>
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
        <div className="bench-media-player bench-media-player--audio">
          <audio
            ref={audioRef}
            src={file.src}
            controls
            preload="metadata"
            crossOrigin="anonymous"
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
