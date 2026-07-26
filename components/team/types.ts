export type Permission = { key: string; grp: string; label: string; sort: number }

export type EditableRole = {
  id: string
  name: string
  description: string | null
  color: string
  base_role: string
  is_system: boolean
  permissions: string[]
}

export type Role = EditableRole & { userCount: number }

export type Member = {
  user_id: string | null
  email: string
  base_role: string
  role_id: string | null
  role_name: string | null
  status: string
  created_at: string
}

export type RoleOption = { id: string; name: string }

export const BASE_ROLES = [
  "owner",
  "manager",
  "receptionist",
  "cashier",
  "waiter",
  "kitchen",
  "inventory",
] as const

/**
 * Swatches for role colouring. Named, not raw hex: a screen reader announcing
 * "Color #c026d3" tells nobody anything.
 */
export const ROLE_COLORS: { hex: string; name: string }[] = [
  { hex: "#059669", name: "Emerald" },
  { hex: "#d97706", name: "Amber" },
  { hex: "#7c3aed", name: "Violet" },
  { hex: "#c026d3", name: "Fuchsia" },
  { hex: "#2563eb", name: "Blue" },
  { hex: "#16a34a", name: "Green" },
  { hex: "#64748b", name: "Slate" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#b91c1c", name: "Dark red" },
  { hex: "#0a0a0a", name: "Black" },
  { hex: "#78350f", name: "Brown" },
  { hex: "#ec4899", name: "Pink" },
]

export const MEMBER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  invited: "Invited",
}

export const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  invited: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
}
