/**
 * Document model → ESC/POS bytes. The fast path, and what a thermal head is
 * actually built for. Knows nothing about bills or tickets — see docs.ts.
 */

import { EscPos } from "./escpos"
import type { DocBlock, PrintDocModel } from "./docs"

export type RenderOptions = {
  paperWidthMm: number
  /** Off for printers with no cutter — otherwise the codes print as garbage. */
  autoCut: boolean
  /** Only the cashier's printer has a drawer hanging off it. */
  openDrawer: boolean
}

export function renderEscPos(doc: PrintDocModel, opts: RenderOptions): EscPos {
  const p = new EscPos(opts.paperWidthMm)
  p.init()

  for (const b of doc.blocks) block(p, b)

  if (doc.wantsDrawer && opts.openDrawer) p.drawerKick()
  // Always last: anything after a cut lands on the next customer's ticket.
  if (opts.autoCut) p.feedCut()
  else p.line().line().line()
  return p
}

function block(p: EscPos, b: DocBlock): void {
  switch (b.kind) {
    case "title":
      p.align("center").bold(true).size(2, 2)
      // Double-width halves the usable columns, so a long station name has to
      // wrap here rather than be chopped by the printer.
      p.wrapped(b.text, 0, 2)
      p.size(1, 1).bold(false).align("left")
      return

    case "subtitle":
      p.align("center").bold(true)
      p.wrapped(b.text)
      p.bold(false).align("left")
      return

    case "banner":
      p.align("center").bold(true)
      p.wrapped(b.text)
      p.bold(false).align("left")
      return

    case "line":
      p.align(b.align ?? "center")
      if (b.bold) p.bold(true)
      p.wrapped(b.text)
      if (b.bold) p.bold(false)
      p.align("left")
      return

    case "divider":
      p.align("left").divider(b.char ?? "-")
      return

    case "space":
      p.line()
      return

    case "ruler":
      p.align("left")
      p.line("1234567890".repeat(Math.ceil(p.cols / 10)).slice(0, p.cols))
      return

    case "item":
      return item(p, b)

    case "row": {
      p.align("left")
      if (b.bold) p.bold(true)
      if (b.large) p.size(1, 2)
      p.twoCol(b.label, b.value)
      if (b.large) p.size(1, 1)
      if (b.bold) p.bold(false)
      return
    }
  }
}

function item(p: EscPos, b: Extract<DocBlock, { kind: "item" }>): void {
  p.align("left")
  const label = `${b.qty} x ${b.name}`

  if (b.amount === undefined) {
    // Kitchen copy: no money column, so the name gets the whole width and the
    // quantity is as large as the dish name.
    if (b.emphasis) p.bold(true).size(1, 2)
    // Double *height* only — the width is unchanged, so the column count holds.
    p.wrapped(label)
    if (b.emphasis) p.size(1, 1).bold(false)
  } else if (label.length + b.amount.length + 1 > p.cols) {
    // Name on its own line when it would collide with the money column, so the
    // amount is never pushed off the paper.
    p.wrapped(label)
    p.twoCol("", b.amount)
  } else {
    p.twoCol(label, b.amount)
  }

  if (b.seat) p.line(`   seat ${b.seat}`)
  for (const m of b.modifiers ?? []) {
    p.wrapped(`+ ${m.name}${m.qty > 1 ? ` x${m.qty}` : ""}`, 3)
  }
  // Allergy and "no onion" live here. Bold so it survives a fast scan.
  if (b.notes) {
    p.bold(true)
    p.wrapped(`** ${b.notes}`, 3)
    p.bold(false)
  }
}
