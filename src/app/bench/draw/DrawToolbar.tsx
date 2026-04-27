/**
 * DrawToolbar — color + brush size picker for draw mode.
 * Inline popover-free version adapted for adits.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export type BrushSize = 'S' | 'M' | 'L' | 'XL'

export const BRUSH_SIZE_MAP: Record<BrushSize, number> = {
  S: 4,
  M: 10,
  L: 20,
  XL: 40,
}

const BRUSH_SIZES = Object.keys(BRUSH_SIZE_MAP) as BrushSize[]

export const DRAW_COLORS = [
  { id: 'black', hex: '#1d1d1d' },
  { id: 'grey', hex: '#9fa8b2' },
  { id: 'light-violet', hex: '#e085f4' },
  { id: 'violet', hex: '#ae3ec9' },
  { id: 'blue', hex: '#4465e9' },
  { id: 'light-blue', hex: '#4ba1f1' },
  { id: 'yellow', hex: '#f1ac4b' },
  { id: 'orange', hex: '#e16919' },
  { id: 'green', hex: '#099268' },
  { id: 'light-green', hex: '#4cb05e' },
  { id: 'light-red', hex: '#f87777' },
  { id: 'red', hex: '#e03131' },
] as const

/** Default brush color used by both image and PDF editors. */
export const DEFAULT_BRUSH_COLOR = '#e03131'

export interface DrawToolbarProps {
  color: string
  onColorChange: (color: string) => void
  size: BrushSize
  onSizeChange: (size: BrushSize) => void
}

export function DrawToolbar({ color, onColorChange, size, onSizeChange }: DrawToolbarProps) {
  const { t } = useTranslation('workspace')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close()
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [open, close])

  return (
    <div ref={containerRef} className="bench-draw-toolbar">
      <button
        type="button"
        className="bench-draw-swatch"
        style={{ backgroundColor: color }}
        aria-label={t('viewer.pickBrush')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      />
      {open && (
        <div className="bench-draw-popover" role="menu">
          <div className="bench-draw-colors" role="radiogroup" aria-label="Color palette">
            {DRAW_COLORS.map(c => {
              const selected = c.hex === color
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={c.id}
                  className={`bench-draw-color${selected ? ' is-selected' : ''}`}
                  onClick={() => onColorChange(c.hex)}
                >
                  <span style={{ backgroundColor: c.hex }} />
                </button>
              )
            })}
          </div>
          <div className="bench-draw-sizes" role="radiogroup" aria-label="Brush size">
            {BRUSH_SIZES.map(s => {
              const selected = s === size
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`bench-draw-size${selected ? ' is-selected' : ''}`}
                  onClick={() => onSizeChange(s)}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
