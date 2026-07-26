"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import type { PrinterConnection, PrinterRole } from "@/lib/print/types"

/** Printer registry CRUD + station routing. Owner/manager only. */

export type PrinterInput = {
  name: string
  connection: PrinterConnection
  host: string
  port: number
  systemName: string
  paperWidth: number
  role: PrinterRole
  isDefault: boolean
  isActive: boolean
}

export type PrinterState = { error: string } | { ok: true } | undefined

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reject anything that isn't a bare host — a value with a scheme, path or
 * credentials in it isn't a printer address and shouldn't reach the agent.
 */
const HOST_RE = /^[a-zA-Z0-9._-]+$/

function validate(input: PrinterInput): string | null {
  if (!input.name.trim()) return "Give the printer a name."
  if (!["network", "system"].includes(input.connection)) return "Pick a connection type."
  if (![58, 80].includes(input.paperWidth)) return "Paper width must be 58mm or 80mm."
  if (!["kot", "receipt", "both"].includes(input.role)) return "Pick what this printer prints."
  if (input.connection === "network") {
    if (!input.host.trim()) return "Network printers need an IP address."
    if (!HOST_RE.test(input.host.trim())) return "Enter just the IP or hostname, e.g. 192.168.1.50."
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      return "Port must be between 1 and 65535."
  } else if (!input.systemName.trim()) {
    return "System printers need the name your computer gives them."
  }
  return null
}

function toRow(input: PrinterInput, tenantId: string) {
  return {
    tenant_id: tenantId,
    name: input.name.trim(),
    connection: input.connection,
    host: input.connection === "network" ? input.host.trim() : null,
    port: input.connection === "network" ? input.port : 9100,
    system_name: input.connection === "system" ? input.systemName.trim() : null,
    paper_width: input.paperWidth,
    role: input.role,
    is_default: input.isDefault,
    is_active: input.isActive,
  }
}

/**
 * Only one printer per role may be the default. The database enforces it with a
 * partial unique index, so the previous holder has to stand down before the new
 * one can claim the flag.
 *
 * Returns the id it demoted so the caller can put it back if the write that
 * followed failed — otherwise a rejected save leaves the tenant with no default
 * printer at all, and nothing on screen would say why.
 */
async function clearOtherDefaults(
  tenantId: string,
  role: PrinterRole,
  exceptId?: string,
): Promise<string | null> {
  const supabase = await createClient()
  let find = supabase
    .from("printers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .eq("is_default", true)
  if (exceptId) find = find.neq("id", exceptId)
  const { data: previous } = await find.maybeSingle()
  if (!previous) return null

  await supabase
    .from("printers")
    .update({ is_default: false })
    .eq("id", previous.id as string)
    .eq("tenant_id", tenantId)
  return previous.id as string
}

/** Undo a demotion after a failed save. */
async function restoreDefault(tenantId: string, printerId: string | null): Promise<void> {
  if (!printerId) return
  const supabase = await createClient()
  await supabase
    .from("printers")
    .update({ is_default: true })
    .eq("id", printerId)
    .eq("tenant_id", tenantId)
}

export async function createPrinter(input: PrinterInput): Promise<PrinterState> {
  const tenant = await requireRole("owner", "manager")
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  const demoted = input.isDefault
    ? await clearOtherDefaults(tenant.tenantId, input.role)
    : null

  const { error } = await supabase.from("printers").insert(toRow(input, tenant.tenantId))
  if (error) {
    await restoreDefault(tenant.tenantId, demoted)
    return { error: error.message }
  }
  revalidatePath("/settings")
  return { ok: true }
}

export async function updatePrinter(
  printerId: string,
  input: PrinterInput,
): Promise<PrinterState> {
  const tenant = await requireRole("owner", "manager")
  if (!UUID_RE.test(printerId)) return { error: "Unknown printer." }
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  const demoted = input.isDefault
    ? await clearOtherDefaults(tenant.tenantId, input.role, printerId)
    : null

  // tenant_id is never patched — the row already belongs to this tenant, and
  // the eq() below is what keeps it that way.
  const row = toRow(input, tenant.tenantId)
  const { error } = await supabase
    .from("printers")
    .update({ ...row, tenant_id: undefined })
    .eq("id", printerId)
    .eq("tenant_id", tenant.tenantId)
  if (error) {
    await restoreDefault(tenant.tenantId, demoted)
    return { error: error.message }
  }
  revalidatePath("/settings")
  return { ok: true }
}

export async function deletePrinter(printerId: string): Promise<PrinterState> {
  const tenant = await requireRole("owner", "manager")
  if (!UUID_RE.test(printerId)) return { error: "Unknown printer." }
  const supabase = await createClient()
  // Stations pointing here are set null by the FK — their tickets fall back to
  // the default printer, then to the browser. Nothing is lost.
  const { error } = await supabase
    .from("printers")
    .delete()
    .eq("id", printerId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/settings")
  revalidatePath("/menu")
  return { ok: true }
}

/** Route one kitchen station's tickets to a printer (null = tenant default). */
export async function setStationPrinter(
  stationId: string,
  printerId: string | null,
): Promise<PrinterState> {
  const tenant = await requireRole("owner", "manager")
  if (!UUID_RE.test(stationId)) return { error: "Unknown station." }
  if (printerId !== null && !UUID_RE.test(printerId)) return { error: "Unknown printer." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("kitchen_stations")
    .update({ printer_id: printerId })
    .eq("id", stationId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/settings")
  return { ok: true }
}
