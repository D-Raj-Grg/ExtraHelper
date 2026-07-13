"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { writeAudit } from "@/lib/supabase/audit"

export type TeamState = { error: string } | { ok: true } | undefined

const BASE_ROLES = ["owner", "manager", "receptionist", "cashier", "waiter", "kitchen", "inventory"]

type RoleInput = {
  name: string
  description: string
  color: string
  baseRole: string
  permissions: string[]
}

/** Create a custom role + its permission set. */
export async function createRole(input: RoleInput): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const name = input.name.trim()
  if (!name) return { error: "Role name is required." }
  if (!BASE_ROLES.includes(input.baseRole)) return { error: "Invalid base role." }

  const supabase = await createClient()
  const { data: role, error } = await supabase
    .from("roles")
    .insert({
      tenant_id: tenant.tenantId,
      name,
      description: input.description.trim() || null,
      color: input.color || "#64748b",
      base_role: input.baseRole,
      is_system: false,
    })
    .select("id")
    .single()
  if (error || !role) return { error: error?.message ?? "Could not create role." }

  if (input.permissions.length) {
    const { error: pErr } = await supabase
      .from("role_permissions")
      .insert(input.permissions.map((k) => ({ role_id: role.id, permission_key: k })))
    if (pErr) return { error: pErr.message }
  }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "role",
    entityId: role.id,
    metadata: { event: "create", name },
  })
  revalidatePath("/team")
  return { ok: true }
}

/** Update a custom role (system roles are read-only). */
export async function updateRole(roleId: string, input: RoleInput): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const name = input.name.trim()
  if (!name) return { error: "Role name is required." }
  if (!BASE_ROLES.includes(input.baseRole)) return { error: "Invalid base role." }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("roles")
    .select("is_system")
    .eq("id", roleId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!existing) return { error: "Role not found." }
  if (existing.is_system) return { error: "Default roles can't be edited." }

  const { error } = await supabase
    .from("roles")
    .update({
      name,
      description: input.description.trim() || null,
      color: input.color || "#64748b",
      base_role: input.baseRole,
    })
    .eq("id", roleId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }

  await supabase.from("role_permissions").delete().eq("role_id", roleId)
  if (input.permissions.length) {
    const { error: pErr } = await supabase
      .from("role_permissions")
      .insert(input.permissions.map((k) => ({ role_id: roleId, permission_key: k })))
    if (pErr) return { error: pErr.message }
  }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "role",
    entityId: roleId,
    metadata: { event: "update", name },
  })
  revalidatePath("/team")
  return { ok: true }
}

/** Delete a custom role — its members fall back to the base-role defaults. */
export async function deleteRole(roleId: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("roles")
    .select("is_system, name")
    .eq("id", roleId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!existing) return { error: "Role not found." }
  if (existing.is_system) return { error: "Default roles can't be deleted." }

  const { error } = await supabase.from("roles").delete().eq("id", roleId).eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "role",
    entityId: roleId,
    metadata: { event: "delete", name: existing.name },
  })
  revalidatePath("/team")
  return { ok: true }
}

/** Add a member by email (attach existing account, else create a pending invite). */
export async function addMember(email: string, roleId: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("add_member_by_email", {
    _tenant: tenant.tenantId,
    _email: email,
    _role_id: roleId,
  })
  if (error) return { error: error.message }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "user_tenant",
    metadata: { event: data === "invited" ? "invite" : "add", email },
  })
  revalidatePath("/team")
  return { ok: true }
}

export async function setMemberRole(userId: string, roleId: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_member_role", {
    _tenant: tenant.tenantId,
    _user_id: userId,
    _role_id: roleId,
  })
  if (error) return { error: error.message }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "user_tenant",
    entityId: userId,
    metadata: { event: "set_role", role_id: roleId },
  })
  revalidatePath("/team")
  return { ok: true }
}

export async function approveMember(userId: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_member", { _tenant: tenant.tenantId, _user_id: userId })
  if (error) return { error: error.message }
  revalidatePath("/team")
  return { ok: true }
}

export async function removeMember(userId: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_member", { _tenant: tenant.tenantId, _user_id: userId })
  if (error) return { error: error.message }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "user_tenant",
    entityId: userId,
    metadata: { event: "remove" },
  })
  revalidatePath("/team")
  return { ok: true }
}

export type JoinCodeState = { error: string } | { ok: true; code: string } | undefined

/** Generate a shareable join code someone can enter to self-join as a pending member. */
export async function generateJoinCode(roleId?: string | null): Promise<JoinCodeState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_join_code", {
    _tenant: tenant.tenantId,
    _role_id: roleId || null,
  })
  if (error) return { error: error.message }
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "user_tenant",
    metadata: { event: "join_code", role_id: roleId || null },
  })
  revalidatePath("/team")
  return { ok: true, code: data as string }
}

export async function cancelInvite(email: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_invite", { _tenant: tenant.tenantId, _email: email })
  if (error) return { error: error.message }
  revalidatePath("/team")
  return { ok: true }
}
