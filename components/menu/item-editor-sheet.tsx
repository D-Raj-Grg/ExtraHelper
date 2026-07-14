"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import {
  addAvailability,
  addItemStationRoute,
  addVariant,
  createItem,
  linkModifier,
  removeAvailability,
  removeItemStationRoute,
  removeVariant,
  unlinkModifier,
  updateItem,
  uploadItemImage,
  type MenuState,
} from "@/app/(app)/menu/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DAY_NAMES, dayLabel, FormError, InlineError, type Category, type Item, type Modifier, type Station } from "./types"

const textareaClass =
  "border-input dark:bg-input/30 min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

// ============================================================================
// Add-item sheet — create form (opened from the "+ Add item" button)
// ============================================================================

export function AddItemSheet({
  open,
  onOpenChange,
  categories,
  stations,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  stations: Station[]
}) {
  const [state, action, pending] = useActionState<MenuState, FormData>(createItem, undefined)

  // Close the sheet once the create action reports success.
  useEffect(() => {
    if (state && "ok" in state) onOpenChange(false)
  }, [state, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add menu item</SheetTitle>
          <SheetDescription>
            Create the item, then open it to add a photo, sizes, add-ons, kitchen routing and hours.
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6" key={open ? "open" : "closed"}>
          <Field>
            <FieldLabel htmlFor="add-item-name">Name</FieldLabel>
            <Input id="add-item-name" name="name" placeholder="Classic Burger" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-item-price">Price</FieldLabel>
            <Input id="add-item-price" name="price" type="number" min={0} step="0.01" placeholder="12.00" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-item-category">Category</FieldLabel>
            <Select name="categoryId" defaultValue="">
              <SelectTrigger id="add-item-category" className="w-full">
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
          </Field>
          <Field>
            <FieldLabel htmlFor="add-item-station">Kitchen station</FieldLabel>
            <Select name="stationId" defaultValue="">
              <SelectTrigger id="add-item-station" className="w-full">
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
          </Field>
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add item"}
            </Button>
            <FormError state={state} />
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ============================================================================
// Item editor sheet — full detail editor for one item
// ============================================================================

export function ItemEditorSheet({
  item,
  open,
  onOpenChange,
  categories,
  stations,
  modifiers,
  currency,
}: {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  stations: Station[]
  modifiers: Modifier[]
  currency: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {item ? (
          <>
            <SheetHeader>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>{money(item.base_price_cents, currency)}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-6 pb-8">
              {/* key forces a fresh editor when switching items */}
              <ItemEditorBody
                key={item.id}
                item={item}
                categories={categories}
                stations={stations}
                modifiers={modifiers}
                currency={currency}
              />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ItemEditorBody({
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
    <>
      {/* Details --------------------------------------------------------- */}
      <FieldSet>
        <FieldLegend variant="label">Details</FieldLegend>
        <Field>
          <FieldLabel htmlFor="edit-name">Name</FieldLabel>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-price">Price</FieldLabel>
          <Input id="edit-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-category">Category</FieldLabel>
          <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
            <SelectTrigger id="edit-category" className="w-full">
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
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-description">Description</FieldLabel>
          <textarea
            id="edit-description"
            className={textareaClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description shown to customers…"
          />
        </Field>
        <div className="flex items-center gap-3">
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
      </FieldSet>

      {/* Image ----------------------------------------------------------- */}
      <FieldSet>
        <FieldLegend variant="label">Photo</FieldLegend>
        <div className="flex items-center gap-4">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_url} alt={item.name} className="size-16 rounded-md border object-cover" />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-md border text-xs text-muted-foreground">
              None
            </span>
          )}
          <form action={imgAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="itemId" value={item.id} />
            <Label htmlFor="edit-image" className="sr-only">
              Item photo file
            </Label>
            <input id="edit-image" type="file" name="file" accept="image/*" className="text-sm" required />
            <Button type="submit" size="sm" variant="secondary" disabled={imgPending}>
              {imgPending ? "Uploading…" : "Upload"}
            </Button>
            <FormError state={imgState} />
          </form>
        </div>
      </FieldSet>

      {/* Variants -------------------------------------------------------- */}
      <FieldSet>
        <FieldLegend variant="label">Sizes &amp; variants</FieldLegend>
        {item.item_variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variants — the item sells at its base price.</p>
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
                  aria-label={`Remove variant ${v.name}`}
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
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-40">
            <FieldLabel htmlFor="edit-variant-name">Name</FieldLabel>
            <Input id="edit-variant-name" value={vName} onChange={(e) => setVName(e.target.value)} placeholder="Large" />
          </Field>
          <Field className="w-28">
            <FieldLabel htmlFor="edit-variant-delta">Price change</FieldLabel>
            <Input id="edit-variant-delta" type="number" step="0.01" value={vDelta} onChange={(e) => setVDelta(e.target.value)} placeholder="2.00" />
          </Field>
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
      </FieldSet>

      {/* Modifiers ------------------------------------------------------- */}
      <FieldSet>
        <FieldLegend variant="label">Add-ons</FieldLegend>
        {modifiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No add-ons in the library yet. Create them on the Modifiers tab first.
          </p>
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
                      aria-label={`${linked ? "Remove" : "Add"} add-on ${mod.name}`}
                      onCheckedChange={(v) =>
                        startMod(async () => {
                          setModErr(null)
                          const res = v ? await linkModifier(item.id, mod.id) : await unlinkModifier(item.id, mod.id)
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
                        aria-label={`Max quantity for ${mod.name}`}
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
      </FieldSet>

      {/* Stations -------------------------------------------------------- */}
      <FieldSet>
        <FieldLegend variant="label">Kitchen routing</FieldLegend>
        <div className="flex flex-wrap items-center gap-2">
          {item.item_station_routes.length === 0 ? (
            <span className="text-sm text-muted-foreground">Not routed — this item won&apos;t print a kitchen ticket.</span>
          ) : (
            item.item_station_routes.map((r) => (
              <span key={r.station_id} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-3 text-sm">
                {r.kitchen_stations?.name ?? "?"}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 text-destructive"
                  disabled={stPending}
                  aria-label={`Remove routing to ${r.kitchen_stations?.name ?? "station"}`}
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
            <Label htmlFor="edit-add-station" className="sr-only">
              Add kitchen station route
            </Label>
            <Select value={stationSel} onValueChange={(v) => setStationSel(v ?? "")}>
              <SelectTrigger id="edit-add-station" className="w-48">
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
      </FieldSet>

      {/* Availability ---------------------------------------------------- */}
      <FieldSet>
        <FieldLegend variant="label">Available hours</FieldLegend>
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
                  aria-label={`Remove ${dayLabel(a.day_of_week)} ${a.start_time}–${a.end_time} window`}
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
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-36">
            <FieldLabel htmlFor="edit-avail-day">Day</FieldLabel>
            <Select value={avDay} onValueChange={(v) => setAvDay(v ?? "null")}>
              <SelectTrigger id="edit-avail-day" className="w-36">
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
          </Field>
          <Field className="w-32">
            <FieldLabel htmlFor="edit-avail-start">Start</FieldLabel>
            <Input id="edit-avail-start" type="time" value={avStart} onChange={(e) => setAvStart(e.target.value)} />
          </Field>
          <Field className="w-32">
            <FieldLabel htmlFor="edit-avail-end">End</FieldLabel>
            <Input id="edit-avail-end" type="time" value={avEnd} onChange={(e) => setAvEnd(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={avPending}
            onClick={() =>
              startAvail(async () => {
                setAvErr(null)
                const res = await addAvailability(item.id, avDay === "null" ? null : Number(avDay), avStart, avEnd)
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
      </FieldSet>
    </>
  )
}
