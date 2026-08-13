/**
 * The document model every printed page is described in.
 *
 * There are two renderers — ESC/POS bytes and an HTML page — because a
 * single-byte code page cannot print Devanagari, and a rasterised page is
 * slower and softer than native text. Both have to say the same thing, so
 * neither of them knows what a bill is: they only know rows, items and
 * dividers. The builders below are the only place that decides what goes on a
 * ticket, which is what keeps the kitchen's copy and the guest's copy honest.
 *
 * Plain module — no server imports, safe from either side.
 */

import { formatDateTime, money } from "@/lib/format"
import type { PrintBitmap } from "./bitmap"

export type DocAlign = "left" | "center" | "right"

/**
 * One baked bitmap per printable width. A `GS v 0` image is sent at its own
 * size — the printer will not scale it — so the 58mm roll needs its own copy,
 * and each is already padded to the full width so the centring is in the
 * pixels rather than in a justification command cheap clones may ignore.
 */
export type DocImage = Record<string, PrintBitmap>

export type DocBlock =
  /** The one thing readable across a hot pass: station, or the restaurant. */
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  /** Centred, bold, unmissable: "*** REPRINT ***", "*** VOID ***". */
  | { kind: "banner"; text: string }
  | { kind: "line"; text: string; align?: DocAlign; bold?: boolean }
  | { kind: "divider"; char?: "-" | "=" }
  | { kind: "space" }
  /** A dish. `amount` present means the guest is looking at it. */
  | {
      kind: "item"
      qty: number
      name: string
      seat?: number | null
      modifiers?: { name: string; qty: number }[]
      notes?: string | null
      amount?: string
      /** Kitchen copies set this: double height, read at arm's length. */
      emphasis?: boolean
    }
  | { kind: "row"; label: string; value: string; bold?: boolean; large?: boolean }
  /** A column ruler; only the test page uses it. */
  | { kind: "ruler" }
  /**
   * A baked bitmap — the tenant's logo, or the payment QR they uploaded.
   * `alt` is what the HTML surfaces read out; paper shows the pixels.
   */
  | { kind: "image"; variants: DocImage; alt: string }

export type PrintDocModel = {
  /** Shown in toasts and the job list, never printed. */
  label: string
  blocks: DocBlock[]
  /** Cash only, and only if the printer has a drawer wired to it. */
  wantsDrawer?: boolean
}

// ---------------------------------------------------------------------------
// Kitchen and bar tickets
// ---------------------------------------------------------------------------

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
 * Kitchen or bar ticket. No prices anywhere: a cook deciding between two
 * dishes by margin is not a thing that should be possible.
 */
export function buildKot(t: KotTicket, doc: "kot" | "bot" = "kot"): PrintDocModel {
  const blocks: DocBlock[] = [
    { kind: "title", text: t.station.toUpperCase() },
    { kind: "subtitle", text: t.destination.toUpperCase() },
  ]
  if (t.reprint) blocks.push({ kind: "banner", text: "*** REPRINT ***" })
  blocks.push(
    { kind: "divider" },
    { kind: "line", text: `${doc === "bot" ? "BOT" : "KOT"} #${t.shortId}` },
    { kind: "line", text: formatDateTime(t.createdAt, t.timezone) },
    { kind: "divider" },
  )

  for (const it of t.items) {
    blocks.push({
      kind: "item",
      qty: it.qty,
      name: it.name,
      seat: it.seat,
      modifiers: it.modifiers,
      notes: it.notes,
      emphasis: true,
    })
    blocks.push({ kind: "space" })
  }

  const count = t.items.reduce((n, i) => n + i.qty, 0)
  blocks.push(
    { kind: "divider" },
    { kind: "line", text: `${count} item${count === 1 ? "" : "s"}`, align: "center" },
  )
  return { label: t.station || (doc === "bot" ? "Bar ticket" : "Kitchen ticket"), blocks }
}

// ---------------------------------------------------------------------------
// Full KOT — the pass's copy of the whole order
// ---------------------------------------------------------------------------

export type FullKotTicket = {
  destination: string
  shortId: string
  createdAt: string
  timezone: string
  reprint?: boolean
  /** Grouped by station so the expo can see who owes what. */
  stations: {
    station: string
    items: {
      name: string
      qty: number
      seat?: number | null
      modifiers?: { name: string; qty: number }[]
      notes?: string | null
    }[]
  }[]
}

