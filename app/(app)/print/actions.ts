"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole, requireTenant } from "@/lib/supabase/guards"
import { renderKot, renderReceipt, renderTest } from "@/lib/print/templates"
import type { PreparedPrintJob, PrinterRef, PrintJobStatus } from "@/lib/print/types"

/**
 * Prepares print jobs: resolve the target printer, render ESC/POS, log the job.
 * The bytes are built here rather than in the browser so the layout has one
 * source of truth and a future headless agent can reuse it.
 *
 * A missing printer is never an error — the caller falls back to the browser
 * print page, which is exactly how printing worked before this module.
 */

type PrinterRow = {
  id: string
  name: string
  connection: "network" | "system"
  host: string | null
  port: number
  system_name: string | null
  paper_width: number
}

const PRINTER_COLS = "id, name, connection, host, port, system_name, paper_width"

function toRef(row: PrinterRow): PrinterRef {
  return {
    id: row.id,
    name: row.name,
    connection: row.connection,
    host: row.host,
    port: row.port,
    systemName: row.system_name,
    paperWidth: row.paper_width,
  }
}

/** Default printer for a role, falling back to one flagged 'both'. */
async function defaultPrinter(
  tenantId: string,
  role: "kot" | "receipt",
): Promise<PrinterRef | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("printers")
    .select(`${PRINTER_COLS}, role, is_default`)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", [role, "both"])
    // An exact-role printer beats a shared one; a default beats a spare.
    .order("is_default", { ascending: false })
    .order("role", { ascending: true })
    .limit(10)

  const rows = (data ?? []) as (PrinterRow & { role: string; is_default: boolean })[]
  const exact = rows.find((r) => r.role === role) ?? rows[0]
  return exact ? toRef(exact) : null
}

type KotRow = {
  id: string
  created_at: string
  station_id: string | null
  kitchen_stations: { name: string; printer_id: string | null } | null
  orders: { order_type: string; restaurant_tables: { label: string } | null } | null
  kot_items: {
    qty: number
    order_items: {
      name_snapshot: string
      notes: string | null
      seat: number | null
      order_item_modifiers: { name_snapshot: string; qty: number }[] | null
    } | null
  }[]
}

