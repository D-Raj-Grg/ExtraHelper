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