export function buildFullKot(t: FullKotTicket): PrintDocModel {
  const blocks: DocBlock[] = [
    { kind: "title", text: "FULL KOT" },
    { kind: "subtitle", text: t.destination.toUpperCase() },
  ]
  if (t.reprint) blocks.push({ kind: "banner", text: "*** REPRINT ***" })
  blocks.push(
    { kind: "divider" },
    { kind: "line", text: `Order #${t.shortId}` },
    { kind: "line", text: formatDateTime(t.createdAt, t.timezone) },
    { kind: "divider" },
  )

  for (const group of t.stations) {
    // The station heading is what makes this different from a KOT — the pass
    // reads it to know which window the dish is coming out of.
    blocks.push({ kind: "line", text: group.station.toUpperCase(), bold: true })
    for (const it of group.items) {
      blocks.push({
        kind: "item",
        qty: it.qty,
        name: it.name,
        seat: it.seat,
        modifiers: it.modifiers,
        notes: it.notes,
        emphasis: true,
      })
    }
    blocks.push({ kind: "space" })
  }

  const count = t.stations.reduce(
    (n, g) => n + g.items.reduce((m, i) => m + i.qty, 0),
    0,
  )
  blocks.push(
    { kind: "divider" },
    { kind: "line", text: `${count} item${count === 1 ? "" : "s"}`, align: "center" },
  )
  return { label: "Full KOT", blocks }
}

// ---------------------------------------------------------------------------
// Order slip — what the guest or the waiter holds
// ---------------------------------------------------------------------------

export type OrderSlipDoc = {
  tenantName: string
  currency: string
  timezone: string
  header?: string
  footer?: string
  shortId: string
  destination: string
  createdAt: string
  waiter?: string | null
  guests?: number | null
  items: {
    name: string
    qty: number
    modifiers?: { name: string; qty: number }[]
    notes?: string | null
    totalCents: number
  }[]
  subtotalCents: number
}

/**
 * Prices, but no tax and no total-due — this is a confirmation of what was
 * ordered, not a demand for money. Calling it a bill is how guests end up
 * paying twice.
 */
export function buildOrderSlip(o: OrderSlipDoc): PrintDocModel {
  const blocks: DocBlock[] = [
    { kind: "title", text: o.tenantName.toUpperCase() },
    { kind: "banner", text: "ORDER SLIP" },
  ]
  if (o.header) blocks.push({ kind: "line", text: o.header, align: "center" })
  blocks.push(
    { kind: "line", text: o.destination, align: "center" },
    { kind: "line", text: formatDateTime(o.createdAt, o.timezone), align: "center" },
    { kind: "line", text: `Order #${o.shortId}`, align: "center" },
  )
  if (o.waiter) blocks.push({ kind: "line", text: `Served by ${o.waiter}`, align: "center" })
  if (o.guests) blocks.push({ kind: "line", text: `${o.guests} guests`, align: "center" })
  blocks.push({ kind: "divider" })

  for (const it of o.items) {
    blocks.push({
      kind: "item",
      qty: it.qty,
      name: it.name,
      modifiers: it.modifiers,
      notes: it.notes,
      amount: money(it.totalCents, o.currency),
    })
  }

  blocks.push(
    { kind: "divider" },
    { kind: "row", label: "Subtotal", value: money(o.subtotalCents, o.currency), bold: true },
    // Said plainly, because a slip with prices on it looks exactly like a bill.
    { kind: "line", text: "Taxes and charges are added on the bill.", align: "center" },
    { kind: "divider" },
    { kind: "line", text: o.footer || "Thank you!", align: "center" },
  )
  return { label: "Order slip", blocks }
}

// ---------------------------------------------------------------------------
// Bill / receipt
// ---------------------------------------------------------------------------

export type BillDoc = {
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
  openDrawer?: boolean
  /** Baked branding — absent when the tenant has uploaded none. */
  logo?: DocImage
  qr?: DocImage
  qrCaption?: string
}

