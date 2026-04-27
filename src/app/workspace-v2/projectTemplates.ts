import type { BuildingSkillId } from '../../../packages/shared/building-skills'

/**
 * Project-creation tiles on the home page. Each tile maps to exactly one
 * building skill (or none — the "blank" escape hatch). The id lives in
 * `packages/shared/building-skills.ts`; the server copies its directory
 * into `<project>/.skills/building/<id>/` when the project is created.
 *
 * Design system is chosen separately in the create form — templates do
 * not preselect one. The two axes are orthogonal.
 */
export interface ProjectTemplate {
  key: string
  label: string
  description: string
  /** The building skill to apply when this template is picked. `null` for
   *  the blank escape hatch — no building skill is applied. */
  buildingSkillId: BuildingSkillId | null
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    key: 'prototype',
    label: 'Prototype',
    description: 'Working app with real interactions',
    buildingSkillId: 'prototype',
  },
  {
    key: 'slides',
    label: 'Slide deck',
    description: 'Presentation in HTML',
    buildingSkillId: 'slide-deck',
  },
  {
    key: 'onepager',
    label: 'One-pager',
    description: 'Single-page summary or brief',
    buildingSkillId: 'one-pager',
  },
  {
    key: 'resume',
    label: 'Resume',
    description: 'CV or résumé',
    buildingSkillId: 'resume',
  },
  {
    key: 'letter',
    label: 'Letter',
    description: 'Formal letter',
    buildingSkillId: 'letter',
  },
  {
    key: 'blank',
    label: 'Blank',
    description: 'Start empty',
    buildingSkillId: null,
  },
]

export function getProjectTemplate(key: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find(t => t.key === key) ?? null
}
