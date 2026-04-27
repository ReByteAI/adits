/**
 * Lexical DecoratorNode for inline FILE chips in the prompt editor.
 *
 * Generic over file type — image, PDF, doc, audio, video, html, etc.
 * Rendering delegates to `getType(fileTypeKey).ChipThumb` so each file type
 * owns its inline chip presentation. See CLAUDE.md "File Type Architecture".
 *
 * For pure-image chips (e.g. annotation captures from the editor) use
 * ImageNode instead — keep the two distinct, never mix.
 */
import { useState } from 'react'
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import {
  useFloating,
  offset,
  shift,
  autoUpdate,
  useHover,
  useFocus,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react'
import { getType } from '../../file-types'
import { FileType } from '../../../../packages/shared/file-types/types'

export interface FileNodePayload {
  /** Display name (filename) */
  name: string
  /** Blob/object URL for the underlying file (used for hover preview where supported) */
  src: string
  /** Optional small thumbnail blob URL — only meaningful for image files */
  thumb?: string
  /** Registry key (e.g. 'pdf', 'doc', 'image', 'audio') — looked up via getType() */
  fileTypeKey: string
  /** Owning bench file id */
  fileId?: string
  key?: NodeKey
}

export type SerializedFileNode = Spread<
  { name: string; src: string; thumb?: string; fileTypeKey: string; fileId?: string },
  SerializedLexicalNode
>

/** Inline file chip — registered ChipThumb + name, hover preview only for image-renderable types. */
function FileChip({ name, src, thumb, fileTypeKey }: { name: string; src: string; thumb?: string; fileTypeKey: string }) {
  const [isOpen, setIsOpen] = useState(false)

  const def = getType(fileTypeKey)
  const ChipThumbComponent = def.ChipThumb
  const hoverEnabled = def.fileType === FileType.Image

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [offset(8), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { enabled: hoverEnabled })
  const focus = useFocus(context, { enabled: hoverEnabled })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus])

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        className="bench-prompt-chip"
        tabIndex={0}
        role="img"
        aria-label={`${def.label}: ${name}`}
      >
        <ChipThumbComponent file={{ name, src, thumb }} />
        <span className="bench-prompt-chip-name">{name}</span>
      </span>
      {isOpen && hoverEnabled && (
        <FloatingPortal>
          <span
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="bench-prompt-chip-preview"
          >
            <img src={thumb || src} alt={name} />
          </span>
        </FloatingPortal>
      )}
    </>
  )
}

export class FileNode extends DecoratorNode<React.JSX.Element> {
  __name: string
  __src: string
  __thumb: string | undefined
  __fileTypeKey: string
  __fileId: string

  static getType(): string { return 'file' }

  static clone(node: FileNode): FileNode {
    return new FileNode(node.__name, node.__src, node.__thumb, node.__fileTypeKey, node.__fileId, node.__key)
  }

  static importJSON(serializedNode: SerializedFileNode): FileNode {
    return $createFileNode({
      name: serializedNode.name,
      src: serializedNode.src,
      thumb: serializedNode.thumb,
      fileTypeKey: serializedNode.fileTypeKey,
      fileId: serializedNode.fileId,
    })
  }

  constructor(name: string, src: string, thumb: string | undefined, fileTypeKey: string, fileId: string, key?: NodeKey) {
    super(key)
    this.__name = name
    this.__src = src
    this.__thumb = thumb
    this.__fileTypeKey = fileTypeKey
    this.__fileId = fileId
  }

  exportJSON(): SerializedFileNode {
    return {
      name: this.__name,
      src: this.__src,
      thumb: this.__thumb,
      fileTypeKey: this.__fileTypeKey,
      fileId: this.__fileId,
      type: 'file',
      version: 1,
    }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    const className = config.theme.image // reuse image theme styling — chip pill is identical
    if (className) span.className = className
    return span
  }

  updateDOM(): false { return false }

  getTextContent(): string {
    // Link files: surface the URL literally so the agent can fetch it. We branch
    // on the registered file-type key (not src content) so blob-backed files with
    // remote URLs never leak into the prompt text by accident.
    if (this.__fileTypeKey === 'link') {
      return `[${this.__name} (${this.__src})]`
    }
    return `[${this.__name}]`
  }

  decorate(): React.JSX.Element {
    return (
      <FileChip
        name={this.__name}
        src={this.__src}
        thumb={this.__thumb}
        fileTypeKey={this.__fileTypeKey}
      />
    )
  }
}

export function $createFileNode({ name, src, thumb, fileTypeKey, fileId = '', key }: FileNodePayload): FileNode {
  return $applyNodeReplacement(new FileNode(name, src, thumb, fileTypeKey, fileId, key))
}

export function $isFileNode(node: LexicalNode | null | undefined): node is FileNode {
  return node instanceof FileNode
}
