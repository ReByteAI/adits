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
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div className="ui-dialog" onClick={e => e.stopPropagation()}>
        <div className="ui-dialog-header">
          <h3 className="ui-dialog-title">{title}</h3>
          <button className="ui-dialog-close" aria-label={t('actions.close')} onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="ui-dialog-body">
          <p>{message}</p>
        </div>
        <div className="ui-dialog-footer">
          <button className="btn btn-secondary" onClick={onCancel}><span>{t('actions.cancel')}</span></button>
          <button className={`btn btn-primary${confirmDanger ? ' ui-dialog-btn--danger' : ''}`} onClick={onConfirm}><span>{confirmLabel}</span></button>
        </div>
      </div>
    </div>
  )
}
