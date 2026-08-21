/**
 * Shared print types. Plain module — imported by server actions, the client
 * dispatcher and the settings UI alike, so it must never reach for
 * `lib/supabase/server`.
 */

import type { PrintDocModel } from "./docs"

export type PrinterConnection = "network" | "usb" | "system" | "bluetooth"
export type PrinterRenderMode = "text" | "image"
/**
 * `bill` and `receipt` are two documents on purpose. The estimate the guest
 * reads before paying and the slip that follows the money are separate
 * decisions — plenty of counters print the first and skip the second.
 */
export type PrintDoc =
  | "kot"
  | "bot"
  | "full_kot"
  | "order_slip"
  | "bill"
  | "receipt"
  | "day_report"
  | "test"
export type PrintJobStatus = "queued" | "claimed" | "printed" | "failed" | "cancelled"

/** Everything the agent needs to address one printer and lay a page out for it. */
export type PrinterRef = {
  id: string
  name: string
  connection: PrinterConnection
  host: string | null
  port: number
  systemName: string | null
  usbVendorId: string | null
  usbProductId: string | null
  /**
   * Discovered from the device on first print and cached, so the next job
   * skips the interface scan. Null means "look it up".
   */
  usbInterface: string | null
  usbEndpoint: string | null
  /**
   * Bluetooth address of the printer. Driven by the Flutter app on Android —
   * no browser can open an SPP socket, and iOS classic Bluetooth needs MFi.
   */
  btAddress: string | null
  paperWidth: number
  renderMode: PrinterRenderMode
  autoCut: boolean
  openDrawer: boolean
}

/**
 * What the agent is handed.
 *
 * `raw` is finished ESC/POS. `image` is the document model, rasterised by the
 * browser and sent as an ESC/POS bit-image — the only way a Devanagari dish
 * name reaches paper, since ESC/POS text is a single-byte code page with no
 * glyph for it. The rasterising happens client-side on purpose: the browser
 * already shapes every script correctly, and QZ's own `pixel` printing goes
 * through an OS printer driver, so it cannot reach a network printer on a
 * socket — which is how most kitchen printers are wired.
 */
export type PrintPayload =
  | { kind: "raw"; base64: string }
  | { kind: "image"; doc: PrintDocModel; paperWidthMm: number }

/**
 * A job ready to send. `fallbackUrl` is the browser-print page for the same
 * document — offered as an explicit click when the agent cannot reach the
 * printer, never opened behind the user's back (a `window.open` after an await
 * is a popup and browsers eat it).
 */
export type PreparedPrintJob = {
  jobId: string
  printer: PrinterRef | null
  payload: PrintPayload
  fallbackUrl: string | null
  label: string
  copies: number
}

/** 58mm and 80mm thermal, 76mm impact. */
export const PAPER_WIDTHS = [58, 76, 80] as const

/** The documents a printer can be assigned; `test` is always a manual act. */
export const ASSIGNABLE_DOCS = [
  "kot",
  "bot",
  "full_kot",
  "order_slip",
  "bill",
  "receipt",
  "day_report",
] as const satisfies readonly PrintDoc[]

export const DOC_LABELS: Record<PrintDoc, string> = {
  kot: "KOT",
  bot: "BOT",
  full_kot: "Full KOT",
  order_slip: "Order slip",
  bill: "Bill",
  receipt: "Receipt",
  day_report: "Day close (Z)",
  test: "Test page",
}

export const DOC_DESCRIPTIONS: Record<PrintDoc, string> = {
  kot: "Kitchen order ticket — one per kitchen station",
  bot: "Bar order ticket — one per bar station",
  full_kot: "The whole order on one ticket, for the pass",
  order_slip: "Itemised slip with prices, for the guest or the waiter",
  bill: "The bill the guest checks, printed before they pay",
  receipt: "Proof of payment, printed on its own once the bill is settled",
  day_report: "The day's totals, payment split and cash reconciliation — printed at close",
  test: "A width and cut test, printed on demand",
}

export const CONNECTION_LABELS: Record<PrinterConnection, string> = {
  network: "Network (IP)",
  usb: "USB",
  system: "System printer",
  bluetooth: "Bluetooth",
}

export const RENDER_MODE_LABELS: Record<PrinterRenderMode, string> = {
  text: "Text (fastest)",
  image: "Image (any script)",
}

export const JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  queued: "Waiting",
  claimed: "Printing",
  printed: "Printed",
  failed: "Failed",
  cancelled: "Cancelled",
}

/** How a printer is addressed, for display. */
export function printerTarget(p: {
  connection: PrinterConnection
  host: string | null
  port: number
  system_name: string | null
  usb_vendor_id?: string | null
  usb_product_id?: string | null
  bt_address?: string | null
}): string {
  if (p.connection === "network") return `${p.host ?? "—"}:${p.port}`
  if (p.connection === "usb")
    return `${p.usb_vendor_id ?? "—"} / ${p.usb_product_id ?? "—"}`
  if (p.connection === "bluetooth") return p.bt_address ?? "—"
  return p.system_name ?? "—"
}
