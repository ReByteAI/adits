import { useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store.ts'
import type { ApiTask } from '../api.ts'
import { formatSqliteRelative, isNonTerminalStatus } from '../data.ts'

interface FlatTask extends ApiTask {
  projectId: string
  projectName: string
}

/**
 * Always-visible task overview panel — a flat list of every task across
 * every project, newest first. Reached via the "All tasks" button in the
 * Nav. Each row shows a "detail" link that points at the raw
 * agent-computer URL for the task.
 */
export default function TasksPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('workspace')
  const { t: tchat } = useTranslation('chat')
  const projects = useStore(s => s.projects)
  const tasksByProject = useStore(s => s.tasksByProject)
  const cancelTask = useStore(s => s.cancelTask)
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  // Per-row "cancel in flight" state. Stored locally (not in the store)
  // because it's purely view state — the store already handles the
  // optimistic transition. We use it to disable the button + show a
  // spinner while the API call is in flight.
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set())

  const onCancel = async (taskId: string) => {
    setCancelingIds(prev => new Set(prev).add(taskId))
    try {
      await cancelTask(taskId)
    } catch {
      // store.cancelTask already rolls back the optimistic transition
      // and logs the underlying error; nothing to surface here.
    } finally {
      setCancelingIds(prev => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  const allTasks: FlatTask[] = useMemo(() => {
    const out: FlatTask[] = []
    for (const p of projects) {
      const tasks = tasksByProject[p.id] ?? []
      for (const t of tasks) out.push({ ...t, projectId: p.id, projectName: p.name })
    }
    out.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    return out
  }, [projects, tasksByProject])

  const filtered = useMemo(() => {
    if (!query.trim()) return allTasks
    const q = query.trim().toLowerCase()
    return allTasks.filter(t =>
      (t.title ?? t.prompt).toLowerCase().includes(q) ||
      t.projectName.toLowerCase().includes(q) ||
      t.status.toLowerCase().includes(q),
    )
  }, [allTasks, query])

  // Dismiss on outside click or Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const runningCount = allTasks.filter(t => isNonTerminalStatus(t.status)).length

  return (
    <div className="tasks-panel" ref={ref} role="dialog" aria-label={t('tasks.panelLabel')}>
      <div className="tasks-panel-header">
        <div className="tasks-panel-title">
          {t('tasks.panelTitle')}
          <span className="tasks-panel-count">
            {allTasks.length}
            {runningCount > 0 && ` · ${t('tasks.running', { count: runningCount })}`}
          </span>
        </div>
        <input
          type="search"
          className="tasks-panel-search"
          placeholder={t('tasks.filterPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="tasks-panel-list">
        {filtered.length === 0 && (
          <div className="tasks-panel-empty">
            {allTasks.length === 0 ? t('tasks.empty') : t('tasks.noMatches')}
          </div>
        )}
        {filtered.map(task => {
          const isCancelable = isNonTerminalStatus(task.status)
          const isCanceling = cancelingIds.has(task.id)
          return (
            <div key={task.id} className="tasks-panel-row">
              <span className={`tasks-panel-status tasks-panel-status--${task.status}`}>
                {isNonTerminalStatus(task.status) ? '●' : task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : '○'}
              </span>
              <div className="tasks-panel-body">
                <div className="tasks-panel-prompt">{task.title ?? task.prompt}</div>
                <div className="tasks-panel-meta">
                  <span className="tasks-panel-project">{task.projectName}</span>
                  <span className="tasks-panel-sep">·</span>
                  <span>{tchat(`status.${task.status}` as 'status.completed', { defaultValue: task.status })}</span>
                  {task.created_at && (
                    <>
                      <span className="tasks-panel-sep">·</span>
                      <span title={task.created_at}>{formatSqliteRelative(task.created_at)}</span>
                    </>
                  )}
                  {task.url && (
                    <>
                      <span className="tasks-panel-sep">·</span>
                      <a href={task.url} target="_blank" rel="noopener noreferrer">{t('tasks.detail')}</a>
                    </>
                  )}
                </div>
              </div>
              {isCancelable && (
                <button
                  type="button"
                  className="tasks-panel-cancel"
                  aria-label={t('tasks.cancelTask')}
                  title={t('tasks.cancelTask')}
                  disabled={isCanceling}
                  onClick={() => onCancel(task.id)}
                >
                  {isCanceling ? (
                    <span className="tasks-panel-cancel-spinner" aria-hidden="true" />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
