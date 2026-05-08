import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChatPanel from './ChatPanel'
import Bench from './Bench'
import ProjectGate from '../components/ProjectGate'
import { useActiveProjectId } from '../store.ts'

export default function WorkspaceV2() {
  const { t } = useTranslation('chat')
  const id = useActiveProjectId()
  const [mobilePane, setMobilePane] = useState<'bench' | 'chat'>('bench')

  return (
    <div className="wsv2">
      <div className={`wsv2-pane-slot wsv2-pane-slot--chat${mobilePane === 'chat' ? ' is-active' : ''}`}>
        <ChatPanel />
      </div>
      <div className={`wsv2-pane-slot wsv2-pane-slot--bench${mobilePane === 'bench' ? ' is-active' : ''}`}>
        {id ? (
          <ProjectGate key={id} projectId={id}>
            <Bench />
          </ProjectGate>
        ) : (
          <Bench />
        )}
      </div>
      <div className="wsv2-mobile-switcher" role="tablist" aria-label={t('header.projectOverview')}>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'bench'}
          className={`wsv2-mobile-switcher-btn${mobilePane === 'bench' ? ' is-active' : ''}`}
          onClick={() => setMobilePane('bench')}
        >
          {t('header.projectOverview')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'chat'}
          className={`wsv2-mobile-switcher-btn${mobilePane === 'chat' ? ' is-active' : ''}`}
          onClick={() => setMobilePane('chat')}
        >
          {t('header.tabChat')}
        </button>
      </div>
    </div>
  )
}
