/**
 * Turns an uploaded logo or payment QR into the 1-bit bitmaps a thermal head
 * actually prints.
 *
 * Baking happens **here, at upload**, and not at print time, because only a
 * browser has a canvas. The phone and the headless print agent are byte pipes
 * — they fetch finished ESC/POS and write it to a socket. Rasterise at print
 * time and the branding would appear on till-driven printers only, and every
 * slip printed from Android would come out blank where the QR should be.
 *
 * Two different treatments, for one reason: a QR is data, a logo is a picture.
 * Dithering a QR scatters its module edges and it stops scanning; hard
 * thresholding a logo turns a photographic mark into a blob.
 *
 * Browser-only: touches `document` and `createImageBitmap`.
 */

import jsQR from "jsqr"
import { BAKE_WIDTHS, encodeBitmap, type PrintBitmap } from "@/lib/print/bitmap"
import type { DocImage } from "@/lib/print/docs"

export type BakeKind = "logo" | "qr"

export type BakeResult = {
  variants: DocImage
  /** Base64 payload size across all widths, for the storage guard. */
  bytes: number
  /** Paper widths whose baked QR would not decode. Empty for a logo. */
  unscannable: number[]
}

/** A logo taller than this eats the top of every receipt. */
const LOGO_MAX_HEIGHT_RATIO = 0.25
/** Leaves room either side so the QR is not crowded by the paper edge. */
const QR_WIDTH_RATIO = 0.62
/** The quiet zone a scanner needs, as a fraction of the QR's own size. */
const QR_QUIET_RATIO = 0.08

export async function bakeAsset(file: File, kind: BakeKind): Promise<BakeResult> {
  const source = await loadPixels(file)
  const trimmed = kind === "qr" ? trimWhiteBorder(source) : source

  const variants: DocImage = {}
  const unscannable: number[] = []
  let bytes = 0

  for (const dots of BAKE_WIDTHS) {
    const composed = kind === "qr" ? composeQr(trimmed, dots) : composeLogo(trimmed, dots)
    if (kind === "qr" && !decodes(composed)) unscannable.push(dots)
    const bmp = pack(composed)
    variants[String(dots)] = bmp
    bytes += bmp.data.length
  }

  return { variants, bytes, unscannable }
}

// --- composition ------------------------------------------------------------

/**
 * Full printable width, white, with the artwork centred in it. The centring is
 * baked into the pixels on purpose: `ESC a 1` is honoured for text on every
 * printer but for raster bit images on only some of them.
 */
function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("This browser cannot prepare print images.")
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, width, height)
  return ctx
}

