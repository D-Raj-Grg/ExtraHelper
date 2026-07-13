"use client"

import { useActionState, useState, useTransition } from "react"
import {
  createCategory,
  createItem,
  createStation,
  createModifier,
  deleteItem,
  toggleItem86,
  updateItem,
  updateCategory,
  updateStation,
  deleteStation,
  addVariant,
  removeVariant,
  deleteModifier,
  linkModifier,
  unlinkModifier,
  createCombo,
  deleteCombo,
  uploadItemImage,
  addAvailability,
  removeAvailability,
  addItemStationRoute,
  removeItemStationRoute,
  type MenuState,
} from "@/app/(app)/menu/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type Category = { id: string; name: string; sort: number | null; is_active: boolean }
type Station = { id: string; name: string }
type Modifier = { id: string; name: string; price_cents: number }
type Item = {
  id: string
  name: string
  description: string | null
  base_price_cents: number
  is_86: boolean
  image_url: string | null
  category_id: string | null
  item_station_routes: { station_id: string; kitchen_stations: { name: string } | null }[]
  item_variants: { id: string; name: string; price_delta_cents: number }[]
  item_modifiers: {
    modifier_id: string
    is_default: boolean
    max_qty: number
    modifiers: { id: string; name: string; price_cents: number } | null
  }[]
  item_availability: { id: string; day_of_week: number | null; start_time: string; end_time: string }[]
}
type Combo = {
  id: string
  name: string
  price_cents: number
  items: { item_id: string; qty: number }[]
  is_active: boolean
}

const inputClass =
  "border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
function dayLabel(d: number | null) {
  return d === null || d === undefined ? "Every day" : DAY_NAMES[d] ?? `Day ${d}`
}

function FormError({ state }: { state: MenuState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

/** Small inline error paragraph for non-form (transition) mutations. */
function InlineError({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {msg}
    </p>
  )
}

// ============================================================================
// Stations — editable pills
// ============================================================================

function StationPill({ station }: { station: Station }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(station.name)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
        <input
          className={inputClass + " h-7 w-32"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateStation(station.id, name)
              if (res && "error" in res) setErr(res.error)
              else setEditing(false)
            })
          }
        >
          Save
        </Button>
        <Button size="sm" variant="link" onClick={() => { setEditing(false); setName(station.name); setErr(null) }}>
          Cancel
        </Button>
        <InlineError msg={err} />
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-medium">
      {station.name}
      <Button size="sm" variant="link" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="link"
        className="text-destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteStation(station.id)
            if (res && "error" in res) setErr(res.error)
          })
        }
      >
        Delete
      </Button>
      <InlineError msg={err} />
    </span>
  )
}

// ============================================================================
// Categories — editable row
// ============================================================================

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <TableRow className="border-b last:border-0">
      <TableCell className="px-4 py-2">
        {editing ? (
          <input
            className={inputClass + " h-8 w-48"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        ) : (
          <span className="font-medium">{category.name}</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={category.is_active}
            disabled={pending}
            onCheckedChange={(v) =>
              startTransition(async () => {
                const res = await updateCategory(category.id, { isActive: Boolean(v) })
                if (res && "error" in res) setErr(res.error)
              })
            }
          />
          Active
        </label>
      </TableCell>
      <TableCell className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await updateCategory(category.id, { name })
                    if (res && "error" in res) setErr(res.error)
                    else setEditing(false)
                  })
                }
              >
                Save
              </Button>
              <Button size="sm" variant="link" onClick={() => { setEditing(false); setName(category.name); setErr(null) }}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Rename
            </Button>
          )}
          <InlineError msg={err} />
        </div>
      </TableCell>
    </TableRow>
  )
}

// ============================================================================
// Modifiers library
// ============================================================================

function ModifierRow({ modifier, currency }: { modifier: Modifier; currency: string }) {
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <TableRow className="border-b last:border-0">
      <TableCell className="px-4 py-2 font-medium">{modifier.name}</TableCell>
      <TableCell className="px-4 py-2 text-muted-foreground">
        {money(modifier.price_cents, currency)}
      </TableCell>
      <TableCell className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteModifier(modifier.id)
                if (res && "error" in res) setErr(res.error)
              })
            }
          >
            Delete
          </Button>
          <InlineError msg={err} />
        </div>
      </TableCell>
    </TableRow>
  )
}

