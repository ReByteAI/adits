/**
 * Lexical DecoratorNode for inline TIME-RANGE references to a media file.
 *
 * Used by the audio + video editors to drop a `cacio.mp3 0:15–0:17` chip into
 * the prompt. Pure reference — no bytes are extracted; the agent receives the
 * full file plus the time window via getTextContent().
 *
 * Distinct from FileNode (static file chip) and ImageNode (image-only chip).
 * Don't merge them — see CLAUDE.md File Type Architecture.
 */
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import { getType } from '../../file-types'
import { formatTime } from '../media/MediaTimeline'

export interface MediaSegmentPayload {
  /** Display name (filename) */
  name: string
  /** Registry key (e.g. 'audio', 'video') — looked up via getType() */
  fileTypeKey: string
  /** Owning bench file id — the agent uses this to fetch the actual bytes. */
  fileId?: string
  /** Window in seconds */
  startSec: number
  endSec: number
  key?: NodeKey
}

export type SerializedMediaSegmentNode = Spread<
  { name: string; fileTypeKey: string; fileId?: string; startSec: number; endSec: number },
  SerializedLexicalNode
>

function MediaSegmentChip({
  name,
  fileTypeKey,
  startSec,
  endSec,
}: { name: string; fileTypeKey: string; startSec: number; endSec: number }) {
  const def = getType(fileTypeKey)
  const ChipThumbComponent = def.ChipThumb
  const range = `${formatTime(startSec)}–${formatTime(endSec)}`

  return (
    <span
      className="bench-prompt-chip bench-prompt-chip--segment"
      tabIndex={0}
      role="img"
      aria-label={`${def.label}: ${name}, ${formatTime(startSec)} to ${formatTime(endSec)}`}
    >
      <ChipThumbComponent file={{ name }} />
      <span className="bench-prompt-chip-name">{name}</span>
      <span className="bench-prompt-chip-range" aria-hidden="true">{range}</span>
    </span>
  )
}

export class MediaSegmentNode extends DecoratorNode<React.JSX.Element> {
  __name: string
  __fileTypeKey: string
  __fileId: string
  __startSec: number
  __endSec: number

  static getType(): string { return 'media-segment' }

  static clone(node: MediaSegmentNode): MediaSegmentNode {
    return new MediaSegmentNode(
      node.__name,
      node.__fileTypeKey,
      node.__fileId,
      node.__startSec,
      node.__endSec,
      node.__key,
    )
  }

  static importJSON(serializedNode: SerializedMediaSegmentNode): MediaSegmentNode {
    return $createMediaSegmentNode({
      name: serializedNode.name,
      fileTypeKey: serializedNode.fileTypeKey,
      fileId: serializedNode.fileId,
      startSec: serializedNode.startSec,
      endSec: serializedNode.endSec,
    })
  }

  constructor(
    name: string,
    fileTypeKey: string,
    fileId: string,
    startSec: number,
    endSec: number,
    key?: NodeKey,
  ) {
    super(key)
    this.__name = name
    this.__fileTypeKey = fileTypeKey
    this.__fileId = fileId
    this.__startSec = startSec
    this.__endSec = endSec
  }

  exportJSON(): SerializedMediaSegmentNode {
    return {
      name: this.__name,
      fileTypeKey: this.__fileTypeKey,
      fileId: this.__fileId,
      startSec: this.__startSec,
      endSec: this.__endSec,
      type: 'media-segment',
      version: 1,
    }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    const className = config.theme.image
    if (className) span.className = className
    return span
  }

  updateDOM(): false { return false }

  /** Embeds the time range in the plaintext the agent receives. */
  getTextContent(): string {
    return `[${this.__name} ${formatTime(this.__startSec)}-${formatTime(this.__endSec)}]`
  }

  decorate(): React.JSX.Element {
    return (
      <MediaSegmentChip
        name={this.__name}
        fileTypeKey={this.__fileTypeKey}
        startSec={this.__startSec}
        endSec={this.__endSec}
      />
    )
  }
}

export function $createMediaSegmentNode({
  name, fileTypeKey, fileId = '', startSec, endSec, key,
}: MediaSegmentPayload): MediaSegmentNode {
  return $applyNodeReplacement(new MediaSegmentNode(name, fileTypeKey, fileId, startSec, endSec, key))
}

export function $isMediaSegmentNode(node: LexicalNode | null | undefined): node is MediaSegmentNode {
  return node instanceof MediaSegmentNode
}
