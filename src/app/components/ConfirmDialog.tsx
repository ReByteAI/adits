import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  confirmDanger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ title, message, confirmLabel, confirmDanger, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [onCancel])

  return (
    <div className="wsv2-modal-backdrop" onMouseDown={onCancel} role="presentation">
      <div
        className="wsv2-modal wsv2-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wsv2-confirm-dialog-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="wsv2-modal-header wsv2-confirm-dialog-header">
          <h3 className="wsv2-modal-title wsv2-confirm-dialog-title" id="wsv2-confirm-dialog-title">{title}</h3>
          <button className="wsv2-modal-close" aria-label={t('actions.close')} onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="wsv2-modal-body wsv2-confirm-dialog-body">
          <p>{message}</p>
        </div>
        <div className="wsv2-confirm-dialog-actions">
          <button type="button" className="wsv2-btn-ghost wsv2-confirm-dialog-cancel" onClick={onCancel}>
            <span>{t('actions.cancel')}</span>
          </button>
          <button
            type="button"
            className={`wsv2-btn-solid wsv2-confirm-dialog-confirm${confirmDanger ? ' is-danger' : ''}`}
            onClick={onConfirm}
          >
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
