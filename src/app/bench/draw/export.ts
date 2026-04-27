/**
 * Composite helpers — draw image or PDF page + annotation overlay into a PNG Blob.
 */

import { MASK_OPACITY } from './MaskCanvas'
import type { CropRect } from './CropOverlay'

function exportWithOverlay(
  source: CanvasImageSource,
  width: number,
  height: number,
  drawOverlay: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Cannot get canvas context')

  ctx.drawImage(source, 0, 0, width, height)
  drawOverlay(ctx, width, height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to export'))
    }, 'image/png')
  })
}

/** Export an image with a drawing overlay to a PNG blob at natural resolution. */
export function exportImageWithDrawing(
  img: HTMLImageElement,
  maskCanvas: HTMLCanvasElement,
  maskOpacity: number = MASK_OPACITY,
): Promise<Blob> {
  return exportWithOverlay(img, img.naturalWidth, img.naturalHeight, (ctx, w, h) => {
    ctx.globalAlpha = maskOpacity
    ctx.drawImage(maskCanvas, 0, 0, w, h)
  })
}

/** Export a PDF page canvas with a drawing overlay to a PNG blob at native resolution. */
export function exportPdfPageWithDrawing(
  pdfCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  maskOpacity: number = MASK_OPACITY,
): Promise<Blob> {
  return exportWithOverlay(pdfCanvas, pdfCanvas.width, pdfCanvas.height, (ctx, w, h) => {
    ctx.globalAlpha = maskOpacity
    ctx.drawImage(maskCanvas, 0, 0, w, h)
  })
}

/** Crop a source to a PNG blob at the source's native pixel resolution. */
function exportCrop(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  rectCss: CropRect,
  cssW: number,
  cssH: number,
): Promise<Blob> {
  // Map CSS-space rect onto the source's native pixel grid.
  const scaleX = sourceW / cssW
  const scaleY = sourceH / cssH
  const sx = Math.max(0, Math.round(rectCss.x * scaleX))
  const sy = Math.max(0, Math.round(rectCss.y * scaleY))
  const sw = Math.max(1, Math.min(sourceW - sx, Math.round(rectCss.w * scaleX)))
  const sh = Math.max(1, Math.min(sourceH - sy, Math.round(rectCss.h * scaleY)))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Cannot get canvas context')
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to export'))
    }, 'image/png')
  })
}

/** Crop an image element to a PNG blob at natural resolution. rect is in the image's CSS pixel box. */
export function exportImageCrop(img: HTMLImageElement, rectCss: CropRect): Promise<Blob> {
  return exportCrop(img, img.naturalWidth, img.naturalHeight, rectCss, img.clientWidth, img.clientHeight)
}

/** Crop a PDF page canvas to a PNG blob at the canvas's native resolution. rect is in the canvas's CSS pixel box. */
export function exportPdfPageCrop(pdfCanvas: HTMLCanvasElement, rectCss: CropRect): Promise<Blob> {
  return exportCrop(
    pdfCanvas,
    pdfCanvas.width,
    pdfCanvas.height,
    rectCss,
    pdfCanvas.clientWidth,
    pdfCanvas.clientHeight,
  )
}

/** Crop a snapshot canvas (e.g. from html-to-image) to a PNG blob.
 *  The canvas was captured from a DOM element of size cssW × cssH at some
 *  pixel ratio — the source's native pixel dimensions live on canvas.width
 *  and canvas.height, while the rect is expressed in the original CSS pixel
 *  box (so the caller can pass the rect from CropOverlay verbatim). */
export function exportHtmlCrop(
  canvas: HTMLCanvasElement,
  rectCss: CropRect,
  cssW: number,
  cssH: number,
): Promise<Blob> {
  return exportCrop(canvas, canvas.width, canvas.height, rectCss, cssW, cssH)
}

/** Composite a snapshot canvas (e.g. from html-to-image on a rendered DOCX
 *  / XLSX / HTML node) with a draw mask canvas at the same dimensions, and
 *  return a PNG blob. The shared rendered-html editor uses this for its
 *  draw mode — same role as exportImageWithDrawing/exportPdfPageWithDrawing
 *  but for arbitrary DOM-rendered content. */
export function exportHtmlWithDrawing(
  canvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  maskOpacity: number = MASK_OPACITY,
): Promise<Blob> {
  return exportWithOverlay(canvas, canvas.width, canvas.height, (ctx, w, h) => {
    ctx.globalAlpha = maskOpacity
    ctx.drawImage(maskCanvas, 0, 0, w, h)
  })
}

