/** Bottom bar that lives across the page view while the Edit lane is
 *  active. Shows the running queue of pending edits and the explicit
 *  "Send N edits" button that turns the queue into a chip.
 *
 *  Exit semantics are NOT handled here — toolbar toggle / Esc / lane
 *  switch all call EditController.exit() which discards the queue.
 *  This bar only offers commit.
 */
import type { PendingEdit } from './EditController.tsx'

export interface EditPendingBarProps {
  edits: PendingEdit[]
  onSend: () => void
}

export default function EditPendingBar({ edits, onSend }: EditPendingBarProps) {
  const n = edits.length
  return (
    <div className="wsv2-edit-pending-bar" data-dm-overlay="">
      <div className="wsv2-edit-pending-list">
        {n === 0 ? (
          <div className="wsv2-edit-pending-empty">
            Pick an element and change a property — your edits stack up here.
          </div>
        ) : (
          edits.map((e, i) => (
            <div key={`${e.selector}::${e.prop}::${i}`} className="wsv2-edit-pending-row">
              <span className="wsv2-edit-pending-selector">{e.selector}</span>
              <span className="wsv2-edit-pending-sep">→</span>
              <span className="wsv2-edit-pending-prop">{e.prop}</span>
              <span className="wsv2-edit-pending-sep">:</span>
              <span className="wsv2-edit-pending-value">{e.value}</span>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        className="wsv2-btn-solid wsv2-edit-pending-send"
        onClick={onSend}
        disabled={n === 0}
        title={n === 0 ? 'Make at least one edit to enable Send' : 'Queue these edits as a chip in the chat composer'}
      >
        Send {n} {n === 1 ? 'edit' : 'edits'}
      </button>
    </div>
  )
}
