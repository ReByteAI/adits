import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store.ts'

/** Projects whose file listing we've successfully fetched in this
 *  session. Lets the gate skip the (second) `loadProjectFiles` call on
 *  A → B → A. Module-level because it needs to survive the gate's
 *  key-forced remounts on project switch.
 *
 *  Reset by `clearLoadedProjects()` whenever the store's `init()`
 *  rebuilds the project list (sign-out/sign-in, account switch).
 *  Without the reset, a re-init would leave entries pointing at fresh
 *  `{ files: [] }` projects and the gate would skip the file fetch,
 *  leaving the right pane permanently empty. */
const loadedProjects = new Set<string>()

/** Clear the loaded-projects cache. Called from `store.init()` so a
 *  re-init (sign-out/sign-in) forces every subsequent gate mount to
 *  re-fetch its files against the freshly loaded project list. */
export function clearLoadedProjects(): void {
  loadedProjects.clear()
}

type Status = 'booting' | 'ready' | 'error'

interface Props {
  projectId: string
  children: ReactNode
}

/** Owns the per-project file-list fetch as a single gate. Children only
 *  render once `loadProjectFiles` has populated the store. A single
 *  Retry button rewinds on failure.
 *
 *  Sandboxes are Lambdas — we never pre-warm the VM. The first file
 *  fetch (this gate's `loadProjectFiles`) lands on the sandbox
 *  gateway, which auto-resumes the VM if paused. There is no keepalive
 *  loop and no `/ensure-sandbox` round-trip; the URL embedded in the
 *  project row (`fileServerRoot`) is a static origin that resumes on
 *  first request the same way.
 *
 *  Sidebar (global navigation) should stay OUTSIDE this gate so the
 *  user can switch projects even when one project's load fails.
 *  Mount with `key={activeProjectId}` so switching projects forces a
 *  fresh fetch. Switching back to an already-loaded project starts in
 *  `'ready'` via `loadedProjects` (no loading flash). */
export default function ProjectGate({ projectId, children }: Props) {
  const { t } = useTranslation('workspace')
  const loadProjectFiles = useStore(s => s.loadProjectFiles)
  const [status, setStatus] = useState<Status>(() =>
    loadedProjects.has(projectId) ? 'ready' : 'booting',
  )
  // Bumped by the Retry button to re-run the boot effect. `projectId`
  // can't serve this role because retry doesn't change the project.
  const [attempt, setAttempt] = useState(0)

  // Run loadProjectFiles once per (projectId, attempt). Skip on revisits
  // unless the user pressed Retry (attempt > 0). The AbortController is
  // cleanup-only: unmounting (or retrying, or switching projects) aborts
  // the in-flight work so stale resolves don't update a doomed gate.
  useEffect(() => {
    if (loadedProjects.has(projectId) && attempt === 0) {
      setStatus('ready')
      return
    }
    setStatus('booting')
    const ctrl = new AbortController()

    ;(async () => {
      try {
        await loadProjectFiles(projectId)
        if (ctrl.signal.aborted) return
        loadedProjects.add(projectId)
        setStatus('ready')
      } catch (err) {
        if (ctrl.signal.aborted) return
        console.warn(`[project-gate] ${projectId} load failed:`, (err as Error).message)
        setStatus('error')
      }
    })()

    return () => ctrl.abort()
  }, [projectId, attempt, loadProjectFiles])

  if (status === 'booting') {
    return (
      <div className="app-grid-loading" role="status" aria-live="polite">
        <p>{t('projectGate.loading')}</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="app-grid-loading" role="alert">
        <p>
          {t('projectGate.error')}{' '}
          <button
            type="button"
            className="app-grid-retry"
            onClick={() => setAttempt(n => n + 1)}
          >
            {t('projectGate.retry')}
          </button>
        </p>
      </div>
    )
  }

  return <>{children}</>
}
