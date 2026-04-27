import { useTranslation } from 'react-i18next'

/**
 * BenchBackChip — file-identity cluster shown at the start of every editor toolbar.
 *
 * 30×30 ghost back arrow (the click target) followed by a passive filename label.
 * Lives inside each editor's `.bench-editor-toolbar` so the bench has a single
 * unified action band — no separate header row above.
 */

interface BenchBackChipProps {
  fileName: string
  onClose: () => void
}

export function BenchBackChip({ fileName, onClose }: BenchBackChipProps) {
  const { t } = useTranslation('workspace')
  return (
    <div className="bench-back-chip">
      <button
        type="button"
        className="bench-editor-btn bench-back-chip-btn"
        onClick={onClose}
        aria-label={t('bench.backToProjectAria')}
        title={t('bench.backToProject')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>
      <span className="bench-back-chip-filename" title={fileName}>{fileName}</span>
    </div>
  )
}
