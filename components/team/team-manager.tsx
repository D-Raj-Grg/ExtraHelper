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
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RoleEditorSheet } from "./role-editor-sheet"
import { RolesTab } from "./roles-tab"
import { StaffTab } from "./staff-tab"
import type { Member, Permission, Role } from "./types"

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
  const [tab, setTab] = useState("roles")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
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

  const openEditor = (role: Role | null) => {
    setEditingRole(role)
    setEditorOpen(true)
  }

  // The action distinguishes attaching an existing account from holding an
  // invite; saying "Saved." for both left admins expecting someone to show up
  // who hadn't been mailed anything.
  const handleAdd = (email: string, roleId: string) =>
    startTransition(async () => {
      const res = await addMember(email, roleId)
      if (res && "error" in res) toast.error(res.error)
      else if (res && "ok" in res)
        toast.success(
          res.invited
            ? `No account for ${email} yet — invite saved. They'll join when they sign up.`
            : `${email} added to the team.`,
        )
    })

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <TabsList variant="line">
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
          </TabsList>
          {tab === "roles" && canEdit ? (
            <Button size="sm" onClick={() => openEditor(null)}>
              <PlusIcon className="size-4" /> Add role
            </Button>
          ) : null}
        </div>

        <TabsContent value="roles">
          <RolesTab
            systemRoles={systemRoles}
            customRoles={customRoles}
            canEdit={canEdit}
            pending={pending}
            onOpen={openEditor}
            onDelete={(r) => run(() => deleteRole(r.id), `${r.name} deleted.`)}
          />
        </TabsContent>

        <TabsContent value="staff">
          <StaffTab
            members={members}
            roleOptions={roleOptions}
            canEdit={canEdit}
            pending={pending}
            onAdd={handleAdd}
            onSetRole={(userId, roleId) => run(() => setMemberRole(userId, roleId), "Role updated.")}
            onApprove={(userId) => run(() => approveMember(userId), "Member approved.")}
            onRemove={(m) => run(() => removeMember(m.user_id as string), `${m.email} removed.`)}
            onCancel={(m) => run(() => cancelInvite(m.email), "Invite cancelled.")}
          />
        </TabsContent>
      </Tabs>

      <RoleEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        role={editingRole}
        permissions={permissions}
      />
    </div>
  )
}
