"use client"

import { useActionState, useState } from "react"
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon } from "lucide-react"
import {
  createSupplier,
  deleteSupplier,
  getSupplierDetail,
  renameSupplier,
  setSupplierArchived,
  type PurchState,
} from "@/app/(app)/purchasing/actions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { money } from "@/lib/format"
import { ConfirmButton } from "./confirm-button"
import { SupplierSheet, type DetailOrder, type DetailPayment } from "./supplier-sheet"
import { OutstandingCell, type Supplier, type SupplierBalance } from "./types"

export function SuppliersTab({
  currency,
  timezone,
  suppliers,
  balances,
  canDelete,
  run,
}: {
  currency: string
  timezone: string
  suppliers: Supplier[]
  balances: SupplierBalance[]
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [detail, setDetail] = useState<{ orders: DetailOrder[]; payments: DetailPayment[] }>({
    orders: [],
    payments: [],
  })
  const [loadingDetail, setLoadingDetail] = useState(false)
  const open = suppliers.find((s) => s.id === openId) ?? null

  // Fetched on the open event, not in an effect.
  const openSupplier = async (id: string) => {
    setOpenId(id)
    setDetail({ orders: [], payments: [] })
    setLoadingDetail(true)
    try {
      const d = await getSupplierDetail(id)
      setDetail(d as unknown as { orders: DetailOrder[]; payments: DetailPayment[] })
    } finally {
      setLoadingDetail(false)
    }
  }

  const byId = new Map(balances.map((b) => [b.supplier_id, b]))
  const active = suppliers.filter((s) => !s.archived_at)
  const archived = suppliers.filter((s) => s.archived_at)

  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 && archived.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <p className="font-medium">No suppliers yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A supplier is whoever you buy from — the vegetable man, the gas dealer, the
            cash-and-carry. Add one and you can raise orders and track what you owe them.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table className="text-sm">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="px-3 py-2">Supplier</TableHead>
                <TableHead className="px-3 py-2">Contact</TableHead>
                <TableHead className="px-3 py-2">Phone</TableHead>
                <TableHead className="px-3 py-2 text-right">Received</TableHead>
                <TableHead className="px-3 py-2 text-right">Paid</TableHead>
                <TableHead className="px-3 py-2 text-right">Outstanding</TableHead>
                <TableHead className="px-3 py-2 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((s) => (
                <SupplierRow
                  key={s.id}
                  supplier={s}
                  balance={byId.get(s.id)}
                  currency={currency}
                  canDelete={canDelete}
                  run={run}
                  onOpen={() => void openSupplier(s.id)}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AddSupplier />

      {archived.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Archived ({archived.length})
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide" : "Show"}
            </Button>
          </div>
          {showArchived ? (
            <Card className="overflow-x-auto p-0">
              <p className="border-b px-3 py-2 text-sm text-muted-foreground">
                Archived suppliers don&apos;t appear when you raise an order or record a payment.
                Their history is unchanged, and anything you still owe them is still counted.
              </p>
              <Table className="text-sm">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="px-3 py-2">Supplier</TableHead>
                    <TableHead className="px-3 py-2 text-right">Outstanding</TableHead>
                    <TableHead className="px-3 py-2 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((s) => {
                    const b = byId.get(s.id)
                    const out = Number(b?.outstanding_cents ?? 0)
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="px-3 py-2">{s.name}</TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums">
                          <OutstandingCell cents={out} money={money(Math.abs(out), currency)} />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                run(
                                  () => setSupplierArchived(s.id, false),
                                  `${s.name} restored.`,
                                )
                              }
                            >
                              <ArchiveRestoreIcon className="size-4" /> Restore
                            </Button>
                            {canDelete ? (
                              <DeleteSupplierButton
                                supplier={s}
                                balance={b}
                                currency={currency}
                                run={run}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          ) : null}
        </section>
      ) : null}

      <SupplierSheet
        supplier={open}
        balance={open ? byId.get(open.id) : undefined}
        orders={detail.orders}
        payments={detail.payments}
        loading={loadingDetail}
        currency={currency}
        timezone={timezone}
        onOpenChange={(o) => !o && setOpenId(null)}
      />
    </div>
  )
}

