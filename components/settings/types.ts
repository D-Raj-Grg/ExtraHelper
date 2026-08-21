import type {
  PrintDoc,
  PrinterConnection,
  PrinterRenderMode,
  PrintJobStatus,
} from "@/lib/print/types"

export type TaxRule = { name: string; rate: number; inclusive: boolean }
export type Branch = { id: string; name: string; address: string | null; is_default: boolean }

/** Transfer-ownership candidate: an active, non-owner member. */
export type TransferMember = { userId: string; email: string; roleName: string | null }

/** Owner-only data behind the Dangerous Area. */
export type DangerData = {
  planLabel: string
  usage: { customers: number; tables: number; staff: number; menuItems: number }
  /** null denominator = unlimited (trial or unmetered). */
  limits: {
    customers: number | null
    tables: number | null
    staff: number | null
    menuItems: number | null
  }
  members: TransferMember[]
  deletionScheduledAt: string | null
}

/**
 * Printer registry row, as the settings page selects it. `printer_documents`
 * is the auto-print assignment — carrying a document means this printer fires
 * it on its own; a printer with none is still available for a manual print.
 */
export type PrinterRow = {
  id: string
  name: string
  branch_id: string | null
  connection: PrinterConnection
  host: string | null
  port: number
  system_name: string | null
  usb_vendor_id: string | null
  usb_product_id: string | null
  bt_address: string | null
  paper_width: number
  render_mode: PrinterRenderMode
  auto_cut: boolean
  open_drawer: boolean
  is_active: boolean
  printer_documents: { doc: PrintDoc; copies: number }[]
}

/** One entry in the print-job queue and its history. */
export type PrintJobRow = {
  id: string
  doc: PrintDoc
  status: PrintJobStatus
  attempts: number
  error: string | null
  created_at: string
  claimed_by: string | null
  kot_id: string | null
  bill_id: string | null
  order_id: string | null
  printer_id: string | null
  printers: { name: string } | null
}

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "NPR", "AED", "SGD", "AUD", "CAD", "JPY"]

export const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
]

/** Shared card grid: two columns from `lg`, cards top-aligned so uneven
 * heights don't stretch. Every settings tab uses this so the rhythm matches. */
export const CARD_GRID = "grid items-start gap-6 lg:grid-cols-2"

/**
 * When the trading day turns over, in minutes past local midnight.
 *
 * A restaurant's day does not end at midnight — a sale rung at 01:30 belongs to
 * the night before. Shared by the Select and by `updateSettings`, so the server
 * rejects exactly what the UI never offered. Mirrors
 * `tenant_settings.day_cutoff_minutes` and `public.business_day`.
 */
export const DAY_CUTOFFS: { value: number; label: string }[] = [
  { value: 0, label: "Midnight" },
  { value: 60, label: "1:00 am" },
  { value: 120, label: "2:00 am" },
  { value: 180, label: "3:00 am" },
  { value: 240, label: "4:00 am" },
  { value: 300, label: "5:00 am" },
  { value: 360, label: "6:00 am" },
]
