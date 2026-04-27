/**
 * Decode an audio (or audio track of a video) file and reduce it to a
 * fixed-size peaks array, normalized 0..1. Used by MediaTimeline to draw
 * a waveform behind the playhead.
 *
 * Browsers' AudioContext.decodeAudioData accepts MP3, WAV, AAC/MP4, OGG,
 * Opus/WebM and (in Chrome/Safari) the audio track inside .mp4/.webm video
 * containers. If decoding fails (unsupported codec, corrupted file, etc.)
 * the caller gets back null and the timeline silently skips the waveform.
 */

const PEAK_COUNT = 240

export async function computePeaks(srcUrl: string, signal?: AbortSignal): Promise<number[] | null> {
  try {
    const res = await fetch(srcUrl, { signal })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (signal?.aborted) return null

    // AudioContext is closed after we're done — no leaks. Use offline ctor
    // path that doesn't kick a hardware output stream.
    const Ctor: typeof AudioContext = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    let audio: AudioBuffer
    try {
      audio = await ctx.decodeAudioData(buf.slice(0))
    } catch {
      ctx.close().catch(() => {})
      return null
    }
    ctx.close().catch(() => {})
    if (signal?.aborted) return null

    // Mix down to mono by max-of-channels at each sample
    const channels = audio.numberOfChannels
    const length = audio.length
    if (length === 0) return null
    const samplesPerPeak = Math.max(1, Math.floor(length / PEAK_COUNT))
    const peaks = new Array<number>(PEAK_COUNT).fill(0)

    // For each output peak slot, scan its slice across all channels and
    // record the maximum absolute amplitude. Linear in the number of samples,
    // ~0.5s for a typical 3-minute song on a modern laptop.
    const channelData: Float32Array[] = new Array(channels)
    for (let c = 0; c < channels; c++) channelData[c] = audio.getChannelData(c)

    for (let i = 0; i < PEAK_COUNT; i++) {
      const start = i * samplesPerPeak
      const end = Math.min(length, start + samplesPerPeak)
      let max = 0
      for (let c = 0; c < channels; c++) {
        const data = channelData[c]
        for (let s = start; s < end; s++) {
          const v = Math.abs(data[s])
          if (v > max) max = v
        }
      }
      peaks[i] = max
    }

    // Normalize to 0..1 so quiet recordings still show a usable waveform
    let globalMax = 0
    for (const p of peaks) if (p > globalMax) globalMax = p
    if (globalMax > 0) {
      for (let i = 0; i < PEAK_COUNT; i++) peaks[i] = peaks[i] / globalMax
    }
    return peaks
  } catch {
    return null
  }
}
