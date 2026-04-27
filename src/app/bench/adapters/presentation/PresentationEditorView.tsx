/**
 * PresentationEditorView — preview PPTX files via Google Drive iframe.
 *
 * Flow: fetch blob → get Google OAuth token → upload to Drive → iframe preview.
 * Uses the same GCP project / credentials as useGooglePicker.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorViewProps } from '../../types.ts'
import { fetchFileBlob } from '../../../api.ts'
import { BenchBackChip } from '../../BenchBackChip.tsx'
import { BenchFullscreenChip } from '../../BenchFullscreenChip.tsx'
import { getType } from '../../../file-types'
import {
  ensureGisLoaded,
  requestGoogleToken,
  getCachedToken,
} from '../../../hooks/useGooglePicker.ts'

type PreviewState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Upload a blob to Google Drive as a Google Slides file and return the file ID.
 */
async function uploadToDrive(token: string, blob: Blob, fileName: string): Promise<string> {
  const boundary = 'adits_upload_boundary';
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: 'application/vnd.google-apps.presentation',
  });

  // Build multipart/related body for the Drive multipart upload.
  const body = new Blob([
    `--${boundary}\r\n`,
    `Content-Type: application/json; charset=UTF-8\r\n`,
    `\r\n`,
    metadata,
    `\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: ${blob.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}\r\n`,
    `\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PresentationEditor] Drive upload failed:', response.status, errorText);
    if (response.status === 401) {
      throw new Error('Google token expired — please try again');
    }
    if (response.status === 403) {
      throw new Error('Google Drive permissions not granted');
    }
    throw new Error(`Google Drive upload failed: ${response.status}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

export default function PresentationEditorView({ file, onClose }: EditorViewProps) {
  const { t } = useTranslation('workspace')
  const [state, setState] = useState<PreviewState>('idle')
  const [fileId, setFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  const def = getType(file.type)

  const triggerPreview = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      // 1. Fetch the file blob from R2
      const blob = await fetchFileBlob(file.id)

      // 2. Get Google OAuth token (reuses cached token from picker if available)
      await ensureGisLoaded()
      const token = await requestGoogleToken()

      // 3. Upload to Google Drive
      const driveFileId = await uploadToDrive(token, blob, file.name)
      setFileId(driveFileId)
      setState('ready')
    } catch (err) {
      console.error('[PresentationEditor] Preview failed:', err)
      setError(err instanceof Error ? err.message : 'Preview failed')
      setState('error')
    }
  }, [file.id, file.name])

  // Auto-trigger preview on mount when a cached Google token exists
  // (i.e. user already authenticated via the picker — no popup needed).
  // Falls back to manual button if no token is cached.
  useEffect(() => {
    if (startedRef.current) return
    if (getCachedToken()) {
      startedRef.current = true
      triggerPreview()
    }
  }, [triggerPreview])

  return (
    <div className="bench-placeholder-editor">
      <div className="bench-editor-toolbar">
        <BenchBackChip fileName={file.name} onClose={onClose} />
        <BenchFullscreenChip />
      </div>

      {state === 'ready' && fileId ? (
        /* Google Drive iframe preview */
        <div className="bench-pres-preview">
          <iframe
            src={`https://drive.google.com/file/d/${fileId}/preview`}
            className="bench-pres-iframe"
            title={`Preview of ${file.name}`}
            allow="autoplay"
          />
        </div>
      ) : (
        <div className="bench-placeholder-view">
          {state === 'loading' ? (
            <div className="bench-pres-loading">
              <svg className="upload-dialog-cloud-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              <span>{t('viewer.preparing')}</span>
            </div>
          ) : (
            <>
              <div className="bench-placeholder-thumb">
                <def.Thumbnail file={{ name: file.name, src: file.src, thumb: file.thumb }} />
              </div>
              <div className="bench-placeholder-name">{file.name}</div>
              <div className="bench-placeholder-label">{def.label}</div>

              {state === 'idle' && (
                <button
                  type="button"
                  className="bench-pres-preview-btn"
                  onClick={triggerPreview}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Preview in Google Drive
                </button>
              )}

              {state === 'error' && (
                <div className="bench-pres-error">
                  <p className="bench-pres-error-msg">{error}</p>
                  <button
                    type="button"
                    className="bench-pres-preview-btn"
                    onClick={triggerPreview}
                  >
                    Retry
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
