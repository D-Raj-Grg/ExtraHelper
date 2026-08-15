"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { CheckIcon, PlusIcon, SlidersHorizontalIcon, XIcon } from "lucide-react"

import { createUnit } from "@/app/(app)/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ManageUnitsDialog } from "./manage-units-dialog"
import type { UnitOpt } from "./types"

const ADD_NEW = "__add_new__"
const MANAGE = "__manage__"

/** Group order in the dropdown — matches the manage dialog, so the list reads the same in both. */
const KIND_ORDER: { key: string; label: string }[] = [
  { key: "weight", label: "Weight" },
  { key: "volume", label: "Volume" },
  { key: "count", label: "Count" },
  { key: "packaging", label: "Packaging" },
  { key: "custom", label: "Yours" },
]

/**
 * Unit-of-measure picker, backed by the restaurant's own unit list
 * (`inventory_units` — seeded with the usual kg/ltr/pcs on day one).
 *
 * Two ways out of the list: add one inline, right where you noticed it was
 * missing, or open Units to rename and remove.
 *
 * `name` renders a hidden input so this works inside a plain <form action={…}>.
 */
export function UnitSelect({
  id,
  name,
  value,
  onChange,
  units,
  usage,
  className,
}: {
  id?: string
  name?: string
  value: string
  onChange: (unit: string) => void
  /** This restaurant's unit list. */
  units: UnitOpt[]
  /** lowercased unit name → how many items measure in it. */
  usage: Map<string, number>
  className?: string
}) {
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [draft, setDraft] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Set when a menu row opens something else: the select closes by returning
  // focus to its trigger, which lands after the text field mounts and swallows
  // the first keystrokes. `finalFocus={false}` tells it to leave focus alone.
  const goingElsewhere = useRef(false)

  const groups = useMemo(() => {
    const byKind = new Map<string, string[]>()
    for (const u of units) {
      const key = u.kind && KIND_ORDER.some((k) => k.key === u.kind) ? u.kind : "custom"
      const list = byKind.get(key)
      if (list) list.push(u.name)
      else byKind.set(key, [u.name])
    }
    // A value not on the list yet (an item saved before this list existed, or a
    // unit just typed) still has to be selectable, or the trigger would show a
    // name the menu can't offer back.
    const known = units.some((u) => u.name.toLowerCase() === value.trim().toLowerCase())
    if (value.trim() && !known) {
      byKind.set("custom", [...(byKind.get("custom") ?? []), value.trim()])
    }
    return KIND_ORDER.map((k) => ({
      ...k,
      units: (byKind.get(k.key) ?? []).sort((a, b) => a.localeCompare(b)),
    })).filter((g) => g.units.length > 0)
  }, [units, value])

  function commitDraft() {
    const next = draft.trim()
    if (!next) return cancelDraft()
    // Reuse the existing casing if this unit already exists in some form, so
    // "KG" doesn't become a second entry sitting next to "kg".
    const existing = units.find((u) => u.name.toLowerCase() === next.toLowerCase())?.name
    const unit = existing ?? next
    onChange(unit)
    setAdding(false)
    setDraft("")
    triggerRef.current?.focus()
    // Persist it, so it survives the sheet closing and can be renamed or
    // removed later from Units. Insert is idempotent on the name.
    if (!existing) {
      startTransition(async () => {
        const res = await createUnit(unit)
        if (res && "error" in res) setErr(res.error)
      })
    }
  }

  function cancelDraft() {
    setAdding(false)
    setDraft("")
    triggerRef.current?.focus()
  }

  if (adding) {
    return (
      <div className={"flex flex-col gap-1 " + (className ?? "")}>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            aria-label="New unit"
            placeholder="e.g. half-crate"
            maxLength={24}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commitDraft()
              } else if (e.key === "Escape") {
                e.preventDefault()
                cancelDraft()
              }
            }}
          />
          <Button type="button" size="icon" variant="ghost" aria-label="Save unit" onClick={commitDraft}>
            <CheckIcon />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={cancelDraft}>
            <XIcon />
          </Button>
        </div>
        {err ? <p className="text-xs text-destructive">{err}</p> : null}
      </div>
    )
  }

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Select
        value={value}
        onValueChange={(v) => {
          const next = (v ?? "") as string
          if (next === ADD_NEW) {
            goingElsewhere.current = true
            setAdding(true)
          } else if (next === MANAGE) {
            goingElsewhere.current = true
            setManaging(true)
          } else if (next) {
            onChange(next)
          }
        }}
      >
        <SelectTrigger ref={triggerRef} id={id} className={"w-full " + (className ?? "")}>
          <SelectValue placeholder="Pick a unit" />
        </SelectTrigger>
        <SelectContent
          finalFocus={() => {
            if (!goingElsewhere.current) return undefined
            goingElsewhere.current = false
            return false
          }}
        >
          {groups.map((g) => (
            <SelectGroup key={g.key}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.units.map((u) => (
                <SelectItem key={`${g.key}-${u}`} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectSeparator />
          <SelectItem value={ADD_NEW}>
            <PlusIcon />
            Add unit…
          </SelectItem>
          <SelectItem value={MANAGE}>
            <SlidersHorizontalIcon />
            Edit units…
          </SelectItem>
        </SelectContent>
      </Select>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <ManageUnitsDialog
        open={managing}
        onOpenChange={(o) => {
          setManaging(o)
          if (!o) triggerRef.current?.focus()
        }}
        units={units}
        usage={usage}
      />
    </>
  )
}
