/** Right-side Properties panel.
 *
 *  Full schema matching the claude.ai design tool:
 *    TYPOGRAPHY — Font, Size, Color, Line, Weight, Align, Tracking
 *    SIZE       — Width, Height
 *    BOX        — Opacity, Padding, Margin, Radius
 *
 *  Each field reads a computed-style value from the selection payload
 *  and emits `setStyle(cssProp, value)` on change. The controller
 *  handles coalescing, live DOM patch, and batch commit on exit.
 */
import { useEffect, useState } from 'react'
import type { SelectionInfo } from './EditController.tsx'

export function PropertiesPanel({
  selection,
  onApply,
}: {
  selection: SelectionInfo
  onApply: (prop: string, value: string) => void
}) {
  const s = selection.styles
  return (
    <aside className="wsv2-props">
      <div className="wsv2-props-title">{selection.tag}</div>

      <div className="wsv2-props-group">TYPOGRAPHY</div>
      <TextField label="Font" value={firstFont(s.fontFamily)} onCommit={v => onApply('font-family', v)} />
      <NumPxField label="Size" value={s.fontSize} onCommit={v => onApply('font-size', v)} />
      <ColorField label="Color" value={s.color} onChange={v => onApply('color', v)} />
      <TextField label="Line" value={s.lineHeight} onCommit={v => onApply('line-height', v)} />
      <SelectField
        label="Weight" value={s.fontWeight}
        options={['100', '200', '300', '400', '500', '600', '700', '800', '900']}
        onChange={v => onApply('font-weight', v)}
      />
      <SelectField
        label="Align" value={s.textAlign}
        options={['start', 'left', 'center', 'right', 'justify', 'end']}
        onChange={v => onApply('text-align', v)}
      />
      <NumPxField label="Tracking" value={s.letterSpacing === 'normal' ? '0px' : s.letterSpacing} onCommit={v => onApply('letter-spacing', v)} />

      {/* SIZE group hidden for inline elements — width/height are
          ignored on `display: inline` tags, so exposing them would
          queue prompt lines that produce no visible effect. */}
      {!selection.inline && (
        <>
          <div className="wsv2-props-group">SIZE</div>
          <TextField label="Width" value={s.width} onCommit={v => onApply('width', v)} />
          <TextField label="Height" value={s.height} onCommit={v => onApply('height', v)} />
        </>
      )}

      {/* BOX group: Padding/Margin/Radius use TextField (not NumPxField)
          because computed shorthands can have 2–4 values ("8px 16px",
          "0px auto", asymmetric corners). NumPxField's numeric-only
          parse would flatten these to a single value on blur, silently
          losing the shorthand. */}
      <div className="wsv2-props-group">BOX</div>
      <OpacityField label="Opacity" value={s.opacity} onChange={v => onApply('opacity', v)} />
      <TextField label="Padding" value={s.padding} onCommit={v => onApply('padding', v)} />
      <TextField label="Margin" value={s.margin} onCommit={v => onApply('margin', v)} />
      <TextField label="Radius" value={s.borderRadius} onCommit={v => onApply('border-radius', v)} />
      <ColorField label="Background" value={s.backgroundColor} onChange={v => onApply('background-color', v)} />
    </aside>
  )
}

/* ---------- Field primitives ---------- */

/** Free text field — commits on blur / Enter so the batch doesn't get
 *  a prompt line per keystroke. */
function TextField({
  label, value, onCommit,
}: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v !== value) onCommit(v) }
  return (
    <div className="wsv2-props-field">
      <label className="wsv2-props-label">{label}</label>
      <input
        type="text"
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </div>
  )
}

/** Number-with-px input. Reads/writes values like "16px"; "auto" stays
 *  as-is. Commits on blur / Enter. */
function NumPxField({
  label, value, onCommit,
}: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(numericPart(value))
  useEffect(() => setV(numericPart(value)), [value])
  const commit = () => {
    const parsed = parseFloat(v)
    if (!Number.isFinite(parsed)) {
      // Invalid input (blank, non-numeric) — snap back to the current
      // value so the field doesn't show text that doesn't match reality.
      setV(numericPart(value))
      return
    }
    const next = `${parsed}px`
    if (next !== value) onCommit(next)
  }
  return (
    <div className="wsv2-props-field wsv2-props-field-inline">
      <label className="wsv2-props-label">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      <span className="wsv2-props-unit">px</span>
    </div>
  )
}

/** <select> with a fixed option list. Commits on every change (cheap). */
function SelectField({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  // Merge the current computed value into the option list if it's not already
  // there (e.g. computed "bold" even though we only show numeric weights).
  const opts = options.includes(value) ? options : [...options, value]
  return (
    <div className="wsv2-props-field wsv2-props-field-inline">
      <label className="wsv2-props-label">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

/** Color picker + hex readout. For transparent / partial-alpha / non-rgb
 *  values, the picker stays disabled with a hint. */
function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const parsed = parseColor(value)
  if (parsed.kind === 'unsupported') {
    return (
      <div className="wsv2-props-field wsv2-props-field-inline">
        <label className="wsv2-props-label">{label}</label>
        <input type="color" disabled value="#ffffff" readOnly />
        <span className="wsv2-props-hint">{parsed.reason}</span>
      </div>
    )
  }
  return (
    <div className="wsv2-props-field wsv2-props-field-inline">
      <label className="wsv2-props-label">{label}</label>
      <input
        type="color"
        value={parsed.hex}
        onChange={e => onChange(e.target.value)}
      />
      <code className="wsv2-props-hex">{parsed.hex}</code>
    </div>
  )
}

/** Opacity 0..1 numeric input. */
function OpacityField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    const n = parseFloat(v)
    if (!Number.isFinite(n)) { setV(value); return }
    const clamped = String(Math.max(0, Math.min(1, n)))
    // Normalize the shown value to the clamp (e.g. user types "1.2",
    // we display "1" after blur) so the input never shows an
    // unapplied value.
    if (clamped !== v) setV(clamped)
    // Equality check mirrors TextField / NumPxField — blurring an
    // unchanged field must not enqueue a redundant edit.
    if (clamped !== value) onChange(clamped)
  }
  return (
    <div className="wsv2-props-field wsv2-props-field-inline">
      <label className="wsv2-props-label">{label}</label>
      <input
        type="number"
        step="0.05"
        min="0"
        max="1"
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </div>
  )
}

/* ---------- Helpers ---------- */

/** `getComputedStyle` returns font-family as a quoted list; keep just
 *  the first family for display. */
function firstFont(fam: string): string {
  const m = fam.split(',')[0]?.trim()
  if (!m) return fam
  return m.replace(/^["']|["']$/g, '')
}

function numericPart(v: string): string {
  if (v === 'auto' || v === 'normal' || v === '') return v
  const m = v.match(/^(-?[\d.]+)/)
  return m ? m[1] : v
}

/** Classify a computed `color` / `background-color` string. */
function parseColor(s: string):
  | { kind: 'opaque'; hex: string }
  | { kind: 'unsupported'; reason: string }
{
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (!m) return { kind: 'unsupported', reason: 'Non-color value. Use a Tweak or chat.' }
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3])
  const a = m[4] != null ? Number(m[4]) : 1
  if (a === 0) return { kind: 'unsupported', reason: 'Transparent — use a Tweak or chat.' }
  if (a < 1) return { kind: 'unsupported', reason: 'Partial alpha — use a Tweak or chat.' }
  return { kind: 'opaque', hex: rgbToHex(r, g, b) }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
