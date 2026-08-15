"use client"

import { useMemo, useState, useTransition } from "react"
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import { createUnit, deleteUnit, renameUnit } from "@/app/(app)/inventory/actions"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { UnitOpt } from "./types"

/** Group order in the list — the order a store keeper thinks in, not alphabetical. */
const KIND_LABEL: { key: string; label: string }[] = [
  { key: "weight", label: "Weight" },
  { key: "volume", label: "Volume" },
  { key: "count", label: "Count" },
  { key: "packaging", label: "Packaging" },
  { key: "custom", label: "Yours" },
]

/**
 * The unit list, whole.
 *
 * Every unit is a row this restaurant owns, so every row can be renamed or
 * removed — no half-list where the useful entries are untouchable. Rename
 * carries the items with it (`rename_inventory_unit`); delete is refused while
 * items still measure in it, and the row says so before you try, because the
 * count is right there next to the name.
 *
 * Editing happens in place. A rename dialog on top of a manage dialog on top of
 * the item sheet is three layers deep for changing one word.
 */
export function ManageUnitsDialog({
  open,
  onOpenChange,
  units,
  usage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  units: UnitOpt[]
  /** lowercased unit name → how many items measure in it. */
  usage: Map<string, number>
}) {
  const [draft, setDraft] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const groups = useMemo(() => {
    const byKind = new Map<string, UnitOpt[]>()
    for (const u of units) {
      const key = u.kind && KIND_LABEL.some((k) => k.key === u.kind) ? u.kind : "custom"
      const list = byKind.get(key)
      if (list) list.push(u)
      else byKind.set(key, [u])
    }
    return KIND_LABEL.map((k) => ({
      ...k,
      units: (byKind.get(k.key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.units.length > 0)
  }, [units])

  function add() {
    const name = draft.trim()
    if (!name) return
    if (units.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      setErr(`"${name}" is already on the list.`)
      return
    }
    startTransition(async () => {
      setErr(null)
      const res = await createUnit(name)
      if (res && "error" in res) setErr(res.error)
      else setDraft("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="gap-0">
        <DialogHeader>
          <DialogTitle>Units</DialogTitle>
          <DialogDescription>
            Rename one and every item measured in it follows. Remove one and it leaves the picker.
          </DialogDescription>
        </DialogHeader>

        {/* Adding sits above the list, not behind a second click: coming here to
            add is at least as common as coming here to tidy up. */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 p-4">
          <Input
            aria-label="New unit"
            placeholder="Add a unit — half-crate, tin, jar…"
            maxLength={24}
            value={draft}
            disabled={pending}
            onChange={(e) => {
              setDraft(e.target.value)
              setErr(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              add()
            }}
          />
          <Button type="button" onClick={add} disabled={pending || !draft.trim()} className="h-11 px-4">
            <PlusIcon />
            Add
          </Button>
        </div>

        <DialogBody className="p-0">
          {err ? (
            <p className="border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive">
              {err}
            </p>
          ) : null}

          {groups.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No units yet. Add the first one above — kg, ltr, pcs, whatever this kitchen counts in.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.key}>
                <h3 className="sticky top-0 z-10 bg-background/95 px-4 pt-4 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground backdrop-blur">
                  {g.label}
                </h3>
                <ul>
                  {g.units.map((u) => (
                    <UnitRow key={u.id} unit={u} inUse={usage.get(u.name.trim().toLowerCase()) ?? 0} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

type RowMode = "idle" | "editing" | "confirming"

function UnitRow({ unit, inUse }: { unit: UnitOpt; inUse: number }) {
  const [mode, setMode] = useState<RowMode>("idle")
  const [draft, setDraft] = useState(unit.name)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    const next = draft.trim()
    if (!next || next === unit.name) return reset()
    startTransition(async () => {
      setErr(null)
      const res = await renameUnit(unit.id, next)
      if (res && "error" in res) setErr(res.error)
      else setMode("idle")
    })
  }

  function remove() {
    startTransition(async () => {
      setErr(null)
      const res = await deleteUnit(unit.id)
      if (res && "error" in res) setErr(res.error)
      // On success the row disappears with the revalidated list.
    })
  }

  function reset() {
    setMode("idle")
    setDraft(unit.name)
    setErr(null)
  }

  if (mode === "editing") {
    return (
      <li className="border-b px-4 py-2 last:border-b-0">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            aria-label={`Rename ${unit.name}`}
            maxLength={24}
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                save()
              } else if (e.key === "Escape") {
                e.preventDefault()
                reset()
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Save name"
            disabled={pending}
            onClick={save}
          >
            <CheckIcon />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 shrink-0"
            aria-label="Cancel rename"
            disabled={pending}
            onClick={reset}
          >
            <XIcon />
          </Button>
        </div>
        {inUse > 0 ? (
          <p className="pt-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{inUse}</span> item{inUse === 1 ? "" : "s"} will be
            renamed with it.
          </p>
        ) : null}
        {err ? <p className="pt-1.5 text-xs font-medium text-destructive">{err}</p> : null}
      </li>
    )
  }

  if (mode === "confirming") {
    const blocked = inUse > 0
    return (
      <li className="border-b bg-destructive/8 px-4 py-2.5 last:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-semibold">Remove {unit.name}?</span>{" "}
            <span className="text-muted-foreground">
              {blocked ? (
                <>
                  <span className="tabular-nums">{inUse}</span> item{inUse === 1 ? "" : "s"} still
                  measure in it — rename it instead, or move those items to another unit first.
                </>
              ) : (
                "It leaves the picker. Nothing on the shelf changes."
              )}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button type="button" variant="ghost" className="h-11" onClick={reset} disabled={pending}>
              Keep
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              disabled={pending || blocked}
              onClick={remove}
            >
              {pending ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
        {err ? <p className="pt-1.5 text-xs font-medium text-destructive">{err}</p> : null}
      </li>
    )
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-3 border-b px-4 py-1.5 last:border-b-0",
        "transition-colors motion-reduce:transition-none hover:bg-muted/50",
      )}
    >
      <span className="text-sm font-semibold">{unit.name}</span>
      <span className="text-xs text-muted-foreground">
        {inUse === 0 ? (
          "unused"
        ) : (
          <>
            <span className="tabular-nums">{inUse}</span> item{inUse === 1 ? "" : "s"}
          </>
        )}
      </span>
      {/* Actions stay put on touch — a waiter has no hover. They only *quieten*
          until hover/focus on a pointer device. */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:opacity-60 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:motion-reduce:transition-none">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-11"
          aria-label={`Rename ${unit.name}`}
          onClick={() => setMode("editing")}
        >
          <PencilIcon />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${unit.name}`}
          onClick={() => setMode("confirming")}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}
