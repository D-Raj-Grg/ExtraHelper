/** Online-order lifecycle (plain module — not the "use server" actions file). */
export const ONLINE_STATES = [
  "received",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const
export type OnlineStatus = (typeof ONLINE_STATES)[number]
