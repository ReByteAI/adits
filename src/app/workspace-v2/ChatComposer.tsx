import { useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { ClearEditorPlugin } from '@lexical/react/LexicalClearEditorPlugin'
import { $getRoot, $isElementNode, CLEAR_EDITOR_COMMAND, type EditorState } from 'lexical'
import { ImageNode } from '../bench/lexical/ImageNode.tsx'
import { FileNode } from '../bench/lexical/FileNode.tsx'
import { MediaSegmentNode } from '../bench/lexical/MediaSegmentNode.tsx'
import { useStore, useActiveProjectId } from '../store.ts'
import {
  PromptPieceNode,
  $isPromptPieceNode,
  serializePromptPiece,
} from './round/nodes/PromptPieceNode.tsx'
import { RoundBufferPlugin } from './round/RoundBufferPlugin.tsx'
import { useRoundStore } from './round/store.ts'
import { uploadPieceScreenshots } from './round/screenshots.ts'
import { getSkill, type SkillId } from '../../../packages/shared/skills'

interface ChatComposerProps {
  placeholder: string
  /** Called with the composed plain-text prompt. The composer clears its
   *  editor only after `onSubmit` resolves successfully. If the promise
   *  rejects, the text is left in place so the user can retry without
   *  losing their prompt. */
  onSubmit: (text: string) => void | Promise<void>
  /** Disables the editor + Send button. Used when a form-style artifact
   *  has taken over the next user action, or during a send in flight. */
  disabled?: boolean
  /** Swaps the Send button's label — useful for first-send vs follow-up. */
  sendLabel?: string
  /** Attached skills rendered as chips at the top of the composer card.
   *  Parent owns the list; composer just renders + emits remove events. */
  skills?: readonly SkillId[]
  onRemoveSkill?: (id: SkillId) => void
}

function ComposerInner({ placeholder, onSubmit, disabled, sendLabel, skills, onRemoveSkill }: ChatComposerProps) {
  const { t } = useTranslation('chat')
  const { t: tc } = useTranslation('common')
  const [editor] = useLexicalComposerContext()
  const [hasContent, setHasContent] = useState(false)
  const setPromptDirty = useStore(s => s.setPromptDirty)
  const roundPieces = useRoundStore(s => s.pieces)
  const clearRound = useRoundStore(s => s.clear)
  const projectId = useActiveProjectId()

  // Track dirtiness — shared with the bench composer through the store so
  // the existing "Discard unsent prompt?" dialogs still fire on project
  // switch when the user has unsent text here. Round chips count as
  // unsent content too, even without typed text.
  const onChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const textDirty = $getRoot().getTextContent().trim().length > 0
      setHasContent(textDirty)
      setPromptDirty(textDirty)
    })
  }, [setPromptDirty])

  const hasRoundNodes = roundPieces.length > 0
  const canSendRaw = hasContent || hasRoundNodes

  const submit = useCallback(async () => {
    if (disabled) return

    // Materialize each chip's inline base64 image as a real file in
    // the project's `screenshots/` dir, then walk the editor tree
    // serializing chips with that path appended. The text the agent
    // receives references files on disk — no inline base64.
    //
    // Upload happens before the tree walk so chips can include their
    // saved path in the serialized output. If upload fails, surface
    // and abort — sending a screenshot-less prompt would silently
    // drop the visual evidence the user just attached.
    const piecesWithImages = roundPieces.filter(p => p.image)
    let screenshotPaths = new Map<string, string>()
    if (piecesWithImages.length > 0) {
      if (!projectId) {
        console.error('[composer] cannot upload screenshots — no active project')
        return
      }
      try {
        screenshotPaths = await uploadPieceScreenshots(projectId, piecesWithImages)
      } catch (err) {
        console.error('[composer] screenshot upload failed', err)
        return
      }
    }

    let text = ''
    editor.getEditorState().read(() => {
      const lines: string[] = []
      for (const child of $getRoot().getChildren()) {
        if (!$isElementNode(child)) {
          lines.push(child.getTextContent())
          continue
        }
        const chunks: string[] = []
        for (const grand of child.getChildren()) {
          if ($isPromptPieceNode(grand)) {
            chunks.push(serializePromptPiece(grand.__piece, screenshotPaths.get(grand.__id)))
          } else {
            chunks.push(grand.getTextContent())
          }
        }
        lines.push(chunks.join(''))
      }
      text = lines.join('\n').trim()
    })
    if (!text) return

    try {
      await onSubmit(text)
      // Only clear after a successful send — on failure the editor text
      // and round chips are still there for the user to retry or edit.
      clearRound()
      editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined)
      setPromptDirty(false)
    } catch {
      // onSubmit has already logged. Leave editor text + chips untouched.
    }
  }, [editor, disabled, onSubmit, setPromptDirty, clearRound, projectId, roundPieces])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void submit()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [submit])

  const canSend = canSendRaw && !disabled

  return (
    <>
      <OnChangePlugin onChange={onChange} />
      <ClearEditorPlugin />
      <RoundBufferPlugin />
      {skills && skills.length > 0 && (
        <div className="wsv2-composer-skill-chips">
          {skills.map(id => {
            const spec = getSkill(id)
            if (!spec) return null
            return (
              <span key={id} className="wsv2-composer-skill-chip">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 1.5l1.9 4.2 4.6.45-3.45 3.1.95 4.55L8 11.5l-4 2.3.95-4.55L1.5 6.15l4.6-.45L8 1.5z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                {spec.label}
                {onRemoveSkill && (
                  <button
                    type="button"
                    className="wsv2-composer-skill-chip-remove"
                    aria-label={t('removeSkill', { skill: spec.label })}
                    onClick={() => onRemoveSkill(id)}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      <div className="wsv2-composer-editor">
        <RichTextPlugin
          contentEditable={<ContentEditable className="wsv2-composer-editable" />}
          placeholder={<div className="wsv2-composer-placeholder">{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <div className="wsv2-composer-toolbar">
        <button
          className="wsv2-send"
          type="button"
          onClick={() => { void submit() }}
          disabled={!canSend}
        >
          {sendLabel ?? tc('actions.send')}
        </button>
      </div>
    </>
  )
}

const theme = {
  paragraph: 'wsv2-composer-paragraph',
}

export default function ChatComposer(props: ChatComposerProps) {
  const initialConfig = {
    namespace: 'ChatComposer',
    theme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: [ImageNode, FileNode, MediaSegmentNode, PromptPieceNode],
  }

  return (
    <div className="wsv2-composer">
      <div className="wsv2-composer-card">
        <LexicalComposer initialConfig={initialConfig}>
          <ComposerInner {...props} />
          <HistoryPlugin />
        </LexicalComposer>
      </div>
    </div>
  )
}
