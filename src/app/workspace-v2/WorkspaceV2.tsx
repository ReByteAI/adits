import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChatPanel from './ChatPanel'
import Bench from './Bench'
import ProjectGate from '../components/ProjectGate'
import { useActiveProjectId } from '../store.ts'

export default function WorkspaceV2() {
  const { t: tc } = useTranslation('chat')
  const { t: tw } = useTranslation('workspace')
  const id = useActiveProjectId()
  const [mobilePane, setMobilePane] = useState<'files' | 'preview' | 'chat'>('files')

  return (
    <div className="wsv2">
      <div className={`wsv2-pane-slot wsv2-pane-slot--chat${mobilePane === 'chat' ? ' is-active' : ''}`}>
        <ChatPanel />
      </div>
      <div className={`wsv2-pane-slot wsv2-pane-slot--bench${mobilePane !== 'chat' ? ' is-active' : ''}`}>
        {id ? (
          <ProjectGate key={id} projectId={id}>
            <Bench mobileView={mobilePane === 'chat' ? 'preview' : mobilePane} />
          </ProjectGate>
        ) : (
          <Bench mobileView={mobilePane === 'chat' ? 'preview' : mobilePane} />
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
