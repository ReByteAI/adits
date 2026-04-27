/** Blob → base64 data URL. Used by the image / PDF editors when
 *  producing PromptPieces — the round buffer's `image` field is an
 *  inline data URL (no object-URL lifetime to manage, no external
 *  dependencies to resolve on send). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}
