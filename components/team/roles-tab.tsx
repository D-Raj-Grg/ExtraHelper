"use client"

import { useState } from "react"
import { Trash2Icon } from "lucide-react"
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
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Role } from "./types"

export function RolesTab({
  systemRoles,
  customRoles,
  canEdit,
  pending,
  onOpen,
  onDelete,
}: {
  systemRoles: Role[]
  customRoles: Role[]
  canEdit: boolean
  pending: boolean
  onOpen: (r: Role) => void
  onDelete: (r: Role) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <RoleGrid
        title="Default roles"
        description="Built in and read-only. Open one to see exactly what it can reach."
        roles={systemRoles}
        pending={pending}
        onOpen={onOpen}
      />
      <RoleGrid
        title="Custom roles"
        description="Roles you define for this restaurant."
        roles={customRoles}
        emptyText="No custom roles yet. Add one when a default doesn't fit — a Shift Lead who can void, say."
        pending={pending}
        onOpen={onOpen}
        onDelete={canEdit ? onDelete : undefined}
      />
    </div>
  )
}

function RoleGrid({
  title,
  description,
  roles,
  emptyText,
  pending,
  onOpen,
  onDelete,
}: {
  title: string
  description: string
  roles: Role[]
  emptyText?: string
  pending: boolean
  onOpen: (r: Role) => void
  onDelete?: (r: Role) => void
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>

      {roles.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{emptyText ?? "None."}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.id} size="sm" className="transition-colors hover:border-ring/40">
              <CardContent className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className={cn(
                    "block w-full rounded-sm text-left",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: r.color }}
                      aria-hidden
                    />
                    <span className="truncate font-semibold">{r.name}</span>
                    {r.is_system ? (
                      <Badge variant="outline" className="ml-auto">
                        Default
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs capitalize text-muted-foreground">
                    Based on {r.base_role} · {r.permissions.length}{" "}
                    {r.permissions.length === 1 ? "permission" : "permissions"}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {r.userCount} {r.userCount === 1 ? "person" : "people"}
                  </span>
                </button>

                {onDelete ? (
                  <div className="flex justify-end">
                    <DeleteRoleButton role={r} pending={pending} onDelete={onDelete} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Deleting a role silently re-permissions everyone holding it, so the
 * confirmation says how many people that is and what they fall back to.
 */
function DeleteRoleButton({
  role,
  pending,
  onDelete,
}: {
  role: Role
  pending: boolean
  onDelete: (r: Role) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="icon-sm" variant="ghost" disabled={pending}>
            <Trash2Icon className="size-4" />
            <span className="sr-only">Delete role {role.name}</span>
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the {role.name} role?</AlertDialogTitle>
          <AlertDialogDescription>
            {role.userCount > 0
              ? `${role.userCount} ${role.userCount === 1 ? "person keeps" : "people keep"} their account but fall back to the default ${role.base_role} permissions. This can't be undone.`
              : "Nobody holds this role, so no one's access changes. This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onDelete(role)
            }}
          >
            Delete role
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
