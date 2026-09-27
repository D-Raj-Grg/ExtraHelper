"use client"

import { useActionState, useState, useTransition } from "react"
import {
  MergeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  StarIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  adjustPoints,
  deleteCustomer,
  mergeCustomers,
  updateCustomer,
  type LoyaltyState,
} from "@/app/(app)/loyalty/actions"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { money } from "@/lib/format"
import { CustomerDrawer, type DrawerCustomer } from "@/components/customer-drawer"

type Customer = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  loyalty_accounts: { points_balance: number; tier: string | null }[]
  outstanding_cents: number
  unpaid_bills: number
}
type Feedback = {
  id: string
  rating: number | null
  comment: string | null
  created_at: string
  customers: { name: string | null } | null
}

/** Enum values never reach staff (CLAUDE.md): tier words come from here. */
const TIER_LABEL: Record<string, string> = {
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
}

function displayName(c: Pick<Customer, "name">): string {
  return c.name ?? "Guest"
}

/** "Max · 9767288510" — enough to tell two people with one name apart. */
function describe(c: Customer): string {
  const bits = [displayName(c), c.phone ?? c.email].filter(Boolean)
  return bits.join(" · ")
}

function CustomerRow({
  c,
  currency,
  canManage,
  onOpen,
  onEdit,
  onMerge,
  onDelete,
}: {
  c: Customer
  currency: string
  canManage: boolean
  onOpen: (c: DrawerCustomer) => void
  onEdit: (id: string) => void
  onMerge: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [pts, setPts] = useState("")
  const acct = c.loyalty_accounts?.[0]
  const balance = acct?.points_balance ?? 0
  const tier = acct?.tier ?? "bronze"
  const name = displayName(c)

  function go(type: "earn" | "burn") {
    const n = Number(pts)
    if (!Number.isInteger(n) || n <= 0) return
    startTransition(async () => {
      const result = await adjustPoints(c.id, n, type)
      if (result && "error" in result) {
        toast.error(result.error)
        return
      }
      setPts("")
    })
  }

  return (
    <TableRow className="border-t">
      <TableCell className="px-3 py-2">
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() =>
            onOpen({
              id: c.id,
              name: c.name,
              phone: c.phone,
              points: balance,
              tier,
              outstanding_cents: c.outstanding_cents,
              unpaid_bills: c.unpaid_bills,
            })
          }
        >
          {name}
          {c.phone || c.email ? (
            <span className="block text-xs text-muted-foreground">{c.phone ?? c.email}</span>
          ) : null}
        </button>
      </TableCell>
      <TableCell className="px-3 py-2 text-right font-medium tabular-nums">{balance} pts</TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">
        {c.outstanding_cents > 0 ? (
          <span className="font-medium text-destructive">
            {money(c.outstanding_cents, currency)}
            <span className="block text-xs font-normal">
              {c.unpaid_bills} unpaid {c.unpaid_bills === 1 ? "bill" : "bills"}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-2">
        <Badge variant="outline">{TIER_LABEL[tier] ?? TIER_LABEL.bronze}</Badge>
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <Input
            type="number"
            min={1}
            value={pts}
            onChange={(e) => setPts(e.target.value)}
            placeholder="pts"
            aria-label={`Points to earn or redeem for ${name}`}
            className="h-8 w-16 text-xs"
            disabled={!canManage}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !canManage}
            onClick={() => go("earn")}
          >
            Earn
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !canManage}
            onClick={() => go("burn")}
          >
            Redeem
          </Button>
        </div>
      </TableCell>
      {canManage ? (
        <TableCell className="px-1 py-1 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`Actions for ${name}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(c.id)}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMerge(c.id)}>
                <MergeIcon />
                Merge into another customer
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(c.id)}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      ) : null}
    </TableRow>
  )
}

function EditCustomerDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [state, action, pending] = useActionState<LoyaltyState, FormData>(
    async (prev, formData) => {
      const result = await updateCustomer(prev, formData)
      if (result && "ok" in result) {
        toast.success("Customer updated")
        onClose()
      }
      return result
    },
    undefined,
  )

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent size="sm">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>
              Name or phone is required. The change is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="id" value={customer.id} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="customer-name">Name</FieldLabel>
                <Input
                  id="customer-name"
                  name="name"
                  defaultValue={customer.name ?? ""}
                  maxLength={80}
                  autoFocus
                  className="h-11"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="customer-phone">Phone</FieldLabel>
                <Input
                  id="customer-phone"
                  name="phone"
                  type="tel"
                  defaultValue={customer.phone ?? ""}
                  maxLength={30}
                  className="h-11"
                />
                <FieldDescription>
                  Typed with or without the country code, it matches the same customer at the
                  POS.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="customer-email">Email</FieldLabel>
                <Input
                  id="customer-email"
                  name="email"
                  type="email"
                  defaultValue={customer.email ?? ""}
                  maxLength={120}
                  className="h-11"
                />
              </Field>
            </FieldGroup>
            {state && "error" in state ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MergeCustomerDialog({
  customer,
  others,
  onClose,
}: {
  /** The row being folded away. */
  customer: Customer
  others: Customer[]
  onClose: () => void
}) {
  const [keepId, setKeepId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const keep = others.find((o) => o.id === keepId)

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Merge {describe(customer)}</DialogTitle>
          <DialogDescription>
            Their orders, reservations, feedback and points move to the customer you pick, and
            this row is removed. Use it when one person was saved twice.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel htmlFor="merge-into">Merge into</FieldLabel>
            <Select value={keepId} onValueChange={(v) => setKeepId(String(v ?? ""))}>
              <SelectTrigger id="merge-into" className="h-11 w-full">
                <SelectValue placeholder="Pick the customer to keep" />
              </SelectTrigger>
              <SelectContent>
                {others.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {describe(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              The kept customer keeps its own name and phone; blanks are filled from this one.
            </FieldDescription>
          </Field>
          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="h-11"
            disabled={pending || !keep}
            onClick={() => {
              if (!keep) return
              start(async () => {
                const result = await mergeCustomers(keep.id, customer.id)
                if (result && "error" in result) {
                  setError(result.error)
                  return
                }
                toast.success(`Merged into ${displayName(keep)}`)
                onClose()
              })
            }}
          >
            {pending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteCustomerDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const balance = customer.loyalty_accounts?.[0]?.points_balance ?? 0

  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {describe(customer)}?</AlertDialogTitle>
          <AlertDialogDescription>
            Past orders and bills keep their totals but lose the name.
            {balance > 0
              ? ` Their ${balance} points and the points history are deleted.`
              : " Their points history is deleted."}{" "}
            This can&apos;t be undone. If this is the same person as another row, merge instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">Keep customer</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await deleteCustomer(customer.id)
                if (result && "error" in result) {
                  setError(result.error)
                  return
                }
                toast.success("Customer deleted")
                onClose()
              })
            }
          >
            {pending ? "Deleting…" : "Delete customer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Stars({ rating }: { rating: number | null }) {
  const n = Math.max(0, Math.min(5, rating ?? 0))
  return (
    <span className="flex items-center gap-0.5" aria-label={`${n} out of 5 stars`} role="img">
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          aria-hidden
          className={cn(
            "size-4",
            i < n ? "fill-amber-500 text-amber-500" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  )
}

export function LoyaltyManager({
  customers,
  feedback,
  timezone,
  currency,
  totalOutstandingCents,
  debtors,
  canManage,
  canCollect,
}: {
  customers: Customer[]
  feedback: Feedback[]
  timezone: string
  currency: string
  totalOutstandingCents: number
  debtors: number
  /** Holds `loyalty.edit`: may edit, merge, delete, and adjust points. */
  canManage: boolean
  /** Holds `payment.take`: the drawer offers Collect on unpaid bills. */
  canCollect: boolean
}) {
  const [open, setOpen] = useState<DrawerCustomer | null>(null)
  // Debtors first — that is what the page is opened for on a slow afternoon.
  const sorted = [...customers].sort((a, b) => b.outstanding_cents - a.outstanding_cents)

  // Editors are held by id, so a revalidated row shows up while the dialog is
  // open instead of a snapshot from when it was clicked.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mergingId, setMergingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const editing = customers.find((c) => c.id === editingId)
  const merging = customers.find((c) => c.id === mergingId)
  const deleting = customers.find((c) => c.id === deletingId)

  return (
    <div className="flex flex-col gap-8">
      <CustomerDrawer
        customer={open}
        currency={currency}
        timezone={timezone}
        canCollect={canCollect}
        onOpenChange={(o) => {
          if (!o) setOpen(null)
        }}
      />
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Customers</h2>
          <p className="text-sm">
            <span className="text-muted-foreground">Outstanding credit: </span>
            <span
              className={
                totalOutstandingCents > 0 ? "font-semibold tabular-nums text-destructive" : "font-semibold tabular-nums"
              }
            >
              {money(totalOutstandingCents, currency)}
            </span>
            {debtors > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                across {debtors} {debtors === 1 ? "customer" : "customers"}
              </span>
            ) : null}
          </p>
        </div>
        {customers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <UsersIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-base font-semibold">No customers yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Attach a name and phone to an order at the POS, or take a reservation, and the
              customer appears here with a points balance.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50 text-left">
                <TableRow>
                  <TableHead className="px-3 py-2 font-medium">Customer</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Balance</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Credit</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Tier</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Points</TableHead>
                  {canManage ? (
                    <TableHead className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <CustomerRow
                    key={c.id}
                    c={c}
                    currency={currency}
                    canManage={canManage}
                    onOpen={setOpen}
                    onEdit={setEditingId}
                    onMerge={setMergingId}
                    onDelete={setDeletingId}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Feedback</h2>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No feedback yet. Ratings guests leave after a visit appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {feedback.map((f) => (
              <li key={f.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <Stars rating={f.rating} />
                  <span className="text-xs text-muted-foreground">
                    {f.customers?.name ?? "Guest"} · {formatDateTime(f.created_at, timezone)}
                  </span>
                </div>
                {f.comment ? <p className="mt-1 text-muted-foreground">{f.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing ? (
        <EditCustomerDialog customer={editing} onClose={() => setEditingId(null)} />
      ) : null}
      {merging ? (
        <MergeCustomerDialog
          customer={merging}
          others={customers.filter((c) => c.id !== merging.id)}
          onClose={() => setMergingId(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteCustomerDialog customer={deleting} onClose={() => setDeletingId(null)} />
      ) : null}
    </div>
  )
}
