import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAccountActions, useCurrentUser } from '../auth-shim.tsx'
import { useProjects, useProjectsStatus, useStore } from '../store.ts'
import type { Project } from '../data.ts'
import { ADITS_LOGO_URL } from '../../../packages/shared/logo'
import { PROJECT_TEMPLATES } from './projectTemplates.ts'
import { DESIGN_SYSTEMS } from '../../../packages/shared/design-systems'
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.tsx'

export default function ProjectList() {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const projects = useProjects()
  const status = useProjectsStatus()
  const selectProject = useStore(s => s.selectProject)
  const addProject = useStore(s => s.addProject)
  const renameProject = useStore(s => s.renameProject)
  const init = useStore(s => s.init)
  const { user } = useCurrentUser()

  const [activeTemplateKey, setActiveTemplateKey] = useState<string>(PROJECT_TEMPLATES[0]?.key ?? 'blank')
  const [name, setName] = useState('')
  const [designSystemId, setDesignSystemId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')

  const activeTemplate = useMemo(
    () => PROJECT_TEMPLATES.find(t => t.key === activeTemplateKey) ?? PROJECT_TEMPLATES[0],
    [activeTemplateKey],
  )

  const onOpen = (id: string) => {
    selectProject(id)
    window.history.pushState(null, '', `/project/${id}`)
  }

  const onCreate = async () => {
    if (creating || !activeTemplate) return
    setCreating(true)
    try {
      const id = await addProject(name.trim() || undefined, {
        designSystemId,
        buildingSkillId: activeTemplate.buildingSkillId,
      })
      selectProject(id)
      window.history.pushState(null, '', `/project/${id}`)
    } finally {
      setCreating(false)
    }
  }

  const visible = useMemo(() => {
    const list = projects.filter(p => !p.provisioning || p.files.length > 0)
    const q = search.trim().toLowerCase()
    return q ? list.filter(p => p.name.toLowerCase().includes(q)) : list
  }, [projects, search])

  return (
    <div className="wsv2-home">
      <header className="wsv2-home-topbar">
        <div className="wsv2-home-brand">
          <span className="wsv2-home-brand-mark" aria-hidden="true">
            <img src={ADITS_LOGO_URL} alt="" />
          </span>
          <span className="wsv2-home-brand-name">Adits</span>
        </div>
        <nav className="wsv2-home-topbar-right">
          <LanguageSwitcher />
          <a className="wsv2-home-doc-link" href="/get-started" target="_blank" rel="noreferrer">
            {t('docs')}
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 9l6-6M5 3h4v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </a>
        </nav>
      </header>

      <main className="wsv2-home-cols">
        <section className="wsv2-home-left">
          <h2 className="wsv2-home-form-title">{t('newProject')}</h2>

          <div className="wsv2-home-tabs" role="tablist" aria-label={t('newProject')}>
            {PROJECT_TEMPLATES.map(t => {
              const active = t.key === activeTemplateKey
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`wsv2-home-tab${active ? ' is-active' : ''}`}
                  onClick={() => setActiveTemplateKey(t.key)}
                  disabled={creating}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {activeTemplate && (
            <div className="wsv2-home-create" role="tabpanel">
              <h3 className="wsv2-home-create-title">{t('newWithTemplate', { template: activeTemplate.label.toLowerCase() })}</h3>

              <input
                type="text"
                className="wsv2-home-create-input"
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={creating}
                onKeyDown={e => {
                  if (e.key === 'Enter') void onCreate()
                }}
              />

              <div className="wsv2-home-create-field">
                <label className="wsv2-home-create-label" htmlFor="design-system-select">
                  {t('designSystem')}
                </label>
                <select
                  id="design-system-select"
                  className="wsv2-home-create-select"
                  value={designSystemId ?? ''}
                  onChange={e => setDesignSystemId(e.target.value || null)}
                  disabled={creating}
                >
                  <option value="">{t('designSystemNone')}</option>
                  {DESIGN_SYSTEMS.map(ds => (
                    <option key={ds.id} value={ds.id}>{ds.label}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="wsv2-home-create-submit"
                onClick={() => void onCreate()}
                disabled={creating}
                aria-busy={creating || undefined}
              >
                {creating ? t('creating') : t('createButton')}
              </button>
            </div>
          )}

          <p className="wsv2-home-privacy">{t('privacy')}</p>

          <AccountButton />
        </section>

        <section className="wsv2-home-right">
          <div className="wsv2-home-search">
            <svg className="wsv2-home-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              className="wsv2-home-search-input"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {status === 'loading' && visible.length === 0 && (
            <div className="wsv2-home-note">{t('loading')}</div>
          )}

          {status === 'ready' && visible.length === 0 && search === '' && (
            <div className="wsv2-home-note">{t('empty')}</div>
          )}

          {status === 'ready' && visible.length === 0 && search !== '' && (
            <div className="wsv2-home-note">{t('noMatch', { q: search })}</div>
          )}

          {status === 'error' && (
            <div className="wsv2-home-note">
              <p>{t('loadError')}</p>
              <button
                type="button"
                className="wsv2-btn-solid"
                onClick={() => {
                  const email = user?.primaryEmailAddress?.emailAddress
                  if (!email) return
                  void init({ email, name: user?.fullName ?? undefined, avatarUrl: user?.imageUrl ?? undefined })
                }}
              >
                {tc('actions.tryAgain')}
              </button>
            </div>
          )}

          {visible.length > 0 && (
            <div className="wsv2-home-grid">
              {visible.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => onOpen(p.id)}
                  onRename={(n) => renameProject(p.id, n)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function AccountButton() {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const { user } = useCurrentUser()
  const { signOut, openUserProfile } = useAccountActions()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  const initial = user?.firstName?.[0] ?? email[0]?.toUpperCase() ?? 'A'
  const org = user?.organizationMemberships?.[0]?.organization?.name ?? t('personalWorkspace')

  return (
    <div className="wsv2-home-account" ref={wrapRef}>
      <button
        type="button"
        className="wsv2-home-account-btn"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="wsv2-home-account-avatar" aria-hidden="true">
          {user?.imageUrl
            ? <img src={user.imageUrl} alt="" />
            : <span>{initial}</span>}
        </span>
        <span className="wsv2-home-account-info">
          <span className="wsv2-home-account-email">{email || t('signedIn')}</span>
          <span className="wsv2-home-account-org">{org}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="wsv2-home-account-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="wsv2-home-account-menu-item"
            onClick={() => { setOpen(false); openUserProfile() }}
          >
            {t('accountSettings')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="wsv2-home-account-menu-item"
            onClick={() => { setOpen(false); void signOut() }}
          >
            {tc('navigation.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onRename,
}: {
  project: Project
  onOpen: () => void
  onRename: (name: string) => Promise<void> | void
}) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(project.name)

  const fileCount = project.files.length
  const lastDate = project.files
    .map(f => f.date)
    .filter(Boolean)
    .sort()
    .slice(-1)[0]
  const meta = [
    fileCount === 0 ? t('fileCountEmpty') : t('fileCount', { count: fileCount }),
    lastDate && t('updatedAt', { date: lastDate }),
  ].filter(Boolean).join(' · ')

  const commit = async () => {
    const next = value.trim()
    setEditing(false)
    if (!next || next === project.name) {
      setValue(project.name)
      return
    }
    try {
      await onRename(next)
    } catch {
      setValue(project.name)
    }
  }

  return (
    <div className="wsv2-card-project" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && !editing) onOpen() }}>
      <div className="wsv2-card-project-thumb" aria-hidden="true" />
      <div className="wsv2-card-project-body">
        {editing ? (
          <input
            autoFocus
            className="wsv2-card-project-input"
            value={value}
            onClick={e => e.stopPropagation()}
            onChange={e => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commit() }
              if (e.key === 'Escape') { setEditing(false); setValue(project.name) }
            }}
          />
        ) : (
          <div className="wsv2-card-project-name">{project.name}</div>
        )}
        <div className="wsv2-card-project-meta">{meta}</div>
      </div>
      {!editing && (
        <button
          type="button"
          className="wsv2-card-project-rename"
          aria-label={tc('actions.rename')}
          onClick={(e) => { e.stopPropagation(); setEditing(true); setValue(project.name) }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 2 14 4.5 5 13.5H2.5V11l9-9Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
