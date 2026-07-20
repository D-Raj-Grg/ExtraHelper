// Reset-domain catalog. A plain module (no server imports) so both the server
// action and the client reset dialog can share it — importing a file that pulls
// in lib/supabase/server would drag next/headers into the browser bundle.

export type ResetDomain = {
  key: string
  /** Staff-facing name — enum values never reach the UI. */
  label: string
  /** What gets wiped, one short line. */
  detail: string
}

/** The 11 wipeable domains, in the order they appear in the dialog. */
export const RESET_DOMAINS: ResetDomain[] = [
  { key: "menu", label: "Menu", detail: "Dishes, categories, prices, recipes" },
  { key: "tables", label: "Tables", detail: "Tables & reservations" },
  { key: "finance", label: "Finance", detail: "Bills, payments, cash sessions" },
  { key: "space", label: "Space", detail: "Floors & layout" },
  { key: "customers", label: "Customers", detail: "Guests, loyalty, feedback" },
  { key: "suppliers", label: "Suppliers", detail: "Vendors & purchase orders" },
  { key: "inventory", label: "Inventory", detail: "Stock, counts, wastage" },
  { key: "website", label: "Website", detail: "Online orders & delivery" },
  { key: "staff", label: "Staff Members", detail: "Team, invites, shifts (not you)" },
  { key: "orders", label: "Orders", detail: "Orders & KOT tickets" },
  { key: "activity", label: "Activity", detail: "Audit log history" },
]

export const RESET_DOMAIN_KEYS = RESET_DOMAINS.map((d) => d.key)

/** Sentinel domain: expands to every domain server-side. */
export const RESET_EVERYTHING = "everything"
