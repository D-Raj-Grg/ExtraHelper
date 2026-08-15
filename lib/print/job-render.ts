/**
 * Turns a queued print job into something a printer will accept.
 *
 * Lives outside the server-action file so the headless print agent can reach
 * it over HTTP with a bearer token, rather than a cookie session. Both callers
 * pass their own Supabase client; RLS does the tenant scoping either way.
 *
 * Rendering happens on demand rather than at enqueue time so a job always
 * describes the order as it is *now*: a ticket amended between queueing and
 * printing comes out amended, not as a stale snapshot.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildBill,
  buildFullKot,
  buildKot,
  buildOrderSlip,
  buildTest,
  type PrintDocModel,
} from "./docs"
import { renderForPrinter } from "./render"
import { brandingFrom, type ReceiptTemplate } from "./branding"
import type { PreparedPrintJob, PrintDoc, PrinterRef } from "./types"

/**
 * Untyped on purpose: the clients are never parameterised with `Database`
 * anywhere in the app, so rows come back loose and the builders below cast
 * what they select.
 */
type Db = SupabaseClient

export type TenantCtx = {
  tenantId: string
  name: string
  currency: string
  timezone: string
}

export const PRINTER_COLS =
  "id, name, connection, host, port, system_name, usb_vendor_id, usb_product_id, usb_interface, usb_endpoint, bt_address, paper_width, render_mode, auto_cut, open_drawer"

export type PrinterRow = {
  id: string
  name: string
  connection: "network" | "usb" | "system" | "bluetooth"
  host: string | null
  port: number
  system_name: string | null
  usb_vendor_id: string | null
  usb_product_id: string | null
  usb_interface: string | null
  usb_endpoint: string | null
  bt_address: string | null
  paper_width: number
  render_mode: "text" | "image"
  auto_cut: boolean
  open_drawer: boolean
}

export function toRef(row: PrinterRow): PrinterRef {
  return {
    id: row.id,
    name: row.name,
    connection: row.connection,
    host: row.host,
    port: row.port,
    systemName: row.system_name,
    usbVendorId: row.usb_vendor_id,
    usbProductId: row.usb_product_id,
    usbInterface: row.usb_interface,
    usbEndpoint: row.usb_endpoint,
    btAddress: row.bt_address,
    paperWidth: row.paper_width,
    renderMode: row.render_mode,
    autoCut: row.auto_cut,
    openDrawer: row.open_drawer,
  }
}

type JobRow = {
  id: string
  doc: PrintDoc
  printer_id: string | null
  kot_id: string | null
  bill_id: string | null
  order_id: string | null
  copies: number
  attempts: number
}

/**
 * Turn a claimed job into bytes. Used by the browser worker (through a server
 * action) and by the headless print agent (through /api/print/render), so the
 * two always print the same page.
 */
export async function renderJobWith(
  supabase: Db,
  tenant: TenantCtx,
  jobId: string,
): Promise<PreparedPrintJob | { error: string }> {
  const { data: jobRow } = await supabase
    .from("print_jobs")
    .select("id, doc, printer_id, kot_id, bill_id, order_id, copies, attempts")
    .eq("id", jobId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!jobRow) return { error: "That print job no longer exists." }
  const job = jobRow as JobRow

  let printer: PrinterRef | null = null
  if (job.printer_id) {
    const { data } = await supabase
      .from("printers")
      .select(PRINTER_COLS)
      .eq("id", job.printer_id)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle()
    if (data) printer = toRef(data as PrinterRow)
  }

  const built = await buildForJob(
    supabase,
    job,
    tenant,
    await printedBefore(supabase, tenant.tenantId, job),
  )
  if ("error" in built) return built

  return {
    jobId: job.id,
    printer,
    payload: renderForPrinter(built.doc, printer),
    fallbackUrl: job.kot_id
      ? `/kot/${job.kot_id}`
      : job.bill_id
        ? `/receipt/${job.bill_id}`
        : null,
    label: built.doc.label,
    copies: job.copies,
  }
}

/**
 * Has this exact document already come out of a printer?
 *
 * Deliberately *not* `attempts > 0`. A job that failed because the printer was
 * out of paper and was then retried has attempts, but the kitchen has never
 * seen the ticket — stamping it "REPRINT" tells a cook the food is already on.
 * What matters is whether a job for the same document ever reached `printed`.
 */
