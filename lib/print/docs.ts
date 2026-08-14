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

import { amountInWords, formatDateTime, money } from "@/lib/format"
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
  /**
   * The invoice's Particular / Rate / Qty / Amount table.
   *
   * Every row arrives together rather than one block each, because the columns
   * can only be aligned once the widest rate and amount in the whole table are
   * known — laid out row by row, "NPR 2,800.00" and "NPR 30.00" would not line
   * up. The renderers decide whether the four columns fit at all: on a 58mm
   * roll they do not, and each row degrades to a name line with `qty x rate`
   * under it.
   */
  | {
      kind: "particulars"
      rows: { name: string; rate: string; qty: number; amount: string }[]
    }
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
  items: { description: string; qty: number; unitPriceCents: number; totalCents: number }[]
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
  /** Settled bills are a tax invoice; an unsettled one must not claim to be. */
  settled?: boolean
  /** Absent for a walk-in, and then the line is omitted rather than filled in. */
  customerName?: string
  servedBy?: string | null
  /** Per-bill extras the cashier added, e.g. "Cake plating". */
  charges?: { label: string; amountCents: number }[]
  tipCents?: number
  roundingCents?: number
  note?: string | null
}

/**
 * Same dish at the same rate collapses to one particular.
 *
 * `bill_items` keeps one row per order line, so three teas ordered in three
 * rounds are three rows. A guest reading the slip counts three teas and one
 * price each, and thinks they have been charged wrong. The checkout preview
 * groups them; paper has to group them identically or the two documents
 * disagree about a number the guest is holding.
 */
export function groupParticulars(items: BillDoc["items"]) {
  const by = new Map<string, { name: string; rate: number; qty: number; amount: number }>()
  for (const it of items) {
    const key = `${it.description}|${it.unitPriceCents}`
    const row = by.get(key)
    if (row) {
      row.qty += it.qty
      row.amount += it.totalCents
    } else {
      by.set(key, {
        name: it.description,
        rate: it.unitPriceCents,
        qty: it.qty,
        amount: it.totalCents,
      })
    }
  }
  return [...by.values()]
}


/**
 * Does anything sit between the sub total and the total?
 *
 * Sub total only earns its line when the answer is yes. Otherwise it is the
 * same figure twice, two lines apart, and a guest hunts for the difference
 * between them. Exported because the printed slip and the browser receipt must
 * agree about it — a number showing on one and not the other is exactly the
 * kind of drift that made those two documents diverge in the first place.
 */
export function hasBillAdjustments(r: {
  serviceChargeCents: number
  taxCents: number
  discountCents: number
  tipCents?: number
  roundingCents?: number
  charges?: unknown[]
}): boolean {
  return (
    r.serviceChargeCents > 0 ||
    r.taxCents > 0 ||
    r.discountCents > 0 ||
    (r.tipCents ?? 0) > 0 ||
    (r.roundingCents ?? 0) !== 0 ||
    (r.charges?.length ?? 0) > 0
  )
}

/**
 * Mirrors `components/checkout/invoice-preview.tsx` block for block.
 *
 * That preview is what the cashier reads while settling, and it is the document
 * the restaurant recognises as its invoice — headed rate/qty/amount columns,
 * the total spelled out in words, who served the table. Paper used to say
 * strictly less: `3 x Shikhar Ice … NPR 75.00` with no unit price to check the
 * arithmetic against, and no named customer. Two documents for one transaction
 * is a support call waiting to happen, so this builds the same thing.
 */
