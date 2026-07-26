/**
 * Ticket + receipt layouts as ESC/POS.
 *
 * These mirror what the browser-print pages already render — `app/kot/[kotId]`
 * and `components/receipt-view.tsx` — because the browser path stays as the
 * fallback when no print agent is connected. If the two ever say different
 * things, one of them is lying to the kitchen.
 *
 * Plain module: no server imports, so it is safe from either side.
 */

import { formatDateTime, money } from "@/lib/format"
import { EscPos } from "./escpos"

export type KotTicket = {
  station: string
  /** "Table 4" or "DELIVERY" — the destination line under the station. */
  destination: string
  shortId: string
  createdAt: string
  timezone: string
  /** Set on a re-fire so the kitchen doesn't cook a ticket twice. */
  reprint?: boolean
  items: {
    name: string
    qty: number
    seat?: number | null
    modifiers?: { name: string; qty: number }[]
    notes?: string | null
  }[]
}

/**
 * Kitchen ticket. Read across a hot pass at arm's length, so the station and
 * the item lines are double-height and everything else gets out of the way.
 */
export function renderKot(t: KotTicket, paperWidthMm: number): EscPos {
  const p = new EscPos(paperWidthMm)
  p.init().align("center").bold(true).size(2, 2)
  // Double-width: half the columns fit, so a long station name has to wrap
  // here rather than be chopped by the printer.
  p.wrapped(t.station.toUpperCase(), 0, 2)
  p.size(1, 1)
  p.line(t.destination.toUpperCase())
  p.bold(false)
  if (t.reprint) p.line("*** REPRINT ***")
  p.divider()
  p.line(`KOT #${t.shortId}`)
  p.line(formatDateTime(t.createdAt, t.timezone))
  p.divider()

  p.align("left")
  for (const it of t.items) {
    p.bold(true).size(1, 2)
    p.wrapped(`${it.qty} x ${it.name}`)
    p.size(1, 1).bold(false)
    if (it.seat) p.line(`   seat ${it.seat}`)
    for (const m of it.modifiers ?? []) {
      p.wrapped(`+ ${m.name}${m.qty > 1 ? ` x${m.qty}` : ""}`, 3)
    }
    // Allergy and "no onion" live here. Bold so it survives a fast scan.
    if (it.notes) {
      p.bold(true)
      p.wrapped(`** ${it.notes}`, 3)
      p.bold(false)
    }
    p.line()
  }

  p.divider()
  p.align("center")
  const count = t.items.reduce((n, i) => n + i.qty, 0)
  p.line(`${count} item${count === 1 ? "" : "s"}`)
  p.feedCut()
  return p
}

export type ReceiptDoc = {
  tenantName: string
  currency: string
  timezone: string
  header?: string
  footer?: string
  terms?: string
  billShortId: string
  destination: string
  createdAt: string
  items: { description: string; qty: number; totalCents: number }[]
  subtotalCents: number
  serviceChargeCents: number
  taxCents: number
  discountCents: number
  totalCents: number
  payments: { method: string; amountCents: number }[]
  /** Pop the drawer — cash payments only. */
  openDrawer?: boolean
}

/** Customer receipt. Mirrors components/receipt-view.tsx line for line. */
export function renderReceipt(r: ReceiptDoc, paperWidthMm: number): EscPos {
  const p = new EscPos(paperWidthMm)
  p.init().align("center").bold(true).size(1, 2)
  p.line(r.tenantName.toUpperCase())
  p.size(1, 1).bold(false)
  if (r.header) p.wrapped(r.header)
  p.line(r.destination)
  p.line(formatDateTime(r.createdAt, r.timezone))
  p.line(`Bill #${r.billShortId}`)
  p.divider()

  p.align("left")
  for (const it of r.items) {
    // Name on its own line when it would collide with the money column, so the
    // amount is never pushed off the paper.
    const label = `${it.qty} x ${it.description}`
    const amount = money(it.totalCents, r.currency)
    if (label.length + amount.length + 1 > p.cols) {
      p.wrapped(label)
      p.twoCol("", amount)
    } else {
      p.twoCol(label, amount)
    }
  }
  p.divider()

  p.twoCol("Subtotal", money(r.subtotalCents, r.currency))
  if (r.serviceChargeCents > 0)
    p.twoCol("Service + pkg", money(r.serviceChargeCents, r.currency))
  if (r.taxCents > 0) p.twoCol("Tax", money(r.taxCents, r.currency))
  // Signed, not just coloured — a discount must read as a subtraction on paper.
  if (r.discountCents > 0)
    p.twoCol("Discount", `-${money(r.discountCents, r.currency)}`)
  p.divider("=")
  p.bold(true).size(1, 2)
  p.twoCol("TOTAL", money(r.totalCents, r.currency))
  p.size(1, 1).bold(false)

  if (r.payments.length) {
    p.divider()
    for (const pay of r.payments) {
      p.twoCol(`Paid (${pay.method})`, money(pay.amountCents, r.currency))
    }
  }

  p.divider()
  p.align("center")
  p.wrapped(r.footer || "Thank you!")
  if (r.terms) p.wrapped(r.terms)
  if (r.openDrawer) p.drawerKick()
  p.feedCut()
  return p
}

/** Test page — proves the printer, the width and the cut without an order. */
export function renderTest(printerName: string, paperWidthMm: number): EscPos {
  const p = new EscPos(paperWidthMm)
  p.init().align("center").bold(true).size(1, 2)
  p.line("TEST PRINT")
  p.size(1, 1).bold(false)
  p.line(printerName)
  p.divider()
  p.align("left")
  p.line(`Paper: ${paperWidthMm}mm (${p.cols} columns)`)
  // A ruler: if the last character wraps, the width setting is wrong.
  p.line("1234567890".repeat(Math.ceil(p.cols / 10)).slice(0, p.cols))
  p.twoCol("Right column", "0.00")
  p.divider()
  p.align("center")
  p.line("If this fits on one line, you are set.")
  p.feedCut()
  return p
}
