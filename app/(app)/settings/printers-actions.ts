"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireTenant } from "@/lib/supabase/guards"
import { PAPER_WIDTHS } from "@/lib/print/types"
import type { PrintDoc, PrinterConnection, PrinterRenderMode } from "@/lib/print/types"

/**
 * Printer registry CRUD and station routing.
 *
 * Every write goes through a SECURITY DEFINER function gated on
 * `settings.edit`. That is deliberate: the tables are readable by the whole
 * restaurant but writable by nobody directly, because the role check used to
 * live only here — in TypeScript — while RLS let any member re-point a
 * printer straight through the API.
 *
 * The validation below is therefore about telling a human what is wrong, not
 * about safety. The database enforces the same rules regardless.
 */

export type PrinterInput = {
  id: string | null
  name: string
  connection: PrinterConnection
  host: string
  port: number
  systemName: string
  usbVendorId: string
  usbProductId: string
  /** Bluetooth MAC. Only the Flutter app on Android can drive one. */
  btAddress: string
  paperWidth: number
  renderMode: PrinterRenderMode
  autoCut: boolean
  openDrawer: boolean
  branchId: string | null
  isActive: boolean
  /** Assigning a document means "auto-print it here". */
  docs: { doc: PrintDoc; copies: number }[]
}

export type PrinterState = { error: string } | { ok: true } | undefined

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reject anything that isn't a bare host — a value with a scheme, path or
 * credentials in it isn't a printer address and shouldn't reach the agent.
 */
const HOST_RE = /^[a-zA-Z0-9._-]+$/
/** USB ids are hex, with or without the 0x, as printed on the device. */
const USB_ID_RE = /^(0x)?[0-9a-f]{1,4}$/i
/** A Bluetooth MAC, colon- or hyphen-separated, in any case. */
const BT_ADDR_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i

function validate(input: PrinterInput): string | null {
  if (!input.name.trim()) return "Give the printer a name."
  if (!["network", "usb", "system", "bluetooth"].includes(input.connection))
    return "Pick a connection type."
  if (!PAPER_WIDTHS.includes(input.paperWidth as (typeof PAPER_WIDTHS)[number]))
    return "Paper width must be 58mm, 76mm or 80mm."

  if (input.connection === "network") {
    if (!input.host.trim()) return "Network printers need an IP address."
    if (!HOST_RE.test(input.host.trim()))
      return "Enter just the IP or hostname, e.g. 192.168.1.50."
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      return "Port must be between 1 and 65535."
  } else if (input.connection === "usb") {
    if (!input.usbVendorId.trim() || !input.usbProductId.trim())
      return "USB printers need a vendor ID and a product ID. Scan for the device to fill them in."
    if (!USB_ID_RE.test(input.usbVendorId.trim()) || !USB_ID_RE.test(input.usbProductId.trim()))
      return "Vendor and product IDs are hex, like 0x04b8."
  } else if (input.connection === "bluetooth") {
    if (!input.btAddress.trim())
      return "Bluetooth printers need the printer's address. Pair it in the ExtraHelper app on an Android phone and pick it there."
    if (!BT_ADDR_RE.test(input.btAddress.trim()))
      return "A Bluetooth address looks like 66:32:B1:00:1A:2C."
  } else if (!input.systemName.trim()) {
    return "System printers need the name your computer gives them."
  }

  for (const d of input.docs) {
    if (d.copies < 1 || d.copies > 5) return "Copies must be between 1 and 5."
  }
  return null
}

/** Normalise to `0x` + lowercase hex, which is what QZ matches devices on. */
function normaliseUsbId(raw: string): string {
  const hex = raw.trim().replace(/^0x/i, "").toLowerCase()
  return hex ? `0x${hex.padStart(4, "0")}` : ""
}

export async function savePrinter(input: PrinterInput): Promise<PrinterState> {
  const tenant = await requireTenant()
  if (input.id !== null && !UUID_RE.test(input.id)) return { error: "Unknown printer." }
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  const { error } = await supabase.rpc("save_printer", {
    _tenant: tenant.tenantId,
    _id: input.id,
    _name: input.name.trim(),
    _connection: input.connection,
    _host: input.connection === "network" ? input.host.trim() : null,
    _port: input.connection === "network" ? input.port : 9100,
    _system_name: input.connection === "system" ? input.systemName.trim() : null,
    _usb_vendor_id: input.connection === "usb" ? normaliseUsbId(input.usbVendorId) : null,
    _usb_product_id: input.connection === "usb" ? normaliseUsbId(input.usbProductId) : null,
    _bt_address:
      input.connection === "bluetooth"
        ? input.btAddress.trim().replace(/-/g, ":").toUpperCase()
        : null,
    _paper_width: input.paperWidth,
    _render_mode: input.renderMode,
    _auto_cut: input.autoCut,
    _open_drawer: input.openDrawer,
    _branch_id: input.branchId,
    _is_active: input.isActive,
    _docs: input.docs,
  })
  if (error) return { error: error.message }

  revalidatePath("/settings")
  revalidatePath("/menu")
  return { ok: true }
}

export async function deletePrinter(printerId: string): Promise<PrinterState> {
  await requireTenant()
  if (!UUID_RE.test(printerId)) return { error: "Unknown printer." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_printer", { _printer_id: printerId })
  if (error) return { error: error.message }

  revalidatePath("/settings")
  revalidatePath("/menu")
  return { ok: true }
}

/** Route one kitchen station's tickets to a printer (null = follow the docs). */
export async function setStationPrinter(
  stationId: string,
  printerId: string | null,
): Promise<PrinterState> {
  await requireTenant()
  if (!UUID_RE.test(stationId)) return { error: "Unknown station." }
  if (printerId !== null && !UUID_RE.test(printerId)) return { error: "Unknown printer." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_station_printer", {
    _station_id: stationId,
    _printer_id: printerId,
  })
  if (error) return { error: error.message }

  revalidatePath("/menu")
  revalidatePath("/settings")
  return { ok: true }
}

/** Kitchen or bar — this is what makes a ticket a KOT or a BOT. */
export async function setStationKind(
  stationId: string,
  kind: "kitchen" | "bar",
): Promise<PrinterState> {
  await requireTenant()
  if (!UUID_RE.test(stationId)) return { error: "Unknown station." }
  if (kind !== "kitchen" && kind !== "bar") return { error: "Unknown station type." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_station_kind", {
    _station_id: stationId,
    _kind: kind,
  })
  if (error) return { error: error.message }

  revalidatePath("/menu")
  revalidatePath("/settings")
  return { ok: true }
}

export async function setPrintingMode(mode: "local" | "cloud"): Promise<PrinterState> {
  const tenant = await requireTenant()
  if (mode !== "local" && mode !== "cloud") return { error: "Unknown printing mode." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_printing_mode", {
    _tenant: tenant.tenantId,
    _mode: mode,
  })
  if (error) return { error: error.message }

  // The worker is mounted in the app shell, so the whole layout has to re-read.
  revalidatePath("/", "layout")
  return { ok: true }
}
