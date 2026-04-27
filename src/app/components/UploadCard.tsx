import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import UploadDialog from './UploadDialog.tsx'

interface UploadCardProps {
  onFileSelected: (file: File) => void
  onLinkSelected: (url: string) => Promise<void>
}

export default function UploadCard({ onFileSelected, onLinkSelected }: UploadCardProps) {
  const { t } = useTranslation('files')
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleClick = useCallback(() => {
    setDialogOpen(true)
  }, [])

  return (
    <>
      <div className="app-card app-card--upload" onClick={handleClick}>
        <div className="app-dropzone-content">
          <div className="app-dropzone-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h2 className="app-dropzone-title">{t('uploadCard.title')}</h2>
          <p className="app-dropzone-subtitle">{t('uploadCard.subtitle')} <span className="app-dropzone-browse">{t('uploadCard.browse')}</span></p>
          <p className="app-dropzone-hint">{t('uploadCard.hint')}</p>
        </div>
      </div>
      {dialogOpen && (
        <UploadDialog
          onFileSelected={onFileSelected}
          onLinkSelected={onLinkSelected}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}
