import { useEffect } from 'react'
import { useCurrentUser } from '../auth-shim.tsx'
import { useStore, useActiveProjectId } from '../store.ts'
import { useLanguageSync } from '../i18n/useLanguageSync.ts'
import WorkspaceV2 from './WorkspaceV2'
import ProjectList from './ProjectList'
import '../../../public/css/workspace-v2.css'

/**
 * V2 app entry. Routes between the project-list home and the two-pane
 * workspace shell based on the URL path:
 *
 *   /projects        → ProjectList (all projects as cards)
 *   /project/<id>    → WorkspaceV2 (chat + bench for that project)
 *
 * Also accepts legacy `?v2=1` and `/app-v2` as v2-mode triggers; those
 * fall back to `/projects` for the project-list view.
 */
function projectIdFromPath(): string {
  const m = window.location.pathname.match(/^\/project\/([^/]+)/)
  return m ? m[1] : ''
}

export default function V2App() {
  const { user } = useCurrentUser()
  const activeProjectId = useActiveProjectId()
  const init = useStore(s => s.init)
  const selectProject = useStore(s => s.selectProject)

  useLanguageSync()

  useEffect(() => {
    if (!user?.primaryEmailAddress?.emailAddress) return
    init({
      email: user.primaryEmailAddress.emailAddress,
      name: user.fullName ?? undefined,
      avatarUrl: user.imageUrl ?? undefined,
    })
  }, [user?.primaryEmailAddress?.emailAddress, init])

  useEffect(() => {
    const id = projectIdFromPath()
    if (id) selectProject(id)
  }, [selectProject])

  useEffect(() => {
    const id = activeProjectId ?? ''
    // First mount: the URL may already point at /project/X but the
    // store is still null because the selectProject effect above
    // hasn't run yet. Don't clobber the URL to /projects in that
    // window — the next render (after activeProjectId resolves) will
    // re-enter this effect and confirm the path is already correct.
    if (!id && projectIdFromPath()) return

    const desired = id ? `/project/${id}` : '/projects'
    if (window.location.pathname !== desired) {
      // Drop the search string on project switch — `?file=` is
      // scoped to a single project's file list and shouldn't leak
      // across (e.g. /project/A?file=foo.html → /project/B).
      window.history.replaceState(null, '', desired)
    }
  }, [activeProjectId])

  useEffect(() => {
    const onPop = () => selectProject(projectIdFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [selectProject])

  // Wake-up reconciliation. SSE drops while the tab is hidden
  // (`fetchEventSource` doesn't survive backgrounding), so anything
  // that finished or changed during that window is invisible until
  // the next user action OR an explicit refetch. We hook
  // `visibilitychange` + `focus`, debounced, and call the store's
  // `refreshOnFocus` (which re-pulls `/all-tasks` for every project
  // and `/files` for the active one). A small debounce keeps paired
  // events — Chrome fires both visibilitychange and focus on a tab
  // switch — from doubling the network work.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        useStore.getState().refreshOnFocus().catch(err =>
          console.warn('[v2app] refreshOnFocus failed:', err))
      }, 100)
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      if (timer) { clearTimeout(timer); timer = null }
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return activeProjectId ? <WorkspaceV2 /> : <ProjectList />
}
