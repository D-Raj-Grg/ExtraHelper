/**
 * Reservation lifecycle states (mirrors `reservation_status` DB enum). Plain
 * module — a "use server" file may only export async functions, so a const
 * array exported from one breaks when imported into a Client Component.
 */
export const RESV_STATES = [
  "pending",
  "confirmed",
  "seated",
  "cancelled",
  "no_show",
] as const
export type ResvStatus = (typeof RESV_STATES)[number]

/**
 * Staff-facing names. Enum values never reach a host — `no_show` read off a
 * screen mid-service is a bug, not a label.
 */
const RESV_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  seated: "Seated",
  cancelled: "Cancelled",
  no_show: "No-show",
}

export function resvStatusLabel(status: string): string {
  return RESV_LABELS[status] ?? "Pending"
}
