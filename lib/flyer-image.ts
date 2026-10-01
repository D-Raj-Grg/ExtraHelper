import { parseHex, qrMatrix, qrRuns, type FlyerPlacement } from "@/lib/flyer"

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("The template image couldn't be read."))
    img.src = url
  })
}

/**
 * One flyer as a picture, for sharing over WhatsApp or saving: the template with
 * this code in its box and this QR in its square. Drawn on a canvas from the
 * same fractions the PDF uses, so the two match. Capped at `maxWidth` pixels
 * wide, since chat apps recompress anything larger anyway.
 */
export async function renderFlyerImage(opts: {
  imageUrl: string
  placement: FlyerPlacement
  code: string
  payload: string
  maxWidth?: number
}): Promise<Blob> {
  const { imageUrl, placement, code, payload, maxWidth = 1400 } = opts
  const img = await loadImage(imageUrl)

  const scale = Math.min(1, maxWidth / img.naturalWidth)
  const W = Math.round(img.naturalWidth * scale)
  const H = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser can't draw the flyer.")
  ctx.drawImage(img, 0, 0, W, H)

  // Code: as tall as the box allows, shrunk only when it would overflow the width.
  const c = placement.code
  const boxW = c.w * W
  const boxH = c.h * H
  let size = boxH * placement.codeScale
  const font = (px: number) => `bold ${px}px Helvetica, Arial, sans-serif`
  ctx.font = font(size)
  const w = ctx.measureText(code).width
  if (w > boxW) {
    size = (size * boxW) / w
    ctx.font = font(size)
  }
  ctx.fillStyle = placement.codeColor
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(code, c.x * W + boxW / 2, c.y * H + boxH / 2)

  // QR: modules fill the square less the inset.
  const m = qrMatrix(payload)
  const side = placement.qr.s * W
  const inner = side * (1 - 2 * placement.qrInset)
  const cell = inner / m.size
  const ox = placement.qr.x * W + side * placement.qrInset
  const oy = placement.qr.y * H + side * placement.qrInset
  ctx.fillStyle = parseHex(placement.qrColor) ? placement.qrColor : "#000000"
  for (const [row, col, len] of qrRuns(m)) {
    // Overlap by a hair so anti-aliasing leaves no seams between rows.
    ctx.fillRect(ox + col * cell, oy + row * cell, len * cell, cell + 0.4)
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The flyer image couldn't be made."))), "image/jpeg", 0.92),
  )
}
