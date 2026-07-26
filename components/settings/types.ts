import type {
  PrinterConnection,
  PrinterRole,
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

/** Printer registry row, as the settings page selects it. */
export type PrinterRow = {
  id: string
  name: string
  connection: PrinterConnection
  host: string | null
  port: number
  system_name: string | null
  paper_width: number
  role: PrinterRole
  is_default: boolean
  is_active: boolean
}

/** One entry in the print-job log. */
export type PrintJobRow = {
  id: string
  type: string
  status: PrintJobStatus
  attempts: number
  error: string | null
  created_at: string
  kot_id: string | null
  bill_id: string | null
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