export function buildBill(r: BillDoc): PrintDocModel {
  const blocks: DocBlock[] = []
  const settled = r.settled !== false

  if (r.logo) blocks.push({ kind: "image", variants: r.logo, alt: r.tenantName })
  // "Invoice", not "Tax invoice": that phrase is a specific document — issued by
  // a VAT-registered seller, carrying their PAN — and this tenant is neither
  // registered nor printing a PAN. A heading is a claim, and paper is what an
  // inspector reads. "Estimate" for an unsettled bill, which is not yet a
  // record of anything and must not be walked out with as though it were.
  blocks.push({ kind: "title", text: settled ? "INVOICE" : "ESTIMATE" })
  // The name stays even with a logo above it: a mark alone rarely survives a
  // 1-bit thermal head well enough to name the restaurant on a tax document.
  blocks.push({ kind: "subtitle", text: r.tenantName })
  if (r.header) blocks.push({ kind: "line", text: r.header, align: "center" })

  blocks.push(
    { kind: "divider" },
    { kind: "row", label: "Invoice no", value: r.billShortId },
    { kind: "row", label: "Date", value: formatDateTime(r.createdAt, r.timezone) },
    { kind: "line", text: r.destination, align: "left" },
  )
  // A walk-in has no name to print, and "Customer: Walk-in" is a line that
  // tells the guest nothing on the majority of receipts.
  if (r.customerName)
    blocks.push({ kind: "line", text: `Customer: ${r.customerName}`, align: "left" })
  blocks.push({ kind: "divider" })

  blocks.push({
    kind: "particulars",
    rows: groupParticulars(r.items).map((g) => ({
      name: g.name,
      rate: money(g.rate, r.currency),
      qty: g.qty,
      amount: money(g.amount, r.currency),
    })),
  })

  // With nothing to show, the section collapses entirely — including its rule,
  // or the ticket prints two dividers touching.
  const hasAdjustments = hasBillAdjustments(r)
  if (hasAdjustments) {
    blocks.push({ kind: "divider" })
    blocks.push({ kind: "row", label: "Sub total", value: money(r.subtotalCents, r.currency) })
  }
  if (r.serviceChargeCents > 0)
    blocks.push({
      kind: "row",
      label: "Service + pkg",
      value: money(r.serviceChargeCents, r.currency),
    })
  if (r.taxCents > 0)
    blocks.push({ kind: "row", label: "Tax", value: money(r.taxCents, r.currency) })
  for (const c of r.charges ?? [])
    blocks.push({ kind: "row", label: c.label, value: money(c.amountCents, r.currency) })
  // Signed, not just coloured — a discount must read as a subtraction on paper.
  if (r.discountCents > 0)
    blocks.push({
      kind: "row",
      label: "Discount",
      value: `-${money(r.discountCents, r.currency)}`,
    })
  if (r.tipCents && r.tipCents > 0)
    blocks.push({ kind: "row", label: "Tip", value: money(r.tipCents, r.currency) })
  if (r.roundingCents)
    blocks.push({ kind: "row", label: "Round off", value: money(r.roundingCents, r.currency) })

  blocks.push(
    { kind: "divider", char: "=" },
    {
      kind: "row",
      label: "TOTAL",
      value: money(r.totalCents, r.currency),
      bold: true,
      large: true,
    },
    // The figure a guest disputes is the one they misread. Words are the
    // check on the digits, which is why every invoice in the region carries them.
    { kind: "line", text: amountInWords(r.totalCents, r.currency), align: "center" },
  )

  if (r.payments.length) {
    blocks.push({ kind: "divider" })
    for (const pay of r.payments) {
      blocks.push({
        kind: "row",
        label: `Paid · ${pay.method}`,
        value: money(pay.amountCents, r.currency),
      })
    }
    const due = r.totalCents - r.payments.reduce((s, p) => s + p.amountCents, 0)
    if (due > 0)
      blocks.push({ kind: "row", label: "Balance due", value: money(due, r.currency), bold: true })
  }

  if (r.note) blocks.push({ kind: "divider" }, { kind: "line", text: r.note, align: "left" })

  // Who to ask about this table, on the slip the guest keeps. Service duration
  // deliberately absent: the guest has no use for it, and on a bill it reads as
  // a comment on how long they sat.
  if (r.servedBy)
    blocks.push(
      { kind: "divider" },
      { kind: "line", text: `Served by: ${r.servedBy}`, align: "left" },
    )

  // The same sentence the checkout preview carries. A slip handed over before
  // payment is a request, not a record, and the guest must not be able to walk
  // out with it believing otherwise.
  if (!settled)
    blocks.push(
      { kind: "divider" },
      {
        kind: "line",
        text: "This is not a tax invoice — the final bill comes from the counter.",
        align: "center",
        bold: true,
      },
    )

  // Below the money, above the footer: the guest reads the total, then scans.
  if (r.qr) {
    blocks.push({ kind: "divider" })
    if (r.qrCaption) blocks.push({ kind: "line", text: r.qrCaption, align: "center", bold: true })
    blocks.push({ kind: "image", variants: r.qr, alt: r.qrCaption || "Payment QR code" })
  }

  blocks.push(
    { kind: "divider" },
    { kind: "line", text: r.footer || "Thank you — please visit again.", align: "center" },
  )
  if (r.terms) blocks.push({ kind: "line", text: r.terms, align: "center" })

  return { label: settled ? "Receipt" : "Bill", blocks, wantsDrawer: r.openDrawer }
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
