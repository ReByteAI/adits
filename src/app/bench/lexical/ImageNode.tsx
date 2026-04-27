/**
 * Lexical DecoratorNode for inline IMAGE chips in the prompt editor.
 *
 * IMAGE FILES ONLY — for any other file type use FileNode. Don't retrofit
 * this to handle PDFs/docs/audio/video; that's exactly the kind of mixing
 * the file-type architecture forbids.
 */
import { useState } from 'react'
import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
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

export interface ImagePayload {
  altText: string
  src: string
  fileId?: string
  maxWidth?: number
  key?: NodeKey
}

export type SerializedImageNode = Spread<
  { altText: string; src: string; fileId?: string; maxWidth?: number },
  SerializedLexicalNode
>

function convertImageElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLImageElement) {
    const { alt: altText, src } = domNode
    const node = $createImageNode({ altText, src })
    return { node }
  }
  return null
}

/** Inline image chip — small round thumb + filename, hover shows large preview. */
function ImageChip({ src, altText }: { src: string; altText: string }) {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [offset(8), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context)
  const focus = useFocus(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus])

  const displayName = altText || 'image'

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        className="bench-prompt-chip"
        tabIndex={0}
        role="img"
        aria-label={`Image: ${displayName}`}
      >
        <img src={src} alt="" className="bench-prompt-chip-thumb" />
        <span className="bench-prompt-chip-name">{displayName}</span>
      </span>
      {isOpen && (
        <FloatingPortal>
          <span
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="bench-prompt-chip-preview"
          >
            <img src={src} alt={altText} />
          </span>
        </FloatingPortal>
      )}
    </>
  )
}

export class ImageNode extends DecoratorNode<React.JSX.Element> {
  __src: string
  __altText: string
  __fileId: string
  __maxWidth: number

  static getType(): string { return 'image' }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__fileId, node.__maxWidth, node.__key)
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      altText: serializedNode.altText,
      src: serializedNode.src,
      fileId: serializedNode.fileId,
      maxWidth: serializedNode.maxWidth,
    })
  }

  static importDOM(): DOMConversionMap | null {
    return { img: () => ({ conversion: convertImageElement, priority: 0 }) }
  }

  constructor(src: string, altText: string, fileId: string, maxWidth: number, key?: NodeKey) {
    super(key)
    this.__src = src
    this.__altText = altText
    this.__fileId = fileId
    this.__maxWidth = maxWidth
  }

  exportJSON(): SerializedImageNode {
    return {
      altText: this.__altText,
      src: this.__src,
      fileId: this.__fileId,
      maxWidth: this.__maxWidth,
      type: 'image',
      version: 1,
    }
  }

  exportDOM(): DOMExportOutput {
    const el = document.createElement('img')
    el.setAttribute('src', this.__src)
    el.setAttribute('alt', this.__altText)
    return { element: el }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    const className = config.theme.image
    if (className) span.className = className
    return span
  }

  updateDOM(): false { return false }

  getTextContent(): string {
    return `[${this.__altText}]`
  }

  decorate(): React.JSX.Element {
    return <ImageChip src={this.__src} altText={this.__altText} />
  }
}

export function $createImageNode({ altText, src, fileId = '', maxWidth = 40, key }: ImagePayload): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, altText, fileId, maxWidth, key))
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}
