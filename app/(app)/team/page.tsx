import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { TeamManager } from "@/components/team-manager"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  const tenant = await requirePermission("staff.view")
  const supabase = await createClient()

  const [{ data: roles }, { data: perms }, { data: members }, { data: memberRoles }, { data: canEditData }] =
    await Promise.all([
      supabase
        .from("roles")
        .select("id, name, description, color, base_role, is_system")
        .eq("tenant_id", tenant.tenantId)
        .order("is_system", { ascending: false })
        .order("name"),
      supabase.from("permissions").select("key, grp, label, sort").order("sort"),
      supabase.rpc("list_tenant_members", { _tenant: tenant.tenantId }),
      supabase.from("user_tenants").select("role_id").eq("tenant_id", tenant.tenantId).eq("status", "active"),
      supabase.rpc("has_permission", { _tenant: tenant.tenantId, _key: "staff.edit" }),
    ])

  const roleRows = (roles ?? []) as {
    id: string
    name: string
    description: string | null
    color: string
    base_role: string
    is_system: boolean
  }[]
  const roleIds = roleRows.map((r) => r.id)

  const { data: rolePerms } = roleIds.length
    ? await supabase.from("role_permissions").select("role_id, permission_key").in("role_id", roleIds)
    : { data: [] as { role_id: string; permission_key: string }[] }

  const permsByRole = new Map<string, string[]>()
  for (const rp of (rolePerms ?? []) as { role_id: string; permission_key: string }[]) {
    const arr = permsByRole.get(rp.role_id) ?? []
    arr.push(rp.permission_key)
    permsByRole.set(rp.role_id, arr)
  }
  const countByRole = new Map<string, number>()
  for (const m of (memberRoles ?? []) as { role_id: string | null }[]) {
    if (m.role_id) countByRole.set(m.role_id, (countByRole.get(m.role_id) ?? 0) + 1)
  }

  const rolesOut = roleRows.map((r) => ({
    ...r,
    permissions: permsByRole.get(r.id) ?? [],
    userCount: countByRole.get(r.id) ?? 0,
  }))

  return (
    <PageShell width="standard">
      <PageHeader title="Users & Roles" description="Manage staff, roles and permissions." />
      <TeamManager
        roles={rolesOut}
        permissions={(perms ?? []) as never}
        members={(members ?? []) as never}
        canEdit={canEditData === true}
      />
    </PageShell>
  )
}
