"use client"

import { useState, useTransition } from "react"
import { XIcon } from "lucide-react"
import { toast } from "sonner"
import { createRole, updateRole } from "@/app/(app)/team/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

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

const COLORS = [
  "#059669", "#d97706", "#7c3aed", "#c026d3", "#2563eb", "#16a34a",
  "#64748b", "#ef4444", "#b91c1c", "#0a0a0a", "#78350f", "#ec4899",
]
const BASE_ROLES = ["owner", "manager", "receptionist", "cashier", "waiter", "kitchen", "inventory"]

export function RoleEditor({
  role,
  permissions,
  onClose,
}: {
  role: EditableRole | null // null = create
  permissions: Permission[]
  onClose: () => void
}) {
  const readOnly = role?.is_system ?? false
  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [color, setColor] = useState(role?.color ?? COLORS[0])
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
      items.forEach((i) => (on ? n.add(i.key) : n.delete(i.key)))
      return n
    })

  function save() {
    if (readOnly) return
    const input = {
      name,
      description,
      color,
      baseRole,
      permissions: [...selected],
    }
    startTransition(async () => {
      const res = role ? await updateRole(role.id, input) : await createRole(input)
      if (res && "error" in res) toast.error(res.error)
      else {
        toast.success(role ? "Role updated." : "Role created.")
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {role ? (readOnly ? role.name : "Edit role") : "Create role"}
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <XIcon className="size-4" />
          </Button>
        </div>

        {readOnly ? (
          <p className="mb-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            This is a default role — its permissions are read-only.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">
            Role name
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} className="mt-1" placeholder="e.g. Shift Lead" />
          </label>
          <label className="text-sm font-medium">
            Description
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} className="mt-1" placeholder="Short description" />
          </label>
          <div className="text-sm font-medium">
            Base role (DB access floor)
            <select
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value)}
              disabled={readOnly}
              className="border-input dark:bg-input/30 mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm capitalize"
            >
              {BASE_ROLES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="text-sm font-medium">
            Color
            <div className="mt-1 flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setColor(c)}
                  className={`size-6 rounded ${color === c ? "ring-2 ring-ring ring-offset-1" : ""}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex-1">
          <p className="mb-2 text-sm font-semibold">Permissions</p>
          <div className="flex flex-col gap-3">
            {groups.map((g) => {
              const allOn = g.items.every((i) => selected.has(i.key))
              return (
                <div key={g.grp} className="rounded-lg border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">{g.grp}</span>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.items, !allOn)}
                        className="text-xs text-primary hover:underline"
                      >
                        {allOn ? "Clear" : "All"}
                      </button>
                    ) : null}
                  </div>
                  <ul>
                    {g.items.map((p) => (
                      <li key={p.key} className="flex items-center justify-between px-3 py-1.5 text-sm">
                        <span>{p.label}</span>
                        <Checkbox
                          checked={selected.has(p.key)}
                          disabled={readOnly}
                          onCheckedChange={() => toggle(p.key)}
                          className="size-4"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>

        {!readOnly ? (
          <div className="sticky bottom-0 mt-4 flex gap-2 border-t bg-background pt-3">
            <Button className="flex-1" disabled={pending || !name.trim()} onClick={save}>
              {pending ? "Saving…" : role ? "Save changes" : "Create role"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