async function printedBefore(supabase: Db, tenantId: string, job: JobRow): Promise<boolean> {
  const ref = job.kot_id
    ? (["kot_id", job.kot_id] as const)
    : job.bill_id
      ? (["bill_id", job.bill_id] as const)
      : job.order_id
        ? (["order_id", job.order_id] as const)
        : null
  if (!ref) return false

  const { count } = await supabase
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("doc", job.doc)
    .eq(ref[0], ref[1])
    .eq("status", "printed")
    .neq("id", job.id)

  return (count ?? 0) > 0
}

async function buildForJob(
  supabase: Db,
  job: JobRow,
  tenant: TenantCtx,
  reprint: boolean,
): Promise<{ doc: PrintDocModel } | { error: string }> {
  switch (job.doc) {
    case "kot":
    case "bot":
      return job.kot_id
        ? buildKotDoc(supabase, job.kot_id, tenant, job.doc, reprint)
        : { error: "That ticket no longer exists." }
    case "full_kot":
      return job.order_id
        ? buildFullKotDoc(supabase, job.order_id, tenant, reprint)
        : { error: "That order no longer exists." }
    case "order_slip":
      return job.order_id
        ? buildOrderSlipDoc(supabase, job.order_id, tenant)
        : { error: "That order no longer exists." }
    // Same paper either way — `buildBill` decides "tax invoice" from the bill's
    // own status, not from which document asked for it.
    case "bill":
    case "receipt":
      return job.bill_id
        ? buildBillDoc(supabase, job.bill_id, tenant)
        : { error: "That bill no longer exists." }
    case "test":
      return buildTestDoc(supabase, job.printer_id, tenant)
  }
}

// --- kitchen / bar ticket ---------------------------------------------------

type KotRow = {
  id: string
  created_at: string
  kitchen_stations: { name: string } | null
  orders: { order_type: string; restaurant_tables: { label: string } | null } | null
  kot_items: {
    qty: number
    order_items: {
      name_snapshot: string
      notes: string | null
      seat: number | null
      is_void: boolean
      order_item_modifiers: { name_snapshot: string; qty: number }[] | null
    } | null
  }[]
}

const KOT_SELECT =
  "id, created_at, kitchen_stations(name), orders(order_type, restaurant_tables!orders_table_id_fkey(label)), kot_items(qty, order_items(name_snapshot, notes, seat, is_void, order_item_modifiers(name_snapshot, qty)))"

async function buildKotDoc(
  supabase: Db,
  kotId: string,
  tenant: TenantCtx,
  doc: "kot" | "bot",
  reprint: boolean,
): Promise<{ doc: PrintDocModel } | { error: string }> {
  const { data } = await supabase
    .from("kots")
    .select(KOT_SELECT)
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!data) return { error: "That ticket no longer exists." }
  const kot = data as unknown as KotRow

  return {
    doc: buildKot(
      {
        station: kot.kitchen_stations?.name ?? "Expo",
        destination: destinationOf(kot.orders),
        shortId: kot.id.slice(0, 8).toUpperCase(),
        createdAt: kot.created_at,
        timezone: tenant.timezone,
        reprint,
        // A line voided after the ticket was queued must not be cooked.
        items: kot.kot_items
          .filter((ki) => ki.order_items && !ki.order_items.is_void)
          .map((ki) => ({
            name: ki.order_items?.name_snapshot ?? "item",
            qty: ki.qty,
            seat: ki.order_items?.seat,
            notes: ki.order_items?.notes,
            modifiers: (ki.order_items?.order_item_modifiers ?? []).map((m) => ({
              name: m.name_snapshot,
              qty: m.qty,
            })),
          })),
      },
      doc,
    ),
  }
}

function destinationOf(
  order: { order_type: string; restaurant_tables: { label: string } | null } | null,
): string {
  const table = order?.restaurant_tables?.label
  if (table) return `Table ${table}`
  return (order?.order_type ?? "dine_in").replace("_", " ")
}

// --- full KOT ---------------------------------------------------------------

