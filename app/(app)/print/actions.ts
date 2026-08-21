"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireTenant } from "@/lib/supabase/guards"
import { renderJobWith } from "@/lib/print/job-render"
import type { PreparedPrintJob, PrintDoc, PrintJobStatus } from "@/lib/print/types"

/**
 * The print queue's server half.
 *
 * Nothing here decides *whether* something prints — the triggers in
 * 20260731160100_printing_v2.sql do that, so an order placed from the QR menu
 * or the Flutter app queues its tickets without any client being involved.
 * These functions enqueue an explicit (manual) print, hand a claimed job its
 * bytes, and record what happened.
 *
 * Rendering happens here rather than at enqueue time so a job always describes
 * the order as it is *now*: a ticket amended between queueing and printing
 * comes out amended, not as a stale snapshot.
 */

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export type EnqueueInput = {
  doc: PrintDoc
  kotId?: string
  billId?: string
  orderId?: string
  /** day_report only: which business day, as "YYYY-MM-DD". */
  day?: string
  /** Manual "print to this one". Otherwise routing decides. */
  printerId?: string
  /**
   * A reprint carries no idempotency key — asking for a second copy of a
   * ticket that already printed is the entire point.
   */
  reprint?: boolean
}

export type EnqueueResult =
  | { jobIds: string[] }
  | { error: string }
  /** Nothing is set up to print this. The caller offers the browser page. */
  | { noPrinter: true; fallbackUrl: string | null }

export async function enqueuePrint(input: EnqueueInput): Promise<EnqueueResult> {
  const tenant = await requireTenant()
  const supabase = await createClient()

  let doc = input.doc
  let branchId: string | null = null
  // Printer plus the copy count that printer is configured for; a manual
  // reprint has to honour "two copies of every bill" exactly as auto-print does.
  let targets: { printerId: string; copies: number }[] = []

  if ((doc === "kot" || doc === "bot") && input.kotId) {
    const { data } = await supabase
      .from("kots")
      .select("kitchen_stations(kind, printer_id), orders(branch_id)")
      .eq("id", input.kotId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle()
    const kot = data as unknown as {
      kitchen_stations: { kind: "kitchen" | "bar"; printer_id: string | null } | null
      orders: { branch_id: string | null } | null
    } | null

    // The station decides KOT vs BOT, not the caller. A reprint asked for as
    // "kot" from the POS would otherwise put a KOT header on a bar ticket.
    doc = kot?.kitchen_stations?.kind === "bar" ? "bot" : "kot"
    branchId = kot?.orders?.branch_id ?? null

    // A station's own printer wins outright — splitting tickets per station is
    // the whole point of routing, and a document assignment must not
    // second-guess it.
    const routed = kot?.kitchen_stations?.printer_id
    if (routed) targets = [{ printerId: routed, copies: 1 }]
  } else if (doc !== "day_report") {
    branchId = await branchOf(supabase, tenant.tenantId, input)
  }

  if (input.printerId) {
    targets = [{ printerId: input.printerId, copies: 1 }]
  } else if (!targets.length) {
    targets = await routeTo(supabase, tenant.tenantId, doc, branchId)
    // A day close belongs on the counter's roll, and nobody sets up a new
    // document assignment before their first one. Fall back to whichever
    // printer already carries the paper a Z-report is read on — the same
    // reasoning /receipt/[billId] uses to find the counter.
    if (doc === "day_report" && !targets.length) {
      targets = await routeTo(supabase, tenant.tenantId, "receipt", branchId)
      if (!targets.length) targets = await routeTo(supabase, tenant.tenantId, "bill", branchId)
      // One copy: the fallback printer's `receipt` copy count answers a
      // different question ("two slips per sale"), not this one.
      targets = targets.slice(0, 1).map((t) => ({ ...t, copies: 1 }))
    }
  }

  if (!targets.length) {
    return { noPrinter: true, fallbackUrl: fallbackUrlFor(input) }
  }

  if (doc === "day_report") {
    const jobIds: string[] = []
    for (const target of targets) {
      const { data, error } = await supabase.rpc("enqueue_day_report_job", {
        _tenant: tenant.tenantId,
        _printer_id: target.printerId,
        _day: input.day ?? null,
        _copies: target.copies,
        _idem: input.reprint ? null : `day_report:${input.day ?? "today"}:${target.printerId}`,
      })
      if (error) return { error: error.message }
      if (data) jobIds.push(data as string)
    }
    revalidatePath("/settings")
    return { jobIds }
  }

  const jobIds: string[] = []
  for (const target of targets) {
    const ref = input.kotId ?? input.billId ?? input.orderId ?? target.printerId
    const { data, error } = await supabase.rpc("enqueue_print_job", {
      _tenant: tenant.tenantId,
      _doc: doc,
      _printer_id: target.printerId,
      _kot_id: input.kotId ?? null,
      _bill_id: input.billId ?? null,
      _order_id: input.orderId ?? null,
      _copies: target.copies,
      _idem: input.reprint ? null : `${doc}:${ref}:${target.printerId}`,
    })
    if (error) return { error: error.message }
    if (data) jobIds.push(data as string)
  }

  revalidatePath("/settings")
  return { jobIds }
}

/** Printers assigned this document, active, and not tied to a different branch. */
async function routeTo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  doc: PrintDoc,
  branchId: string | null,
): Promise<{ printerId: string; copies: number }[]> {
  const { data } = await supabase
    .from("printer_documents")
    .select("printer_id, copies, printers!inner(is_active, branch_id)")
    .eq("tenant_id", tenantId)
    .eq("doc", doc)

  return (
    (data ?? []) as unknown as {
      printer_id: string
      copies: number
      printers: { is_active: boolean; branch_id: string | null }
    }[]
  )
    .filter(
      (r) =>
        r.printers?.is_active &&
        // A printer tied to a branch only prints that branch's orders.
        (branchId === null || r.printers.branch_id === null || r.printers.branch_id === branchId),
    )
    .map((r) => ({ printerId: r.printer_id, copies: r.copies }))
}

