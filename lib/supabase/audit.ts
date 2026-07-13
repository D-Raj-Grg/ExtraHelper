import { createClient } from "@/lib/supabase/server"

/** Sensitive actions that must be audited (rule #5). */
export type AuditAction =
  | "void"
  | "discount"
  | "refund"
  | "price_change"
  | "impersonate"
  | "tenant_suspend"
  | "tenant_activate"
  | "role_change"
  | "table_transfer"
  | "table_merge"
  | "table_split"

export type AuditEntry = {
  tenantId: string
  action: AuditAction
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
}

/**
 * Append an audit log row. Actor is the current authenticated user; RLS enforces
 * `actor_id = auth.uid()` and tenant membership on insert. Best-effort: a logging
 * failure is surfaced to the caller (returns the error) rather than thrown, so it
 * never silently swallows — callers decide whether to hard-fail.
 */
export async function writeAudit(entry: AuditEntry): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "not authenticated" }

  const { error } = await supabase.from("audit_logs").insert({
    tenant_id: entry.tenantId,
    actor_id: user.id,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  })
  return { error: error?.message ?? null }
}
