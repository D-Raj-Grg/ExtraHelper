/**
 * ESC/POS command builder for thermal receipt printers.
 *
 * Plain module by design — no `lib/supabase/server` import — so both server
 * actions and client code can pull it in without dragging `next/headers` into
 * the browser bundle.
 *
 * Everything is built as a byte array and handed to the transport as base64,
 * because that is the only lossless way to carry control bytes (0x1B, 0x1D, and
 * the 0x00 terminators) through JSON.
 */

const ESC = 0x1b
const GS = 0x1d

/**
 * Printable columns for a paper width, at the default Font A (12 dots/char).
 *
 * 76mm is the impact-printer width (TM-U220 and its clones) and gives 40, not
 * the 42 the arithmetic suggests — the carriage cannot reach the last two
 * columns. Under-running is free; over-running silently wraps the amount off
 * the money column onto its own line.
 */
export function columnsFor(paperWidthMm: number): number {
  if (paperWidthMm === 58) return 32
  if (paperWidthMm === 76) return 40
  return 48
}

export type Align = "left" | "center" | "right"

/**
 * Accumulates ESC/POS bytes. Text is encoded as CP437 — the code page every
 * ESC/POS printer boots into. Characters outside it (Devanagari, emoji, curly
 * quotes) have no byte, so they are transliterated or dropped rather than
 * emitted as mojibake.
 */
export class EscPos {
  private bytes: number[] = []
  readonly cols: number

  constructor(paperWidthMm: number) {
    this.cols = columnsFor(paperWidthMm)
  }

  private push(...b: number[]): this {
    this.bytes.push(...b)
    return this
  }

  /** ESC @ — reset to a known state. Always the first thing on the wire. */
  init(): this {
    return this.push(ESC, 0x40)
  }

  align(a: Align): this {
    return this.push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0)
  }

  bold(on: boolean): this {
    return this.push(ESC, 0x45, on ? 1 : 0)
  }

  /** GS ! — character magnification, 1–2× in each axis. */
  size(w: 1 | 2, h: 1 | 2): this {
    return this.push(GS, 0x21, ((w - 1) << 4) | (h - 1))
  }

  /** Raw text, no newline. */
  text(s: string): this {
    return this.push(...encodeCp437(s))
  }

  /** Text plus CR/LF. Empty call feeds one blank line. */
  line(s = ""): this {
    return this.text(s).push(0x0a)
  }

  /**
   * Wraps at the paper width so long dish names never truncate silently. Pass
   * `magnify` when the text is double-width — the paper does not get wider, so
   * the usable column count halves.
   */
  wrapped(s: string, indent = 0, magnify = 1): this {
    const width = Math.max(1, Math.floor(this.cols / magnify) - indent)
    const pad = " ".repeat(indent)
    for (const word of wrapText(s, width)) this.line(pad + word)
    return this
  }

  divider(char = "-"): this {
    return this.line(char.repeat(this.cols))
  }

  /**
   * Left label + right value on one row — the money layout. The value is never
   * truncated (a clipped total is worse than a clipped name); the label gives
   * way instead.
   */
  twoCol(left: string, right: string, width = this.cols): this {
    const room = Math.max(0, width - right.length - 1)
    const l = left.length > room ? left.slice(0, room) : left
    const gap = width - l.length - right.length
    return this.line(l + " ".repeat(Math.max(1, gap)) + right)
  }

  /**
   * Pre-built raster bytes, straight onto the wire. Deliberately not routed
   * through `text()`: the CP437 encoder below turns every byte outside
   * 0x20–0x7E into '?', which would shred a bit image into gibberish the
   * printer then tries to read as commands.
   */
  raster(bytes: number[]): this {
    // Appended, not spread: a full-width QR is ~30,000 bytes and `push(...b)`
    // puts every one of them on the argument stack.
    for (const b of bytes) this.bytes.push(b)
    return this
  }

  /** ESC p — pop the cash drawer wired to the printer. */
  drawerKick(): this {
    return this.push(ESC, 0x70, 0x00, 0x19, 0xfa)
  }

  /** Feed clear of the tear bar, then partial cut. Always last. */
  feedCut(): this {
    return this.push(0x0a, 0x0a, 0x0a, 0x0a).push(GS, 0x56, 0x42, 0x00)
  }

  toBase64(): string {
    return Buffer.from(Uint8Array.from(this.bytes)).toString("base64")
  }

  /** Byte view — for tests and byte-level assertions. */
  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

/** Greedy wrap; a word longer than the line is hard-split rather than lost. */
export function wrapText(s: string, width: number): string[] {
  const out: string[] = []
  let line = ""
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      out.push(line)
      line = word
    }
    while (line.length > width) {
      out.push(line.slice(0, width))
      line = line.slice(width)
    }
  }
  if (line) out.push(line)
  return out.length ? out : [""]
}

/** Typographic characters a receipt picks up from templates and item names. */
const TRANSLITERATE: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
  "₹": "Rs.",
  "₨": "Rs.",
  // Separators the app's own labels use — "Paid · cash", "− 50.00", "3 × tea".
  // Without these the receipt prints "Paid ? cash", which reads as a fault in
  // the printer rather than a glyph this code page never had.
  "·": "-",
  "•": "-",
  "−": "-",
  "×": "x",
}

/**
 * CP437 is a straight pass-through for ASCII, which is all a ticket needs once
 * smart punctuation is folded. Anything else becomes '?' — a visible gap beats
 * a stream of garbage bytes the printer may interpret as commands.
 */
function encodeCp437(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const mapped = TRANSLITERATE[ch] ?? ch
    for (const c of mapped) {
      const code = c.charCodeAt(0)
      out.push(code >= 0x20 && code <= 0x7e ? code : code === 0x0a ? 0x0a : 0x3f)
    }
  }
  return out
}
