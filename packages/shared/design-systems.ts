/**
 * The hardcoded list of design systems a project can adopt. The id is the
 * stable key — it matches the directory name under
 * `server/backend/local/design-systems/<id>/` in local mode, and maps to a
 * different resolution path in rebyte mode (out of scope here).
 *
 * Adding a new design system is a two-step change: (1) add an entry to
 * `DESIGN_SYSTEMS`, (2) create the corresponding content directory on disk.
 * Both must be present — there is no default, no fallback.
 */

export interface DesignSystemSpec {
  id: string
  label: string
  description: string
}

export const DESIGN_SYSTEMS: readonly DesignSystemSpec[] = [
  {
    id: 'kami',
    label: 'Kami',
    description: 'Warm parchment, ink-blue accent, editorial serif — good content deserves good paper',
  },
  {
    id: 'corporate-memo',
    label: 'Corporate memo',
    description: 'Cool neutrals, sans-serif, navy accent, rule lines not shadows — density is respect',
  },
  {
    id: 'neobrutalism',
    label: 'Neobrutalism',
    description: 'Hard black borders, solid saturated color, offset drop shadows — raw and loud',
  },
]

export type DesignSystemId = (typeof DESIGN_SYSTEMS)[number]['id']

export function getDesignSystem(id: string): DesignSystemSpec | null {
  return DESIGN_SYSTEMS.find(d => d.id === id) ?? null
}
