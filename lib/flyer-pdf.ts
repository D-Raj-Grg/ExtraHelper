import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

import { parseHex, qrMatrix, qrRuns, type FlyerPlacement } from "@/lib/flyer"

/** A4 in PDF points. */
export const A4 = { w: 595.28, h: 841.89 } as const

export type FlyerTemplate = {
  bytes: ArrayBuffer
  /** `image/jpeg` or `image/png`; anything else is refused before this point. */
  type: string
  /** Pixel size, to turn the placement fractions into page coordinates. */
  width: number
  height: number
}

const PAGES_PER_TICK = 8

/**
 * One A4 page per code: the template, the code in its box and the QR in its
 * square. The template is embedded **once** and every page references it, and
 * the QR is vector rectangles — so 500 pages stay a few MB and print sharp at
 * any size instead of 500 copies of a 2 MB photo.
 *
 * Yields to the browser every few pages so the progress bar can move.
 */
export async function buildFlyerPdf(opts: {
  template: FlyerTemplate
  placement: FlyerPlacement
  codes: string[]
  /** The text the QR carries for a code. */
  payload: (code: string) => string
  onProgress?: (done: number, total: number) => void
}): Promise<Uint8Array> {
  const { template, placement, codes, payload, onProgress } = opts

  const doc = await PDFDocument.create()
  const image =
    template.type === "image/png" ? await doc.embedPng(template.bytes) : await doc.embedJpg(template.bytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)

  const codeColor = parseHex(placement.codeColor) ?? [0, 0, 0]
  const qrColor = parseHex(placement.qrColor) ?? [0, 0, 0]

  // Placement fractions → page points. The image fills the page; the template is
  // within a percent of A4's proportions, so the stretch is not visible.
  const box = placement.code
  const boxX = box.x * A4.w
  const boxW = box.w * A4.w
  const boxH = box.h * A4.h
  const boxY = A4.h - (box.y + box.h) * A4.h

  const side = placement.qr.s * A4.w
  const qrX = placement.qr.x * A4.w
  const qrY = A4.h - placement.qr.y * A4.h - side

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    const page = doc.addPage([A4.w, A4.h])
    page.drawImage(image, { x: 0, y: 0, width: A4.w, height: A4.h })

    // Code: as tall as the box allows, shrunk only if it would overflow the width.
    let size = boxH * placement.codeScale
    const widthAt = (s: number) => font.widthOfTextAtSize(code, s)
    if (widthAt(size) > boxW) size = (size * boxW) / widthAt(size)
    page.drawText(code, {
      x: boxX + (boxW - widthAt(size)) / 2,
      y: boxY + (boxH - font.heightAtSize(size, { descender: false })) / 2,
      size,
      font,
      color: rgb(...codeColor),
    })

    // QR: modules fill the square less the inset.
    const m = qrMatrix(payload(code))
    const inner = side * (1 - 2 * placement.qrInset)
    const cell = inner / m.size
    const ox = qrX + side * placement.qrInset
    const oy = qrY + side * placement.qrInset + inner // top edge of the grid
    for (const [row, col, len] of qrRuns(m)) {
      page.drawRectangle({
        x: ox + col * cell,
        y: oy - (row + 1) * cell,
        width: len * cell,
        height: cell,
        color: rgb(...qrColor),
        borderWidth: 0,
      })
    }

    if ((i + 1) % PAGES_PER_TICK === 0 || i === codes.length - 1) {
      onProgress?.(i + 1, codes.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  return doc.save()
}