async function buildFullKotDoc(
  supabase: Db,
  orderId: string,
  tenant: TenantCtx,
  reprint: boolean,
): Promise<{ doc: PrintDocModel } | { error: string }> {
  const [{ data: order }, { data: kots }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, created_at, order_type, restaurant_tables!orders_table_id_fkey(label)")
      .eq("id", orderId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("kots")
      .select(KOT_SELECT)
      .eq("order_id", orderId)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at"),
  ])
  if (!order) return { error: "That order no longer exists." }

  const groups = new Map<string, { name: string; qty: number; seat: number | null; notes: string | null; modifiers: { name: string; qty: number }[] }[]>()
  for (const row of (kots ?? []) as unknown as KotRow[]) {
    const station = row.kitchen_stations?.name ?? "Expo"
    const list = groups.get(station) ?? []
    for (const ki of row.kot_items) {
      if (!ki.order_items || ki.order_items.is_void) continue
      list.push({
        name: ki.order_items.name_snapshot,
        qty: ki.qty,
        seat: ki.order_items.seat,
        notes: ki.order_items.notes,
        modifiers: (ki.order_items.order_item_modifiers ?? []).map((m) => ({
          name: m.name_snapshot,
          qty: m.qty,
        })),
      })
    }
    groups.set(station, list)
  }

  const o = order as unknown as {
    id: string
    created_at: string
    order_type: string
    restaurant_tables: { label: string } | null
  }

  return {
    doc: buildFullKot({
      destination: destinationOf(o),
      shortId: o.id.slice(0, 8).toUpperCase(),
      createdAt: o.created_at,
      timezone: tenant.timezone,
      reprint,
      stations: [...groups.entries()]
        .filter(([, items]) => items.length > 0)
        .map(([station, items]) => ({ station, items })),
    }),
  }
}

// --- order slip -------------------------------------------------------------

async function buildOrderSlipDoc(
  supabase: Db,
  orderId: string,
  tenant: TenantCtx,
): Promise<{ doc: PrintDocModel } | { error: string }> {
  const [{ data: order }, { data: settings }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, created_at, order_type, guests, waiter_id, restaurant_tables!orders_table_id_fkey(label), order_items(name_snapshot, qty, unit_price_cents, notes, is_void, order_item_modifiers(name_snapshot, qty, price_cents))",
      )
      .eq("id", orderId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("tenant_settings")
      .select("receipt_template")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
  ])
  if (!order) return { error: "That order no longer exists." }

  const o = order as unknown as {
    id: string
    created_at: string
    order_type: string
    guests: number | null
    waiter_id: string | null
    restaurant_tables: { label: string } | null
    order_items: {
      name_snapshot: string
      qty: number
      unit_price_cents: number
      notes: string | null
      is_void: boolean
      order_item_modifiers: { name_snapshot: string; qty: number; price_cents: number }[] | null
    }[]
  }
  const template = (settings?.receipt_template ?? {}) as { header?: string; footer?: string }

  // Who to go back to about this order. Fetched separately rather than joined,
  // because `orders.waiter_id` points at auth users, not at a tenant table.
  let waiter: string | null = null
  if (o.waiter_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", o.waiter_id)
      .maybeSingle()
    waiter = (profile?.full_name as string | null) ?? null
  }

  const items = o.order_items
    .filter((it) => !it.is_void)
    .map((it) => {
      const mods = it.order_item_modifiers ?? []
      const modCents = mods.reduce((n, m) => n + m.price_cents * m.qty, 0)
      return {
        name: it.name_snapshot,
        qty: it.qty,
        notes: it.notes,
        modifiers: mods.map((m) => ({ name: m.name_snapshot, qty: m.qty })),
        totalCents: (it.unit_price_cents + modCents) * it.qty,
      }
    })

  return {
    doc: buildOrderSlip({
      tenantName: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone,
      header: template.header,
      footer: template.footer,
      shortId: o.id.slice(0, 8).toUpperCase(),
      destination: destinationOf(o),
      createdAt: o.created_at,
      waiter,
      guests: o.guests,
      items,
      subtotalCents: items.reduce((n, it) => n + it.totalCents, 0),
    }),
  }
}

// --- bill -------------------------------------------------------------------

