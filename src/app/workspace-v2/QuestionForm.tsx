/**
 * Renders an `ask-design-questions` payload as a form and collects answers.
 *
 * - `choice` questions render as chip rows. `Other` reveals an inline
 *   input. `Explore a few options` and `Decide for me` are
 *   single-select meta-chips (picking one clears the inline input).
 * - `text` questions render as a textarea with an optional paperclip for
 *   image attachments (stored as local blob URLs until submit).
 * - `file` questions render as a dropzone. Clicking picks a single file.
 *
 * On submit, the component builds an `AskDesignQuestionsAnswers` object
 * and hands it to `onSubmit`. Image/file attachments are passed as `File`
 * objects alongside — upload/persist is the caller's problem.
 */

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Answer,
  AskDesignQuestionsAnswers,
  AskDesignQuestionsPayload,
  ChoiceQuestion,
  FileQuestion,
  Question,
  TextQuestion,
} from '../../../packages/shared/ask-design-questions'
import { META_DECIDE, META_EXPLORE, META_OTHER } from '../../../packages/shared/ask-design-questions'

interface QuestionFormProps {
  payload: AskDesignQuestionsPayload
  /** Called when the user hits Continue. `attachments` carries any
   *  `File` objects the user picked — keyed by `<questionId>` for `file`
   *  questions, `<questionId>:<index>` for `text` question images.
   *  Required iff `readOnly` is false/undefined. */
  onSubmit?: (
    answers: AskDesignQuestionsAnswers,
    attachments: Map<string, File>,
  ) => void
  busy?: boolean
  submitLabel?: string
  /** Historical-turn mode: show the questions as they were asked, no
   *  interaction, no submit button. Chips are unselected; textarea and
   *  dropzone are still present but rendered disabled so the layout
   *  stays consistent with the live form. */
  readOnly?: boolean
}

type ChoiceState = {
  type: 'choice'
  selection: string | null
  otherText: string
}
type TextState = {
  type: 'text'
  value: string
  images: { id: string; file: File; preview: string }[]
}
type FileState = { type: 'file'; file: File | null }
type QuestionState = ChoiceState | TextState | FileState
type FormState = Record<string, QuestionState>

function initialState(payload: AskDesignQuestionsPayload): FormState {
  const state: FormState = {}
  for (const q of payload.questions) {
    if (q.type === 'choice') state[q.id] = { type: 'choice', selection: null, otherText: '' }
    else if (q.type === 'text') state[q.id] = { type: 'text', value: '', images: [] }
    else state[q.id] = { type: 'file', file: null }
  }
  return state
}

function buildAnswers(
  payload: AskDesignQuestionsPayload,
  state: FormState,
): { answers: AskDesignQuestionsAnswers; attachments: Map<string, File> } {
  const answers: Record<string, Answer> = {}
  const attachments = new Map<string, File>()
  for (const q of payload.questions) {
    const s = state[q.id]
    if (!s) continue
    if (q.type === 'choice' && s.type === 'choice') {
      if (s.selection === META_OTHER) {
        answers[q.id] = { value: META_OTHER, text: s.otherText.trim() }
      } else if (s.selection === META_EXPLORE) {
        answers[q.id] = { value: META_EXPLORE }
      } else if (s.selection === META_DECIDE) {
        answers[q.id] = { value: META_DECIDE }
      } else if (s.selection) {
        answers[q.id] = { value: s.selection }
      }
    } else if (q.type === 'text' && s.type === 'text') {
      const imagePaths: string[] = []
      s.images.forEach((img, i) => {
        const key = `${q.id}:${i}`
        attachments.set(key, img.file)
        imagePaths.push(key)
      })
      const entry: Answer = imagePaths.length
        ? { value: s.value, images: imagePaths }
        : { value: s.value }
      answers[q.id] = entry
    } else if (q.type === 'file' && s.type === 'file') {
      if (s.file) attachments.set(q.id, s.file)
      answers[q.id] = { file: s.file ? q.id : null }
    }
  }
  return { answers: { answers }, attachments }
}

