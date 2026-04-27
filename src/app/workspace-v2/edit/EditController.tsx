/** Host-side controller for the Edit lane.
 *
 *  Thin layer over an injected IframeBridgeApi (iframe/bridge.ts) + the
 *  shared inject script (iframe/inject-core.ts). Owns only Edit-specific
 *  state: the selection-mode machine and the batched style-edit queue.
 *  Lane bookkeeping (modeRef + Esc listener) is shared via useLaneExit.
 *
 *  Interaction model:
 *    - While in Edit mode, each knob change applies live to the iframe
 *      DOM and appends to a pending-edits map the bottom bar renders.
 *    - Two terminal actions, explicit:
 *        commit()  — enqueues an `edit-batch` chip in the round buffer
 *                    (EditBatchNode.getTextContent() owns the LLM
 *                    prompt shape) and exits Edit mode.
 *        exit()    — discards the queue and exits. No chip. Used by
 *                    the toolbar toggle, Esc, and mutual-exclusion
 *                    with other lanes.
 *    - There is NO auto-commit on exit. An accidental Esc / toggle-
 *      off / lane switch cancels the batch cleanly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IframeBridgeApi } from '../iframe/bridge.ts'
import type { IframeInMsg, Rect, SelectionStyles } from '../iframe/messages.ts'
import { useLaneExit } from '../iframe/lane.ts'
import { useRoundStore } from '../round/store.ts'

export type { SelectionStyles }

export interface SelectionInfo {
  selector: string
  tag: string
  rect: Rect
  inline: boolean
  styles: SelectionStyles
}

export interface PendingEdit {
  selector: string
  prop: string
  value: string
}

type Mode = 'off' | 'picking' | 'editing'

export interface EditControllerApi {
  mode: Mode
  selection: SelectionInfo | null
  /** Ordered list of pending edits, deduped by `${selector}::${prop}`
   *  — the bottom bar renders these and clears them when commit()
   *  produces a chip. */
  pendingEdits: PendingEdit[]
  enter: () => void
  /** Leave Edit mode and DISCARD any pending edits. Called from the
   *  toolbar toggle, Esc, and mutual-exclusion with Comment. */
  exit: () => void
  /** Enqueue the pending edits as a single `edit-batch` chip and
   *  exit Edit mode. No-op when there are no pending edits (caller
   *  should fall back to exit() in that case). */
  commit: () => void
  applyStyle: (prop: string, value: string) => void
}

export function useEditController(fileName: string, bridge: IframeBridgeApi): EditControllerApi {
  const [mode, setMode] = useState<Mode>('off')
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  /** Map keyed by `${selector}::${prop}` so a color-picker drag
   *  collapses to one entry per property. Iteration order matches
   *  Map-insertion order — i.e. the order in which the user touched
   *  distinct (element, property) pairs — which is what the bottom
   *  bar renders. */
  const [pendingEdits, setPendingEdits] = useState<Map<string, PendingEdit>>(new Map())
  /** Synchronous mirror of pendingEdits so commit() can read the
   *  latest value without waiting for a post-commit effect. Updated
   *  in the same code path that calls setPendingEdits. */
  const pendingEditsRef = useRef<Map<string, PendingEdit>>(pendingEdits)

  const modeRef = useRef<Mode>('off')
  useEffect(() => { modeRef.current = mode }, [mode])

  const fileNameRef = useRef(fileName)
  useEffect(() => { fileNameRef.current = fileName }, [fileName])

  const updatePending = useCallback((next: Map<string, PendingEdit>) => {
    pendingEditsRef.current = next
    setPendingEdits(next)
  }, [])

  const resetLocalState = useCallback(() => {
    updatePending(new Map())
    setSelection(null)
    setMode('off')
  }, [updatePending])

  /** Exit without producing a chip. Pending edits are discarded. */
  const doExit = useCallback(() => {
    if (modeRef.current === 'off') return
    bridge.postCmd({ type: 'exit' })
    resetLocalState()
  }, [bridge, resetLocalState])

  /** Enqueue the pending batch as a chip and exit. */
  const doCommit = useCallback(() => {
    if (modeRef.current === 'off') return
    const pending = pendingEditsRef.current
    const name = fileNameRef.current
    if (pending.size === 0 || !name) return
    const edits = Array.from(pending.values())
    const id = useRoundStore.getState().add({
      v: 1,
      source: 'edit',
      ref: { fileName: name },
      text: `${edits.length} ${edits.length === 1 ? 'change' : 'changes'} in ${name}`,
      data: { edits },
    })
    // On validation failure in prod, bail without changing anything
    // so the user can inspect / retry.
    if (id === null) return
    bridge.postCmd({ type: 'exit' })
    resetLocalState()
  }, [bridge, resetLocalState])

  const exitRef = useLaneExit(doExit, useCallback(() => modeRef.current !== 'off', []))

  useEffect(() => {
    const unsubscribe = bridge.subscribe({
      onMessage: (msg: IframeInMsg) => {
        if (msg.type === 'select' && msg.mode === 'edit') {
          setSelection({
            selector: msg.selector,
            tag: msg.tag,
            rect: msg.rect,
            inline: msg.inline,
            styles: msg.styles,
          })
          setMode('editing')
        } else if (msg.type === 'deselect') {
          setSelection(null)
          setMode(curr => (curr === 'off' ? 'off' : 'picking'))
        } else if (msg.type === 'escape') {
          exitRef.current()
        }
      },
      onDetach: resetLocalState,
    })
    return unsubscribe
  }, [bridge, resetLocalState, exitRef])

  const enter = useCallback(() => {
    if (modeRef.current !== 'off') return
    updatePending(new Map())
    setSelection(null)
    setMode('picking')
    bridge.postCmd({ type: 'enter', mode: 'edit' })
  }, [bridge, updatePending])

  const applyStyle = useCallback((prop: string, value: string) => {
    const sel = selection?.selector
    if (!sel) return
    const next = new Map(pendingEditsRef.current)
    next.set(`${sel}::${prop}`, { selector: sel, prop, value })
    updatePending(next)
    bridge.postCmd({ type: 'setStyle', selector: sel, prop, value })
  }, [selection, bridge, updatePending])

  const pendingList = useMemo(() => Array.from(pendingEdits.values()), [pendingEdits])

  return useMemo(() => ({
    mode, selection, pendingEdits: pendingList, enter, exit: doExit, commit: doCommit, applyStyle,
  }), [mode, selection, pendingList, enter, doExit, doCommit, applyStyle])
}
