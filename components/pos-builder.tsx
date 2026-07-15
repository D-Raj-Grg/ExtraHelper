"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  MinusIcon,
  PauseIcon,
  PlusIcon,
  ReceiptIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import {
  addItem,
  fireOrder,
  removeItem,
  setLineHold,
  setLineQty,
  voidLine,
  type PosState,
} from "@/app/(app)/pos/actions"
import { generateBill } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { orderStatusLabel, ORDER_STATUS_STYLE } from "@/lib/order-constants"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHeader } from "@/components/page-header"
import { MenuTile } from "@/components/pos/menu-tile"

type Order = {
  id: string
  status: string
  order_type: string
  restaurant_tables: { label: string } | null
}
type LineMod = { modifier_id: string; name_snapshot: string; price_cents: number }
type Line = {
  id: string
  name_snapshot: string
  qty: number
  unit_price_cents: number
  status: string
  is_void: boolean
  is_held: boolean
  notes: string | null
  course: number | null
  seat: number | null
  order_item_modifiers: LineMod[]
}
type MenuItem = {
  id: string
  name: string
  base_price_cents: number
  is_86: boolean
  image_url: string | null
  item_variants: { id: string; name: string; price_delta_cents: number }[]
  item_modifiers: {
    modifier_id: string
    modifiers: { id: string; name: string; price_cents: number } | null
  }[]
}