export function QuestionForm({
  payload,
  onSubmit,
  busy,
  submitLabel = 'Continue',
  readOnly = false,
}: QuestionFormProps) {
  const [state, setState] = useState<FormState>(() => initialState(payload))

  const update = (id: string, updater: (s: QuestionState) => QuestionState) => {
    if (readOnly) return
    setState(prev => {
      const cur = prev[id]
      if (!cur) return prev
      return { ...prev, [id]: updater(cur) }
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || readOnly || !onSubmit) return
    const built = buildAnswers(payload, state)
    onSubmit(built.answers, built.attachments)
  }

  return (
    <form
      className={`wsv2-qf${readOnly ? ' is-readonly' : ''}`}
      onSubmit={handleSubmit}
      aria-disabled={readOnly}
    >
      <h2 className="wsv2-qf-title">{payload.title}</h2>

      <div className="wsv2-qf-questions">
        {payload.questions.map(q => (
          <QuestionRow
            key={q.id}
            question={q}
            state={state[q.id]}
            onUpdate={updater => update(q.id, updater)}
            readOnly={readOnly}
          />
        ))}
      </div>

      {!readOnly && (
        <footer className="wsv2-qf-footer">
          <button type="submit" className="wsv2-qf-submit" disabled={busy}>
            {submitLabel}
          </button>
        </footer>
      )}
    </form>
  )
}

function QuestionRow({
  question,
  state,
  onUpdate,
  readOnly,
}: {
  question: Question
  state: QuestionState | undefined
  onUpdate: (updater: (s: QuestionState) => QuestionState) => void
  readOnly: boolean
}) {
  if (!state) return null
  return (
    <section className="wsv2-qf-question">
      <div className="wsv2-qf-label">{question.label}</div>
      {question.hint && <div className="wsv2-qf-hint">{question.hint}</div>}
      <div className="wsv2-qf-field">
        {question.type === 'choice' && state.type === 'choice' && (
          <ChoiceField question={question} state={state} onUpdate={onUpdate} readOnly={readOnly} />
        )}
        {question.type === 'text' && state.type === 'text' && (
          <TextField question={question} state={state} onUpdate={onUpdate} readOnly={readOnly} />
        )}
        {question.type === 'file' && state.type === 'file' && (
          <FileField question={question} state={state} onUpdate={onUpdate} readOnly={readOnly} />
        )}
      </div>
    </section>
  )
}

function ChoiceField({
  question,
  state,
  onUpdate,
  readOnly,
}: {
  question: ChoiceQuestion
  state: ChoiceState
  onUpdate: (updater: (s: QuestionState) => QuestionState) => void
  readOnly: boolean
}) {
  const { t: tr } = useTranslation('workspace')
  const pick = (value: string) =>
    onUpdate(() => ({
      type: 'choice',
      selection: value,
      otherText: value === META_OTHER ? state.otherText : '',
    }))

  const setOtherText = (text: string) =>
    onUpdate(() => ({ type: 'choice', selection: META_OTHER, otherText: text }))

  const isSelected = (value: string) => state.selection === value

  return (
    <div className="wsv2-qf-chips">
      {question.options.map(opt => (
        <button
          key={opt}
          type="button"
          className={`wsv2-qf-chip${isSelected(opt) ? ' is-on' : ''}`}
          onClick={() => pick(opt)}
          disabled={readOnly}
        >
          {opt}
        </button>
      ))}
      {question.allowExplore && (
        <button
          type="button"
          className={`wsv2-qf-chip is-meta${isSelected(META_EXPLORE) ? ' is-on' : ''}`}
          onClick={() => pick(META_EXPLORE)}
          disabled={readOnly}
        >
          Explore a few options
        </button>
      )}
      {question.allowDecideForMe && (
        <button
          type="button"
          className={`wsv2-qf-chip is-meta${isSelected(META_DECIDE) ? ' is-on' : ''}`}
          onClick={() => pick(META_DECIDE)}
          disabled={readOnly}
        >
          {tr('questionForm.decideForMe')}
        </button>
      )}
      {question.allowOther && (
        <>
          <button
            type="button"
            className={`wsv2-qf-chip is-meta${isSelected(META_OTHER) ? ' is-on' : ''}`}
            onClick={() => pick(META_OTHER)}
            disabled={readOnly}
          >
            {tr('questionForm.other')}
          </button>
          <input
            type="text"
            className="wsv2-qf-other-input"
            placeholder={tr('questionForm.otherPlaceholder')}
            value={state.selection === META_OTHER ? state.otherText : ''}
            onChange={e => setOtherText(e.target.value)}
            onFocus={() => pick(META_OTHER)}
            disabled={readOnly}
          />
        </>
      )}
    </div>
  )
}

function TextField({
  question,
  state,
  onUpdate,
  readOnly,
}: {
  question: TextQuestion
  state: TextState
  onUpdate: (updater: (s: QuestionState) => QuestionState) => void
  readOnly: boolean
}) {
  const { t: tr } = useTranslation('workspace')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    onUpdate(prev => {
      if (prev.type !== 'text') return prev
      const added = files.map(f => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        preview: URL.createObjectURL(f),
      }))
      return { ...prev, images: [...prev.images, ...added] }
    })
    e.target.value = ''
  }

  const removeImage = (id: string) =>
    onUpdate(prev => {
      if (prev.type !== 'text') return prev
      const next = prev.images.filter(img => {
        if (img.id === id) URL.revokeObjectURL(img.preview)
        return img.id !== id
      })
      return { ...prev, images: next }
    })

  return (
    <div className="wsv2-qf-textwrap">
      <textarea
        className="wsv2-qf-textarea"
        placeholder={tr('questionForm.answerPlaceholder')}
        value={state.value}
        onChange={e =>
          onUpdate(prev =>
            prev.type === 'text' ? { ...prev, value: e.target.value } : prev,
          )
        }
        rows={4}
        disabled={readOnly}
      />
      {question.allowImageAttachment && !readOnly && (
        <>
          <button
            type="button"
            className="wsv2-qf-paperclip"
            aria-label={tr('questionForm.attachImage')}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleAttach}
          />
        </>
      )}
      {state.images.length > 0 && (
        <div className="wsv2-qf-attachments">
          {state.images.map(img => (
            <div key={img.id} className="wsv2-qf-attachment">
              <img src={img.preview} alt="" />
              <button
                type="button"
                className="wsv2-qf-attachment-remove"
                onClick={() => removeImage(img.id)}
                aria-label={tr('questionForm.removeAttachment')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FileField({
  question: _question,
  state,
  onUpdate,
  readOnly,
}: {
  question: FileQuestion
  state: FileState
  onUpdate: (updater: (s: QuestionState) => QuestionState) => void
  readOnly: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const onPick = (file: File | null) =>
    onUpdate(() => ({ type: 'file', file }))

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (readOnly) return
    const file = e.dataTransfer.files?.[0] ?? null
    if (file) onPick(file)
  }

  return (
    <>
      <button
        type="button"
        className={`wsv2-qf-dropzone${state.file ? ' has-file' : ''}`}
        onClick={() => { if (!readOnly) inputRef.current?.click() }}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        disabled={readOnly}
      >
        {state.file ? (
          <span className="wsv2-qf-dropzone-filename">{state.file.name}</span>
        ) : (
          <span className="wsv2-qf-dropzone-hint">Click to upload a file</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={e => onPick(e.target.files?.[0] ?? null)}
      />
      {state.file && !readOnly && (
        <button
          type="button"
          className="wsv2-qf-dropzone-remove"
          onClick={() => onPick(null)}
        >
          Remove
        </button>
      )}
    </>
  )
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.79V17a5 5 0 01-10 0V6.5a3.5 3.5 0 017 0V16a2 2 0 01-4 0V7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
