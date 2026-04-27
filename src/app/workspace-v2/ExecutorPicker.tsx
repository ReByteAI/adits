/**
 * Compact executor picker — the dropdown that sits in the chat composer
 * toolbar. Shows the current executor's logo + label; clicking opens a
 * list of the three options (Claude / Gemini / Codex).
 *
 * The selection is stored by the caller; this component is purely UI.
 * Local mode shows the same three options — the single-user build
 * requires the matching CLI (`claude`, `codex`, `gemini`) on $PATH.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AVAILABLE_EXECUTORS,
  EXECUTOR_BRAND_COLORS,
  EXECUTOR_LOGO_PATHS,
  EXECUTOR_LOGO_VIEWBOX,
  type ExecutorType,
} from '../../../packages/shared/executors'

function ExecutorIcon({ value, size = 14 }: { value: ExecutorType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={EXECUTOR_LOGO_VIEWBOX[value]}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d={EXECUTOR_LOGO_PATHS[value]} fill={EXECUTOR_BRAND_COLORS[value]} />
    </svg>
  )
}

export function ExecutorPicker({
  value,
  onChange,
  disabled,
}: {
  value: ExecutorType
  onChange: (next: ExecutorType) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('workspace')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = AVAILABLE_EXECUTORS.find(e => e.value === value) ?? AVAILABLE_EXECUTORS[0]

  return (
    <div ref={ref} className="wsv2-executor-picker">
      <button
        type="button"
        className="wsv2-executor-picker-btn"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('executor.agent', { name: current.label })}
      >
        <ExecutorIcon value={current.value} />
        <span className="wsv2-executor-picker-label">{current.label}</span>
        <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <ul className="wsv2-executor-picker-menu" role="listbox">
          {AVAILABLE_EXECUTORS.map(e => (
            <li key={e.value}>
              <button
                type="button"
                role="option"
                aria-selected={e.value === value}
                className="wsv2-executor-picker-item"
                onClick={() => {
                  onChange(e.value)
                  setOpen(false)
                }}
              >
                <ExecutorIcon value={e.value} />
                <span>{e.label}</span>
                {e.value === value && <span className="wsv2-executor-picker-check">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