/** Which branch this document belongs to, so a printer tied to one is skipped. */
async function branchOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  input: EnqueueInput,
): Promise<string | null> {
  if (input.orderId) {
    const { data } = await supabase
      .from("orders")
      .select("branch_id")
      .eq("id", input.orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    return (data?.branch_id as string | null) ?? null
  }
  if (input.billId) {
    const { data } = await supabase
      .from("bills")
      .select("branch_id")
      .eq("id", input.billId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    return (data?.branch_id as string | null) ?? null
  }
  return null
}

function fallbackUrlFor(input: EnqueueInput): string | null {
  if (input.kotId) return `/kot/${input.kotId}`
  if (input.billId) return `/receipt/${input.billId}`
  if (input.doc === "day_report") {
    return input.day ? `/reports/day?date=${input.day}` : "/reports/day"
  }
  return null
}

// ---------------------------------------------------------------------------
// Claim / complete
// ---------------------------------------------------------------------------

export type ClaimedJob = {
  id: string
  doc: PrintDoc
  printerId: string | null
  copies: number
}

/**
 * What QZ Tray in a browser can actually drive. Bluetooth is deliberately
 * absent: no browser can open an SPP socket, so a Bluetooth job left for the
 * Flutter app must not be claimed and failed here — it would take the ticket
 * off the queue and produce no paper.
 */
const BROWSER_CONNECTIONS = ["network", "usb", "system"]

/**
 * Take work off the queue. The RPC uses `for update skip locked`, so a second
 * POS tab or a second agent asking at the same moment gets a different set —
 * that is what stops one ticket printing twice.
 */
export async function claimPrintJobs(
  claimer: string,
  branchId?: string | null,
  limit = 5,
): Promise<ClaimedJob[]> {
  const tenant = await requireTenant()
  const supabase = await createClient()
  const { data } = await supabase.rpc("claim_print_jobs", {
    _tenant: tenant.tenantId,
    _branch: branchId ?? null,
    _claimer: claimer,
    _limit: limit,
    _connections: BROWSER_CONNECTIONS,
    // Any render mode: the browser is the only thing that can rasterise, so
    // image-mode jobs are precisely its job.
    _render_modes: null,
  })
  return ((data ?? []) as { id: string; doc: PrintDoc; printer_id: string | null; copies: number }[])
    .map((r) => ({ id: r.id, doc: r.doc, printerId: r.printer_id, copies: r.copies }))
}

export async function completePrintJob(
  jobId: string,
  status: PrintJobStatus,
  error?: string,
): Promise<{ ok: true } | { error: string }> {
  await requireTenant()
  const supabase = await createClient()
  const { error: err } = await supabase.rpc("complete_print_job", {
    _job_id: jobId,
    _status: status,
    _error: error ?? null,
  })
  if (err) return { error: err.message }
  revalidatePath("/settings")
  return { ok: true }
}

export async function retryPrintJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  await requireTenant()
  const supabase = await createClient()
  const { error } = await supabase.rpc("retry_print_job", { _job_id: jobId })
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

/** Cache what the agent discovered, so the next print skips the scan. */
export async function savePrinterUsbPath(
  printerId: string,
  iface: string,
  endpoint: string,
): Promise<void> {
  await requireTenant()
  const supabase = await createClient()
  await supabase.rpc("set_printer_usb_path", {
    _printer_id: printerId,
    _interface: iface,
    _endpoint: endpoint,
  })
}


/**
 * Server-action wrapper. The rendering itself lives in lib/print/job-render.ts
 * so the headless agent can reach the same code over HTTP.
 */
export async function renderPrintJob(
  jobId: string,
): Promise<PreparedPrintJob | { error: string }> {
  const tenant = await requireTenant()
  const supabase = await createClient()
  return renderJobWith(supabase, tenant, jobId)
}
