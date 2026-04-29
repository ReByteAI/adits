import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, useActiveProject, useActiveProjectId, useProjectTasks } from '../store.ts'
import { useAuthToken } from '../auth.tsx'
import { queryClient } from '../query-client.ts'
import {
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  useChatWidth,
  useDebugViewEnabled,
  useUiStore,
} from '../ui-store.ts'
import { fetchTaskContent, type ApiTask, type TaskContent } from '../api.ts'
import { formatSqliteRelative, isNonTerminalStatus } from '../data.ts'
import ChatComposer from './ChatComposer.tsx'
import { ExecutorPicker } from './ExecutorPicker.tsx'
import { SkillsModal } from './SkillsModal.tsx'
import { FramesView } from './FramesView.tsx'
import { DEFAULT_EXECUTOR, DEFAULT_MODEL_FOR, type ExecutorType } from '../../../packages/shared/executors'
import { ADITS_LOGO_URL } from '../../../packages/shared/logo'
import { type SkillId } from '../../../packages/shared/skills'
import { useRoundStore } from './round/store.ts'

const RESIZE_HANDLE_CLICK_THRESHOLD = 4

type Tab = 'chat' | 'history'

interface FollowUp {
  tempId: string
  text: string
  /** Server-assigned prompt id, filled in when POST /tasks/:tid/prompts
   *  resolves. The optimistic entry is dropped from the render once a
   *  server prompt with this id appears in /content. */
  serverId?: string
}

function statusGlyph(status: string): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✕'
  if (status === 'canceled') return '—'
  return '●'  // any non-terminal state
}

