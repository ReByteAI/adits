/** Small helper for host-side lane bookkeeping that both Edit and
 *  Comment share: a stable `exitRef` the bridge subscriber can call on
 *  `escape`, and the host-window keydown listener that invokes it on
 *  Esc. Factors out the `modeRef` / `doExitRef` / `useEffect(keydown)`
 *  trio that was duplicated across EditController + CommentController.
 */
import { useEffect, useRef, type RefObject } from 'react'

/** @returns exitRef — a ref the caller's subscribers should invoke on
 *  the iframe's `escape` message so they always hit the latest `exit`.
 *
 *  @param exit       The lane's exit function. Re-declared per render;
 *                    the hook keeps the ref in sync.
 *  @param isActive   Whether the lane is currently in any non-off
 *                    state. Checked on host-window Esc.
 */
export function useLaneExit(
  exit: () => void,
  isActive: () => boolean,
): RefObject<() => void> {
  const exitRef = useRef(exit)
  const isActiveRef = useRef(isActive)
  useEffect(() => { exitRef.current = exit }, [exit])
  useEffect(() => { isActiveRef.current = isActive }, [isActive])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isActiveRef.current()) exitRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return exitRef
}
