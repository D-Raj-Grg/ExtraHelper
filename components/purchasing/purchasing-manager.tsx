"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { PlusIcon, SparklesIcon } from "lucide-react"
import {
  createDraftPOFromLowStock,
  createPO,
  type PurchState,
} from "@/app/(app)/purchasing/actions"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { SummaryStrip } from "./purchasing-summary"
import { OrdersTab } from "./orders-tab"
import { SuppliersTab } from "./suppliers-tab"
import { PaymentsTab } from "./payments-tab"
import { PaymentDialog } from "./payment-dialog"
import type {
  ItemOpt,
  PO,
  PurchasingSummary,
  Supplier,
  SupplierBalance,
  SupplierPayment,
} from "./types"

export function PurchasingManager({
  currency,
  timezone,
  suppliers,
  items,
  purchaseOrders,
  poCount,
  poPage,
  poPageSize,
  showAll,
  balances,
  payments,
  paidByPo,
  summary,
  canDelete,
  initialTab,
}: {
  currency: string
  timezone: string
  suppliers: Supplier[]
  items: ItemOpt[]
  purchaseOrders: PO[]
  poCount: number
  poPage: number
  poPageSize: number
  showAll: boolean
  balances: SupplierBalance[]
  payments: SupplierPayment[]
  paidByPo: Record<string, number>
  summary: PurchasingSummary | null
  canDelete: boolean
  initialTab: string
}) {
  const [tab, setTab] = useState(initialTab)
  const [, startTransition] = useTransition()

  /** Report the outcome of a mutation. Nothing here is fire-and-forget. */
  const report = (res: PurchState, ok?: string) => {
    if (res && "error" in res) toast.error(res.error)
    else if (ok) toast.success(ok)
    return !(res && "error" in res)
  }

  /** Row actions: the page revalidates itself, nothing local to refresh. */
  const run = (fn: () => Promise<PurchState>, ok?: string) =>
    startTransition(async () => {
      report(await fn(), ok)
    })

  /**
   * Sheet actions, which have to refetch their own detail afterwards. Awaited
   * rather than run-and-hope: firing the reload on a timer races the write and
   * leaves stale lines on screen when the round trip is slow.
   */
  const runAsync = async (fn: () => Promise<PurchState>, ok?: string) =>
    report(await fn(), ok)

  const active = suppliers.filter((s) => !s.archived_at)

  return (
    <div>
      <SummaryStrip summary={summary} currency={currency} timezone={timezone} />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>

          {tab === "orders" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  startTransition(async () => {
                    const res = await createDraftPOFromLowStock()
                    if ("error" in res) toast.error(res.error)
                    else
                      toast.success(
                        res.created > 0
                          ? `Drafted ${res.created} ${res.created === 1 ? "order" : "orders"} from low stock.`
                          : "Nothing is below its reorder level.",
                      )
                  })
                }
              >
                <SparklesIcon className="size-4" />
                Draft from low stock
              </Button>
              <NewOrderDialog suppliers={active} />
            </div>
          ) : null}

          {tab === "payments" ? (
            <PaymentDialog
              currency={currency}
              suppliers={active}
              triggerLabel="Record a purchase"
            />
          ) : null}
        </div>

        <TabsContent value="orders">
          <OrdersTab
            currency={currency}
            timezone={timezone}
            purchaseOrders={purchaseOrders}
            poCount={poCount}
            poPage={poPage}
            poPageSize={poPageSize}
            showAll={showAll}
            suppliers={active}
            items={items}
            paidByPo={paidByPo}
            canDelete={canDelete}
            run={run}
            runAsync={runAsync}
            onGoToSuppliers={() => setTab("suppliers")}
          />
        </TabsContent>

        <TabsContent value="suppliers">
          <SuppliersTab
            currency={currency}
            timezone={timezone}
            suppliers={suppliers}
            balances={balances}
            canDelete={canDelete}
            run={run}
          />
        </TabsContent>

        <TabsContent value="payments">
          <PaymentsTab
            currency={currency}
            timezone={timezone}
            payments={payments}
            suppliers={active}
            owedCents={Number(summary?.owed_cents ?? 0)}
            canDelete={canDelete}
            run={run}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Creating an order asks for the supplier up front rather than making an empty
 * draft you then have to find and fill — the old flow left orphan drafts around
 * with no way to delete them.
 */
function NewOrderDialog({ suppliers }: { suppliers: Supplier[] }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button disabled={suppliers.length === 0}>
            <PlusIcon className="size-4" />
            New order
          </Button>
        }
      />
      <DialogContent size="sm">
        <form
          action={(formData) =>
            startTransition(async () => {
              const res = await createPO(undefined, formData)
              if (res && "error" in res) toast.error(res.error)
              else {
                toast.success("Draft order created — add what you're buying.")
                setOpen(false)
              }
            })
          }
        >
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
            <DialogDescription>
              A draft you can edit freely. Sending it freezes the lines; receiving it puts the
              stock on your shelf and adds to what you owe.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="po-supplier">Supplier</FieldLabel>
              <Select name="supplierId" required>
                <SelectTrigger id="po-supplier" className="w-full">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
