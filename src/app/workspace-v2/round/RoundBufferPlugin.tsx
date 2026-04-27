/** Lexical plugin that mirrors the shared round buffer into the editor
 *  tree (and vice versa). The buffer is the upstream source of truth:
 *  every piece in it should correspond to a PromptPieceNode in the
 *  editor.
 *
 *  Two directions:
 *    1. Store → editor: subscribe to `round.pieces`. On change, diff
 *       against the existing piece ids in the editor tree. Insert new
 *       ones in their own paragraph; remove stale ones.
 *    2. Editor → store: `editor.registerUpdateListener` watches for the
 *       user backspacing over a chip. If a piece id disappears from
 *       the tree without a corresponding store removal, pull it from
 *       the store too so the two stay consistent.
 *
 *  Placement rule: a new chip always inserts AFTER the last chip
 *  currently in the tree (or, if there are no chips yet, before the
 *  first typed paragraph — or at root end if the tree is empty). That
 *  way chips stay in store-insertion order relative to each other and
 *  join the existing chip cluster. The user can still move their
 *  caret anywhere and type in between chips; any such typed paragraph
 *  keeps its position, but subsequent chips still join the end of the
 *  chip cluster. Serialization walks the Lexical tree in document
 *  order, so what the user sees is what gets sent.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  type ElementNode,
} from 'lexical'
import { useRoundStore } from './store'
import {
  $createPromptPieceNode,
  $isPromptPieceNode,
  type PromptPieceNode,
} from './nodes/PromptPieceNode'

/** Collect every prompt-piece in the tree, keyed by its round id. */
function collectPieces(): Map<string, PromptPieceNode> {
  const m = new Map<string, PromptPieceNode>()
  for (const child of $getRoot().getChildren()) {
    if (!$isElementNode(child)) continue
    for (const grand of child.getChildren()) {
      if ($isPromptPieceNode(grand)) m.set(grand.__id, grand)
    }
  }
  return m
}

export function RoundBufferPlugin() {
  const [editor] = useLexicalComposerContext()
  const pieces = useRoundStore(s => s.pieces)

  /** Ids the plugin has actually rendered into the editor tree. The
   *  editor→store removal path uses this set to distinguish a user-
   *  deleted chip (was inserted, now gone) from a store entry whose
   *  store→editor mirror hasn't run yet. Without this guard, an
   *  unrelated editor update fired between `round.add()` and the
   *  mirror effect would see the new store id missing from the
   *  tree and silently remove it. */
  const insertedIdsRef = useRef<Set<string>>(new Set())

  // Store → editor. useLayoutEffect (not useEffect) so the mirror
  // runs synchronously after the React commit that brought the new
  // `pieces` reference — closes the window where a same-tick Send
  // click, or an unrelated editor update, could observe a
  // still-empty tree.
  useLayoutEffect(() => {
    editor.update(() => {
      const existing = collectPieces()
      const storeIds = new Set(pieces.map(p => p.id))

      // Remove nodes no longer in the store. Remove the enclosing
      // paragraph too if it became empty — keeps the tree tidy.
      existing.forEach((lex, id) => {
        if (storeIds.has(id)) return
        const parent = lex.getParent()
        lex.remove()
        if (parent && $isElementNode(parent) && parent.getChildrenSize() === 0) {
          parent.remove()
        }
        insertedIdsRef.current.delete(id)
      })

      // Insert new pieces AFTER the existing chip paragraphs (not
      // before root's first child — that would reverse store order
      // when multiple chips arrive). Each gets its own paragraph so
      // the user can click between them and type.
      const root = $getRoot()
      let lastChipPara: ElementNode | null = null
      for (const child of root.getChildren()) {
        if (!$isElementNode(child)) continue
        const first = child.getFirstChild()
        if (first && $isPromptPieceNode(first)) lastChipPara = child
      }
      for (const piece of pieces) {
        if (existing.has(piece.id)) continue
        const para = $createParagraphNode()
        para.append($createPromptPieceNode(piece))
        if (lastChipPara) {
          lastChipPara.insertAfter(para)
        } else {
          const first = root.getFirstChild()
          if (first) first.insertBefore(para)
          else root.append(para)
        }
        lastChipPara = para
        insertedIdsRef.current.add(piece.id)
      }
    })
  }, [editor, pieces])

  // Editor → store. Only remove a store id when the plugin has
  // already inserted that id into the tree and then later sees it
  // gone — that's the "user backspaced the chip" signal. Ids the
  // plugin hasn't yet mirrored are left alone.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const present = new Set<string>()
        for (const [id] of collectPieces()) present.add(id)
        const store = useRoundStore.getState()
        for (const piece of store.pieces) {
          if (!insertedIdsRef.current.has(piece.id)) continue
          if (present.has(piece.id)) continue
          insertedIdsRef.current.delete(piece.id)
          store.remove(piece.id)
        }
      })
    })
  }, [editor])

  return null
}
