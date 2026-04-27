import { lazy } from 'react'
import type { FileChipFile, FileTypeDefinition } from './types'
import { HtmlSpec, HTML_ICON } from '../../../packages/shared/file-types/html'

// HTML files open through PageViewer; the registry's Editor slot is
// never reached. Stubbed with PlaceholderView purely to satisfy the
// FileTypeDefinition interface shape.
const Editor = lazy(() => import('../bench/adapters/PlaceholderView'))

const HtmlIcon = () => (
  <span className="app-card-thumb-icon" dangerouslySetInnerHTML={{ __html: HTML_ICON }} />
)

/** Card thumbnail: the same iframe PageViewer uses, scaled down to fit
 *  the card. No authFetch, no srcDoc — the Go file-server serves the
 *  file directly. `sandbox=""` keeps scripts (including the injected
 *  bridge) from running in the thumbnail.
 *
 *  `fileServerRoot` flows in via the file prop (the caller has project
 *  context — see `FileChipFile`). When absent we fall back to the icon;
 *  the previous approach pulled the root from the store via
 *  `useActiveProject`, but that introduced a circular import (store →
 *  data → file-types/index → html → store) that produced a TDZ error
 *  on `HtmlType` and the Maximum-update-depth cascade behind it. */
function Thumbnail({ file }: { file: FileChipFile }) {
  const root = file.fileServerRoot
  if (!root) return <HtmlIcon />
  return (
    <div className="app-card-thumb-html">
      <iframe
        className="app-card-thumb-html-frame"
        src={`${root}/${encodeURI(file.name)}`}
        sandbox=""
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  )
}

export const HtmlType: FileTypeDefinition = {
  ...HtmlSpec,
  Thumbnail,
  ChipThumb: HtmlIcon,
  Editor,
}