export function PosBuilder({
  currency,
  order,
  items,
  menu,
}: {
  currency: string
  order: Order
  items: Line[]
  menu: MenuItem[]
}) {
  const [pending, startTransition] = useTransition()
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const visibleMenu = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? menu.filter((m) => m.name.toLowerCase().includes(q)) : menu
  }, [menu, query])

  const editable = order.status === "draft" || order.status === "placed"
  const live = items.filter((i) => !i.is_void)
  const total = live.reduce((sum, i) => sum + i.unit_price_cents * i.qty, 0)
  const heldCount = live.filter((i) => i.is_held).length
  const allHeld = live.length > 0 && heldCount === live.length

  /** Run a server action inside a transition, toasting any {error}. */
  function run(fn: () => Promise<PosState>) {
    startTransition(async () => {
      const res = await fn()
      if (res && "error" in res) toast.error(res.error)
    })
  }

  function quickAdd(m: MenuItem) {
    run(() => addItem(order.id, m.id))
  }

  const qtyInOrder = (itemId: string, name: string) =>
    live.filter((l) => l.name_snapshot === name).reduce((s, l) => s + l.qty, 0)

  const destination = order.restaurant_tables?.label
    ? `Table ${order.restaurant_tables.label}`
    : "Takeaway"

  return (
    <div>
      <PageHeader
        title={destination}
        description={`Add items, then fire to the kitchen. ${orderStatusLabel(order.status)}.`}
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/pos" />}>
            <ArrowLeftIcon className="size-4" /> All orders
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        {/* Menu grid */}
        <section className="min-w-0">
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Label htmlFor="builder-search" className="sr-only">
              Search the menu
            </Label>
            <Input
              id="builder-search"
              className="h-11 pl-9"
              placeholder="Search the menu…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {visibleMenu.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visibleMenu.map((m) => {
                const hasOptions = m.item_variants.length > 0 || m.item_modifiers.length > 0
                return (
                  <div key={m.id} className="flex min-w-0 flex-col">
                    <MenuTile
                      item={m}
                      qty={qtyInOrder(m.id, m.name)}
                      currency={currency}
                      hasOptions={hasOptions}
                      expanded={openItemId === m.id}
                      disabled={!editable || pending}
                      onAdd={() =>
                        hasOptions
                          ? setOpenItemId((id) => (id === m.id ? null : m.id))
                          : quickAdd(m)
                      }
                    />
                    {openItemId === m.id && editable ? (
                      <ItemOptions
                        item={m}
                        currency={currency}
                        pending={pending}
                        onCancel={() => setOpenItemId(null)}
                        onAdd={(opts) => {
                          setOpenItemId(null)
                          run(() => addItem(order.id, m.id, opts))
                        }}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Running order */}
        <section className="flex flex-col rounded-xl border bg-card p-4 lg:sticky lg:top-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Order</h2>
            <Badge
              className={cn("border-transparent", ORDER_STATUS_STYLE[order.status] ?? "bg-muted")}
            >
              {orderStatusLabel(order.status)}
            </Badge>
          </div>
          {live.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Tap a dish to start this order.
            </p>
          ) : (
            <ul className="mb-3 space-y-3">
              {live.map((l) => (
                <OrderLine
                  key={l.id}
                  line={l}
                  currency={currency}
                  editable={editable}
                  pending={pending}
                  onQty={(qty) => run(() => setLineQty(order.id, l.id, qty))}
                  onHold={() => run(() => setLineHold(order.id, l.id, !l.is_held))}
                  onVoid={(reason) => run(() => voidLine(order.id, l.id, reason))}
                  onRemove={() => run(() => removeItem(order.id, l.id))}
                />
              ))}
            </ul>
          )}
          <div className="mt-auto border-t pt-3">
            {heldCount > 0 ? (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <PauseIcon className="size-3.5 shrink-0" />
                {heldCount} item{heldCount === 1 ? "" : "s"} held — won&apos;t fire
              </p>
            ) : null}
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="text-xl font-bold tabular-nums">{money(total, currency)}</span>
            </div>
            {editable ? (
              <>
                <Button
                  className="h-12 w-full text-base"
                  disabled={pending || live.length === 0 || allHeld}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await fireOrder(order.id)
                      if ("error" in res) {
                        toast.error(res.error)
                      } else {
                        // Open a print view per station ticket (blocked popups can
                        // still be printed from the KDS board).
                        res.kotIds.forEach((id) =>
                          window.open(`/kot/${id}`, "_blank", "noopener"),
                        )
                        if (res.kotIds.length)
                          toast.success(`Fired · printing ${res.kotIds.length} ticket(s)`)
                      }
                    })
                  }
                >
                  {pending ? "Firing…" : "Fire to kitchen"}
                </Button>
                {allHeld ? (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    All items are held — release one to fire.
                  </p>
                ) : null}
              </>
            ) : order.status === "billed" || order.status === "closed" ? (
              <p className="text-center text-sm text-muted-foreground">
                {order.status === "closed" ? "Closed · paid" : "Billed"}
              </p>
            ) : (
              <Button
                className="h-12 w-full text-base"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    // Was fire-and-forget: a failed bill left the cashier
                    // tapping a button that looked like it did nothing.
                    const res = await generateBill(order.id)
                    if (res && "error" in res) toast.error(res.error)
                  })
                }
              >
                <ReceiptIcon className="size-4" />
                {pending ? "Opening bill…" : "Generate bill"}
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** Inline option picker: variant radios, modifier checkboxes, qty/notes/course/seat. */
function ItemOptions({
  item,
  currency,
  pending,
  onAdd,
  onCancel,
}: {
  item: MenuItem
  currency: string
  pending: boolean
  onAdd: (opts: {
    variantId: string | null
    modifierIds: string[]
    notes: string | null
    course: number | null
    seat: number | null
    qty: number
  }) => void
  onCancel: () => void
}) {
  const [variantId, setVariantId] = useState<string | null>(null)
  const [modifierIds, setModifierIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState("")
  const [course, setCourse] = useState("")
  const [seat, setSeat] = useState("")

  const mods = item.item_modifiers
    .map((im) => im.modifiers)
    .filter((m): m is NonNullable<typeof m> => m != null)

  function toggleMod(id: string) {
    setModifierIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    )
  }

  return (
    <div className="mt-1 space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
      {item.item_variants.length > 0 ? (
        <div>
          <p className="mb-1 font-medium">Variant</p>
          <div className="space-y-1">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`variant-${item.id}`}
                checked={variantId === null}
                onChange={() => setVariantId(null)}
              />
              <span>Regular</span>
            </label>
            {item.item_variants.map((v) => (
              <label key={v.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name={`variant-${item.id}`}
                  checked={variantId === v.id}
                  onChange={() => setVariantId(v.id)}
                />
                <span>
                  {v.name}
                  {v.price_delta_cents !== 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      {v.price_delta_cents > 0 ? "+" : "−"}
                      {money(Math.abs(v.price_delta_cents), currency)}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {mods.length > 0 ? (
        <div>
          <p className="mb-1 font-medium">Modifiers</p>
          <div className="space-y-1">
            {mods.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={modifierIds.includes(m.id)}
                  onCheckedChange={() => toggleMod(m.id)}
                />
                <span>
                  {m.name}
                  {m.price_cents !== 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      +{money(m.price_cents, currency)}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="font-medium">Qty</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={qty <= 1}
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          aria-label="Decrease quantity"
        >
          −
        </Button>
        <span className="w-6 text-center tabular-nums">{qty}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => setQty((q) => q + 1)}
          aria-label="Increase quantity"
        >
          +
        </Button>
      </div>

      <Input
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          placeholder="Course"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
        />
        <Input
          type="number"
          min={1}
          placeholder="Seat"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            onAdd({
              variantId,
              modifierIds,
              notes: notes.trim() || null,
              course: course.trim() ? Number(course) : null,
              seat: seat.trim() ? Number(seat) : null,
              qty,
            })
          }
        >
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** A single running-order line with qty steppers, hold, void, remove. */
function OrderLine({
  line,
  currency,
  editable,
  pending,
  onQty,
  onHold,
  onVoid,
  onRemove,
}: {
  line: Line
  currency: string
  editable: boolean
  pending: boolean
  onQty: (qty: number) => void
  onHold: () => void
  onVoid: (reason: string) => void
  onRemove: () => void
}) {
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState("")
  const isDraft = line.status === "draft"

  return (
    <li className={line.is_held ? "opacity-50" : undefined}>
      <div className="flex items-start justify-between gap-2 text-sm">
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">
              {line.qty}× {line.name_snapshot}
            </span>
            {line.is_held ? (
              <Badge className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
                Held
              </Badge>
            ) : null}
            {line.course != null ? (
              <Badge variant="outline" title={`Course ${line.course}`}>
                C{line.course}
              </Badge>
            ) : null}
            {line.seat != null ? (
              <Badge variant="outline" title={`Seat ${line.seat}`}>
                S{line.seat}
              </Badge>
            ) : null}
          </div>
          {line.order_item_modifiers.map((mod) => (
            <div key={mod.modifier_id} className="pl-3 text-xs text-muted-foreground">
              + {mod.name_snapshot}
              {mod.price_cents !== 0 ? ` (${money(mod.price_cents, currency)})` : ""}
            </div>
          ))}
          {line.notes ? (
            <div className="pl-3 text-xs italic text-muted-foreground">{line.notes}</div>
          ) : null}
        </div>
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {money(line.unit_price_cents * line.qty, currency)}
        </span>
      </div>

      {editable ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            disabled={pending || line.qty <= 1}
            onClick={() => onQty(line.qty - 1)}
            aria-label={`One less ${line.name_snapshot}`}
          >
            <MinusIcon className="size-4" />
          </Button>
          <span className="w-6 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            disabled={pending}
            onClick={() => onQty(line.qty + 1)}
            aria-label={`One more ${line.name_snapshot}`}
          >
            <PlusIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={onHold}
            className="ml-auto"
          >
            {line.is_held ? "Release" : "Hold"}
            <span className="sr-only"> {line.name_snapshot}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setVoiding((v) => !v)}
            aria-expanded={voiding}
            className="text-destructive"
          >
            Void
            <span className="sr-only"> {line.name_snapshot}</span>
          </Button>
          {isDraft ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${line.name_snapshot}`}
              disabled={pending}
              onClick={onRemove}
              className="text-destructive"
            >
              <Trash2Icon className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {voiding ? (
        <div className="mt-1 flex items-center gap-1">
          <Input
            placeholder="Void reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending || !reason.trim()}
            onClick={() => {
              onVoid(reason)
              setVoiding(false)
              setReason("")
            }}
          >
            Confirm
          </Button>
        </div>
      ) : null}
    </li>
  )
}
