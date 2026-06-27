/**
 * Assistant-message Markdown renderer (modeled on rebyte-app-kit's Markdown).
 *
 * The relay streams assistant text as plain deltas; without this they render
 * raw (literal `**bold**`, `# heads`, unformatted tables/lists). GFM gives us
 * tables / strikethrough / task lists / autolinks.
 *
 * Scoped under `.wsv2-md` (NOT app-kit's bare `.md`) so it can't collide with
 * the design-system preview CSS adits ships (kami / neobrutalism).
 *
 * rehype-raw is intentionally NOT enabled → raw HTML in model output is treated
 * as text, never injected into the DOM (XSS-safe).
 */
import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Module-scope so their identity is stable across renders: a fresh array/object
// each render makes react-markdown rebuild its unified processor, which on the
// streaming path (a re-parse per token delta) is pure waste.
const remarkPlugins = [remarkGfm]
const components: Components = {
  // Links open in a new tab.
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Wrap tables so wide ones scroll horizontally inside the message instead of
  // overflowing the chat column.
  table: ({ children }) => (
    <div className="wsv2-md-table-scroll">
      <table>{children}</table>
    </div>
  ),
}

// memo: once a text run is followed by a tool call its `text` is frozen, so it
// skips re-parsing while later deltas re-render the message. The growing trailing
// run still re-parses (its text changes each delta) — memo can't help there.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="wsv2-md">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
