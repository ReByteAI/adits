/** Send-time screenshot persistence.
 *
 *  Pieces produced by Image / PDF / Draw editors carry their visual
 *  evidence as a base64 data URL on `piece.image`. The agent reads
 *  files from the project's file tree, so before we hand the prompt
 *  text to `onSubmit`, we materialize each image as a real file under
 *  `screenshots/` in the project, then reference that path from the
 *  text.
 *
 *  Uses `POST /projects/:id/blobs` (a thin wrapper over the shared
 *  `FileStore.write` interface), NOT the user-visible `/files`
 *  endpoint — screenshots are prompt artifacts and shouldn't show
 *  up in the design files grid. Backend split (local vs. rebyte) is
 *  invisible here: both implement `FileStore.write` and the route
 *  picks based on `ADITS_BACKEND`.
 */
import { uploadBlob } from '../../../../packages/shared/api'
import type { PromptPiece } from './store'

const SCREENSHOTS_DIR = 'screenshots'

/** Project-relative path for a piece's screenshot. Stable: piece ids
 *  are random within a round, so two sends never collide. */
export function screenshotPathFor(piece: PromptPiece): string {
  const shortId = piece.id.startsWith('r_') ? piece.id.slice(2) : piece.id
  return `${SCREENSHOTS_DIR}/${piece.source}-${shortId}.png`
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0 || !dataUrl.startsWith('data:')) {
    throw new Error('Not a data URL')
  }
  const header = dataUrl.slice(5, commaIdx)
  const mime = header.split(';')[0] || 'application/octet-stream'
  const b64 = dataUrl.slice(commaIdx + 1)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Upload every piece that has an inline image to the project's
 *  `screenshots/` dir. Returns a map of pieceId → project-relative
 *  file path. Errors reject the whole promise so the caller can
 *  block the send and surface one failure rather than ship a
 *  partial prompt. */
export async function uploadPieceScreenshots(
  projectId: string,
  pieces: readonly PromptPiece[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    pieces.map(async (p) => {
      if (!p.image) return
      const path = screenshotPathFor(p)
      const blob = dataUrlToBlob(p.image)
      await uploadBlob(projectId, path, blob)
      out.set(p.id, path)
    }),
  )
  return out
}
