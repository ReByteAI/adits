/**
 * Share + Export dropdown. Most items don't do conversion themselves —
 * they compose a chat prompt ("Save this design as a PDF: <file>") and
 * submit it as a new task. The agent (claude / gemini / codex)
 * owns the actual PDF/PPTX/ZIP/HTML generation, using whatever toolchain
 * it decides (headless chromium, libreoffice, pandoc, etc.).
 *
 * Duplicate project is the exception — that's a real server action
 * (copy dir + DB row), not something an agent should freelance.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store.ts'

// Agent prompts stay in English — the model receives them and acts on them;
// the user-facing label is what gets localized via i18n keys below.
const EXPORT_PROMPTS = [
  {
    labelKey: 'share.exportZip',
    isZip: true,
    buildPrompt: () => 'Save this project as a ZIP — include every file in the project directory.',
  },
  {
    labelKey: 'share.exportPdf',
    isZip: false,
    buildPrompt: (fileName: string | null) =>
      fileName
        ? `Save this design as a PDF: ${fileName}`
        : 'Save the active design as a PDF.',
  },
  {
    labelKey: 'share.exportPptx',
    isZip: false,
    buildPrompt: (fileName: string | null) =>
      fileName
        ? `Save this design as a PPTX: ${fileName}`
        : 'Save the active design as a PPTX.',
  },
  {
    labelKey: 'share.exportHtml',
    isZip: false,
    buildPrompt: (fileName: string | null) =>
      fileName
        ? `Save this design as a standalone HTML file (all CSS/JS inlined): ${fileName}`
        : 'Save the active design as a standalone HTML file (all CSS/JS inlined).',
  },
] as const

export function ShareMenu({
  projectId,
  activeFileName,
  onOpenProject,
}: {
  projectId: string | null
  activeFileName: string | null
  /** Called with the new project id after a successful duplicate so the
   *  caller can navigate to it. */
  onOpenProject: (newProjectId: string) => void
}) {
  const { t } = useTranslation('workspace')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const createChatTask = useStore(s => s.createChatTask)
  const duplicateProject = useStore(s => s.duplicateProject)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const handleExport = async (buildPrompt: (fileName: string | null) => string) => {
    if (!projectId || busy) return
    setBusy(true)
    setOpen(false)
    try {
      await createChatTask(projectId, buildPrompt(activeFileName))
    } catch (err) {
      console.error('[share] export prompt failed:', err)
    } finally {
      setBusy(false)
    }
  }

  const handleDuplicate = async () => {
    if (!projectId || busy) return
    setBusy(true)
    setOpen(false)
    try {
      const newId = await duplicateProject(projectId)
      onOpenProject(newId)
    } catch (err) {
      console.error('[share] duplicate failed:', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="wsv2-share-menu-wrap">
      <button
        type="button"
        className="wsv2-btn-ghost"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!projectId}
      >
        {t('share.button')}
      </button>
      {open && (
        <div className="wsv2-share-menu" role="menu">
          <div className="wsv2-share-menu-section">
            <button type="button" className="wsv2-share-menu-item" onClick={handleDuplicate} disabled={busy}>
              <ItemIcon kind="duplicate" /> {t('share.duplicateProject')}
            </button>
          </div>
          <div className="wsv2-share-menu-divider" />
          <div className="wsv2-share-menu-section">
            {EXPORT_PROMPTS.map(item => (
              <button
                key={item.labelKey}
                type="button"
                className="wsv2-share-menu-item"
                onClick={() => handleExport(item.buildPrompt)}
                disabled={busy}
              >
                <ItemIcon kind={item.isZip ? 'zip' : 'doc'} />
                {t(item.labelKey as 'share.exportZip')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ItemIcon({ kind }: { kind: 'duplicate' | 'zip' | 'doc' }) {
  if (kind === 'duplicate') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="4" y="2" width="9" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="2.5" y="4" width="9" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="var(--wsv2-body-bg, #faf9f5)" />
      </svg>
    )
  }
  if (kind === 'zip') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 1.5h6l2.5 2.5V14A.5.5 0 0 1 12 14.5H4A.5.5 0 0 1 3.5 14V2A.5.5 0 0 1 4 1.5z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 5v6m0 0-1.5-1.5M8 11l1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.5h6l2.5 2.5V14A.5.5 0 0 1 12 14.5H4A.5.5 0 0 1 3.5 14V2A.5.5 0 0 1 4 1.5z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
