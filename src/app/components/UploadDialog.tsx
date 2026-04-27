import { useRef, useState, useCallback, useEffect } from 'react'
import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isHttpUrl } from '../bench/link/previewUrl.ts'
import { useGooglePicker } from '../hooks/useGooglePicker.ts'

interface UploadDialogProps {
  onFileSelected: (file: File) => void
  /** Resolves on successful create; rejects with an Error on failure so the
   *  dialog can surface the message inline without closing. */
  onLinkSelected: (url: string) => Promise<void>
  onClose: () => void
}

export default function UploadDialog({ onFileSelected, onLinkSelected, onClose }: UploadDialogProps) {
  const { t } = useTranslation('files')
  const { t: tc } = useTranslation('common')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkSubmitting, setLinkSubmitting] = useState(false)
  // Ref-backed in-flight guard — state alone isn't enough because two synchronous
  // submit events in the same React task both see the pre-setState value.
  const submittingRef = useRef(false)

  const { openPicker: openGooglePicker, isLoading: isGooglePickerLoading } = useGooglePicker({
    onFilesReady: (files) => {
      for (const f of files) onFileSelected(f)
      onClose()
    },
  })

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose])

  const processFiles = useCallback((files: FileList) => {
    for (const file of Array.from(files)) {
      onFileSelected(file)
    }
    onClose()
  }, [onFileSelected, onClose])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragover(false)
    processFiles(e.dataTransfer.files)
  }, [processFiles])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragover(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragover(false)
  }, [])

  const handleInputChange = useCallback(() => {
    const input = fileInputRef.current
    if (!input?.files) return
    processFiles(input.files)
    input.value = ''
  }, [processFiles])

  const handleLinkSubmit = useCallback(async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (submittingRef.current) return
    const trimmed = linkInput.trim()
    if (!trimmed) return
    if (!isHttpUrl(trimmed)) {
      setLinkError(t('upload.invalidUrl'))
      return
    }
    submittingRef.current = true
    setLinkSubmitting(true)
    setLinkError(null)
    try {
      await onLinkSelected(trimmed)
      onClose()
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : t('upload.addLinkFailed'))
      submittingRef.current = false
      setLinkSubmitting(false)
    }
  }, [linkInput, onLinkSelected, onClose])

  return (
    <div className="upload-dialog-overlay" onClick={onClose}>
      <div className="upload-dialog" onClick={e => e.stopPropagation()}>
        <button className="upload-dialog-close" onClick={onClose} aria-label={tc('actions.close')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <h2 className="upload-dialog-title">{t('upload.title')}</h2>
        <p className="upload-dialog-subtitle">{t('upload.subtitle')}</p>

        <div
          className={`upload-dialog-dropzone${dragover ? ' is-dragover' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
        >
          <div className="upload-dialog-dropzone-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="upload-dialog-dropzone-text">{t('upload.dropText')}</p>
          <p className="upload-dialog-dropzone-hint">{t('upload.dropHint')}</p>
        </div>

        <div className="upload-dialog-divider"><span>{t('upload.fromCloud')}</span></div>

        <div className="upload-dialog-cloud-sources">
          <button
            type="button"
            className="upload-dialog-cloud-btn"
            disabled={isGooglePickerLoading}
            onClick={() => {
              onClose()
              openGooglePicker().catch(err => console.error('[UploadDialog] Google picker error:', err))
            }}
          >
            {isGooglePickerLoading ? (
              <svg className="upload-dialog-cloud-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            ) : (
              <svg className="upload-dialog-cloud-icon" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
              </svg>
            )}
            {t('upload.googleDrive')}
          </button>
        </div>

        <div className="upload-dialog-divider"><span>{t('upload.fromLink')}</span></div>

        <form className="upload-dialog-link-form" onSubmit={handleLinkSubmit}>
          <input
            type="url"
            className="upload-dialog-link-input"
            placeholder={t('upload.linkPlaceholder')}
            value={linkInput}
            onChange={(e) => { setLinkInput(e.target.value); setLinkError(null) }}
            autoComplete="off"
            spellCheck={false}
            disabled={linkSubmitting}
          />
          <button
            type="submit"
            className="upload-dialog-link-btn"
            disabled={!linkInput.trim() || linkSubmitting}
          >
            {t('upload.addLink')}
          </button>
        </form>
        {linkError && <p className="upload-dialog-link-error" role="alert">{linkError}</p>}

        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.pptx,.ppt,.xlsx,.xls,.txt,.mp3,.mp4,.wav,.zip,.tar,.gz,.tgz,.bz2,.tbz2,.xz,.txz,.7z,.rar,.zst"
          multiple
          onChange={handleInputChange}
        />
      </div>
    </div>
  )
}
