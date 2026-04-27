/** Context that exposes a portal target in the Bench subbar to the
 *  currently mounted file editor. Lets non-HTML editors (Image, PDF,
 *  …) render their mode toolbar on the right side of the subbar —
 *  the same location HTML uses for `PageToolbar` — instead of
 *  owning a bulky in-body toolbar.
 *
 *  Consumer: `useBenchEditorSlot()` returns the target element (or
 *  null if not yet mounted). Pair with `createPortal(…, slot)` to
 *  render into it. When the slot element mounts after the editor,
 *  React re-renders the editor and the portal attaches.
 *
 *  Only image / PDF / future adapter editors need this. HTML's
 *  PageToolbar is rendered directly in Bench and bypasses the slot. */
import { createContext, useContext } from 'react'

export const BenchEditorSlotContext = createContext<HTMLDivElement | null>(null)

export function useBenchEditorSlot(): HTMLDivElement | null {
  return useContext(BenchEditorSlotContext)
}
