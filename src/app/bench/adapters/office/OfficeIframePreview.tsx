/**
 * OfficeIframePreview — preview + crop/comment for Office files
 * (.docx/.xlsx/.pptx) via an iframe hosted by Rebyte.
 *
 * Adits is open source and users run it locally, so we can't vendor the 31 MB
 * officeSDKForWeb bundle and we can't assume a public URL Rebyte could fetch.
 * Instead: fetch the file here (same-origin to Adits) and postMessage the Blob
 * into an iframe pointed at Rebyte's `/preview-embed`, where the SDK runs
 * same-origin to its own assets.
 *
 * Protocol mirrors Rebyte's `preview-embed`. Lifecycle:
 *   iframe → us    'rebyte-preview:ready'
 *   us → iframe    'rebyte-preview:file' { fileName, blob }
 *   iframe → us    'rebyte-preview:loaded' | 'rebyte-preview:error'
 *
 * Crop/comment flow uses the generic RPC channel exposed on top of the
 * lifecycle messages — `embed-rpc.ts` wraps it. The user drags a rect over
 * the iframe (CropOverlay, same component PDF uses), we ask the iframe to
 * `renderRect(rect)` and get back a PNG Blob of the cropped region, then
 * open a CommentPopover and emit a `source: 'comment'` PromptPiece.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import type { EditorViewProps } from '../../types.ts'
import { fetchFileBlob } from '../../../api.ts'
import { CropOverlay, type CropRect } from '../../draw/CropOverlay.tsx'
import { blobToDataUrl } from '../../draw/dataUrl.ts'
import { useRoundStore } from '../../../workspace-v2/round/store.ts'
import CommentPopover from '../../../workspace-v2/comment/CommentPopover.tsx'
import { useBenchEditorSlot } from '../../../workspace-v2/bench-editor-slot.ts'
import { createEmbedRpc } from './embed-rpc.ts'

// Dev: Rebyte frontend runs at :3332 with the React app under /app/*.
// Prod: frontend is hosted at rebyte.ai root (no /app prefix).
// Override with VITE_REBYTE_EMBED_URL if you deploy to a different host.
const DEFAULT_EMBED_URL = import.meta.env?.DEV
  ? 'http://localhost:3332/app/preview-embed'
  : 'https://rebyte.ai/preview-embed'
const EMBED_URL =
  (import.meta.env?.VITE_REBYTE_EMBED_URL as string | undefined) || DEFAULT_EMBED_URL

type Phase = 'loading-blob' | 'mounting' | 'ready' | 'error'
type OfficeMode = 'view' | 'comment'

function formatRect(rect: CropRect): string {
  return `rect(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)})`
}

function rectAnchor(host: HTMLElement, rect: CropRect): { x: number; y: number } {
  const box = host.getBoundingClientRect()
  return { x: box.left + rect.x + rect.w, y: box.top + rect.y }
}

export default memo(function OfficeIframePreview({ file }: EditorViewProps) {
  const { t } = useTranslation('workspace')
  const [phase, setPhase] = useState<Phase>('loading-blob')
  const [error, setError] = useState<string | null>(null)
  const blobRef = useRef<Blob | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const sentRef = useRef(false)
  const rpc = useMemo(() => createEmbedRpc(() => iframeRef.current), [])

  const [mode, setMode] = useState<OfficeMode>('view')
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [commentPending, setCommentPending] = useState<
    { rect: CropRect; anchor: { x: number; y: number } } | null
  >(null)
  const lockedRef = useRef(false)
  const [flashKey, setFlashKey] = useState(0)

  const commentActive = mode === 'comment' && phase === 'ready'
  const slotEl = useBenchEditorSlot()

  useEffect(() => {
    rpc.attach()
    return () => rpc.detach()
  }, [rpc])

  // 1) Pull the file as a Blob via the project fileserver (same-origin to Adits).
  useEffect(() => {
    let cancelled = false
    setPhase('loading-blob')
    setError(null)
    sentRef.current = false
    blobRef.current = null

    fetchFileBlob(file.id)
      .then(blob => {
        if (cancelled) return
        blobRef.current = blob
        setPhase('mounting')
      })
      .catch(err => {
        if (cancelled) return
        console.error('[OfficeIframePreview] blob fetch failed', err)
        setError(err instanceof Error ? err.message : 'Failed to load file')
        setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [file.id])

  // 2) Handshake with the embed iframe.
  const sendFile = useCallback(() => {
    if (sentRef.current) return
    const iframe = iframeRef.current
    const blob = blobRef.current
    if (!iframe || !iframe.contentWindow || !blob) return
    sentRef.current = true
    iframe.contentWindow.postMessage(
      { type: 'rebyte-preview:file', fileName: file.name, blob },
      '*',
    )
  }, [file.name])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframe = iframeRef.current
      if (!iframe || event.source !== iframe.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      switch (data.type) {
        case 'rebyte-preview:ready':
          sendFile()
          break
        case 'rebyte-preview:loaded':
          setPhase('ready')
          setError(null)
          // Sanity-check the RPC channel now that the SDK is up. Failure
          // here means the embed is an older build without the RPC patch
          // — preview still works, crop won't.
          rpc.call('ping').then(
            info => console.debug('[OfficeIframePreview] embed-rpc ping:', info),
            err => console.warn('[OfficeIframePreview] embed-rpc ping failed:', err.message),
          )
          break
        case 'rebyte-preview:error':
          setError(typeof data.message === 'string' ? data.message : 'Preview failed')
          setPhase('error')
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sendFile, rpc])

  // Escape cascade in comment mode: close popover → clear crop → exit mode.
  useEffect(() => {
    if (!commentActive) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (commentPending) {
        setCommentPending(null)
        return
      }
      if (cropRect) {
        setCropRect(null)
        return
      }
      setMode('view')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commentActive, commentPending, cropRect])

  // Drop any pending crop / popover when leaving comment mode.
  useEffect(() => {
    if (!commentActive) {
      setCropRect(null)
      setCommentPending(null)
    }
  }, [commentActive])

  const handleStartComment = useCallback(() => {
    const host = wrapperRef.current
    if (!host || !cropRect || cropRect.w < 1 || cropRect.h < 1) return
    setCommentPending({ rect: cropRect, anchor: rectAnchor(host, cropRect) })
  }, [cropRect])

  const handleSendComment = useCallback(async (note: string) => {
    const trimmed = note.trim()
    if (!trimmed || !commentPending || lockedRef.current) return
    lockedRef.current = true
    setFlashKey(k => k + 1)

    try {
      const result = await rpc.call<{ blob: Blob; width: number; height: number }>(
        'renderRect',
        { rect: commentPending.rect },
        { timeoutMs: 15_000 },
      )
      const dataUrl = await blobToDataUrl(result.blob)
      useRoundStore.getState().add({
        v: 1,
        source: 'comment',
        ref: {
          fileName: file.name,
          path: formatRect(commentPending.rect),
        },
        text: trimmed,
        image: dataUrl,
      })
      setCommentPending(null)
      setCropRect(null)
    } catch (err) {
      console.error('[OfficeIframePreview] comment crop failed:', err)
    } finally {
      lockedRef.current = false
    }
  }, [commentPending, file.name, rpc])

  const handleCancelComment = useCallback(() => setCommentPending(null), [])

  const modeButtons = (
    <>
      <button
        type="button"
        className={`wsv2-btn-ghost${mode === 'view' ? ' is-active' : ''}`}
        onClick={() => setMode('view')}
        aria-pressed={mode === 'view'}
        title={t('viewer.viewFile')}
        disabled={phase !== 'ready'}
      >
        {t('bench.open')}
      </button>
      <button
        type="button"
        className={`wsv2-btn-ghost${commentActive ? ' is-active' : ''}`}
        onClick={() => setMode('comment')}
        aria-pressed={commentActive}
        title={t('viewer.selectRegion')}
        disabled={phase !== 'ready'}
      >
        {t('bench.comment')}
      </button>
    </>
  )

  return (
    // `height: 100%` is load-bearing: `.bench-placeholder-editor` uses `flex: 1`,
    // but the ancestor `.wsv2-bench-body` is a block-level scroll container, so
    // flex doesn't give the iframe a definite parent height and it collapses to
    // the HTML iframe default (150px). Other editors have intrinsic content
    // height; the iframe doesn't.
    <div className="bench-placeholder-editor" style={{ height: '100%' }}>
      {slotEl && createPortal(modeButtons, slotEl)}

      {phase === 'error' ? (
        <div className="bench-placeholder-view">
          <div className="bench-pres-error">
            <p className="bench-pres-error-msg">{error ?? 'Preview failed'}</p>
          </div>
        </div>
      ) : (
        <div className="bench-pres-preview">
          {phase !== 'ready' && (
            <div className="bench-pres-loading">
              <svg className="upload-dialog-cloud-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>
                {phase === 'loading-blob' ? 'Loading file…' : 'Preparing preview…'}
              </span>
            </div>
          )}
          {phase !== 'loading-blob' && (
            // Positioned wrapper so CropOverlay can layer absolutely on top.
            // The iframe itself fills this div, so the CropOverlay sized to
            // the wrapper's clientWidth/Height matches the iframe's viewport
            // coords 1:1 — which is exactly what `renderRect` expects.
            <div
              ref={wrapperRef}
              className="bench-office-iframe-wrap"
              style={{ position: 'relative', width: '100%', height: '100%' }}
            >
              <iframe
                ref={iframeRef}
                src={EMBED_URL}
                className="bench-pres-iframe"
                title={`Preview of ${file.name}`}
                // sandbox kept permissive — the SDK needs module workers and same-origin
                // requests to its own assets, which both require the iframe's own origin.
              />
              {commentActive && (
                <CropOverlay
                  targetRef={wrapperRef}
                  active={!commentPending}
                  rect={cropRect}
                  onChange={setCropRect}
                  onApply={handleStartComment}
                  applyLabel="Comment"
                />
              )}
              {flashKey > 0 && (
                <div
                  key={flashKey}
                  className="bench-editor-flash"
                  onAnimationEnd={() => setFlashKey(0)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {commentPending && (
        <CommentPopover
          anchor={commentPending.anchor}
          onSend={handleSendComment}
          onCancel={handleCancelComment}
        />
      )}
    </div>
  )
})