// ============================================================================
// Combos
// ============================================================================

function ComboBuilder({ items, currency }: { items: Item[]; currency: string }) {
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [rows, setRows] = useState<{ item_id: string; qty: number }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function addRow() {
    const first = items[0]
    if (!first) return
    setRows((r) => [...r, { item_id: first.id, qty: 1 }])
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Combo name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lunch Combo" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Price</label>
          <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.00" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No member items yet.</p>
        ) : (
          rows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <Select
                value={row.item_id}
                onValueChange={(v) =>
                  setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, item_id: v ?? "" } : r)))
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Pick item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                step="1"
                className="w-20"
                value={row.qty}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, i) => (i === idx ? { ...r, qty: Math.max(1, Number(e.target.value) || 1) } : r)),
                  )
                }
              />
              <Button size="sm" variant="link" className="text-destructive" onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}>
                Remove
              </Button>
            </div>
          ))
        )}
        <div>
          <Button size="sm" variant="outline" onClick={addRow} disabled={items.length === 0}>
            + Add member item
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setErr(null)
              const res = await createCombo(name, price, rows)
              if (res && "error" in res) setErr(res.error)
              else {
                setName("")
                setPrice("")
                setRows([])
              }
            })
          }
        >
          {pending ? "Saving…" : "Create combo"}
        </Button>
        <InlineError msg={err} />
      </div>
    </div>
  )
}

function ComboRow({ combo, itemNames, currency }: { combo: Combo; itemNames: Map<string, string>; currency: string }) {
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const members = combo.items
    .map((m) => `${itemNames.get(m.item_id) ?? "?"}${m.qty > 1 ? ` ×${m.qty}` : ""}`)
    .join(", ")
  return (
    <TableRow className="border-b last:border-0">
      <TableCell className="px-4 py-2 font-medium">{combo.name}</TableCell>
      <TableCell className="px-4 py-2 text-muted-foreground">{money(combo.price_cents, currency)}</TableCell>
      <TableCell className="px-4 py-2 text-muted-foreground">{members || "—"}</TableCell>
      <TableCell className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteCombo(combo.id)
                if (res && "error" in res) setErr(res.error)
              })
            }
          >
            Delete
          </Button>
          <InlineError msg={err} />
        </div>
      </TableCell>
    </TableRow>
  )
}

// ============================================================================
// Per-item detail editor (expanded panel)
// ============================================================================