/** Mirrors components/receipt-view.tsx line for line. */
export function buildBill(r: BillDoc): PrintDocModel {
  const blocks: DocBlock[] = []
  if (r.logo) blocks.push({ kind: "image", variants: r.logo, alt: r.tenantName })
  // The name stays even with a logo above it: a mark alone rarely survives a
  // 1-bit thermal head well enough to name the restaurant on a tax document.
  blocks.push({ kind: "title", text: r.tenantName.toUpperCase() })
  if (r.header) blocks.push({ kind: "line", text: r.header, align: "center" })
  blocks.push(
    { kind: "line", text: r.destination, align: "center" },
    { kind: "line", text: formatDateTime(r.createdAt, r.timezone), align: "center" },
    { kind: "line", text: `Bill #${r.billShortId}`, align: "center" },
    { kind: "divider" },
  )

  for (const it of r.items) {
    blocks.push({
      kind: "item",
      qty: it.qty,
      name: it.description,
      amount: money(it.totalCents, r.currency),
    })
  }

  blocks.push({ kind: "divider" })
  blocks.push({ kind: "row", label: "Subtotal", value: money(r.subtotalCents, r.currency) })
  if (r.serviceChargeCents > 0)
    blocks.push({
      kind: "row",
      label: "Service + pkg",
      value: money(r.serviceChargeCents, r.currency),
    })
  if (r.taxCents > 0)
    blocks.push({ kind: "row", label: "Tax", value: money(r.taxCents, r.currency) })
  // Signed, not just coloured — a discount must read as a subtraction on paper.
  if (r.discountCents > 0)
    blocks.push({
      kind: "row",
      label: "Discount",
      value: `-${money(r.discountCents, r.currency)}`,
    })
  blocks.push(
    { kind: "divider", char: "=" },
    { kind: "row", label: "TOTAL", value: money(r.totalCents, r.currency), bold: true, large: true },
  )

  if (r.payments.length) {
    blocks.push({ kind: "divider" })
    for (const pay of r.payments) {
      blocks.push({
        kind: "row",
        label: `Paid (${pay.method})`,
        value: money(pay.amountCents, r.currency),
      })
    }
  }

  // Below the money, above the footer: the guest reads the total, then scans.
  if (r.qr) {
    blocks.push({ kind: "divider" })
    if (r.qrCaption) blocks.push({ kind: "line", text: r.qrCaption, align: "center", bold: true })
    blocks.push({ kind: "image", variants: r.qr, alt: r.qrCaption || "Payment QR code" })
  }

  blocks.push(
    { kind: "divider" },
    { kind: "line", text: r.footer || "Thank you!", align: "center" },
  )
  if (r.terms) blocks.push({ kind: "line", text: r.terms, align: "center" })

  return { label: "Receipt", blocks, wantsDrawer: r.openDrawer }
}

// ---------------------------------------------------------------------------
// Test page
// ---------------------------------------------------------------------------

/** Proves the printer, the width and the cut without burning an order. */
export function buildTest(
  printerName: string,
  paperWidthMm: number,
  branding?: { logo?: DocImage; qr?: DocImage },
): PrintDocModel {
  const blocks: DocBlock[] = []
  if (branding?.logo) blocks.push({ kind: "image", variants: branding.logo, alt: "Logo" })
  blocks.push(
    { kind: "title", text: "TEST PRINT" },
    { kind: "subtitle", text: printerName },
    { kind: "divider" },
    { kind: "line", text: `Paper: ${paperWidthMm}mm` },
    { kind: "ruler" },
    { kind: "row", label: "Right column", value: "0.00" },
    { kind: "divider" },
    // Non-Latin on purpose: in text mode these are '?', in image mode they
    // are legible, and that difference is the whole reason render_mode exists.
    { kind: "line", text: "नमस्ते · Namaste", align: "center" },
    { kind: "line", text: "If this fits on one line, you are set.", align: "center" },
  )
  // Printing the real QR here is the only way to check it scans off paper
  // without settling a bill to find out.
  if (branding?.qr) {
    blocks.push(
      { kind: "divider" },
      { kind: "line", text: "Scan to check the QR prints", align: "center" },
      { kind: "image", variants: branding.qr, alt: "Payment QR code" },
    )
  }
  return { label: printerName, blocks }
}
