"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { writeAudit } from "@/lib/supabase/audit"
import { createAdminClient } from "@/lib/supabase/admin"

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

/**
 * Update a role. A default role keeps its identity — name, colour and base role
 * are what the seeded RLS floor and the rest of the app key off — but its
 * permission set is the tenant's to tune, which is the whole point of the screen.
 */
export async function updateRole(roleId: string, input: RoleInput): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const name = input.name.trim()
  if (!name) return { error: "Role name is required." }
  if (!BASE_ROLES.includes(input.baseRole)) return { error: "Invalid base role." }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("roles")
    .select("is_system, base_role")
    .eq("id", roleId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!existing) return { error: "Role not found." }

  if (!existing.is_system) {
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
  }

  // An owner-based role that loses staff.edit locks every owner out of this
  // screen permanently — the only door back in is SQL. Keep it pinned on.
  const baseRole = existing.is_system ? existing.base_role : input.baseRole
  const keys = new Set(input.permissions)
  if (baseRole === "owner") keys.add("staff.edit")

  await supabase.from("role_permissions").delete().eq("role_id", roleId)
  if (keys.size) {
    const { error: pErr } = await supabase
      .from("role_permissions")
      .insert([...keys].map((k) => ({ role_id: roleId, permission_key: k })))
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

export type AddMemberState = { error: string } | { ok: true; invited: boolean } | undefined

/**
 * Add a member by email (attach existing account, else create a pending
 * invite). Reports which of the two happened — "invited" means there's no
 * account on that address yet, which the caller must say out loud.
 */
export async function addMember(email: string, roleId: string): Promise<AddMemberState> {
  const tenant = await requirePermission("staff.edit")
  const trimmed = email.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return { error: "Enter a valid email address." }
  if (!roleId) return { error: "Pick a role for the new member." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("add_member_by_email", {
    _tenant: tenant.tenantId,
    _email: trimmed,
    _role_id: roleId,
  })
  if (error) return { error: error.message }

  const invited = data === "invited"
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "role_change",
    entityType: "user_tenant",
    metadata: { event: invited ? "invite" : "add", email: trimmed },
  })
  revalidatePath("/team")
  return { ok: true, invited }
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

/**
 * Staff forget passwords, and many have no inbox they check, so an owner can
 * set one for them. Takeover-grade, so the gate is the owner-only
 * `assert_can_set_member_password` RPC (not staff.edit) run under the caller's
 * JWT; only once it passes does the service-role client touch auth.
 */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters."
  if (password.length > 72) return "Keep it to 72 characters or fewer."
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Mix letters and numbers."
  return null
}

function friendlyPasswordError(message: string): string {
  const msg = message.toLowerCase()
  if (msg.includes("weak") || msg.includes("password")) {
    return "That password was rejected. Use at least 8 characters with a mix of letters and numbers."
  }
  return message
}

export async function setMemberPassword(userId: string, password: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const problem = passwordProblem(password)
  if (problem) return { error: problem }

  const supabase = await createClient()
  const { data: email, error: gateErr } = await supabase.rpc("assert_can_set_member_password", {
    _tenant: tenant.tenantId,
    _user_id: userId,
  })
  if (gateErr) return { error: gateErr.message }

  const admin = createAdminClient()
  if (!admin) return { error: "Password changes aren't configured on this server." }
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { error: friendlyPasswordError(error.message) }

  // The password itself never goes in the log.
  await writeAudit({
    tenantId: tenant.tenantId,
    action: "password_reset",
    entityType: "user_tenant",
    entityId: userId,
    metadata: { event: "set_password", email },
  })
  return { ok: true }
}

/**
 * Turn an invite (no account yet) into a working login: create the account with
 * the owner's password, pre-confirmed, and attach it as an active member so the
 * person can sign in straight away without an approval round trip.
 */
export async function createInviteLogin(email: string, password: string): Promise<TeamState> {
  const tenant = await requirePermission("staff.edit")
  const problem = passwordProblem(password)
  if (problem) return { error: problem }

  const supabase = await createClient()
  const { data: invite, error: gateErr } = await supabase.rpc("assert_can_create_invite_login", {
    _tenant: tenant.tenantId,
    _email: email,
  })
  if (gateErr || !invite) return { error: gateErr?.message ?? "Invite not found." }

  const admin = createAdminClient()
  if (!admin) return { error: "Creating logins isn't configured on this server." }
  const { data: created, error } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
  })
  if (error || !created.user) return { error: friendlyPasswordError(error?.message ?? "Could not create the login.") }

  const { error: memberErr } = await admin.from("user_tenants").upsert(
    {
      user_id: created.user.id,
      tenant_id: tenant.tenantId,
      role: invite.base_role,
      role_id: invite.role_id,
      status: "active",
    },
    { onConflict: "user_id,tenant_id", ignoreDuplicates: true },
  )
  if (memberErr) {
    // No membership means an orphan login nobody can use — take it back out.
    await admin.auth.admin.deleteUser(created.user.id)
    return { error: memberErr.message }
  }
  await admin.from("staff_invites").delete().eq("id", invite.id)

  await writeAudit({
    tenantId: tenant.tenantId,
    action: "password_reset",
    entityType: "user_tenant",
    entityId: created.user.id,
    metadata: { event: "create_login", email: invite.email },
  })
  revalidatePath("/team")
  return { ok: true }
}
