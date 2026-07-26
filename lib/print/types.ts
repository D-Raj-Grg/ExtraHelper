/**
 * Shared print types. Plain module — imported by server actions, the client
 * dispatcher and the settings UI alike, so it must never reach for
 * `lib/supabase/server`.
 */

export type PrinterConnection = "network" | "system"
export type PrinterRole = "kot" | "receipt" | "both"
export type PrintJobStatus = "queued" | "printed" | "failed"

/** Everything the local agent needs to address one printer. */
export type PrinterRef = {
  id: string
  name: string
  connection: PrinterConnection
  host: string | null
  port: number
  systemName: string | null
  paperWidth: number
}

/**
 * A job the client hands to the agent. `fallbackUrl` is the browser-print page
 * for the same document — used verbatim when no agent is connected, which is
 * exactly how printing worked before this module existed.
 */
export type PreparedPrintJob = {
  jobId: string
  printer: PrinterRef | null
  dataBase64: string
  fallbackUrl: string | null
  label: string
}

export const PAPER_WIDTHS = [58, 80] as const

export const ROLE_LABELS: Record<PrinterRole, string> = {
  kot: "Kitchen tickets",
  receipt: "Receipts",
  both: "Tickets & receipts",
}

export const CONNECTION_LABELS: Record<PrinterConnection, string> = {
  network: "Network (IP)",
  system: "System / USB",
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  kot: "Kitchen ticket",
  receipt: "Receipt",
  test: "Test page",
}

/** How a printer is addressed, for display. */
export function printerTarget(p: {
  connection: PrinterConnection
  host: string | null
  port: number
  system_name: string | null
}): string {
  return p.connection === "network" ? `${p.host ?? "—"}:${p.port}` : (p.system_name ?? "—")
}