/** Build the kitchen ticket for one KOT. */
export async function getKotPrintJob(
  kotId: string,
  opts?: { reprint?: boolean },
): Promise<{ error: string } | PreparedPrintJob> {
  const tenant = await requireRole("owner", "manager", "kitchen", "waiter", "cashier")
  const supabase = await createClient()

  // Same shape the browser-print page selects, so the two tickets agree.
  const { data } = await supabase
    .from("kots")
    .select(
      "id, created_at, station_id, kitchen_stations(name, printer_id), orders(order_type, restaurant_tables!orders_table_id_fkey(label)), kot_items(qty, order_items(name_snapshot, notes, seat, order_item_modifiers(name_snapshot, qty)))",
    )
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  if (!data) return { error: "That ticket no longer exists." }
  const kot = data as unknown as KotRow

  // Station printer first — that is the whole point of splitting tickets.
  let printer: PrinterRef | null = null
  const stationPrinterId = kot.kitchen_stations?.printer_id ?? null
  if (stationPrinterId) {
    const { data: row } = await supabase
      .from("printers")
      .select(PRINTER_COLS)
      .eq("id", stationPrinterId)
      .eq("tenant_id", tenant.tenantId)
      .eq("is_active", true)
      .maybeSingle()
    if (row) printer = toRef(row as PrinterRow)
  }
  printer ??= await defaultPrinter(tenant.tenantId, "kot")

  const table = kot.orders?.restaurant_tables?.label
  const doc = renderKot(
    {
      station: kot.kitchen_stations?.name ?? "Expo",
      destination: table
        ? `Table ${table}`
        : (kot.orders?.order_type ?? "dine_in").replace("_", " "),
      shortId: kot.id.slice(0, 8).toUpperCase(),
      createdAt: kot.created_at,
      timezone: tenant.timezone,
      reprint: opts?.reprint,
      items: kot.kot_items.map((ki) => ({
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
    printer?.paperWidth ?? 80,
  )

  // Only log when there is a printer to log against. A shop that prints from
  // the browser shouldn't accumulate a wall of "failed" rows describing a
  // setup it never chose.
  const jobId = printer
    ? await logJob(tenant.tenantId, { printer_id: printer.id, type: "kot", kot_id: kot.id })
    : ""

  return {
    jobId,
    printer,
    dataBase64: doc.toBase64(),
    fallbackUrl: `/kot/${kot.id}`,
    label: kot.kitchen_stations?.name ?? "Kitchen ticket",
  }
}

type BillRow = {
  id: string
  created_at: string
  subtotal_cents: number
  tax_cents: number
  service_charge_cents: number
  discount_cents: number
  total_cents: number
  restaurant_tables: { label: string } | null
}

/** Build the customer receipt for one bill. */
export async function getBillPrintJob(
  billId: string,
): Promise<{ error: string } | PreparedPrintJob> {
  const tenant = await requireRole("owner", "manager", "cashier")
  const supabase = await createClient()

  const [{ data: bill }, { data: items }, { data: payments }, { data: settings }] =
    await Promise.all([
      supabase
        .from("bills")
        .select(
          "id, created_at, subtotal_cents, tax_cents, service_charge_cents, discount_cents, total_cents, restaurant_tables(label)",
        )
        .eq("id", billId)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
      supabase
        .from("bill_items")
        .select("description, qty, total_cents")
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
    ])

  if (!bill) return { error: "That bill no longer exists." }
  const b = bill as unknown as BillRow
  const template = (settings?.receipt_template ?? {}) as {
    header?: string
    footer?: string
    terms?: string
  }
  const paid = (payments ?? []) as { method: string; amount_cents: number }[]
  const printer = await defaultPrinter(tenant.tenantId, "receipt")

  const doc = renderReceipt(
    {
      tenantName: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone,
      header: template.header,
      footer: template.footer,
      terms: template.terms,
      billShortId: b.id.slice(0, 8).toUpperCase(),
      destination: b.restaurant_tables?.label
        ? `Table ${b.restaurant_tables.label}`
        : "Takeaway",
      createdAt: b.created_at,
      items: (items ?? []).map((it) => ({
        description: it.description as string,
        qty: it.qty as number,
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
    },
    printer?.paperWidth ?? 80,
  )

  const jobId = printer
    ? await logJob(tenant.tenantId, { printer_id: printer.id, type: "receipt", bill_id: b.id })
    : ""

  return {
    jobId,
    printer,
    dataBase64: doc.toBase64(),
    fallbackUrl: `/receipt/${b.id}`,
    label: "Receipt",
  }
}

/** Test page for one printer — proves the wiring without burning an order. */
export async function getTestPrintJob(
  printerId: string,
): Promise<{ error: string } | PreparedPrintJob> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()

  const { data } = await supabase
    .from("printers")
    .select(PRINTER_COLS)
    .eq("id", printerId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!data) return { error: "That printer no longer exists." }

  const printer = toRef(data as PrinterRow)
  const doc = renderTest(printer.name, printer.paperWidth)
  const jobId = await logJob(tenant.tenantId, {
    printer_id: printer.id,
    type: "test",
  })

  // No browser fallback: a test page only means anything on real hardware.
  return { jobId, printer, dataBase64: doc.toBase64(), fallbackUrl: null, label: printer.name }
}

/** Insert the queued job row; returns its id ("" if logging failed). */
async function logJob(
  tenantId: string,
  fields: {
    printer_id: string | null
    type: "kot" | "receipt" | "test"
    kot_id?: string
    bill_id?: string
  },
): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("print_jobs")
    .insert({ tenant_id: tenantId, status: "queued", ...fields })
    .select("id")
    .maybeSingle()
  return (data?.id as string) ?? ""
}

/**
 * Record what actually happened. Stamping `printed_at` here — rather than when
 * the print page loads — is what makes "printed" mean printed.
 */
export async function recordPrintJob(
  jobId: string,
  status: PrintJobStatus,
  error?: string,
): Promise<{ ok: true } | { error: string }> {
  const tenant = await requireTenant()
  if (!jobId) return { ok: true }
  const supabase = await createClient()

  const { data: job } = await supabase
    .from("print_jobs")
    .select("attempts, kot_id")
    .eq("id", jobId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!job) return { error: "Unknown print job." }

  const { error: err } = await supabase
    .from("print_jobs")
    .update({
      status,
      attempts: ((job.attempts as number) ?? 0) + 1,
      error: error?.slice(0, 500) ?? null,
      printed_at: status === "printed" ? new Date().toISOString() : null,
    })
    .eq("id", jobId)
    .eq("tenant_id", tenant.tenantId)
  if (err) return { error: err.message }

  if (status === "printed" && job.kot_id) {
    await supabase
      .from("kots")
      .update({ printed_at: new Date().toISOString() })
      .eq("id", job.kot_id as string)
      .eq("tenant_id", tenant.tenantId)
  }

  revalidatePath("/settings")
  return { ok: true }
}
