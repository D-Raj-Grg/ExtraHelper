"use client"

import { useState, useTransition } from "react"
import { CheckIcon } from "lucide-react"
import { toast } from "sonner"
import { createRole, updateRole } from "@/app/(app)/team/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { BASE_ROLES, ROLE_COLORS, type EditableRole, type Permission } from "./types"

/**
 * Create / edit / inspect a role. Built on Sheet rather than a hand-rolled
 * overlay so it gets a focus trap, Escape-to-close, scroll lock and dialog
 * semantics for free — the previous version had none of those.
 */
export function RoleEditorSheet({
  open,
  onOpenChange,
  role,
  permissions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: EditableRole | null // null = create
  permissions: Permission[]
}) {
  // Default roles keep their identity (name, colour, base role) — those are what
  // the seeded RLS floor keys off — but their permissions stay editable.
  const identityLocked = role?.is_system ?? false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md" className="w-full gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{role ? `Edit ${role.name}` : "Create role"}</SheetTitle>
          <SheetDescription>
            {identityLocked
              ? "A default role. Its name and base role are fixed, but you can change what it can reach."
              : "Name the role, pick what it can reach, and save."}
          </SheetDescription>
        </SheetHeader>
        {/* Remount per role so the form never shows the previous role's values. */}
        <RoleForm
          key={role?.id ?? "new"}
          role={role}
          permissions={permissions}
          identityLocked={identityLocked}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}

function RoleForm({
  role,
  permissions,
  identityLocked,
  onDone,
}: {
  role: EditableRole | null
  permissions: Permission[]
  identityLocked: boolean
  onDone: () => void
}) {
  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [color, setColor] = useState(role?.color ?? ROLE_COLORS[0].hex)
  const [baseRole, setBaseRole] = useState(role?.base_role ?? "waiter")
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []))
  const [pending, startTransition] = useTransition()

  const groups: { grp: string; items: Permission[] }[] = []
  for (const p of permissions) {
    let g = groups.find((x) => x.grp === p.grp)
    if (!g) {
      g = { grp: p.grp, items: [] }
      groups.push(g)
    }
    g.items.push(p)
  }

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const toggleGroup = (items: Permission[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      items.forEach((i) => (on || isPinned(i.key) ? n.add(i.key) : n.delete(i.key)))
      return n
    })

  // An owner-based role without staff.edit locks every owner out of this screen
  // for good, so that one box stays pinned on (the server pins it too).
  const isPinned = (key: string) => baseRole === "owner" && key === "staff.edit"

  function save() {
    const input = { name, description, color, baseRole, permissions: [...selected] }
    startTransition(async () => {
      const res = role ? await updateRole(role.id, input) : await createRole(input)
      if (res && "error" in res) toast.error(res.error)
      else {
        toast.success(role ? "Role updated." : "Role created.")
        onDone()
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4">
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="role-name">Role name</FieldLabel>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={identityLocked}
            placeholder="e.g. Shift Lead"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="role-description">Description</FieldLabel>
          <Input
            id="role-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={identityLocked}
            placeholder="What this role is for"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="role-base">Base role</FieldLabel>
          <Select
            value={baseRole}
            onValueChange={(v) => v && setBaseRole(String(v))}
            disabled={identityLocked}
          >
            <SelectTrigger id="role-base" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASE_ROLES.map((b) => (
                <SelectItem key={b} value={b} className="capitalize">
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            The database access floor enforced by row-level security. Permissions above only ever
            narrow what this allows — they can&apos;t widen it.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Colour</FieldLabel>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Role colour">
            {ROLE_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                disabled={identityLocked}
                onClick={() => setColor(c.hex)}
                aria-label={c.name}
                aria-pressed={color === c.hex}
                title={c.name}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md transition-transform",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  "disabled:opacity-50 not-disabled:hover:scale-105",
                  color === c.hex && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: c.hex }}
              >
                {color === c.hex ? <CheckIcon className="size-4 text-white" /> : null}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="flex-1">
        <p className="mb-2 text-sm font-semibold">
          Permissions{" "}
          <span className="font-normal text-muted-foreground">({selected.size} selected)</span>
        </p>
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const allOn = g.items.every((i) => selected.has(i.key))
            return (
              <div key={g.grp} className="rounded-lg border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    {g.grp}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => toggleGroup(g.items, !allOn)}
                  >
                    {allOn ? "Clear" : "Select all"}
                    <span className="sr-only"> in {g.grp}</span>
                  </Button>
                </div>
                <ul>
                  {g.items.map((p) => (
                    <li key={p.key}>
                      {/* Label wraps the row: the whole line is the hit target,
                          not just the 16px box. */}
                      <label
                        htmlFor={`perm-${p.key}`}
                        className={cn(
                          "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                          isPinned(p.key)
                            ? "text-muted-foreground"
                            : "cursor-pointer hover:bg-muted/40",
                        )}
                      >
                        <span>
                          {p.label}
                          {isPinned(p.key) ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              always on for owners
                            </span>
                          ) : null}
                        </span>
                        <Checkbox
                          id={`perm-${p.key}`}
                          checked={isPinned(p.key) || selected.has(p.key)}
                          disabled={isPinned(p.key)}
                          onCheckedChange={() => toggle(p.key)}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      <SheetFooter className="sticky bottom-0 -mx-4 flex-row gap-2 border-t bg-background px-4">
        <Button className="flex-1" disabled={pending || !name.trim()} onClick={save}>
          {pending ? "Saving…" : role ? "Save changes" : "Create role"}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </SheetFooter>
    </div>
  )
}