function SupplierRow({
  supplier,
  balance,
  currency,
  canDelete,
  run,
  onOpen,
}: {
  supplier: Supplier
  balance: SupplierBalance | undefined
  currency: string
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onOpen: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(supplier.name)
  const out = Number(balance?.outstanding_cents ?? 0)

  return (
    <TableRow>
      <TableCell className="px-3 py-2 font-medium">
        {editing ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Rename ${supplier.name}`}
            className="h-9 max-w-56"
          />
        ) : (
          supplier.name
        )}
      </TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">
        {supplier.contact || <span aria-hidden>—</span>}
      </TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">
        {supplier.phone || <span aria-hidden>—</span>}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {money(Number(balance?.received_cents ?? 0), currency)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {money(Number(balance?.paid_cents ?? 0), currency)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">
        <OutstandingCell cents={out} money={money(Math.abs(out), currency)} />
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                onClick={() => {
                  run(() => renameSupplier(supplier.id, name), "Supplier renamed.")
                  setEditing(false)
                }}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setName(supplier.name)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Rename
              </Button>
              <Button size="sm" variant="outline" onClick={onOpen}>
                Details
              </Button>
              <ConfirmButton
                label={
                  <>
                    <ArchiveIcon className="size-4" /> Archive
                  </>
                }
                variant="ghost"
                title={`Archive ${supplier.name}?`}
                description={
                  out > 0
                    ? `They disappear from the pickers, but you still owe them ${money(out, currency)} and that stays on your summary. Every order and payment is unchanged.`
                    : "They disappear from the pickers when you raise an order or record a payment. Every order and payment is unchanged, and you can restore them any time."
                }
                confirmLabel="Archive"
                onConfirm={() =>
                  run(() => setSupplierArchived(supplier.id, true), `${supplier.name} archived.`)
                }
              />
              {canDelete ? (
                <DeleteSupplierButton
                  supplier={supplier}
                  balance={balance}
                  currency={currency}
                  run={run}
                />
              ) : null}
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Delete behaves differently depending on what the supplier is holding, and
 * says which. A disabled button with a tooltip is unreachable on a phone, so a
 * blocked delete opens a dialog that explains and offers archive instead.
 */
function DeleteSupplierButton({
  supplier,
  balance,
  currency,
  run,
}: {
  supplier: Supplier
  balance: SupplierBalance | undefined
  currency: string
  run: (fn: () => Promise<PurchState>, ok?: string) => void
}) {
  const used =
    Number(balance?.received_cents ?? 0) !== 0 || Number(balance?.paid_cents ?? 0) !== 0
  const notArchived = !supplier.archived_at

  if (used)
    return (
      <ConfirmButton
        label="Delete"
        variant="ghost"
        destructive
        blocked
        title={`You can't delete ${supplier.name}`}
        description={`There's history against them — ${money(Number(balance?.received_cents ?? 0), currency)} received and ${money(Number(balance?.paid_cents ?? 0), currency)} paid. Deleting would leave those orders reading "No supplier" and some of that money came out of a drawer that's already been counted. Archive them instead: they vanish from the pickers and every record stays exactly as it is.`}
        confirmLabel="Delete"
        onConfirm={() => undefined}
        blockedAction={{
          label: `Archive ${supplier.name}`,
          onClick: () =>
            run(() => setSupplierArchived(supplier.id, true), `${supplier.name} archived.`),
        }}
      />
    )

  if (notArchived)
    return (
      <ConfirmButton
        label="Delete"
        variant="ghost"
        destructive
        blocked
        title={`Archive ${supplier.name} first`}
        description="Deleting is only for a supplier you never actually used. Archive them, check nothing depends on them, then delete."
        confirmLabel="Delete"
        onConfirm={() => undefined}
        blockedAction={{
          label: "Archive",
          onClick: () =>
            run(() => setSupplierArchived(supplier.id, true), `${supplier.name} archived.`),
        }}
      />
    )

  return (
    <ConfirmButton
      label="Delete"
      variant="ghost"
      destructive
      title={`Delete ${supplier.name}?`}
      description="They have no orders and no payments, so nothing is lost. Any ingredient pointing at them loses its supplier link and will need one set again before low stock can draft them an order. This can't be undone."
      confirmLabel="Delete supplier"
      onConfirm={() => run(() => deleteSupplier(supplier.id), `${supplier.name} deleted.`)}
    />
  )
}

function AddSupplier() {
  const [state, action, pending] = useActionState<PurchState, FormData>(createSupplier, undefined)

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-medium">Add a supplier</p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <Input name="name" placeholder="Name" aria-label="Supplier name" className="max-w-48" required />
        <Input name="contact" placeholder="Contact person" aria-label="Contact person" className="max-w-44" />
        <Input name="phone" placeholder="Phone" aria-label="Phone" className="max-w-36" />
        <Input name="email" type="email" placeholder="Email" aria-label="Email" className="max-w-52" />
        <Button type="submit" variant="secondary" disabled={pending}>
          <PlusIcon className="size-4" /> {pending ? "Adding…" : "Add"}
        </Button>
        {state && "error" in state ? (
          <p className="w-full text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    </Card>
  )
}
