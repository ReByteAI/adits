import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, useActiveProject, useActiveProjectId, useIframeReloadKey } from '../store.ts'
import { ShareMenu } from './ShareMenu.tsx'
import type { FileData } from '../data.ts'
import { isPage } from '../data.ts'
import type { BenchFile } from '../bench/types.ts'
import { fetchFileBlob, fileDownloadUrl } from '../api.ts'
import { getType } from '../file-types'
import ConfirmDialog from '../components/ConfirmDialog.tsx'
import { useEditController } from './edit/EditController.tsx'
import { PropertiesPanel } from './edit/PropertiesPanel.tsx'
import EditPendingBar from './edit/EditPendingBar.tsx'
import { useCommentController } from './comment/CommentController.tsx'
import CommentPopover from './comment/CommentPopover.tsx'
import { useTweaksController } from './tweaks/TweaksController.tsx'
import { useIframeBridge } from './iframe/bridge.ts'
import { usePresentController } from './present/PresentController.ts'
import PresentButton from './present/PresentButton.tsx'
import { useSpeakerNotes } from './present/useSpeakerNotes.ts'
import { useRoundStore } from './round/store.ts'
import NapkinEditor from './napkin/NapkinEditor.tsx'
import { EMPTY_NAPKIN } from './napkin/types.ts'
import { BenchEditorSlotContext } from './bench-editor-slot.ts'
import { QuestionForm } from './QuestionForm.tsx'
import type { AskDesignQuestionsAnswers } from '../../../packages/shared/ask-design-questions'

/** Sentinel id for the always-present Design Files root tab. */
const DESIGN_FILES_TAB = '__design_files__'

/** Napkin sketch files — custom `.napkin` format. Opens in its own
 *  editor tab, not the HTML page viewer. */
function isNapkin(file: FileData): boolean {
  return file.type === 'napkin' || /\.napkin$/i.test(file.name)
}

/** Adapt the V2 store's `FileData` to the V1 `BenchFile` shape that
 *  the registered Editor components expect. The two differ on `src`/
 *  `thumb` optionality: V2 may omit them for not-yet-uploaded rows;
 *  V1 always has strings. We default to the authed download URL so
 *  PDFs / audio / video have something to fetch. */
function toBenchFile(file: FileData): BenchFile {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    src: file.src ?? fileDownloadUrl(file.id),
    thumb: file.thumb ?? '',
  }
}

