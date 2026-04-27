/**
 * Skills & design-systems picker. Renders the fixed list from
 * `packages/shared/skills.ts` in two sections (Design systems, Skills)
 * and surfaces a "Use" button on hover for each row.
 *
 * Controlled from the outside:
 *   open     — render the dialog
 *   onClose  — close requested (backdrop click, ×, Esc)
 *   onUse    — row picked; caller decides what "using" a skill means
 *              (attach a chip, save to project, etc.)
 *
 * No wiring to the prompt payload here. This is the picker only.
 */

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SKILLS, type SkillId, type SkillSpec } from '../../../packages/shared/skills'

interface SkillsModalProps {
  open: boolean
  onClose: () => void
  onUse: (skillId: SkillId) => void
}

export function SkillsModal({ open, onClose, onUse }: SkillsModalProps) {
  const { t } = useTranslation('workspace')
  const { t: tc } = useTranslation('common')
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const designSystems = SKILLS.filter(s => s.category === 'design-system')
  const skills = SKILLS.filter(s => s.category === 'skill')

  return (
    <div className="wsv2-modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="wsv2-modal wsv2-skills-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wsv2-skills-modal-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <header className="wsv2-modal-header">
          <div className="wsv2-modal-heading">
            <h2 className="wsv2-modal-title" id="wsv2-skills-modal-title">
              {t('skillsModal.title')}
            </h2>
            <p className="wsv2-modal-subtitle">
              {t('skillsModal.subtitle')}
            </p>
          </div>
          <button
            type="button"
            className="wsv2-modal-close"
            onClick={onClose}
            aria-label={tc('actions.close')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="wsv2-modal-body">
          {designSystems.length > 0 && (
            <section className="wsv2-skills-section">
              <h3 className="wsv2-skills-section-label">{t('skillsModal.sectionDesignSystems')}</h3>
              <ul className="wsv2-skills-list">
                {designSystems.map(spec => (
                  <SkillRow key={spec.id} spec={spec} onUse={onUse} />
                ))}
              </ul>
            </section>
          )}

          <section className="wsv2-skills-section">
            <h3 className="wsv2-skills-section-label">{t('skillsModal.sectionSkills')}</h3>
            <ul className="wsv2-skills-list">
              {skills.map(spec => (
                <SkillRow key={spec.id} spec={spec} onUse={onUse} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function SkillRow({
  spec,
  onUse,
}: {
  spec: SkillSpec
  onUse: (skillId: SkillId) => void
}) {
  const { t } = useTranslation('workspace')
  return (
    <li className="wsv2-skills-row">
      <button
        type="button"
        className="wsv2-skills-row-body"
        onClick={() => onUse(spec.id as SkillId)}
      >
        <span className="wsv2-skills-row-label">{spec.label}</span>
        <span className="wsv2-skills-row-desc">{spec.description}</span>
      </button>
      <button
        type="button"
        className="wsv2-skills-row-use"
        onClick={() => onUse(spec.id as SkillId)}
      >
        {t('skillsModal.use')}
      </button>
    </li>
  )
}
