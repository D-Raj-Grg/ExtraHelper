/**
 * 1-bit bitmaps for thermal printers, and the `GS v 0` bytes that draw them.
 *
 * Branding images are rasterised **once, at upload**, in a browser that has a
 * canvas, and the packed rows are stored on the tenant. The alternative — draw
 * at print time — only ever works for browser-driven printers, and the phone
 * and the headless agent (both byte pipes, neither able to rasterise) would go
 * on printing a slip with no logo on it.
 *
 * Rows are packed MSB-first, one bit per dot, 1 = burn. Width is always a
 * multiple of 8: a raster row goes out as whole bytes, so a width that isn't
 * makes the printer's row wider than the canvas it was measured against.
 *
 * Plain module — no server imports, no DOM. Safe from either side.
 */

/**
 * Printable dots per paper width. Every value is a multiple of 8 — see the row
 * packing note above. Lives here rather than in the browser rasteriser because
 * the server-side text renderer has to pick a variant by the same key.
 */
const DOTS: Record<number, number> = { 58: 384, 76: 416, 80: 576 }

export function printableDots(paperWidthMm: number): number {
  return DOTS[paperWidthMm] ?? 576
}

/** The widths a branding image is baked for, so a job never misses its size. */
export const BAKE_WIDTHS = [384, 416, 576] as const

/** A baked image, ready to print at one specific paper width. */
export type PrintBitmap = {
  w: number
  h: number
  /** Base64 of the packed rows — `ceil(w/8) * h` bytes. */
  data: string
}

/**
 * Bands are 128 rows because the `GS v 0` height field is two bytes and cheap
 * clones choke well before that. Same figure the full-page rasteriser uses.
 */
const BAND_ROWS = 128

/** `GS v 0` — raster bit image, banded. */
export function bitmapToEscPos(bmp: PrintBitmap): number[] {
  const bytes = decodeBase64(bmp.data)
  const widthBytes = Math.ceil(bmp.w / 8)
  const out: number[] = []

  for (let top = 0; top < bmp.h; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bmp.h - top)
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
    const from = top * widthBytes
    for (let i = 0; i < rows * widthBytes; i++) out.push(bytes[from + i] ?? 0)
  }
  return out
}

export function encodeBitmap(w: number, h: number, bytes: Uint8Array): PrintBitmap {
  return { w, h, data: encodeBase64(bytes) }
}

export function decodeBitmapRows(bmp: PrintBitmap): Uint8Array {
  return decodeBase64(bmp.data)
}

/** Rough wire cost of a stored bitmap, for the upload size guard. */
export function bitmapBytes(bmp: PrintBitmap): number {
  return bmp.data.length
}

// `atob`/`btoa` exist in every browser and in Node 16+, so this module stays
// usable from a server action and a client component without a Buffer import.
function encodeBase64(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