export default function Bench() {
  const { t } = useTranslation('workspace')
  const project = useActiveProject()
  const projectId = useActiveProjectId()
  const addFile = useStore(s => s.addFile)
  const loadProjectFiles = useStore(s => s.loadProjectFiles)
  const sendFollowUp = useStore(s => s.sendFollowUp)
  const activeForm = useStore(s => s.activeForm)
  const setActiveForm = useStore(s => s.setActiveForm)
  const files = project?.files ?? []
  const [reloading, setReloading] = useState(false)
  const [formBusy, setFormBusy] = useState(false)

  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string>(DESIGN_FILES_TAB)
  // Counter-based drag tracking: dragenter/dragleave fire for every
  // child as the cursor moves. Track depth so the confirm pill /
  // dropzone hover state stay stable until the drag truly leaves.
  const [dragDepth, setDragDepth] = useState(0)
  const isDragOver = dragDepth > 0
  // Filename pulled from `?file=` that we still want to open once the
  // project's file list arrives. Captured on every project switch so a
  // shareable URL like /project/X?file=foo.html restores the right tab.
  // Lazy init from the URL so the URL→state restore wins the first
  // render — otherwise the URL-sync effect below sees pendingFileName
  // null on the initial pass and erases the param before we can read it.
  const [pendingFileName, setPendingFileName] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('file'),
  )

  // Project switch → reset tabs and capture any URL ?file= so the
  // restore effect below can re-open it once `files` loads.
  useEffect(() => {
    setOpenTabs([])
    setActiveTabId(DESIGN_FILES_TAB)
    setPendingFileName(new URLSearchParams(window.location.search).get('file'))
  }, [projectId])

  // Restore the tab named in ?file= once the file list is available.
  // Wait for `files.length > 0` so an in-flight fetch (empty list)
  // doesn't clear the pending name before the lookup can succeed.
  useEffect(() => {
    if (!pendingFileName) return
    if (!files.length) return
    const target = files.find(f => f.name === pendingFileName)
    if (target) {
      setOpenTabs(curr => (curr.includes(target.id) ? curr : [...curr, target.id]))
      setActiveTabId(target.id)
    }
    setPendingFileName(null)
  }, [files, pendingFileName])

  // Mirror activeTabId into the URL as ?file=<name>. Held off while a
  // pending restore is in flight; otherwise we'd race-erase the param
  // before the restore effect could read it.
  useEffect(() => {
    if (pendingFileName) return
    const params = new URLSearchParams(window.location.search)
    if (activeTabId === DESIGN_FILES_TAB) {
      params.delete('file')
    } else {
      const file = files.find(f => f.id === activeTabId)
      if (!file) return
      params.set('file', file.name)
    }
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : '')
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next)
    }
  }, [activeTabId, files, pendingFileName])

  // Browser back/forward (or manual URL edits): re-derive the active
  // tab from whatever ?file= now reads.
  useEffect(() => {
    const onPop = () => {
      const wanted = new URLSearchParams(window.location.search).get('file')
      if (!wanted) {
        setActiveTabId(DESIGN_FILES_TAB)
        return
      }
      const target = files.find(f => f.name === wanted)
      if (target) {
        setOpenTabs(curr => (curr.includes(target.id) ? curr : [...curr, target.id]))
        setActiveTabId(target.id)
      } else {
        setActiveTabId(DESIGN_FILES_TAB)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [files])

  const openFileTab = useCallback((file: FileData) => {
    setOpenTabs(curr => (curr.includes(file.id) ? curr : [...curr, file.id]))
    setActiveTabId(file.id)
  }, [])

  // "New sketch" — create an empty .napkin file and open it as a tab.
  // File name pattern: `sketch-<ISO-timestamp-dashed>-<5-char-random-suffix>.napkin`.
  // Uses store.addFile so it goes through the same upload + state
  // reconciliation path as drop-zone uploads.
  const newSketch = useCallback(async () => {
    if (!projectId) return
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19)
    const suffix = Math.random().toString(36).slice(2, 7)
    const filename = `sketch-${ts}-${suffix}.napkin`
    const file = new File(
      [JSON.stringify(EMPTY_NAPKIN(), null, 2)],
      filename,
      { type: 'application/json' },
    )
    // Sketches live in scraps/.
    await addFile(projectId, file, { folder: 'scraps' })
    // Find the freshly added file in the store and open it.
    const created = useStore.getState().projects
      .find(p => p.id === projectId)?.files
      .find(f => f.name === filename)
    if (created) {
      setOpenTabs(curr => (curr.includes(created.id) ? curr : [...curr, created.id]))
      setActiveTabId(created.id)
    }
  }, [projectId, addFile])

  const onReload = useCallback(async () => {
    if (!projectId || reloading) return
    setReloading(true)
    try {
      await loadProjectFiles(projectId)
    } catch {
      // loadProjectFiles already surfaces errors via project state;
      // swallow here so the spinner always clears.
    } finally {
      setReloading(false)
    }
  }, [projectId, reloading, loadProjectFiles])

  const closeFileTab = useCallback((fileId: string) => {
    setOpenTabs(curr => curr.filter(id => id !== fileId))
    setActiveTabId(curr => (curr === fileId ? DESIGN_FILES_TAB : curr))
  }, [])

  // Reconcile tab state when the underlying file list changes: prune any
  // open tab whose file has been deleted, and fall back to Design Files
  // if the active tab's file is gone.
  const fileIds = useMemo(() => new Set(files.map(f => f.id)), [files])
  useEffect(() => {
    setOpenTabs(curr => curr.filter(id => fileIds.has(id)))
    if (activeTabId !== DESIGN_FILES_TAB && !fileIds.has(activeTabId)) {
      setActiveTabId(DESIGN_FILES_TAB)
    }
  }, [fileIds, activeTabId])

  const activeFile = activeTabId !== DESIGN_FILES_TAB
    ? files.find(f => f.id === activeTabId)
    : null

  /** Portal target in the subbar where non-HTML editors (Image, PDF)
   *  render their mode toolbar — matches the right-side placement of
   *  PageToolbar for HTML. Tracked as state so FileEditorTab re-renders
   *  (and its portal attaches) once the slot mounts. */
  const [editorSlotEl, setEditorSlotEl] = useState<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Shared iframe bridge — owns the postMessage transport, inject-on-
  // load, and the ready handshake. Edit + Comment lanes subscribe to
  // it and each narrow on messages relevant to their mode. The bridge's
  // setIframe callback is threaded into PageViewer so the hook binds
  // the moment the iframe attaches, without dependency-array guessing
  // about when the iframe mounts after its HTML finishes fetching.
  const iframeBridge = useIframeBridge()
  const fileName = activeFile?.name ?? ''
  const editCtrl = useEditController(fileName, iframeBridge)
  const commentCtrl = useCommentController(fileName, iframeBridge)
  // Present depends on a ref to the iframe wrapper (for
  // requestFullscreen) and a ref to the iframe element itself (for
  // focus()). PageViewer hangs both off these refs below.
  const pageContainerRef = useRef<HTMLDivElement | null>(null)
  const iframeElRef = useRef<HTMLIFrameElement | null>(null)
  const speakerNotes = useSpeakerNotes(iframeBridge)
  const speakerNotesRef = useRef(speakerNotes)
  useEffect(() => { speakerNotesRef.current = speakerNotes }, [speakerNotes])
  const getNotesSnapshot = useCallback(() => ({
    notes: speakerNotesRef.current.notes,
    slideIndex: speakerNotesRef.current.slideIndex,
  }), [])
  const presentCtrl = usePresentController(
    iframeBridge, iframeElRef, getNotesSnapshot,
  )
  // Dismissed-state key: the file's UUID. Globally unique, stable
  // across rename, and unaffected by filename collisions in the same
  // project (which store.ts:372-388 tolerates during optimistic
  // upload reconciliation). Prior iteration used projectId:fileName
  // which collides in that window.
  const tweaksCtrl = useTweaksController(activeFile?.id ?? null)

  // One callback-ref threaded through PageViewer. Bridge owns the
  // picker plumbing (click interceptor, inject, ready handshake);
  // Tweaks uses its own raw postMessage channel (top-level messages,
  // no envelope) but still needs the iframe element to post into.
  //
  // Deps are the individual setter functions, not the controller
  // objects — the controllers' objects re-memo on any state change,
  // and an unstable callback-ref would detach/re-attach the iframe
  // (firing spurious onDetach into Edit/Comment subscribers) on
  // every Tweaks state flip. The setters themselves are useCallback
  // with empty deps, so this callback stays identity-stable.
  const bridgeSetIframe = iframeBridge.setIframe
  const tweaksSetIframe = tweaksCtrl.setIframe
  const onIframeEl = useCallback((el: HTMLIFrameElement | null) => {
    bridgeSetIframe(el)
    tweaksSetIframe(el)
    iframeElRef.current = el
  }, [bridgeSetIframe, tweaksSetIframe])

  // "Save tweaks" → emit a round-buffer node using the controller's
  // accumulated pendingEdits, then clear that cache. Bench is the
  // composition point because it knows the human-readable filename
  // (the controller only holds fileId for its localStorage key).
  const pendingTweakCount = Object.keys(tweaksCtrl.pendingEdits).length
  const onSaveTweaks = useCallback(() => {
    if (!activeFile || pendingTweakCount === 0) return
    const n = pendingTweakCount
    const id = useRoundStore.getState().add({
      v: 1,
      source: 'tweak',
      ref: { fileName: activeFile.name },
      text: `Save ${n} ${n === 1 ? 'value' : 'values'} in ${activeFile.name}`,
      data: { edits: tweaksCtrl.pendingEdits },
    })
    // Keep pendingEdits on validation failure so the user can retry
    // (or so we can debug what went wrong without losing values).
    if (id !== null) tweaksCtrl.clearPending()
  }, [activeFile, tweaksCtrl, pendingTweakCount])

  // Mutual exclusion: entering one lane exits the other.
  const onEditToggle = useCallback(() => {
    if (editCtrl.mode === 'off') {
      if (commentCtrl.mode !== 'off') commentCtrl.exit()
      editCtrl.enter()
    } else {
      editCtrl.exit()
    }
  }, [editCtrl, commentCtrl])
  const onCommentToggle = useCallback(() => {
    if (commentCtrl.mode === 'off') {
      if (editCtrl.mode !== 'off') editCtrl.exit()
      commentCtrl.enter()
    } else {
      commentCtrl.exit()
    }
  }, [editCtrl, commentCtrl])

  // Present handlers — exit active editing lane, then kick the
  // controller. Fullscreen must call requestFullscreen() inside the
  // same user-gesture handler so Safari doesn't reject it; inline
  // rather than hiding inside the controller.
  const exitActiveLaneBeforePresent = useCallback(() => {
    if (editCtrl.mode !== 'off') editCtrl.exit()
    if (commentCtrl.mode !== 'off') commentCtrl.exit()
  }, [editCtrl, commentCtrl])
  const onPresentTab = useCallback(() => {
    exitActiveLaneBeforePresent()
    presentCtrl.enter('tab', speakerNotes.hasNotes)
  }, [exitActiveLaneBeforePresent, presentCtrl, speakerNotes.hasNotes])
  const onPresentFullscreen = useCallback(() => {
    exitActiveLaneBeforePresent()
    presentCtrl.enter('fullscreen', speakerNotes.hasNotes)
    // requestFullscreen must be called synchronously in the user-
    // gesture handler. If it rejects (browser policy, unsupported,
    // user-denied), unwind to 'off' so we don't sit in a partial
    // "fullscreen state, but no fullscreen" mode.
    const req = pageContainerRef.current?.requestFullscreen?.()
    if (req) {
      req.catch(() => { presentCtrl.exit() })
    } else {
      // No Fullscreen API available; unwind so the user isn't stuck
      // with hidden bench chrome and nothing fullscreened.
      presentCtrl.exit()
    }
  }, [exitActiveLaneBeforePresent, presentCtrl, speakerNotes.hasNotes])
  const onPresentNewTab = useCallback(() => {
    if (!activeFile || !project?.fileServerRoot) return
    const url = `${project.fileServerRoot}/${encodeURI(activeFile.name)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [activeFile, project?.fileServerRoot])

  const presentMode = presentCtrl.mode

  // ⌘\ / Ctrl+\ toggles tab mode from any host-side focus (outside the
  // iframe — the inject script handles it inside). Only wired when a
  // page is active and we're not already presenting.
  useEffect(() => {
    if (!activeFile || !isPage(activeFile)) return
    if (presentMode !== 'off') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        const a = document.activeElement as HTMLElement | null
        if (a) {
          const t = a.tagName
          if (t === 'INPUT' || t === 'TEXTAREA' || a.isContentEditable) return
        }
        e.preventDefault()
        onPresentTab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFile, presentMode, onPresentTab])

  const uploadFiles = useCallback(async (incoming: File[]) => {
    if (!projectId) return
    for (const file of incoming) await addFile(projectId, file)
  }, [projectId, addFile])

  // Drop zone: upload into the project; store.addFile handles the SDK path.
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragDepth(0)
    await uploadFiles(Array.from(e.dataTransfer.files))
  }, [uploadFiles])

  const onFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await uploadFiles(files)
  }, [uploadFiles])

  // Clipboard paste → upload like a drop. Honours images (screenshots)
  // and any File items the OS/app put on the clipboard.
  const onPaste = useCallback(async () => {
    if (!projectId) return
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const t of item.types) {
          if (!t.startsWith('image/') && !t.startsWith('application/')) continue
          const blob = await item.getType(t)
          const ext = t.split('/')[1]?.split('+')[0] ?? 'bin'
          const name = `paste-${Date.now()}.${ext}`
          await addFile(projectId, new File([blob], name, { type: t }))
        }
      }
    } catch {
      // Browser blocked clipboard or user denied permission — silently ignore.
    }
  }, [projectId, addFile])

  // Bench takeover for `ask-design-questions`: when the latest terminal
  // prompt of the loaded task has a form payload, the right pane becomes
  // a full-pane form renderer. ChatPanel publishes `activeForm`;
  // submitting clears it and enqueues the answers as the next user turn
  // via the existing `sendFollowUp` path.
  if (activeForm) {
    const handleSubmit = async (
      answers: AskDesignQuestionsAnswers,
      attachments: Map<string, File>,
    ) => {
      if (attachments.size > 0) {
        console.warn(
          '[bench] question-form attachments dropped (v1, upload TBD):',
          Array.from(attachments.keys()),
        )
      }
      setFormBusy(true)
      try {
        await sendFollowUp(activeForm.taskId, JSON.stringify(answers, null, 2))
        setActiveForm(null)
      } catch (err) {
        console.error('[bench] form submit failed:', err)
      } finally {
        setFormBusy(false)
      }
    }
    return (
      <section className="wsv2-bench wsv2-bench--form-takeover">
        <div className="wsv2-bench-body wsv2-bench-body--form">
          <QuestionForm
            payload={activeForm.payload}
            onSubmit={handleSubmit}
            busy={formBusy}
          />
        </div>
      </section>
    )
  }

  return (
    <section
      className={`wsv2-bench${isDragOver ? ' is-dragging' : ''}`}
      data-presenting={presentMode !== 'off' ? presentMode : undefined}
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) setDragDepth(d => d + 1) }}
      onDragLeave={() => setDragDepth(d => Math.max(0, d - 1))}
    >
      <div className="wsv2-bench-tabs">
        <div className="wsv2-bench-tabs-scroll">
          <TabPill
            title={t('bench.designFiles')}
            active={activeTabId === DESIGN_FILES_TAB}
            onClick={() => setActiveTabId(DESIGN_FILES_TAB)}
          />
          {openTabs.map(id => {
            const file = files.find(f => f.id === id)
            if (!file) return null
            return (
              <TabPill
                key={id}
                title={file.name}
                active={activeTabId === id}
                onClick={() => setActiveTabId(id)}
                onClose={() => closeFileTab(id)}
              />
            )
          })}
        </div>
        <div className="wsv2-bench-actions">
          <button className="wsv2-avatar" type="button" aria-label={t('bench.account')}>C</button>
          <ShareMenu
            projectId={projectId ?? null}
            activeFileName={activeFile?.name ?? null}
            onOpenProject={(id) => {
              useStore.getState().selectProject(id)
              window.history.pushState(null, '', `/project/${id}`)
            }}
          />
        </div>
      </div>

      <div className="wsv2-bench-subbar">
        <button
          className="wsv2-nav-btn"
          type="button"
          aria-label={t('bench.back')}
          onClick={() => setActiveTabId(DESIGN_FILES_TAB)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className={`wsv2-nav-btn${reloading ? ' is-spinning' : ''}`}
          type="button"
          aria-label={t('bench.reload')}
          aria-busy={reloading || undefined}
          disabled={reloading || !projectId}
          onClick={onReload}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M13 3v3.5H9.5M3 13v-3.5H6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.5 9.5A5 5 0 0 1 4 11M3.5 6.5A5 5 0 0 1 12 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button className="wsv2-breadcrumb" type="button">
          {project?.name ?? t('bench.fallbackBreadcrumb')}
          {activeFile && (
            <>
              <span className="wsv2-breadcrumb-sep" aria-hidden="true">/</span>
              {activeFile.name}
            </>
          )}
        </button>
        {activeTabId === DESIGN_FILES_TAB && (
          <div className="wsv2-subbar-actions">
            <button type="button" className="wsv2-btn-ghost wsv2-subbar-action" onClick={newSketch}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10.5 3.5 6 8a2.5 2.5 0 0 0 3.5 3.5L14 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M11.5 6.5 7.2 10.8a1 1 0 0 0 1.4 1.4L13 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              New sketch
            </button>
            <button type="button" className="wsv2-btn-ghost wsv2-subbar-action" onClick={onPaste}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="3.5" y="3.5" width="9" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
                <rect x="6" y="2" width="4" height="2.5" rx="0.6" fill="currentColor" opacity="0.25" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              Paste
            </button>
          </div>
        )}
        {activeFile && isPage(activeFile) && (
          <PageToolbar
            editActive={editCtrl.mode !== 'off'}
            onEditToggle={onEditToggle}
            commentActive={commentCtrl.mode !== 'off'}
            onCommentToggle={onCommentToggle}
            tweaksAvailable={tweaksCtrl.available}
            tweaksActive={tweaksCtrl.active}
            onTweaksToggle={tweaksCtrl.toggle}
            pendingTweakCount={pendingTweakCount}
            onSaveTweaks={onSaveTweaks}
            presentHasNotes={speakerNotes.hasNotes}
            onPresentTab={onPresentTab}
            onPresentFullscreen={onPresentFullscreen}
            onPresentNewTab={onPresentNewTab}
          />
        )}
        {/* Right-side toolbar slot for non-HTML, non-napkin editors.
          * Rendered empty until the active editor portals its mode
          * buttons into it — matches PageToolbar's placement so the
          * chrome stays consistent across file types. */}
        {activeFile && !isPage(activeFile) && !isNapkin(activeFile) && (
          <div
            className="wsv2-page-toolbar wsv2-editor-toolbar-slot"
            ref={setEditorSlotEl}
          />
        )}
      </div>

      <div className="wsv2-bench-body">
        {activeTabId === DESIGN_FILES_TAB ? (
          <DesignFilesTab files={files} onOpen={openFileTab} />
        ) : activeFile && isNapkin(activeFile) ? (
          <NapkinEditor key={activeFile.id} file={activeFile} />
        ) : activeFile && isPage(activeFile) ? (
          <div
            className={`wsv2-page-body${commentCtrl.mode === 'placement' ? ' is-comment-placement' : ''}`}
          >
            <PageViewer
              key={activeFile.id}
              file={activeFile}
              fileServerRoot={project!.fileServerRoot!}
              iframeRef={onIframeEl}
              containerRef={pageContainerRef}
            />
            {editCtrl.mode === 'editing' && editCtrl.selection && (
              <PropertiesPanel
                selection={editCtrl.selection}
                onApply={editCtrl.applyStyle}
              />
            )}
            {editCtrl.mode === 'picking' && (
              <aside className="wsv2-props">
                <div className="wsv2-props-note">{t('bench.clickToEdit')}</div>
              </aside>
            )}
            {editCtrl.mode !== 'off' && (
              <EditPendingBar edits={editCtrl.pendingEdits} onSend={editCtrl.commit} />
            )}
            {commentCtrl.mode === 'placement' && (
              // Non-flex hint so iframe width stays stable across
              // placement → pinned: the popover anchor captured at
              // click time would otherwise drift with the layout.
              <div className="wsv2-comment-hint" data-dm-overlay="">
                {t('bench.clickToComment')}
              </div>
            )}
            {commentCtrl.mode === 'pinned' && commentCtrl.pin?.popoverAnchor && (
              <CommentPopover
                anchor={commentCtrl.pin.popoverAnchor}
                onSend={commentCtrl.sendToClaude}
                onCancel={commentCtrl.exit}
              />
            )}
          </div>
        ) : activeFile ? (
          // key on file.id so switching between two tabs of the same
          // type (e.g. two .docx) remounts the editor and resets any
          // editor-internal useState/useRef. Matches how PageViewer
          // and NapkinEditor above are keyed. Slot context lets the
          // editor's mode toolbar render into the subbar above.
          <BenchEditorSlotContext.Provider value={editorSlotEl}>
            <FileEditorTab key={activeFile.id} file={activeFile} onClose={() => closeFileTab(activeFile.id)} />
          </BenchEditorSlotContext.Provider>
        ) : (
          <div className="wsv2-editor-placeholder">{t('bench.fileNotFound')}</div>
        )}
      </div>

      <div className={`wsv2-dropzone${isDragOver ? ' is-active' : ''}`}>
        <button
          type="button"
          className="wsv2-dropzone-icon"
          aria-label={t('bench.dropFilesTitle')}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 13V3m0 0L6 7m4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 13v2.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <div className="wsv2-dropzone-title">{t('bench.dropFilesTitle')}</div>
        <div className="wsv2-dropzone-sub">{t('bench.dropFilesSub')}</div>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          onChange={onFileInputChange}
        />
      </div>

      {isDragOver && (
        <div className="wsv2-confirm-pill" role="status" aria-live="polite">
          <button
            type="button"
            className="wsv2-confirm-pill-btn"
            aria-label={t('bench.back')}
            onClick={() => setDragDepth(0)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <span className="wsv2-confirm-pill-dots" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <button
            type="button"
            className="wsv2-confirm-pill-btn wsv2-confirm-pill-confirm"
            aria-label={t('bench.designFiles')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="m3 6.5 2.2 2.2L9.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </section>
  )
}

/** Per-page toolbar.
 *  All ghost — Send (in the chat composer) is the only pink CTA on
 *  the workspace so the file can stay the hero:
 *    [Tweaks · Comment]  |  [Edit · Draw]  |  [Present]
 *  Edit's pressed state uses the ghost-active treatment (rose tint on
 *  cream). */
function PageToolbar({
  editActive, onEditToggle,
  commentActive, onCommentToggle,
  tweaksAvailable, tweaksActive, onTweaksToggle,
  pendingTweakCount, onSaveTweaks,
  presentHasNotes, onPresentTab, onPresentFullscreen, onPresentNewTab,
}: {
  editActive: boolean
  onEditToggle: () => void
  commentActive: boolean
  onCommentToggle: () => void
  tweaksAvailable: boolean
  tweaksActive: boolean
  onTweaksToggle: () => void
  pendingTweakCount: number
  onSaveTweaks: () => void
  presentHasNotes: boolean
  onPresentTab: () => void
  onPresentFullscreen: () => void
  onPresentNewTab: () => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <div className="wsv2-page-toolbar">
      <button
        className={`wsv2-btn-ghost${tweaksActive ? ' is-active' : ''}`}
        type="button"
        onClick={onTweaksToggle}
        disabled={!tweaksAvailable}
        aria-pressed={tweaksActive}
        title={tweaksAvailable ? t('bench.tweaksToggle') : t('bench.tweaksUnavailable')}
      >
        {t('bench.tweaks')}
      </button>
      {pendingTweakCount > 0 && (
        <button
          className="wsv2-btn-ghost wsv2-tweaks-save"
          type="button"
          onClick={onSaveTweaks}
          title={t('bench.saveTweaksTitle')}
        >
          {t('bench.savePending', { count: pendingTweakCount })}
        </button>
      )}
      <button
        className={`wsv2-btn-ghost${commentActive ? ' is-active' : ''}`}
        type="button"
        onClick={onCommentToggle}
        aria-pressed={commentActive}
      >
        {t('bench.comment')}
      </button>
      <span className="wsv2-toolbar-sep" aria-hidden="true" />
      <button
        className={`wsv2-btn-ghost${editActive ? ' is-active' : ''}`}
        type="button"
        onClick={onEditToggle}
        aria-pressed={editActive}
      >
        {t('bench.edit')}
      </button>
      <button className="wsv2-btn-ghost" type="button">{t('bench.draw')}</button>
      <span className="wsv2-toolbar-sep" aria-hidden="true" />
      <PresentButton
        hasNotes={presentHasNotes}
        onTab={onPresentTab}
        onFullscreen={onPresentFullscreen}
        onNewTab={onPresentNewTab}
      />
    </div>
  )
}

/** Generic non-page, non-napkin tab body: looks the file up in the
 *  file-type registry and mounts the registered Editor (image, pdf,
 *  audio, video, document, spreadsheet, presentation, link, archive,
 *  fallback). The crop / marker / segment buttons inside each editor
 *  appear functional but their outputs are dropped on the floor for
 *  now — composer wiring is deferred. The console warnings exist so
 *  that path doesn't fail silently while the wiring lands. */
function FileEditorTab({ file, onClose }: { file: FileData; onClose: () => void }) {
  const { t } = useTranslation('workspace')
  const benchFile = useMemo(() => toBenchFile(file), [file])
  const { Editor } = getType(file.type)
  return (
    <Suspense fallback={<div className="wsv2-editor-placeholder">{t('bench.loading')}</div>}>
      <Editor
        file={benchFile}
        onClose={onClose}
        onOutput={(f) => console.warn('[bench] editor output discarded — composer wiring TODO', f)}
        onSegment={(s) => console.warn('[bench] editor segment discarded — composer wiring TODO', s)}
      />
    </Suspense>
  )
}

function TabPill({
  title, active, onClick, onClose,
}: {
  title: string
  active: boolean
  onClick: () => void
  onClose?: () => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`wsv2-bench-tab${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {title}
      {onClose && (
        <button
          type="button"
          className="wsv2-bench-tab-close"
          aria-label={t('bench.closeTab', { name: title })}
          onClick={e => { e.stopPropagation(); onClose() }}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** Visual section for a file row — drives icon tint via CSS modifier
 *  class. HTML pages = salmon, scripts = cream, napkins / scrap files
 *  = rose, rest use the registry icon on a neutral background.
 *
 *  Drives icon tint only; section *bucketing* is done by `role` in
 *  `DesignFilesTab` so `scraps/` / `uploads/` / `screenshots/` sit under
 *  their folders, not in a flat list. */
function rowSection(f: FileData): 'page' | 'sketch' | 'script' | 'file' {
  if (f.role === 'page') return 'page'
  if (f.role === 'sketch' || isNapkin(f)) return 'sketch'
  if (f.role === 'script' || isScript(f)) return 'script'
  return 'file'
}

function FileRowIcon({ variant }: { variant: 'page' | 'sketch' | 'script' | 'file' | 'folder' }) {
  // Document body stroked; folded corner. Fill tint is driven by the
  // parent class so selection states can invert cleanly.
  if (variant === 'folder') {
    return (
      <svg className="wsv2-fb-icon" width="24" height="28" viewBox="0 0 24 28" fill="none" aria-hidden="true">
        <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
      </svg>
    )
  }
  return (
    <svg className="wsv2-fb-icon" width="24" height="28" viewBox="0 0 24 28" fill="none" aria-hidden="true">
      <path d="M5 4a2 2 0 0 1 2-2h8l5 5v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4Z" />
      <path d="M15 2v4a1 1 0 0 0 1 1h4" className="wsv2-fb-icon-fold" />
    </svg>
  )
}

/** Group files by their first path segment. Uses the authoritative
 *  `path` from the API response (project-relative, e.g. `scraps/foo.napkin`).
 *  Reserved folders like `scraps/`, `uploads/`, `screenshots/` surface
 *  here naturally — nothing about them is special in the grouping itself;
 *  they're just the folders that happen to have the well-known names. */
function collectFolders(files: FileData[]): Array<{ name: string; children: FileData[] }> {
  const map = new Map<string, FileData[]>()
  for (const f of files) {
    if (!f.path) continue
    const slash = f.path.indexOf('/')
    if (slash <= 0) continue
    const folder = f.path.slice(0, slash)
    const items = map.get(folder) ?? []
    items.push(f)
    map.set(folder, items)
  }
  return [...map.entries()].map(([name, children]) => ({ name, children }))
}

function DesignFilesTab({
  files, onOpen,
}: {
  files: FileData[]
  onOpen: (file: FileData) => void
}) {
  const { t } = useTranslation('workspace')
  const folders = useMemo(() => collectFolders(files), [files])
  // Flat file list: exclude files that belong to a subfolder so they
  // don't show twice (once nested, once in the flat section). Links
  // (no `path`) stay in the flat list.
  const topLevelFiles = useMemo(
    () => files.filter(f => !f.path || !f.path.includes('/')),
    [files],
  )
  const sections = useMemo(() => {
    // Sections at root: Pages (HTML at root), Scripts (.js at root),
    // Files (everything else at root including links). Sketches /
    // uploads / screenshots aren't flat sections — their files live
    // inside their respective folders and surface via `folders` above.
    const pages: FileData[] = []
    const scripts: FileData[] = []
    const other: FileData[] = []
    for (const f of topLevelFiles) {
      if (f.role === 'page') pages.push(f)
      else if (f.role === 'script') scripts.push(f)
      else other.push(f)
    }
    const out: Array<[string, FileData[]]> = []
    if (pages.length) out.push(['pages', pages])
    if (scripts.length) out.push(['scripts', scripts])
    if (other.length) out.push(['files', other])
    return out
  }, [topLevelFiles])

  const first = files[0]?.id ?? ''
  const [selectedId, setSelectedId] = useState<string>(first)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<FileData | null>(null)
  const activeProjectId = useActiveProjectId()
  const removeFile = useStore(s => s.removeFile)

  // Keep selection valid as files arrive / change.
  useEffect(() => {
    if (!files.length) { setSelectedId(''); return }
    if (!files.some(f => f.id === selectedId)) setSelectedId(files[0].id)
  }, [files, selectedId])

  const selected = files.find(f => f.id === selectedId) ?? null

  if (!files.length) {
    return <div className="wsv2-editor-placeholder">{t('bench.empty')}</div>
  }

  const toggleFolder = (name: string) => {
    setExpandedFolders(curr => {
      const next = new Set(curr)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const renderRow = (f: FileData, section: 'page' | 'sketch' | 'script' | 'file', indent = 0) => (
    <FileRow
      key={f.id}
      file={f}
      section={section}
      indent={indent}
      isActive={f.id === selectedId}
      onSelect={() => setSelectedId(f.id)}
      onOpen={() => onOpen(f)}
      onDelete={() => setPendingDelete(f)}
    />
  )

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !activeProjectId) return
    const target = pendingDelete
    setPendingDelete(null)
    try {
      await removeFile(activeProjectId, target.id)
    } catch (err) {
      console.error('[design-files] delete failed:', err)
    }
  }

  return (
    <div className="wsv2-filebrowser">
      <div className="wsv2-filebrowser-list">
        {folders.length > 0 && (
          <div>
            <div className="wsv2-fb-section">{t('bench.section.folders')}</div>
            {folders.map(folder => {
              const open = expandedFolders.has(folder.name)
              return (
                <div key={folder.name}>
                  <div className={`wsv2-fb-row wsv2-fb-row--folder${open ? ' is-expanded' : ''}`}>
                    <button
                      type="button"
                      className="wsv2-fb-chevron"
                      aria-label={open ? t('bench.collapseFolder') : t('bench.expandFolder')}
                      aria-expanded={open}
                      onClick={() => toggleFolder(folder.name)}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="m3.5 2 3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <FileRowIcon variant="folder" />
                    <div className="wsv2-fb-text">
                      <div className="wsv2-fb-name">{folder.name}</div>
                      <div className="wsv2-fb-meta">{t('bench.folder')}</div>
                    </div>
                    <button
                      type="button"
                      className="wsv2-fb-trailing"
                      aria-label={t('bench.collapseFolder')}
                      onClick={() => toggleFolder(folder.name)}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  {open && folder.children.map(child => renderRow(child, rowSection(child), 1))}
                </div>
              )
            })}
          </div>
        )}
        {sections.map(([section, items]) => (
          <div key={section}>
            <div className="wsv2-fb-section">{t(`bench.section.${section}` as 'bench.section.files')}</div>
            {items.map(f => renderRow(f, rowSection(f)))}
          </div>
        ))}
      </div>
      <DetailPanel selected={selected} onOpen={onOpen} />
      {pendingDelete && (
        <ConfirmDialog
          title={t('bench.deleteTitle')}
          message={t('bench.deleteMessage', { name: pendingDelete.name })}
          confirmLabel={t('bench.delete')}
          confirmDanger
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

/** Single file row: clickable main area for selection/open, plus a
 *  hover-revealed overflow menu with Download and Delete. Download goes
 *  through the authed `/files/:id/download` endpoint (which dispatches to
 *  the active `FileStore`, so Rebyte and local both work without a
 *  separate client path). */
function FileRow({
  file, section, indent, isActive, onSelect, onOpen, onDelete,
}: {
  file: FileData
  section: 'page' | 'sketch' | 'script' | 'file'
  indent: number
  isActive: boolean
  onSelect: () => void
  onOpen: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('workspace')
  const [menuOpen, setMenuOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const handleDownload = async () => {
    setMenuOpen(false)
    if (downloading) return
    setDownloading(true)
    try {
      const blob = await fetchFileBlob(file.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[design-files] download failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className={`wsv2-fb-row wsv2-fb-row--${section}${isActive ? ' is-active' : ''}${menuOpen ? ' is-menu-open' : ''}`}
      style={indent ? { paddingLeft: 14 + indent * 18 } : undefined}
      onClick={onSelect}
      onDoubleClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onOpen() }
        else if (e.key === ' ') { e.preventDefault(); onSelect() }
      }}
    >
      <FileRowIcon variant={section} />
      <div className="wsv2-fb-text">
        <div className="wsv2-fb-name">{file.name}</div>
        <div className="wsv2-fb-meta">{getType(file.type).label ?? file.type}</div>
      </div>
      <div className="wsv2-fb-date">{file.date}</div>
      <div className="wsv2-fb-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="wsv2-fb-menu-btn"
          aria-label={t('bench.fileOptions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
          </svg>
        </button>
        {menuOpen && (
          <div className="wsv2-fb-menu" role="menu" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              role="menuitem"
              className="wsv2-fb-menu-item"
              disabled={downloading}
              onClick={handleDownload}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 2v8m0 0-3-3m3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {t('bench.download')}
            </button>
            <div className="wsv2-fb-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="wsv2-fb-menu-item wsv2-fb-menu-item--danger"
              onClick={() => { setMenuOpen(false); onDelete() }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9h5L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('bench.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailPanel({
  selected, onOpen,
}: {
  selected: FileData | null
  onOpen: (file: FileData) => void
}) {
  const { t } = useTranslation('workspace')
  const project = useActiveProject()
  const label = selected ? (getType(selected.type).label ?? selected.type) : ''
  const ext = selected?.name.split('.').pop()?.toUpperCase() ?? ''
  return (
    <div className="wsv2-filebrowser-detail">
      <div className="wsv2-detail-preview">
        {selected && (
          <Suspense fallback={null}>
            {(() => {
              const Thumb = getType(selected.type).Thumbnail
              return <Thumb file={{
                name: selected.name,
                src: selected.src,
                thumb: selected.thumb,
                fileServerRoot: project?.fileServerRoot ?? null,
              }} />
            })()}
          </Suspense>
        )}
      </div>
      <button
        className="wsv2-detail-open"
        type="button"
        disabled={selected == null}
        onClick={() => { if (selected) onOpen(selected) }}
      >
        <span>{t('bench.open')}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M9 3h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M11 10v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <div className="wsv2-detail-text">
        <div className="wsv2-detail-name">{selected?.name ?? '—'}</div>
        <div className="wsv2-detail-type">{label}</div>
        <div className="wsv2-detail-meta">
          {selected ? t('bench.modifiedMeta', { date: selected.date, size: selected.size, ext }) : ''}
        </div>
      </div>
    </div>
  )
}

function isScript(file: FileData): boolean {
  return /\.(m|c)?jsx?$|\.tsx?$/i.test(file.name)
}

/** HTML page viewer — just an iframe whose `src` is the file-server
 *  URL for this file. The file-server splices a
 *  `<script src="/_adits/inject.js" defer>` into the HTML response,
 *  so the Edit / Comment / Present bridge is in place before the
 *  iframe parses the page. No other transformation happens on our
 *  side — the browser renders the HTML the same way it would in a
 *  standalone tab.
 *
 *  Sandbox deliberately lacks `allow-same-origin` — the iframe runs
 *  at a different origin from the host (Rebyte subdomain vs. the
 *  Adits app origin), and postMessage through `window.parent` handles
 *  all host↔iframe communication. */
function PageViewer({
  file, fileServerRoot, iframeRef, containerRef,
}: {
  file: FileData
  /** Guaranteed non-null by GET /projects: the server synthesizes the
   *  origin from `sandbox_config` and ships it on every row. Typed as
   *  string rather than `string | null` to reflect the invariant. */
  fileServerRoot: string
  iframeRef: (el: HTMLIFrameElement | null) => void
  containerRef?: React.RefObject<HTMLDivElement | null>
}) {
  // Append a `?v=<reloadKey>` cache-buster so the iframe re-fetches
  // whenever a chat task finishes — file IDs are path-addressed, so an
  // agent that overwrites the open file produces no `src` change of
  // its own and the browser keeps the pre-edit DOM otherwise.
  const reloadKey = useIframeReloadKey()
  const src = `${fileServerRoot}/${encodeURI(file.name)}?v=${reloadKey}`
  return (
    <div
      className="wsv2-page-scroll"
      ref={containerRef}
      style={{ flex: 1, minWidth: 0, height: '100%' }}
    >
      <iframe
        ref={iframeRef}
        style={{
          width: '100%',
          height: '100%',
          border: 0,
          background: '#fff',
          display: 'block',
        }}
        src={src}
        sandbox="allow-scripts allow-forms allow-popups"
        allow="fullscreen"
        title={file.name}
      />
    </div>
  )
}
