/** Napkin file schema. Includes the expected `ellipse` type that this
 *  MVP doesn't emit. */

export type NapkinObject =
  | StrokeObject
  | TextObject
  | RectObject
  | LineObject
  | StickyObject

interface NapkinObjectBase {
  id: string
  /** World-space anchor. For `stroke`, points are world-absolute and
   *  this is `(0, 0)`. For `line`, this is the start point. */
  x: number
  y: number
}

export interface StrokeObject extends NapkinObjectBase {
  type: 'stroke'
  data: { points: { x: number; y: number }[]; color: string; size: number }
}

export interface TextObject extends NapkinObjectBase {
  type: 'text'
  width: number
  height: number
  data: { content: string; fontSize: number; color: string; bold: boolean }
}

export interface RectObject extends NapkinObjectBase {
  type: 'rect'
  width: number
  height: number
  data: { fill: string | null; stroke: string | null; strokeWidth: number }
}

export interface LineObject extends NapkinObjectBase {
  type: 'line'
  endX: number
  endY: number
  data: { fill: null; stroke: string; strokeWidth: number; arrowHead?: boolean }
}

export interface StickyObject extends NapkinObjectBase {
  type: 'sticky'
  width: number
  height: number
  data: { content: string; color: StickyColor }
}

export type StickyColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'orange'

export interface NapkinFile {
  version: 1
  created: string
  modified: string
  objects: NapkinObject[]
}

export const EMPTY_NAPKIN = (now = new Date().toISOString()): NapkinFile => ({
  version: 1,
  created: now,
  modified: now,
  objects: [],
})

/** Short alphanumeric id for a new object. Matches the "ogng5lnie" shape
 *  seen in the upstream sample — not required to be unique across files,
 *  just unique within this file. */
export function makeObjectId(): string {
  return Math.random().toString(36).slice(2, 11)
}
