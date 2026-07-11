/**
 * KOT ticket flow constants. Kept in a plain module (NOT the "use server"
 * actions file) — a "use server" module may only export async functions, so
 * exporting a const array from it breaks when imported into a Client Component.
 */
export const KOT_FLOW = ["new", "preparing", "ready", "served"] as const
export type KotStatus = (typeof KOT_FLOW)[number] | "recalled"
