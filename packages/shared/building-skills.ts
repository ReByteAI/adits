/**
 * The hardcoded list of building skills — the "what am I making?" axis of
 * a project. Orthogonal to design systems: any building skill composes
 * with any design system through `.impeccable.md`.
 *
 * The id matches the directory name under
 * `server/backend/local/building-skills/<id>/` in local mode, and the
 * `buildingSkillId` field on `PROJECT_TEMPLATES`.
 *
 * Adding a building skill is a two-step change: (1) add an entry here,
 * (2) create the content directory on disk. No default, no fallback.
 */

export interface BuildingSkillSpec {
  id: string
  label: string
  description: string
}

export const BUILDING_SKILLS: readonly BuildingSkillSpec[] = [
  {
    id: 'prototype',
    label: 'Prototype',
    description: 'Working app with real interactions',
  },
  {
    id: 'slide-deck',
    label: 'Slide deck',
    description: 'Presentation in HTML',
  },
  {
    id: 'one-pager',
    label: 'One-pager',
    description: 'Single-page summary or brief',
  },
  {
    id: 'resume',
    label: 'Resume',
    description: 'CV or résumé',
  },
  {
    id: 'letter',
    label: 'Letter',
    description: 'Formal letter',
  },
]

export type BuildingSkillId = (typeof BUILDING_SKILLS)[number]['id']

export function getBuildingSkill(id: string): BuildingSkillSpec | null {
  return BUILDING_SKILLS.find(s => s.id === id) ?? null
}
