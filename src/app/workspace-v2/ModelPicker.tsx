import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MODELS_BY_EXECUTOR,
  type ExecutorModelId,
  type ExecutorType,
} from '../../../packages/shared/executors'

export function ModelPicker({
  executor,
  value,
  onChange,
  disabled,
}: {
  executor: ExecutorType
  value: ExecutorModelId
  onChange: (next: ExecutorModelId) => void
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

  const options = MODELS_BY_EXECUTOR[executor]
  const current = options.find(option => option.id === value) ?? options[0]
  const menuDisabled = disabled || options.length <= 1

  return (
    <div ref={ref} className="wsv2-executor-picker">
      <button
        type="button"
        className="wsv2-executor-picker-btn"
        onClick={() => setOpen(v => !v)}
        disabled={menuDisabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('executor.label')}
      >
        <span className="wsv2-model-picker-prefix">{t('executor.label')}</span>
        <span className="wsv2-executor-picker-label">{current.label}</span>
        <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <ul className="wsv2-executor-picker-menu" role="listbox">
          {options.map(option => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={option.id === current.id}
                className="wsv2-executor-picker-item"
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
              >
                <span>{option.label}</span>
                {option.id === current.id && <span className="wsv2-executor-picker-check">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
