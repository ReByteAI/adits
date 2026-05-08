import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChatPanel from './ChatPanel'
import Bench from './Bench'
import ProjectGate from '../components/ProjectGate'
import { useActiveProjectId } from '../store.ts'

const MOBILE_BREAKPOINT_PX = 860

function getIsMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
}

export default function WorkspaceV2() {
  const { t: tc } = useTranslation('chat')
  const { t: tw } = useTranslation('workspace')
  const id = useActiveProjectId()
  const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport)
  const [mobilePane, setMobilePane] = useState<'files' | 'preview' | 'chat'>(
    () => getIsMobileViewport() ? 'files' : 'preview',
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`)
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches)
      if (!event.matches) setMobilePane('preview')
    }
    media.addEventListener('change', onChange)
    setIsMobileViewport(media.matches)
    if (!media.matches) setMobilePane('preview')
    return () => media.removeEventListener('change', onChange)
  }, [])

  const benchMobileView = isMobileViewport
    ? (mobilePane === 'chat' ? 'preview' : mobilePane)
    : 'preview'

  return (
    <div className="wsv2">
      <div className={`wsv2-pane-slot wsv2-pane-slot--chat${mobilePane === 'chat' ? ' is-active' : ''}`}>
        <ChatPanel />
      </div>
      <div className={`wsv2-pane-slot wsv2-pane-slot--bench${mobilePane !== 'chat' ? ' is-active' : ''}`}>
        {id ? (
          <ProjectGate key={id} projectId={id}>
            <Bench mobileView={benchMobileView} />
          </ProjectGate>
        ) : (
          <Bench mobileView={benchMobileView} />
        )}
      </div>
      <div className="wsv2-mobile-switcher" role="tablist" aria-label={tc('header.projectOverview')}>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'files'}
          className={`wsv2-mobile-switcher-btn${mobilePane === 'files' ? ' is-active' : ''}`}
          onClick={() => setMobilePane('files')}
        >
          {tw('bench.designFiles')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'preview'}
          className={`wsv2-mobile-switcher-btn${mobilePane === 'preview' ? ' is-active' : ''}`}
          onClick={() => setMobilePane('preview')}
        >
          {tw('bench.preview')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'chat'}
          className={`wsv2-mobile-switcher-btn${mobilePane === 'chat' ? ' is-active' : ''}`}
          onClick={() => setMobilePane('chat')}
        >
          {tc('header.tabChat')}
        </button>
      </div>
    </div>
  )
}
