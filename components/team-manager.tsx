"use client"

import { useState, useTransition } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import {
  addMember,
  approveMember,
  cancelInvite,
  deleteRole,
  removeMember,
  setMemberRole,
  type TeamState,
} from "@/app/(app)/team/actions"
import { RoleEditor, type EditableRole, type Permission } from "@/components/role-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Role = EditableRole & { userCount: number }
type Member = {
  user_id: string | null
  email: string
  base_role: string
  role_id: string | null
  role_name: string | null
  status: string
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 dark:text-green-400",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  invited: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
}

export function TeamManager({
  roles,
  permissions,
  members,
  canEdit,
}: {
  roles: Role[]
  permissions: Permission[]
  members: Member[]
  canEdit: boolean
}) {
  const [tab, setTab] = useState<"roles" | "staff">("roles")
  const [editor, setEditor] = useState<{ role: Role | null } | null>(null)
  const [pending, startTransition] = useTransition()

  const systemRoles = roles.filter((r) => r.is_system)
  const customRoles = roles.filter((r) => !r.is_system)
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }))

  const run = (fn: () => Promise<TeamState>, ok?: string) =>
    startTransition(async () => {
      const res = await fn()
      if (res && "error" in res) toast.error(res.error)
      else if (ok) toast.success(ok)
    })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setTab("roles")}
            className={`rounded-md px-4 py-1.5 font-medium ${tab === "roles" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Roles
          </button>
          <button
            type="button"
            onClick={() => setTab("staff")}
            className={`rounded-md px-4 py-1.5 font-medium ${tab === "staff" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Staff
          </button>
        </div>
        {tab === "roles" && canEdit ? (
          <Button size="sm" onClick={() => setEditor({ role: null })}>
            <PlusIcon className="size-4" /> Add role
          </Button>
        ) : null}
      </div>

      {tab === "roles" ? (
        <div className="flex flex-col gap-6">
          <RoleGrid title="Default roles" roles={systemRoles} onOpen={(r) => setEditor({ role: r })} />
          <RoleGrid
            title="Custom roles"
            roles={customRoles}
            emptyText="No custom roles yet."
            onOpen={(r) => setEditor({ role: r })}
            onDelete={
              canEdit
                ? (r) => run(() => deleteRole(r.id), "Role deleted.")
                : undefined
            }
          />
        </div>
      ) : (
        <StaffTab
          members={members}
          roleOptions={roleOptions}
          canEdit={canEdit}
          pending={pending}
          onAdd={(email, roleId) => run(() => addMember(email, roleId), "Saved.")}
          onSetRole={(userId, roleId) => run(() => setMemberRole(userId, roleId), "Role updated.")}
          onApprove={(userId) => run(() => approveMember(userId), "Approved.")}
          onRemove={(userId) => run(() => removeMember(userId), "Removed.")}
          onCancel={(email) => run(() => cancelInvite(email), "Invite cancelled.")}
        />
      )}

      {editor ? (
        <RoleEditor role={editor.role} permissions={permissions} onClose={() => setEditor(null)} />
      ) : null}
    </div>
  )
}

function RoleGrid({
  title,
  roles,
  emptyText,
  onOpen,
  onDelete,
}: {
  title: string
  roles: Role[]
  emptyText?: string
  onOpen: (r: Role) => void
  onDelete?: (r: Role) => void
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h3>
      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText ?? "None."}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <div key={r.id} className="rounded-lg border p-4">
              <button type="button" onClick={() => onOpen(r)} className="block w-full text-left">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="font-semibold">{r.name}</span>
                  {r.is_system ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      default
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground capitalize">
                  base: {r.base_role} · {r.permissions.length} permissions
                </p>
                <p className="mt-2 text-sm text-muted-foreground">Total users: {r.userCount}</p>
              </button>
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(r)}
                  className="mt-2 text-xs text-destructive hover:underline"
                >
                  Delete
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function StaffTab({
  members,
  roleOptions,
  canEdit,
  pending,
  onAdd,
  onSetRole,
  onApprove,
  onRemove,
  onCancel,
}: {
  members: Member[]
  roleOptions: { id: string; name: string }[]
  canEdit: boolean
  pending: boolean
  onAdd: (email: string, roleId: string) => void
  onSetRole: (userId: string, roleId: string) => void
  onApprove: (userId: string) => void
  onRemove: (userId: string) => void
  onCancel: (email: string) => void
}) {
  const [email, setEmail] = useState("")
  const [roleId, setRoleId] = useState(roleOptions[0]?.id ?? "")

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <label className="flex-1 text-sm font-medium">
            Add by email
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@email.com" type="email" className="mt-1" />
          </label>
          <label className="text-sm font-medium">
            Role
            <Select value={roleId} onValueChange={(v) => setRoleId(v ?? "")}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            disabled={pending || !email.trim() || !roleId}
            onClick={() => {
              onAdd(email.trim(), roleId)
              setEmail("")
            }}
          >
            Add
          </Button>
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team members yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50 text-left">
              <TableRow>
                <TableHead className="px-3 py-2 font-medium">Email</TableHead>
                <TableHead className="px-3 py-2 font-medium">Role</TableHead>
                <TableHead className="px-3 py-2 font-medium">Status</TableHead>
                {canEdit ? <TableHead className="px-3 py-2 text-right font-medium">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id ?? m.email} className="border-t">
                  <TableCell className="px-3 py-2">{m.email}</TableCell>
                  <TableCell className="px-3 py-2">
                    {canEdit && m.user_id ? (
                      <Select
                        value={m.role_id ?? ""}
                        disabled={pending}
                        onValueChange={(v) => v && onSetRole(m.user_id as string, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="capitalize">{m.role_name ?? m.base_role}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[m.status] ?? "bg-muted"}`}>
                      {m.status}
                    </span>
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {m.status === "pending" && m.user_id ? (
                          <button type="button" disabled={pending} onClick={() => onApprove(m.user_id as string)} className="text-xs text-green-600 hover:underline dark:text-green-400">
                            Approve
                          </button>
                        ) : null}
                        {m.user_id ? (
                          <button type="button" disabled={pending} onClick={() => onRemove(m.user_id as string)} className="text-xs text-destructive hover:underline">
                            Remove
                          </button>
                        ) : (
                          <button type="button" disabled={pending} onClick={() => onCancel(m.email)} className="text-xs text-destructive hover:underline">
                            Cancel
                          </button>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
