/**
 * Table lifecycle states (mirrors the `table_state` DB enum). Kept in a plain
 * module — a "use server" file may only export async functions, so a const
 * array exported from one breaks when imported into a Client Component.
 */
export const TABLE_STATES = [
  "free",
  "occupied",
  "reserved",
  "bill_requested",
  "cleaning",
] as const
export type TableState = (typeof TABLE_STATES)[number]
