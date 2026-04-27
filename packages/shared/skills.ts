/**
 * The fixed list of skills the Adits app lets the user attach to a turn.
 * Source of truth is `system.md` § Available Skills (lines 312–323). Any
 * change here must be mirrored there so the agent and the UI agree on
 * what's attachable.
 *
 * `category: 'design-system'` surfaces under the "Design systems" header
 * in the picker modal; `'skill'` surfaces under "Skills".
 */

export type SkillCategory = 'design-system' | 'skill'

export interface SkillSpec {
  /** Stable slug — matches the directory name under `<project>/.skills/`
   *  in local mode and the skill slug passed to Rebyte in hosted mode. */
  id: string
  /** Canonical label, exactly matching the bullet in `system.md`. */
  label: string
  /** One-line description shown under the label in the picker. */
  description: string
  category: SkillCategory
}

export const SKILLS: readonly SkillSpec[] = [
  {
    id: 'create-design-system',
    label: 'Design System',
    description: 'Create a design system or UI kit',
    category: 'design-system',
  },
  {
    id: 'animated-video',
    label: 'Animated video',
    description: 'Timeline-based motion design',
    category: 'skill',
  },
  {
    id: 'interactive-prototype',
    label: 'Interactive prototype',
    description: 'Working app with real interactions',
    category: 'skill',
  },
  {
    id: 'make-a-deck',
    label: 'Make a deck',
    description: 'Slide presentation in HTML',
    category: 'skill',
  },
  {
    id: 'make-tweakable',
    label: 'Make tweakable',
    description: 'Add in-design tweak controls',
    category: 'skill',
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    description: 'Explore many ideas with wireframes and storyboards',
    category: 'skill',
  },
  {
    id: 'export-pptx-editable',
    label: 'Export as PPTX (editable)',
    description: 'Native text & shapes — editable in PowerPoint',
    category: 'skill',
  },
  {
    id: 'export-pptx-screenshots',
    label: 'Export as PPTX (screenshots)',
    description: 'Flat images — pixel-perfect but not editable',
    category: 'skill',
  },
  {
    id: 'save-as-pdf',
    label: 'Save as PDF',
    description: 'Print-ready PDF export',
    category: 'skill',
  },
  {
    id: 'save-as-standalone-html',
    label: 'Save as standalone HTML',
    description: 'Single self-contained file that works offline',
    category: 'skill',
  },
  {
    id: 'one-pager',
    label: 'One-pager',
    description: 'Single-page summary or brief',
    category: 'skill',
  },
  {
    id: 'resume',
    label: 'Resume',
    description: 'CV or résumé',
    category: 'skill',
  },
  {
    id: 'letter',
    label: 'Letter',
    description: 'Formal letter',
    category: 'skill',
  },
]

export type SkillId = (typeof SKILLS)[number]['id']

export function getSkill(id: SkillId): SkillSpec | null {
  return SKILLS.find(s => s.id === id) ?? null
}
