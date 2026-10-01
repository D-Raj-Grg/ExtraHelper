import QRCode from "qrcode"

/**
 * Where the code and the QR go on a flyer template. Every figure is a fraction
 * of the template image, so the same placement holds at any resolution — and
 * the editor preview, the PDF and a re-upload of a sharper copy all agree.
 */
export type FlyerPlacement = {
  /** The coupon-code text box. */
  code: { x: number; y: number; w: number; h: number }
  /** The QR square. `s` is its side as a fraction of the image **width**. */
  qr: { x: number; y: number; s: number }
  /** Text colour, `#rrggbb`. */
  codeColor: string
  /** QR module colour, `#rrggbb`. */
  qrColor: string
  /** Code text height as a fraction of its box height (0.3–1). */
  codeScale: number
  /** White space kept round the QR inside its square, as a fraction of the side. */
  qrInset: number
}

/** A guess at the Sekuwa Dashain template; the owner nudges it from here. */
export const DEFAULT_PLACEMENT: FlyerPlacement = {
  code: { x: 0.3, y: 0.756, w: 0.4, h: 0.032 },
  qr: { x: 0.784, y: 0.703, s: 0.126 },
  codeColor: "#7a2a12",
  qrColor: "#000000",
  codeScale: 0.85,
  qrInset: 0.06,
}

export type FlyerBox = "code" | "qr"

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const HEX = /^#[0-9a-f]{6}$/i

/** `#rrggbb` → 0–1 channels, or null when it isn't one. */
export function parseHex(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number]
}

/** A placement parsed from stored JSON, or null when it is missing or not shaped like one. */
export function parsePlacement(raw: string | null): FlyerPlacement | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<FlyerPlacement>
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v)
    if (
      p.code && p.qr &&
      num(p.code.x) && num(p.code.y) && num(p.code.w) && num(p.code.h) &&
      num(p.qr.x) && num(p.qr.y) && num(p.qr.s) &&
      typeof p.codeColor === "string" && HEX.test(p.codeColor) &&
      typeof p.qrColor === "string" && HEX.test(p.qrColor) &&
      num(p.codeScale) && num(p.qrInset)
    ) {
      return p as FlyerPlacement
    }
  } catch {
    // fall through
  }
  return null
}

/** A stored placement, or the default when it is missing or not shaped like one. */
export function readPlacement(raw: string | null): FlyerPlacement {
  return parsePlacement(raw) ?? DEFAULT_PLACEMENT
}

/** localStorage key: one placement per template file. */
export function placementKey(file: { name: string; size: number }): string {
  return `flyer-placement:${file.name}:${file.size}`
}

export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean }

/**
 * The QR as a module grid. Error correction M: a printed flyer gets creased
 * and smudged, and M survives that without making the square dense enough to
 * need a big print area.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" })
  const { size, data } = qr.modules
  return { size, dark: (r, c) => data[r * size + c] === 1 }
}

/**
 * Horizontal runs of dark modules, as `[row, startCol, length]`. A QR is mostly
 * short runs, so one rectangle per run cuts the PDF's drawing operators by
 * about a third against one per module — which is what keeps 500 pages light.
 */
export function qrRuns(m: QrMatrix): [row: number, col: number, len: number][] {
  const runs: [number, number, number][] = []
  for (let r = 0; r < m.size; r++) {
    let start = -1
    for (let c = 0; c <= m.size; c++) {
      const on = c < m.size && m.dark(r, c)
      if (on && start < 0) start = c
      if (!on && start >= 0) {
        runs.push([r, start, c - start])
        start = -1
      }
    }
  }
  return runs
}

/** The text a flyer QR carries. */
export function flyerPayload(
  mode: "url" | "code",
  code: string,
  makeUrl: (code: string) => string,
): string {
  return mode === "url" ? makeUrl(code) : code
}

/** Browsers and POS scanners can't reach localhost; a flyer pointing at it is a misprint. */
export function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(origin)
}
