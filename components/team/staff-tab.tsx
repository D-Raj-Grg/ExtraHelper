"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { JoinCodeCard } from "./join-code-card"
import { MEMBER_STATUS_LABEL, STATUS_STYLES, type Member, type RoleOption } from "./types"

export function StaffTab({
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
  roleOptions: RoleOption[]
  canEdit: boolean
  pending: boolean
  onAdd: (email: string, roleId: string) => void
  onSetRole: (userId: string, roleId: string) => void
  onApprove: (userId: string) => void
  onRemove: (member: Member) => void
  onCancel: (member: Member) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <AddMemberCard roleOptions={roleOptions} pending={pending} onAdd={onAdd} />
          <JoinCodeCard roleOptions={roleOptions} />
        </div>
      ) : null}

      {members.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No team members yet. Add someone by email above, or share a join code.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="px-3 py-2 font-medium">Email</TableHead>
                <TableHead className="px-3 py-2 font-medium">Role</TableHead>
                <TableHead className="px-3 py-2 font-medium">Status</TableHead>
                {canEdit ? (
                  <TableHead className="px-3 py-2 text-right font-medium">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id ?? m.email}>
                  <TableCell className="px-3 py-2">{m.email}</TableCell>
                  <TableCell className="px-3 py-2">
                    {canEdit && m.user_id ? (
                      <Select
                        value={m.role_id ?? ""}
                        disabled={pending}
                        onValueChange={(v) => v && onSetRole(m.user_id as string, String(v))}
                      >
                        <SelectTrigger className="h-8 text-xs" aria-label={`Role for ${m.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="capitalize">{m.role_name ?? m.base_role}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <Badge
                      className={cn("border-transparent", STATUS_STYLES[m.status] ?? "bg-muted")}
                    >
                      {MEMBER_STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {m.status === "pending" && m.user_id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => onApprove(m.user_id as string)}
                          >
                            Approve
                            <span className="sr-only"> {m.email}</span>
                          </Button>
                        ) : null}
                        <RemoveMemberButton
                          member={m}
                          pending={pending}
                          onRemove={onRemove}
                          onCancel={onCancel}
                        />
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

function AddMemberCard({
  roleOptions,
  pending,
  onAdd,
}: {
  roleOptions: RoleOption[]
  pending: boolean
  onAdd: (email: string, roleId: string) => void
}) {
  const [email, setEmail] = useState("")
  // No pre-selected role on purpose: the list is ordered with the system roles
  // first, so a default would silently hand out whichever one sorts first.
  const [roleId, setRoleId] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !roleId) return
    onAdd(email.trim(), roleId)
    setEmail("")
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Add a member</CardTitle>
        <CardDescription>
          If they already have an account they join right away, otherwise we hold an invite for them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A real form, so Enter submits. */}
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor="member-email">Email</FieldLabel>
            <Input
              id="member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@email.com"
              autoComplete="off"
              required
            />
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="member-role">Role</FieldLabel>
            <Select value={roleId} onValueChange={(v) => setRoleId(String(v ?? ""))}>
              <SelectTrigger id="member-role" className="w-full">
                <SelectValue placeholder="Pick a role" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" disabled={pending || !email.trim() || !roleId}>
            <PlusIcon className="size-4" />
            Add
          </Button>
          <FieldDescription className="w-full">
            Pick the role deliberately — it decides what they can see and do.
          </FieldDescription>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Removing someone revokes their access to this restaurant, and cancelling an
 * invite voids it. Both used to fire on a single click of a text link.
 */
function RemoveMemberButton({
  member,
  pending,
  onRemove,
  onCancel,
}: {
  member: Member
  pending: boolean
  onRemove: (m: Member) => void
  onCancel: (m: Member) => void
}) {
  const [open, setOpen] = useState(false)
  const isInvite = !member.user_id

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}>
            {isInvite ? "Cancel" : "Remove"}
            <span className="sr-only"> {member.email}</span>
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isInvite ? "Cancel this invite?" : `Remove ${member.email}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isInvite
              ? `${member.email} won't be able to join with this invite. You can invite them again later.`
              : "They lose access to this restaurant immediately. Their past orders and audit history stay put."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              if (isInvite) onCancel(member)
              else onRemove(member)
            }}
          >
            {isInvite ? "Cancel invite" : "Remove member"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
