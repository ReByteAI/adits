/**
 * Payload + answer types for the `ask-design-questions` skill.
 * Mirrors the JSON Schema at `skills/ask-design-questions/schema.json` —
 * if you change one, change both.
 *
 * The agent writes a payload matching `AskDesignQuestionsPayload` to
 * `.adits/questions.json`. The app consumes it, renders a form, and on
 * submit sends back `AskDesignQuestionsAnswers` as the next user turn.
 */

export type AskDesignQuestionsPayload = {
  title: string
  questions: Question[]
}

export type Question = ChoiceQuestion | TextQuestion | FileQuestion

interface QuestionBase {
  id: string
  label: string
  hint?: string
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'choice'
  options: string[]
  allowOther?: boolean
  allowExplore?: boolean
  allowDecideForMe?: boolean
}

export interface TextQuestion extends QuestionBase {
  type: 'text'
  allowImageAttachment?: boolean
}

export interface FileQuestion extends QuestionBase {
  type: 'file'
}

/** Reserved `value` strings for the three escape hatches. The client
 *  emits these when the user picks the corresponding meta-chip; the agent
 *  reads them and branches. Regular chip picks pass the option string
 *  verbatim. */
export const META_OTHER = '__other__'
export const META_EXPLORE = '__explore__'
export const META_DECIDE = '__decide__'

export type ChoiceAnswer =
  | { value: string } // one of `options`
  | { value: typeof META_OTHER; text: string }
  | { value: typeof META_EXPLORE }
  | { value: typeof META_DECIDE }

export type TextAnswer = {
  value: string
  /** Paths to uploaded images attached to this answer. Empty / omitted
   *  means no attachments. */
  images?: string[]
}

export type FileAnswer = {
  /** Path to the uploaded file, or `null` if the user submitted without
   *  attaching one. */
  file: string | null
}

export type Answer = ChoiceAnswer | TextAnswer | FileAnswer

export type AskDesignQuestionsAnswers = {
  answers: Record<string, Answer>
}
