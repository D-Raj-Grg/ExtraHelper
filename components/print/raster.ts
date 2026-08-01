/**
 * Rasterises a print document to a PNG the printer can swallow as an ESC/POS
 * bit-image.
 *
 * This exists for one reason: ESC/POS text mode is a single-byte code page, so
 * a Nepali dish name prints as `????`. Drawing the ticket instead sidesteps the
 * code page entirely — and it is done in the browser because the browser
 * already shapes Devanagari, Chinese and Thai correctly, with the fonts the
 * machine has. No dependency, no font file to ship, no server-side text engine.
 *
 * Browser-only: touches `document`. Import from client components.
 */

import type { DocBlock, PrintDocModel } from "@/lib/print/docs"
import { columnsFor } from "@/lib/print/escpos"

/**
 * Printable dots, not paper width. An 80mm roll prints 72mm of it; the rest is
 * margin the head cannot reach. At 203dpi that is 576 dots — the number every
 * ESC/POS datasheet quotes.
 *
 * Every value is a multiple of 8: a raster row is sent as whole bytes, so a
 * width that isn't makes the row the printer draws wider than the canvas the
 * layout was measured against.
 */
const DOTS: Record<number, number> = { 58: 384, 76: 416, 80: 576 }

export function printableDots(paperWidthMm: number): number {
  return DOTS[paperWidthMm] ?? 576
}

const FONT_STACK =
  '"Noto Sans Devanagari", "Noto Sans", "Mangal", "Segoe UI", system-ui, sans-serif'

type Style = { size: number; bold?: boolean; align?: "left" | "center" | "right" }

export type RasterOptions = {
  paperWidthMm: number
  autoCut: boolean
  openDrawer: boolean
}

/**
 * Draws the document and hands back finished ESC/POS — a bit-image, plus the
 * drawer kick and the cut. Doing the encoding here rather than leaning on QZ's
 * image converter is what lets image mode work identically over a network
 * socket, a USB endpoint and a system printer: `qz.usb.sendData` takes bytes
 * and nothing else.
 */
export function rasteriseEscPos(doc: PrintDocModel, opts: RasterOptions): string {
  const { canvas, ctx } = drawDocument(doc, opts.paperWidthMm)
  const bytes: number[] = [0x1b, 0x40] // ESC @ — reset to a known state

  bytes.push(...bitImage(ctx.getImageData(0, 0, canvas.width, canvas.height)))

  if (doc.wantsDrawer && opts.openDrawer) bytes.push(0x1b, 0x70, 0x00, 0x19, 0xfa)
  if (opts.autoCut) bytes.push(0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00)
  else bytes.push(0x0a, 0x0a, 0x0a)

  return base64(Uint8Array.from(bytes))
}

/**
 * `GS v 0` — raster bit image. Sent in bands because the height field is two
 * bytes and some printers choke well before that; 128 rows is the size every
 * cheap clone copes with.
 */
function bitImage(img: ImageData): number[] {
  const widthBytes = Math.ceil(img.width / 8)
  const out: number[] = []

  for (let top = 0; top < img.height; top += 128) {
    const rows = Math.min(128, img.height - top)
    out.push(
      0x1d,
      0x76,
      0x30,
      0x00,
      widthBytes & 0xff,
      (widthBytes >> 8) & 0xff,
      rows & 0xff,
      (rows >> 8) & 0xff,
    )
    for (let y = 0; y < rows; y++) {
      for (let xb = 0; xb < widthBytes; xb++) {
        let byte = 0
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit
          if (x >= img.width) continue
          const i = ((top + y) * img.width + x) * 4
          // A thermal head is one bit per dot; anything but near-white burns.
          const luma = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3
          if (luma < 128) byte |= 0x80 >> bit
        }
        out.push(byte)
      }
    }
  }
  return out
}