export default function ChatPanel() {
  const { t } = useTranslation('chat')
  const projectId = useActiveProjectId()
  const tasks = useProjectTasks(projectId)
  const createChatTask = useStore(s => s.createChatTask)
  const sendFollowUp = useStore(s => s.sendFollowUp)
  const setActiveForm = useStore(s => s.setActiveForm)

  const chatWidth = useChatWidth()
  const setChatWidth = useUiStore((s) => s.setChatWidth)
  const resizeHandleRef = useRef<HTMLDivElement>(null)

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth
    let isDragging = false
    resizeHandleRef.current?.classList.add('is-dragging')
    // Shield the bench iframe — once the cursor crosses into it, the
    // iframe captures mouse events and our document-level mousemove /
    // mouseup stop firing, leaving the resize stuck mid-drag. Disabling
    // pointer-events via this body class routes everything back to the
    // host document until mouseup.
    document.body.classList.add('wsv2-resizing-chat')

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX
      if (!isDragging && Math.abs(delta) < RESIZE_HANDLE_CLICK_THRESHOLD) return
      isDragging = true
      setChatWidth(Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, startWidth + delta)))
    }

    function onUp() {
      resizeHandleRef.current?.classList.remove('is-dragging')
      document.body.classList.remove('wsv2-resizing-chat')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [chatWidth, setChatWidth])

  const [tab, setTab] = useState<Tab>('chat')
  const [executor, setExecutor] = useState<ExecutorType>(DEFAULT_EXECUTOR)
  /** Picker state for the Skills & design-systems modal. Multiple skills
   *  may be attached; duplicates are deduped on add. Rendered as chips
   *  inside the composer card; each chip carries its own × to remove.
   *  Downstream wiring (ship on the task payload) lands in a follow-up.
   *  Cleared on project switch. */
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [pickedSkills, setPickedSkills] = useState<SkillId[]>([])

  /** Thread scroll ref + "am I at the bottom?" flag. Owned here rather
   *  than inside ChatView because the scroll-to-bottom pill is rendered
   *  as a sibling of the thread (absolute-positioned inside `.wsv2-chat`
   *  which is `position: relative`) so it floats over the chat regardless
   *  of scroll state. ChatView just receives the ref + onScroll handler. */
  const threadRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAtBottom(distance < 32)
  }, [])
  const scrollToBottom = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }, [])
  /** The task currently rendered in the Chat tab. `null` = new-task state. */
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null)
  /** Per-task, per-session optimistic follow-up prompts. Each entry carries a
   *  client-minted `tempId` for deletion on failure, and (once the POST
   *  resolves) the server-assigned `serverId` used to reconcile against
   *  `/content` prompts — once the server prompt list contains the
   *  `serverId`, the optimistic entry stops rendering. No by-text or
   *  by-position dedup. Cleared when the project changes. */
  const [followUps, setFollowUps] = useState<Record<string, FollowUp[]>>({})
  const [sending, setSending] = useState(false)
  /** Tracks which project we've already auto-loaded the latest task for.
   *  Prevents `+` (which sets loadedTaskId back to null) from immediately
   *  re-populating with tasks[0] — once the user has opted into the
   *  new-task flow for a given project, we respect that until they leave. */
  const autoLoadedForProjectRef = useRef<string | null>(null)

  // Reset chat state when the active project changes — loadedTaskId,
  // session-scoped follow-ups, and the `sending` indicator all belong
  // to one project. An in-flight send from the previous project won't
  // re-enable Send via its finally block (the guard skips setSending
  // when activeProjectId changed), so we clear it here too. Also
  // re-arm the auto-load guard so the fresh project gets its latest
  // task picked.
  useEffect(() => {
    autoLoadedForProjectRef.current = null
    setLoadedTaskId(null)
    setFollowUps({})
    setSending(false)
    setPickedSkills([])
    setSkillsOpen(false)
    // Round buffer is per-project — wipe accumulated chips when the
    // user switches projects.
    useRoundStore.getState().clear()
  }, [projectId])

  // Auto-load the most recent task once per project on first arrival.
  // Subsequent `+` clicks leave `loadedTaskId` at null deliberately.
  useEffect(() => {
    if (!projectId) return
    if (autoLoadedForProjectRef.current === projectId) return
    if (tasks.length === 0) return
    autoLoadedForProjectRef.current = projectId
    setLoadedTaskId(tasks[0].id)
  }, [projectId, tasks])

  const loadedTask = useMemo<ApiTask | null>(() => {
    if (!loadedTaskId) return null
    return tasks.find(t => t.id === loadedTaskId) ?? null
  }, [loadedTaskId, tasks])

  // Full task transcript. Refetched on:
  //   1. loadedTaskId changes — open a task, show its history.
  //   2. handleSend bumps localRefetch after a successful POST so the new
  //      prompt row lands in the UI before its first frame arrives.
  //   3. FramesView's onTerminal callback — when a per-prompt SSE emits
  //      `done`, we refetch /content for the authoritative final transcript.
  // The per-prompt SSE inside FramesView handles streaming live frames; this
  // component only owns history snapshots.
  // Optimistic `tmp-*` ids have no server row yet, so skip those.
  const [content, setContent] = useState<TaskContent | null>(null)
  const [localRefetch, setLocalRefetch] = useState(0)
  const authToken = useAuthToken()
  // Auto-scroll to bottom on new content when the user was already pinned
  // there. Responds to real content growth (fetchTaskContent resolves to a
  // new object) and to optimistic follow-up insertions.
  useEffect(() => {
    if (!atBottom) return
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, followUps, atBottom])
  // When the user switches tasks, reset the pinned-to-bottom flag so the
  // newly opened task always starts at the bottom. Otherwise a prior
  // scrolled-up state would carry over.
  useEffect(() => {
    setAtBottom(true)
  }, [loadedTaskId])
  // Clear stale content only when the loaded task changes. On bumps we keep
  // the last transcript visible until a newer fetch resolves, so transient
  // `/content` failures don't collapse the thread to just `task.prompt`.
  useEffect(() => {
    setContent(null)
  }, [loadedTaskId])
  useEffect(() => {
    if (!loadedTaskId || loadedTaskId.startsWith('tmp-')) return
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchTaskContent(loadedTaskId)
        if (!cancelled) setContent(data)
      } catch (err) {
        if (!cancelled) console.warn('[chat] fetchTaskContent failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [loadedTaskId, localRefetch])

  // Refetch /content + project file list when any FramesView reports its
  // prompt reached terminal status. /content gets the new frames +
  // form_payload + status; loadProjectFiles surfaces any new files the
  // agent created or removed during the turn.
  //
  // Also invalidate the `['file-blob', …]` query cache: server-side file
  // ids are content/path-addressed, so when the agent OVERWRITES an
  // existing file the id stays the same and React Query's
  // `staleTime: Infinity` would otherwise serve the stale blob URL forever.
  // Invalidation forces every mounted FileCard to refetch its blob.
  const loadProjectFiles = useStore(s => s.loadProjectFiles)
  const bumpIframeReloadKey = useStore(s => s.bumpIframeReloadKey)
  const handlePromptTerminal = useCallback(() => {
    setLocalRefetch(n => n + 1)
    if (projectId) {
      void loadProjectFiles(projectId).catch(err =>
        console.warn('[chat] post-terminal file refresh failed:', err))
    }
    void queryClient.invalidateQueries({ queryKey: ['file-blob'] })
    // Force the bench iframe to refetch — agents that overwrite an
    // existing HTML file leave the file id and url unchanged, so the
    // iframe keeps showing the pre-edit content otherwise.
    bumpIframeReloadKey()
  }, [projectId, loadProjectFiles, bumpIframeReloadKey])

  // Publish the latest unanswered `ask-design-questions` payload into the
  // store so the Bench (right pane) can render it as a full-pane takeover.
  // Semantics: the latest prompt in the loaded task carries `formPayload`
  // — earlier form turns are historical and the user has already moved
  // past them by sending a follow-up, which by definition makes this the
  // latest. Clears when the user switches tasks, the task advances past
  // the form, or the component unmounts.
  useEffect(() => {
    if (!loadedTaskId || !content || content.prompts.length === 0) {
      setActiveForm(null)
      return
    }
    const latest = content.prompts[content.prompts.length - 1]
    if (latest?.formPayload) {
      setActiveForm({ taskId: loadedTaskId, promptId: latest.id, payload: latest.formPayload })
    } else {
      setActiveForm(null)
    }
  }, [content, loadedTaskId, setActiveForm])
  useEffect(() => () => setActiveForm(null), [setActiveForm])

  const handleSend = useCallback(async (text: string) => {
    if (!projectId) return
    // Capture projectId + loadedTaskId at send time. If the user switches
    // projects while the API call is in flight, completion handlers read
    // the live activeProjectId from the store to decide whether this send
    // still belongs to the view in front of the user.
    const pid = projectId
    const tidAtSend = loadedTaskId
    setSending(true)
    try {
      const execOpts = { executor, model: DEFAULT_MODEL_FOR[executor], skills: pickedSkills.length ? pickedSkills : undefined }
      if (!tidAtSend) {
        const newId = await createChatTask(pid, text, execOpts)
        if (useStore.getState().activeProjectId === pid) {
          setLoadedTaskId(newId)
        }
      } else {
        // Kick a `/content` refetch on every follow-up so Claude's
        // streamed response appears without waiting for a terminal SSE
        // event. Bumps after the POST resolves (below) via setLocalRefetch.
        // Optimistically echo with a local tempId. When POST resolves we
        // stamp the server-assigned promptId onto the same entry so later
        // /content refreshes can reconcile by id. Rollback on failure uses
        // tempId so duplicate-text sends can't nuke the wrong entry.
        const tempId = `tmp-${crypto.randomUUID()}`
        setFollowUps(prev => ({
          ...prev,
          [tidAtSend]: [...(prev[tidAtSend] ?? []), { tempId, text }],
        }))
        try {
          const serverId = await sendFollowUp(tidAtSend, text, execOpts)
          if (serverId) {
            setFollowUps(prev => {
              const list = prev[tidAtSend] ?? []
              return {
                ...prev,
                [tidAtSend]: list.map(e => e.tempId === tempId ? { ...e, serverId } : e),
              }
            })
          }
          // Trigger a `/content` refetch so the new prompt + Claude's
          // response show up without waiting for the task to terminate.
          if (useStore.getState().activeProjectId === pid) {
            setLocalRefetch(n => n + 1)
          }
        } catch (err) {
          setFollowUps(prev => {
            const list = prev[tidAtSend] ?? []
            return { ...prev, [tidAtSend]: list.filter(e => e.tempId !== tempId) }
          })
          throw err
        }
      }
    } catch (err) {
      console.error('[chat] send failed:', err)
      throw err
    } finally {
      if (useStore.getState().activeProjectId === pid) {
        setSending(false)
      }
    }
  }, [projectId, loadedTaskId, executor, createChatTask, sendFollowUp])

  const handleNewTask = () => {
    autoLoadedForProjectRef.current = projectId ?? null
    setLoadedTaskId(null)
    setTab('chat')
  }

  const handleOpenTask = (id: string) => {
    setLoadedTaskId(id)
    setTab('chat')
  }

  const composerPlaceholder = loadedTaskId
    ? t('composer.placeholderReply')
    : t('composer.placeholderNew')

  return (
    <aside
      className="wsv2-chat"
      style={{ ['--wsv2-chat-w' as any]: `${chatWidth}px` }}
    >
      <TabStrip tab={tab} onTab={setTab} onNewTask={handleNewTask} />
      {tab === 'chat' ? (
        <ChatView
          task={loadedTask}
          content={content}
          pendingFollowUps={loadedTaskId ? (followUps[loadedTaskId] ?? []) : []}
          threadRef={threadRef}
          onScroll={handleThreadScroll}
          onPromptTerminal={handlePromptTerminal}
          authToken={authToken}
        />
      ) : (
        <HistoryView
          tasks={tasks}
          loadedTaskId={loadedTaskId}
          onOpen={handleOpenTask}
        />
      )}
      {tab === 'chat' && !atBottom && loadedTask && (
        <button
          type="button"
          className="wsv2-scroll-to-bottom"
          onClick={scrollToBottom}
          aria-label={t('composer.scrollLatest')}
          title={t('composer.scrollLatest')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {tab === 'chat' && (
        // Key by projectId so the Lexical editor is re-mounted (empty)
        // on project switch. Without this, the old draft stays visible
        // in the new project after the user accepts "Discard unsent
        // prompt?" — the store's promptDirty flag is cleared but the
        // editor contents are not.
        <>
          <div className="wsv2-composer-executor-row">
            <ExecutorPicker value={executor} onChange={setExecutor} disabled={sending} />
            <button
              type="button"
              className="wsv2-composer-skills-btn"
              onClick={() => setSkillsOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={skillsOpen}
              title={t('composer.skillsTitle')}
            >
              <span className="wsv2-composer-skills-btn-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 1.5l1.9 4.2 4.6.45-3.45 3.1.95 4.55L8 11.5l-4 2.3.95-4.55L1.5 6.15l4.6-.45L8 1.5z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {t('composer.skills')}
            </button>
          </div>
          <ChatComposer
            key={projectId ?? 'none'}
            placeholder={composerPlaceholder}
            onSubmit={handleSend}
            disabled={!projectId || sending}
            skills={pickedSkills}
            onRemoveSkill={(id) => setPickedSkills(prev => prev.filter(s => s !== id))}
          />
          <SkillsModal
            open={skillsOpen}
            onClose={() => setSkillsOpen(false)}
            onUse={(skillId) => {
              setPickedSkills(prev => prev.includes(skillId) ? prev : [...prev, skillId])
              setSkillsOpen(false)
            }}
          />
        </>
      )}
      <div
        ref={resizeHandleRef}
        className="wsv2-chat-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('composer.resizeSidebar')}
        onMouseDown={handleResizerMouseDown}
      />
    </aside>
  )
}

function TabStrip({
  tab, onTab, onNewTask,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onNewTask: () => void
}) {
  const { t } = useTranslation('chat')
  const project = useActiveProject()
  const renameProject = useStore(s => s.renameProject)
  const goHome = () => {
    window.history.pushState(null, '', '/projects')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const enterRename = () => {
    if (!project) return
    setDraftName(project.name)
    setRenaming(true)
  }

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

  const commitRename = () => {
    if (!project) { setRenaming(false); return }
    const trimmed = draftName.trim()
    setRenaming(false)
    if (!trimmed || trimmed === project.name) return
    void renameProject(project.id, trimmed)
  }

  const cancelRename = () => setRenaming(false)

  return (
    <div className="wsv2-chat-header">
      <div className="wsv2-chat-title-row">
        <button
          className="wsv2-home-icon"
          aria-label={t('header.projectOverview')}
          type="button"
          onClick={goHome}
        >
          <span className="wsv2-home-icon-mark" aria-hidden="true">
            <img src={ADITS_LOGO_URL} alt="" />
          </span>
        </button>
        {renaming ? (
          <input
            ref={inputRef}
            className="wsv2-chat-project-name is-editing"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
            }}
            maxLength={120}
          />
        ) : (
          <button
            className="wsv2-chat-project-name"
            type="button"
            onClick={enterRename}
            title={t('header.renameProject')}
          >
            {project?.name ?? t('header.fallbackName')}
          </button>
        )}
      </div>
      <div className="wsv2-chat-tabs">
        <button
          type="button"
          className={`wsv2-tab-pill${tab === 'chat' ? ' is-active' : ''}`}
          onClick={() => onTab('chat')}
        >
          {t('header.tabChat')}
        </button>
        <button
          type="button"
          className={`wsv2-tab-pill${tab === 'history' ? ' is-active' : ''}`}
          onClick={() => onTab('history')}
        >
          {t('header.tabHistory')}
        </button>
        <button
          className="wsv2-chat-new"
          type="button"
          aria-label={t('header.newTask')}
          title={t('header.newTask')}
          onClick={onNewTask}
        >
          +
        </button>
      </div>
    </div>
  )
}

function ChatView({
  task, content, pendingFollowUps, threadRef, onScroll, onPromptTerminal, authToken,
}: {
  task: ApiTask | null
  content: TaskContent | null
  pendingFollowUps: FollowUp[]
  threadRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  onPromptTerminal: (status: string) => void
  authToken: string | null
}) {
  const { t } = useTranslation('chat')
  const debugView = useDebugViewEnabled()

  if (!task) {
    return (
      <div ref={threadRef} onScroll={onScroll} className="wsv2-thread">
        <div className="wsv2-chat-empty">{t('thread.emptyChat')}</div>
      </div>
    )
  }
  // Prefer the relay's authoritative transcript. Optimistic follow-ups
  // whose serverId has already landed in `prompts` are hidden — reconcile
  // by id first. Text fallback only fires for entries where the POST
  // response didn't echo a promptId; it avoids double-rendering at the
  // cost of swallowing one optimistic copy of duplicate-text sends until
  // the next /content refresh.
  const prompts = content?.prompts ?? []
  const serverIds = new Set(prompts.map(p => p.id))
  const serverTexts = new Set(prompts.map(p => p.userPrompt))
  const unreconciled = pendingFollowUps.filter(e => {
    if (e.serverId) return !serverIds.has(e.serverId)
    return !serverTexts.has(e.text)
  })
  // The relay's v1 /content already maps `succeeded` → `completed`, but
  // belt-and-braces: treat either as terminal so the task header never
  // shows `succeeded` verbatim if that normalization slips.
  const rawStatus = content?.status ?? task.status
  const status = rawStatus === 'succeeded' ? 'completed' : rawStatus
  // "Working…" tracks the *latest* prompt, not the task aggregate.
  // The relay's deriveTaskStatus reports `running` if any prompt is still
  // pending/running — so a stuck earlier prompt keeps the whole task
  // "running" even after the user's most recent follow-up has already
  // received its reply. What matters to the user is whether *their*
  // send is still in flight: either an optimistic entry that hasn't
  // been confirmed, or a server prompt whose response hasn't landed.
  const latest = prompts[prompts.length - 1]
  const latestRunning = latest
    ? latest.status === 'running' || latest.status === 'pending'
    : isNonTerminalStatus(status)
  const working = unreconciled.length > 0 || latestRunning
  return (
    <div ref={threadRef} onScroll={onScroll} className="wsv2-thread">
      <div className="wsv2-task-header">
        <div className="wsv2-task-title">{task.title || task.prompt}</div>
        <div className="wsv2-task-meta">
          <span>{t(`status.${status}` as 'status.completed', { defaultValue: status })}</span>
          {task.created_at && <span> · {formatSqliteRelative(task.created_at)}</span>}
          {debugView && task.url && (
            <> · <a href={task.url} target="_blank" rel="noopener noreferrer">{t('thread.detail')}</a></>
          )}
        </div>
      </div>
      {prompts.length === 0 ? (
        <div className="wsv2-msg is-user">
          <div className="wsv2-msg-author">{t('thread.you')}</div>
          <div className="wsv2-msg-body" style={{ whiteSpace: 'pre-wrap' }}>{task.prompt}</div>
        </div>
      ) : (
        prompts.map((p, idx) => {
          const isLatest = idx === prompts.length - 1
          const hasForm = p.formPayload != null
          return (
            <div key={p.id}>
              <div className="wsv2-msg is-user">
                <div className="wsv2-msg-author">{t('thread.you')}</div>
                <div className="wsv2-msg-body" style={{ whiteSpace: 'pre-wrap' }}>{p.userPrompt}</div>
              </div>
              <div className="wsv2-msg is-claude">
                <div className="wsv2-msg-author">{t('thread.agent')}</div>
                {hasForm ? (
                  <div className={`wsv2-msg-body wsv2-qf-chat-stub${isLatest ? ' is-active' : ' is-answered'}`}>
                    {isLatest
                      ? t('thread.formActive')
                      : t('thread.formAnswered', { count: p.formPayload!.questions.length })}
                  </div>
                ) : (
                  <FramesView
                    promptId={p.id}
                    initialFrames={p.frames}
                    isRunning={p.status === 'running' || p.status === 'pending'}
                    onTerminal={onPromptTerminal}
                    authToken={authToken}
                  />
                )}
                {p.status === 'failed' && (
                  <div className="wsv2-msg-body wsv2-msg-muted">{t('thread.msgFailed')}</div>
                )}
                {p.status === 'canceled' && (
                  <div className="wsv2-msg-body wsv2-msg-muted">{t('thread.msgCanceled')}</div>
                )}
              </div>
            </div>
          )
        })
      )}
      {unreconciled.map(fu => (
        <div key={fu.tempId} className="wsv2-msg is-user">
          <div className="wsv2-msg-author">{t('thread.you')}</div>
          <div className="wsv2-msg-body" style={{ whiteSpace: 'pre-wrap' }}>{fu.text}</div>
        </div>
      ))}
      {working && (
        <div className="wsv2-status">{t('thread.working')}</div>
      )}
    </div>
  )
}

function HistoryView({
  tasks, loadedTaskId, onOpen,
}: {
  tasks: ApiTask[]
  loadedTaskId: string | null
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('chat')
  if (tasks.length === 0) {
    return (
      <div className="wsv2-thread">
        <div className="wsv2-chat-empty">{t('thread.emptyHistory')}</div>
      </div>
    )
  }
  return (
    <div className="wsv2-history">
      {tasks.map(task => (
        <button
          key={task.id}
          type="button"
          className={`wsv2-history-row${task.id === loadedTaskId ? ' is-active' : ''}`}
          onClick={() => onOpen(task.id)}
        >
          <span className={`wsv2-history-status wsv2-history-status--${task.status}`}>
            {statusGlyph(task.status)}
          </span>
          <span className="wsv2-history-body">
            <span className="wsv2-history-title">{task.title || task.prompt}</span>
            <span className="wsv2-history-meta">
              {t(`status.${task.status}` as 'status.completed', { defaultValue: task.status })}
              {task.created_at && ` · ${formatSqliteRelative(task.created_at)}`}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