async function buildBillDoc(
  supabase: Db,
  billId: string,
  tenant: TenantCtx,
): Promise<{ doc: PrintDocModel } | { error: string }> {
  const [{ data: bill }, { data: items }, { data: payments }, { data: settings }, { data: orders }, { data: charges }] =
    await Promise.all([
      supabase
        .from("bills")
        .select(
          "id, status, created_at, subtotal_cents, tax_cents, service_charge_cents, discount_cents, tip_cents, rounding_cents, note, total_cents, restaurant_tables(label)",
        )
        .eq("id", billId)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
      supabase
        .from("bill_items")
        .select("description, qty, unit_price_cents, total_cents")
        .eq("bill_id", billId)
        .eq("tenant_id", tenant.tenantId),
      supabase
        .from("payments")
        .select("method, amount_cents")
        .eq("bill_id", billId)
        .eq("tenant_id", tenant.tenantId)
        .eq("status", "completed"),
      supabase
        .from("tenant_settings")
        .select("receipt_template")
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
      // A bill can cover several merged orders. Ordered by time so the waiter
      // and customer come from the one that opened the table, not an arbitrary
      // row — merged orders can carry different waiters.
      supabase
        .from("orders")
        .select("created_at, waiter_id, customers(name)")
        .eq("bill_id", billId)
        .eq("tenant_id", tenant.tenantId)
        .order("created_at"),
      supabase
        .from("bill_charges")
        .select("label, amount_cents")
        .eq("bill_id", billId)
        .eq("tenant_id", tenant.tenantId),
    ])
  if (!bill) return { error: "That bill no longer exists." }

  const b = bill as unknown as {
    id: string
    status: string
    created_at: string
    subtotal_cents: number
    tax_cents: number
    service_charge_cents: number
    discount_cents: number
    tip_cents: number
    rounding_cents: number
    note: string | null
    total_cents: number
    restaurant_tables: { label: string } | null
  }
  const template = (settings?.receipt_template ?? {}) as ReceiptTemplate
  const branding = brandingFrom(template)
  const paid = (payments ?? []) as { method: string; amount_cents: number }[]

  const orderRows = (orders ?? []) as unknown as {
    created_at: string
    waiter_id: string | null
    customers: { name: string | null } | null
  }[]
  const first = orderRows[0]

  // One extra round trip, and only when there is a waiter to name.
  let servedBy: string | null = null
  if (first?.waiter_id) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", first.waiter_id)
      .maybeSingle()
    servedBy = (p?.full_name as string | null) ?? (p?.username as string | null) ?? null
  }


  return {
    doc: buildBill({
      tenantName: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone,
      header: template.header,
      footer: template.footer,
      terms: template.terms,
      billShortId: b.id.slice(0, 8).toUpperCase(),
      destination: b.restaurant_tables?.label
        ? `Dine in: Table ${b.restaurant_tables.label}`
        : "Takeaway",
      createdAt: b.created_at,
      items: (items ?? []).map((it) => ({
        description: it.description as string,
        qty: it.qty as number,
        unitPriceCents: it.unit_price_cents as number,
        totalCents: it.total_cents as number,
      })),
      subtotalCents: b.subtotal_cents,
      serviceChargeCents: b.service_charge_cents,
      taxCents: b.tax_cents,
      discountCents: b.discount_cents,
      totalCents: b.total_cents,
      payments: paid.map((p) => ({ method: p.method, amountCents: p.amount_cents })),
      // Only cash needs the drawer to open.
      openDrawer: paid.some((p) => p.method === "cash"),
      logo: branding.logo,
      qr: branding.qr,
      qrCaption: branding.qrCaption,
      // `bills.status` is open | partial | paid | void — only `paid` earns the
      // words "tax invoice" on paper.
      settled: b.status === "paid",
      customerName: first?.customers?.name ?? undefined,
      servedBy,
      charges: (charges ?? []).map((c) => ({
        label: c.label as string,
        amountCents: c.amount_cents as number,
      })),
      tipCents: b.tip_cents,
      roundingCents: b.rounding_cents,
      note: b.note,
    }),
  }
}

// --- test -------------------------------------------------------------------

async function buildTestDoc(
  supabase: Db,
  printerId: string | null,
  tenant: TenantCtx,
): Promise<{ doc: PrintDocModel } | { error: string }> {
  if (!printerId) return { error: "That printer no longer exists." }
  const [{ data }, { data: settings }] = await Promise.all([
    supabase
      .from("printers")
      .select("name, paper_width")
      .eq("id", printerId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("tenant_settings")
      .select("receipt_template")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
  ])
  if (!data) return { error: "That printer no longer exists." }
  const branding = brandingFrom((settings?.receipt_template ?? {}) as ReceiptTemplate)
  return {
    doc: buildTest(data.name as string, data.paper_width as number, branding),
  }
}