function base64(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function drawDocument(
  doc: PrintDocModel,
  paperWidthMm: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const width = printableDots(paperWidthMm)
  // Match text mode's column count so a layout that fits in one mode fits in
  // the other. The 1.66 is the width-to-height ratio of the stack above.
  const base = Math.max(14, Math.floor((width / columnsFor(paperWidthMm)) * 1.66))

  const measure = document.createElement("canvas").getContext("2d")
  if (!measure) throw new Error("This browser cannot rasterise tickets.")

  // Lay out once to learn the height, then again for real: a canvas cannot be
  // resized without clearing it, and an over-tall canvas would feed blank paper.
  const height = layout(doc, paperWidthMm, width, base, measure, null)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser cannot rasterise tickets.")
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "#000"
  ctx.textBaseline = "top"
  layout(doc, paperWidthMm, width, base, ctx, ctx)

  return { canvas, ctx }
}

/**
 * One pass over the document. `draw` null means measure only — the two passes
 * share this function so they can never disagree about the height.
 */
function layout(
  doc: PrintDocModel,
  paperWidthMm: number,
  width: number,
  base: number,
  measure: CanvasRenderingContext2D,
  draw: CanvasRenderingContext2D | null,
): number {
  let y = base * 0.4

  const font = (s: Style) => `${s.bold ? "700 " : ""}${s.size}px ${FONT_STACK}`

  const text = (s: string, st: Style, indent = 0): void => {
    measure.font = font(st)
    const lineH = Math.round(st.size * 1.3)
    const room = width - indent
    for (const line of wrap(s, room, measure)) {
      if (draw) {
        draw.font = font(st)
        const w = draw.measureText(line).width
        const x =
          st.align === "center"
            ? (width - w) / 2
            : st.align === "right"
              ? width - w
              : indent
        draw.fillText(line, x, y)
      }
      y += lineH
    }
  }

  const twoCol = (label: string, value: string, st: Style): void => {
    measure.font = font(st)
    const lineH = Math.round(st.size * 1.3)
    const valueW = measure.measureText(value).width
    // The value is never truncated — a clipped total is worse than a clipped
    // name — so the label gives way instead.
    for (const line of wrap(label, Math.max(20, width - valueW - 8), measure)) {
      if (draw) {
        draw.font = font(st)
        draw.fillText(line, 0, y)
      }
      y += lineH
    }
    y -= lineH
    if (draw) {
      draw.font = font(st)
      draw.fillText(value, width - valueW, y)
    }
    y += lineH
  }

  const rule = (thick: boolean): void => {
    if (draw) {
      draw.fillRect(0, y + 2, width, thick ? 3 : 1)
    }
    y += Math.round(base * 0.6)
  }

  for (const b of doc.blocks) {
    switch (b.kind) {
      case "title":
        text(b.text, { size: base * 2, bold: true, align: "center" })
        break
      case "subtitle":
      case "banner":
        text(b.text, { size: base, bold: true, align: "center" })
        break
      case "line":
        text(b.text, { size: base, bold: b.bold, align: b.align ?? "center" })
        break
      case "divider":
        rule(b.char === "=")
        break
      case "space":
        y += Math.round(base * 0.6)
        break
      case "ruler": {
        const cols = columnsFor(paperWidthMm)
        text("1234567890".repeat(Math.ceil(cols / 10)).slice(0, cols), {
          size: base,
          align: "left",
        })
        break
      }
      case "row":
        twoCol(b.label, b.value, {
          size: b.large ? Math.round(base * 1.4) : base,
          bold: b.bold,
          align: "left",
        })
        break
      case "item":
        item(b, base, text, twoCol)
        break
    }
  }

  return Math.max(1, Math.ceil(y + base))
}

function item(
  b: Extract<DocBlock, { kind: "item" }>,
  base: number,
  text: (s: string, st: Style, indent?: number) => void,
  twoCol: (label: string, value: string, st: Style) => void,
): void {
  const label = `${b.qty} x ${b.name}`
  const size = b.emphasis ? Math.round(base * 1.3) : base

  if (b.amount === undefined) text(label, { size, bold: true, align: "left" })
  else twoCol(label, b.amount, { size, bold: true, align: "left" })

  if (b.seat) text(`seat ${b.seat}`, { size: base, align: "left" }, base)
  for (const m of b.modifiers ?? []) {
    text(`+ ${m.name}${m.qty > 1 ? ` x${m.qty}` : ""}`, { size: base, align: "left" }, base)
  }
  // Allergy and "no onion" live here. Bold so it survives a fast scan.
  if (b.notes) text(`** ${b.notes}`, { size: base, bold: true, align: "left" }, base)
}

/** Greedy wrap by pixel width; a word wider than the line is hard-split. */
function wrap(s: string, width: number, ctx: CanvasRenderingContext2D): string[] {
  const out: string[] = []
  let line = ""
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= width) {
      line = next
      continue
    }
    if (line) out.push(line)
    line = word
    while (ctx.measureText(line).width > width && line.length > 1) {
      let cut = line.length - 1
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--
      out.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  if (line) out.push(line)
  return out.length ? out : [""]
}