function composeLogo(src: ImageData, dots: number): ImageData {
  const maxH = Math.round(dots * LOGO_MAX_HEIGHT_RATIO)
  let w = dots
  let h = Math.round((src.height * dots) / src.width)
  if (h > maxH) {
    h = maxH
    w = Math.round((src.width * maxH) / src.height)
  }

  const ctx = canvasOf(dots, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(toCanvas(src), Math.round((dots - w) / 2), 0, w, h)

  const out = ctx.getImageData(0, 0, dots, h)
  dither(out)
  return out
}

function composeQr(src: ImageData, dots: number): ImageData {
  const side = Math.round(dots * QR_WIDTH_RATIO)
  const quiet = Math.round(side * QR_QUIET_RATIO)
  const box = side + quiet * 2

  const ctx = canvasOf(dots, box)
  // Nearest-neighbour: a smoothed QR is a grey mush that the threshold below
  // then rounds into ragged modules.
  ctx.imageSmoothingEnabled = false
  // Square regardless of what was uploaded — a stretched QR does not scan.
  ctx.drawImage(toCanvas(src), Math.round((dots - side) / 2), quiet, side, side)

  const out = ctx.getImageData(0, 0, dots, box)
  threshold(out, otsu(out))
  return out
}

function toCanvas(img: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser cannot prepare print images.")
  ctx.putImageData(img, 0, 0)
  return canvas
}

async function loadPixels(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file)
  try {
    const ctx = canvasOf(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/**
 * Payment QRs are usually handed over as a screenshot with a wide white
 * surround. Cropping it back lets the code itself use the paper.
 */
function trimWhiteBorder(img: ImageData): ImageData {
  const near = 230
  let top = 0
  let left = 0
  let right = img.width - 1
  let bottom = img.height - 1

  const rowBlank = (y: number): boolean => {
    for (let x = 0; x < img.width; x++) if (luma(img, x, y) < near) return false
    return true
  }
  const colBlank = (x: number): boolean => {
    for (let y = top; y <= bottom; y++) if (luma(img, x, y) < near) return false
    return true
  }

  while (top < bottom && rowBlank(top)) top++
  while (bottom > top && rowBlank(bottom)) bottom--
  while (left < right && colBlank(left)) left++
  while (right > left && colBlank(right)) right--

  const w = right - left + 1
  const h = bottom - top + 1
  if (w < 8 || h < 8) return img

  const ctx = canvasOf(w, h)
  ctx.drawImage(toCanvas(img), -left, -top)
  return ctx.getImageData(0, 0, w, h)
}

function luma(img: ImageData, x: number, y: number): number {
  const i = (y * img.width + x) * 4
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3
}

// --- tone reduction ---------------------------------------------------------

/**
 * Floyd–Steinberg. A thermal head has one bit per dot, so a gradient has to be
 * carried by dot density; the flat 128 cutoff the page rasteriser uses is
 * right for black text on white and wrong for a mark with any shading in it.
 */
function dither(img: ImageData): void {
  const { width: w, height: h, data } = img
  const grey = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    grey[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const old = grey[i]
      const next = old < 128 ? 0 : 255
      grey[i] = next
      const err = old - next
      if (x + 1 < w) grey[i + 1] += (err * 7) / 16
      if (y + 1 < h) {
        if (x > 0) grey[i + w - 1] += (err * 3) / 16
        grey[i + w] += (err * 5) / 16
        if (x + 1 < w) grey[i + w + 1] += err / 16
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    const v = grey[i] < 128 ? 0 : 255
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
}

/**
 * `<=`, not `<`: Otsu returns the last level belonging to the dark class, so a
 * clean black-and-white QR — every pixel at 0 or 255 — comes back with a cut of
 * 0. Compared exclusively, nothing is ever below it and the whole code bakes
 * out white.
 */
function threshold(img: ImageData, cut: number): void {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3 <= cut ? 0 : 255
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
}

/**
 * Otsu's method, rather than a fixed 128: a QR photographed off a phone screen
 * or printed on coloured stock has its own idea of what "white" is.
 */
function otsu(img: ImageData): number {
  const hist = new Array<number>(256).fill(0)
  const d = img.data
  const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) {
    hist[Math.round((d[i] + d[i + 1] + d[i + 2]) / 3)]++
  }

  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]

  let sumB = 0
  let wB = 0
  let best = 0
  let cut = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const between = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2)
    if (between > best) {
      best = between
      cut = t
    }
  }
  return cut
}

// --- verification and packing ----------------------------------------------

/**
 * The whole point of the exercise. A payment QR that prints but does not scan
 * is a guest standing at the till with a phone that will not pay, and nobody
 * finds out until service.
 */
function decodes(img: ImageData): boolean {
  try {
    return jsQR(img.data, img.width, img.height) !== null
  } catch {
    return false
  }
}

/** MSB-first, one bit per dot, 1 = burn. Width is a multiple of 8 already. */
function pack(img: ImageData): PrintBitmap {
  const widthBytes = Math.ceil(img.width / 8)
  const out = new Uint8Array(widthBytes * img.height)

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (luma(img, x, y) < 128) out[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return encodeBitmap(img.width, img.height, out)
}
