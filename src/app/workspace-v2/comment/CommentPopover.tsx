/** Floating popover shown when a Comment pin is placed.
 *
 *  MVP cut: only the "Send to Adits" action (save-only + send was
 *  considered but save-only requires the VM `/code/.comments/` store
 *  + sidebar, which lands in a follow-up).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface CommentPopoverProps {
  /** Host viewport coordinates where the click landed. The popover
   *  positions near this point, clamped against the viewport edges. */
  anchor: { x: number; y: number }
  onSend: (text: string) => void
  onCancel: () => void
}

const POPOVER_MAX_WIDTH = 320
const POPOVER_MARGIN = 12
/** Conservative fallback height before the element measures itself —
 *  enough for title + textarea + actions + padding. Replaced with the
 *  real measured height after mount. */
const POPOVER_FALLBACK_HEIGHT = 220

export default function CommentPopover({ anchor, onSend, onCancel }: CommentPopoverProps) {
  const { t } = useTranslation('workspace')
  const [text, setText] = useState('')
  const [height, setHeight] = useState(POPOVER_FALLBACK_HEIGHT)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  // Measure height once mounted so the next render can re-clamp `top`
  // against the real bottom edge. Without this, pinning near the
  // bottom of the viewport would let the action row overflow.
  useLayoutEffect(() => {
    if (rootRef.current) setHeight(rootRef.current.offsetHeight)
  }, [])

  // Outside click → cancel. Uses the document (bubble phase) — iframe
  // clicks live in the iframe's document and don't bubble here, so the
  // popover stays open while the iframe is frozen after select. We
  // defer registration one tick so the click that placed the pin
  // doesn't immediately close the popover on the same mousedown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      onCancel()
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onCancel])

  // Clamp to viewport on both axes. Width shrinks to fit available
  // horizontal space below POPOVER_MAX_WIDTH; no lower floor — at an
  // ultra-narrow viewport the popover simply shrinks (bounded below
  // by 0). The host scroll/resize listener in CommentController
  // re-drives this render, so cross-render resize stays clamped.
  const availableWidth = Math.max(0, window.innerWidth - 2 * POPOVER_MARGIN)
  const widthClamped = Math.min(POPOVER_MAX_WIDTH, availableWidth)
  const maxLeft = window.innerWidth - widthClamped - POPOVER_MARGIN
  const left = Math.max(POPOVER_MARGIN, Math.min(anchor.x, maxLeft))
  const maxTop = window.innerHeight - height - POPOVER_MARGIN
  const top = Math.max(POPOVER_MARGIN, Math.min(anchor.y, maxTop))

  const canSend = text.trim().length > 0

  return (
    <div
      ref={rootRef}
      className="wsv2-comment-popover"
      style={{ position: 'fixed', top, left, width: widthClamped }}
      data-dm-overlay=""
      onClick={e => e.stopPropagation()}
    >
      <div className="wsv2-comment-popover-title">{t('comment.title')}</div>
      <textarea
        ref={textareaRef}
        className="wsv2-comment-popover-input"
        placeholder={t('comment.describePlaceholder')}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
            e.preventDefault()
            onSend(text)
          }
        }}
        rows={4}
      />
      <div className="wsv2-comment-popover-actions">
        <button
          type="button"
          className="wsv2-btn-solid"
          disabled={!canSend}
          onClick={() => onSend(text)}
          title={t('comment.sendTitle')}
        >
          {t('comment.sendButton')}
        </button>
      </div>
    </div>
  )
}
