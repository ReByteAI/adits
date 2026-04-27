/** Subscribes to the iframe bridge's `speaker-notes` + `slide-index`
 *  messages and exposes `{hasNotes, notes, slideIndex}`. Used by
 *  Bench to decide whether the Present dropdown shows the notes
 *  subtitle and whether entering tab/fullscreen should open the
 *  popup window.
 *
 *  Reset on iframe detach so a page swap / reload doesn't carry stale
 *  notes into the next document.
 */
import { useEffect, useState } from 'react'
import type { IframeBridgeApi } from '../iframe/bridge.ts'
import type { IframeInMsg } from '../iframe/messages.ts'

export interface SpeakerNotesState {
  hasNotes: boolean
  notes: string[]
  slideIndex: number
}

export function useSpeakerNotes(bridge: IframeBridgeApi): SpeakerNotesState {
  const [notes, setNotes] = useState<string[]>([])
  const [slideIndex, setSlideIndex] = useState(0)

  useEffect(() => {
    const unsub = bridge.subscribe({
      onMessage: (msg: IframeInMsg) => {
        if (msg.type === 'speaker-notes') {
          setNotes(msg.notes ?? [])
        } else if (msg.type === 'slide-index') {
          setSlideIndex(msg.index)
        }
      },
      onDetach: () => {
        setNotes([])
        setSlideIndex(0)
      },
    })
    return unsub
  }, [bridge])

  return { hasNotes: notes.length > 0, notes, slideIndex }
}