function ItemEditor({
  item,
  categories,
  stations,
  modifiers,
  currency,
}: {
  item: Item
  categories: Category[]
  stations: Station[]
  modifiers: Modifier[]
  currency: string
}) {
  // Core fields
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState((item.base_price_cents / 100).toFixed(2))
  const [categoryId, setCategoryId] = useState(item.category_id ?? "")
  const [description, setDescription] = useState(item.description ?? "")
  const [coreErr, setCoreErr] = useState<string | null>(null)
  const [corePending, startCore] = useTransition()

  // Variants
  const [vName, setVName] = useState("")
  const [vDelta, setVDelta] = useState("")
  const [vErr, setVErr] = useState<string | null>(null)
  const [vPending, startVariant] = useTransition()

  // Modifiers / stations / availability
  const [modErr, setModErr] = useState<string | null>(null)
  const [modPending, startMod] = useTransition()
  const [stationSel, setStationSel] = useState("")
  const [stErr, setStErr] = useState<string | null>(null)
  const [stPending, startStation] = useTransition()

  const [avDay, setAvDay] = useState("null")
  const [avStart, setAvStart] = useState("")
  const [avEnd, setAvEnd] = useState("")
  const [avErr, setAvErr] = useState<string | null>(null)
  const [avPending, startAvail] = useTransition()

  // Image upload form
  const [imgState, imgAction, imgPending] = useActionState<MenuState, FormData>(uploadItemImage, undefined)

  const linkedModIds = new Set(item.item_modifiers.map((m) => m.modifier_id))
  const routedStationIds = new Set(item.item_station_routes.map((r) => r.station_id))
  const remainingStations = stations.filter((s) => !routedStationIds.has(s.id))

  return (
    <div className="flex flex-col gap-6 border-t bg-muted/30 p-4">
      {/* Core fields ----------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Details</h4>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Price</label>
            <Input type="number" min={0} step="0.01" className="w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="— none —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— none —</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Description</label>
          <textarea
            className={inputClass + " min-h-16 w-full max-w-xl"}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description…"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={corePending}
            onClick={() =>
              startCore(async () => {
                setCoreErr(null)
                const res = await updateItem(item.id, { name, price, categoryId: categoryId || null, description })
                if (res && "error" in res) setCoreErr(res.error)
              })
            }
          >
            {corePending ? "Saving…" : "Save details"}
          </Button>
          <InlineError msg={coreErr} />
        </div>
      </div>

      {/* Image ----------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Image</h4>
        <div className="flex items-center gap-4">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt={item.name}
              className="size-16 rounded-md border object-cover"
            />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-md border text-xs text-muted-foreground">
              None
            </span>
          )}
          <form action={imgAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="itemId" value={item.id} />
            <input type="file" name="file" accept="image/*" className="text-sm" required />
            <Button type="submit" size="sm" variant="secondary" disabled={imgPending}>
              {imgPending ? "Uploading…" : "Upload"}
            </Button>
            <FormError state={imgState} />
          </form>
        </div>
      </div>

      {/* Variants -------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Variants</h4>
        {item.item_variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variants.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {item.item_variants.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{v.name}</span>
                <span className="text-muted-foreground">
                  {v.price_delta_cents >= 0 ? "+" : "−"}
                  {money(Math.abs(v.price_delta_cents), currency)}
                </span>
                <Button
                  size="sm"
                  variant="link"
                  className="text-destructive"
                  disabled={vPending}
                  onClick={() =>
                    startVariant(async () => {
                      const res = await removeVariant(v.id)
                      if (res && "error" in res) setVErr(res.error)
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input className="w-40" value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Large" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Price delta</label>
            <Input className="w-28" type="number" step="0.01" value={vDelta} onChange={(e) => setVDelta(e.target.value)} placeholder="2.00" />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={vPending}
            onClick={() =>
              startVariant(async () => {
                setVErr(null)
                const res = await addVariant(item.id, vName, vDelta || "0")
                if (res && "error" in res) setVErr(res.error)
                else {
                  setVName("")
                  setVDelta("")
                }
              })
            }
          >
            Add variant
          </Button>
          <InlineError msg={vErr} />
        </div>
      </div>

      {/* Modifiers ------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Modifiers</h4>
        {modifiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No modifiers in the library yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {modifiers.map((mod) => {
              const linked = linkedModIds.has(mod.id)
              const current = item.item_modifiers.find((m) => m.modifier_id === mod.id)
              return (
                <div key={mod.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <Checkbox
                      checked={linked}
                      disabled={modPending}
                      onCheckedChange={(v) =>
                        startMod(async () => {
                          setModErr(null)
                          const res = v
                            ? await linkModifier(item.id, mod.id)
                            : await unlinkModifier(item.id, mod.id)
                          if (res && "error" in res) setModErr(res.error)
                        })
                      }
                    />
                    <span className="font-medium">{mod.name}</span>
                    <span className="text-muted-foreground">{money(mod.price_cents, currency)}</span>
                  </label>
                  {linked ? (
                    <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      max qty
                      <Input
                        type="number"
                        min={1}
                        step="1"
                        className="h-8 w-16"
                        defaultValue={current?.max_qty ?? 1}
                        disabled={modPending}
                        onBlur={(e) =>
                          startMod(async () => {
                            setModErr(null)
                            const res = await linkModifier(item.id, mod.id, {
                              maxQty: Math.max(1, Number(e.target.value) || 1),
                            })
                            if (res && "error" in res) setModErr(res.error)
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        <InlineError msg={modErr} />
      </div>

      {/* Stations -------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Kitchen routing</h4>
        <div className="flex flex-wrap items-center gap-2">
          {item.item_station_routes.length === 0 ? (
            <span className="text-sm text-muted-foreground">No stations routed.</span>
          ) : (
            item.item_station_routes.map((r) => (
              <span key={r.station_id} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
                {r.kitchen_stations?.name ?? "?"}
                <Button
                  size="sm"
                  variant="link"
                  className="text-destructive"
                  disabled={stPending}
                  onClick={() =>
                    startStation(async () => {
                      const res = await removeItemStationRoute(item.id, r.station_id)
                      if (res && "error" in res) setStErr(res.error)
                    })
                  }
                >
                  ✕
                </Button>
              </span>
            ))
          )}
        </div>
        {remainingStations.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={stationSel} onValueChange={(v) => setStationSel(v ?? "")}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Add station…" />
              </SelectTrigger>
              <SelectContent>
                {remainingStations.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={stPending || !stationSel}
              onClick={() =>
                startStation(async () => {
                  setStErr(null)
                  const res = await addItemStationRoute(item.id, stationSel)
                  if (res && "error" in res) setStErr(res.error)
                  else setStationSel("")
                })
              }
            >
              Add route
            </Button>
          </div>
        ) : null}
        <InlineError msg={stErr} />
      </div>

      {/* Availability ---------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Availability</h4>
        {item.item_availability.length === 0 ? (
          <p className="text-sm text-muted-foreground">Always available.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {item.item_availability.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{dayLabel(a.day_of_week)}</span>
                <span className="text-muted-foreground">
                  {a.start_time}–{a.end_time}
                </span>
                <Button
                  size="sm"
                  variant="link"
                  className="text-destructive"
                  disabled={avPending}
                  onClick={() =>
                    startAvail(async () => {
                      const res = await removeAvailability(a.id)
                      if (res && "error" in res) setAvErr(res.error)
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Day</label>
            <Select value={avDay} onValueChange={(v) => setAvDay(v ?? "null")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="null">Every day</SelectItem>
                {DAY_NAMES.map((d, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Start</label>
            <Input type="time" className="w-32" value={avStart} onChange={(e) => setAvStart(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">End</label>
            <Input type="time" className="w-32" value={avEnd} onChange={(e) => setAvEnd(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={avPending}
            onClick={() =>
              startAvail(async () => {
                setAvErr(null)
                const res = await addAvailability(
                  item.id,
                  avDay === "null" ? null : Number(avDay),
                  avStart,
                  avEnd,
                )
                if (res && "error" in res) setAvErr(res.error)
                else {
                  setAvStart("")
                  setAvEnd("")
                }
              })
            }
          >
            Add window
          </Button>
          <InlineError msg={avErr} />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Item row (collapsed) + expand toggle
// ============================================================================

function ItemRow({
  item,
  open,
  onToggle,
  categories,
  stations,
  modifiers,
  currency,
}: {
  item: Item
  open: boolean
  onToggle: () => void
  categories: Category[]
  stations: Station[]
  modifiers: Modifier[]
  currency: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <>
      <TableRow className="border-b last:border-0">
        <TableCell className="px-4 py-2 font-medium">
          {item.name}
          {item.is_86 ? (
            <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 dark:text-red-400">86</span>
          ) : null}
        </TableCell>
        <TableCell className="px-4 py-2 text-muted-foreground">{money(item.base_price_cents, currency)}</TableCell>
        <TableCell className="px-4 py-2 text-muted-foreground">
          {item.item_station_routes
            .map((r) => r.kitchen_stations?.name)
            .filter(Boolean)
            .join(", ") || "—"}
        </TableCell>
        <TableCell className="px-4 py-2 text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant={open ? "secondary" : "outline"} onClick={onToggle}>
              {open ? "Close" : "Edit"}
            </Button>
            <Button
              size="sm"
              variant={item.is_86 ? "default" : "outline"}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await toggleItem86(item.id, !item.is_86)
                })
              }
            >
              {item.is_86 ? "Un-86" : "86"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteItem(item.id)
                })
              }
            >
              Delete
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={4} className="p-0">
            <ItemEditor item={item} categories={categories} stations={stations} modifiers={modifiers} currency={currency} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

// ============================================================================
// Main
// ============================================================================

export function MenuManager({
  currency,
  categories,
  items,
  stations,
  modifiers,
  combos,
}: {
  currency: string
  categories: Category[]
  items: Item[]
  stations: Station[]
  modifiers: Modifier[]
  combos: Combo[]
}) {
  const [catState, catAction, catPending] = useActionState<MenuState, FormData>(createCategory, undefined)
  const [itemState, itemAction, itemPending] = useActionState<MenuState, FormData>(createItem, undefined)
  const [stationState, stationAction, stationPending] = useActionState<MenuState, FormData>(createStation, undefined)
  const [modState, modAction, modPending] = useActionState<MenuState, FormData>(createModifier, undefined)

  const [openItems, setOpenItems] = useState<Set<string>>(new Set())
  function toggleItem(id: string) {
    setOpenItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const itemNames = new Map(items.map((i) => [i.id, i.name]))
  const uncategorized = items.filter((i) => !i.category_id)

  return (
    <div className="flex flex-col gap-8">
      {/* Kitchen stations ---------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Kitchen stations</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {stations.length === 0 ? (
            <span className="text-sm text-muted-foreground">No stations yet — add one to route KOTs.</span>
          ) : (
            stations.map((s) => <StationPill key={s.id} station={s} />)
          )}
        </div>
        <form action={stationAction} className="flex flex-wrap items-center gap-2">
          <Input name="name" placeholder="e.g. Grill" className="max-w-xs" required />
          <Button type="submit" size="sm" variant="secondary" disabled={stationPending}>
            {stationPending ? "Adding…" : "Add station"}
          </Button>
          <FormError state={stationState} />
        </form>
      </section>

      {/* Categories ---------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Categories</h2>
        {categories.length > 0 ? (
          <div className="mb-3 overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-2 text-left">Name</TableHead>
                  <TableHead className="px-4 py-2 text-left">Status</TableHead>
                  <TableHead className="px-4 py-2 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <CategoryRow key={c.id} category={c} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        <form action={catAction} className="flex flex-wrap items-center gap-2">
          <Input name="name" placeholder="e.g. Starters" className="max-w-xs" required />
          <Button type="submit" size="sm" variant="secondary" disabled={catPending}>
            {catPending ? "Adding…" : "Add category"}
          </Button>
          <FormError state={catState} />
        </form>
      </section>

      {/* Modifiers library --------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Modifiers</h2>
        {modifiers.length > 0 ? (
          <div className="mb-3 overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-2 text-left">Name</TableHead>
                  <TableHead className="px-4 py-2 text-left">Price</TableHead>
                  <TableHead className="px-4 py-2 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modifiers.map((m) => (
                  <ModifierRow key={m.id} modifier={m} currency={currency} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">No modifiers yet — add reusable options like “Extra cheese”.</p>
        )}
        <form action={modAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input name="name" placeholder="Extra cheese" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Price</label>
            <Input name="price" type="number" min={0} step="0.01" placeholder="1.50" />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={modPending}>
            {modPending ? "Adding…" : "Add modifier"}
          </Button>
          <FormError state={modState} />
        </form>
      </section>

      {/* Combos -------------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Combos</h2>
        {combos.length > 0 ? (
          <div className="mb-3 overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-2 text-left">Name</TableHead>
                  <TableHead className="px-4 py-2 text-left">Price</TableHead>
                  <TableHead className="px-4 py-2 text-left">Items</TableHead>
                  <TableHead className="px-4 py-2 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {combos.map((c) => (
                  <ComboRow key={c.id} combo={c} itemNames={itemNames} currency={currency} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">No combos yet.</p>
        )}
        <ComboBuilder items={items} currency={currency} />
      </section>

      {/* Add item ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Add item</h2>
        <form action={itemAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input name="name" placeholder="Classic Burger" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Price</label>
            <Input name="price" type="number" min={0} step="0.01" placeholder="12.00" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <Select name="categoryId" defaultValue="">
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— none —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— none —</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Station</label>
            <Select name="stationId" defaultValue="">
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— none —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— none —</SelectItem>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={itemPending}>
            {itemPending ? "Adding…" : "Add item"}
          </Button>
        </form>
        <div className="mt-1">
          <FormError state={itemState} />
        </div>
      </section>

      {/* Items by category --------------------------------------------------- */}
      <section className="flex flex-col gap-6">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet.</p>
        ) : (
          [...categories, { id: "__none__", name: "Uncategorized", sort: null, is_active: true } as Category].map((cat) => {
            const list = cat.id === "__none__" ? uncategorized : items.filter((i) => i.category_id === cat.id)
            if (list.length === 0) return null
            return (
              <div key={cat.id}>
                <h3 className="mb-2 font-medium">{cat.name}</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <Table className="w-full text-sm">
                    <TableBody>
                      {list.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          open={openItems.has(item.id)}
                          onToggle={() => toggleItem(item.id)}
                          categories={categories}
                          stations={stations}
                          modifiers={modifiers}
                          currency={currency}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
