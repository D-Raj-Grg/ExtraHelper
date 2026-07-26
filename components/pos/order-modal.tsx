"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AmendFlow } from "@/components/pos/amend-flow"
import { CreateFlow } from "@/components/pos/create-flow"
import { useOrderDetail } from "@/components/pos/use-order-detail"
import type { PosData, PosOrderDetail } from "@/components/pos/types"

/** What the modal has open. Null ⇒ closed. `tableId` preselects the destination. */
export type PosModalState =
  | { mode: "create"; tableId?: string }
  | { mode: "amend"; orderId: string }
  | null

/**
 * The order composer.
 *
 * This is the **only** file that knows create and amend are different things.
 * Everything below takes a CartController and reads its capabilities, so the
 * grid, rail and rows don't branch on a mode flag.
 */
export function OrderModal({
  state,
  onClose,
  data,
  currency,
  tenantId,
  initialDetail,
}: {
  state: PosModalState
  onClose: () => void
  data: PosData
  currency: string
  tenantId: string
  initialDetail?: PosOrderDetail | null
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="full">
        {state?.mode === "create" ? (
          <>
            <DialogHeader>
              <DialogTitle>New order</DialogTitle>
            </DialogHeader>
            <CreateFlow
              data={data}
              currency={currency}
              onClose={onClose}
              initialTableId={state.tableId}
            />
          </>
        ) : state?.mode === "amend" ? (
          <AmendPane
            // Keyed by order id so opening a different order remounts rather
            // than carrying the previous one's check-in state across.
            key={state.orderId}
            orderId={state.orderId}
            tenantId={tenantId}
            data={data}
            currency={currency}
            initialDetail={initialDetail}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AmendPane({
  orderId,
  tenantId,
  data,
  currency,
  initialDetail,
  onClose,
}: {
  orderId: string
  tenantId: string
  data: PosData
  currency: string
  initialDetail?: PosOrderDetail | null
  onClose: () => void
}) {
  const { detail, loading, error, refetch } = useOrderDetail(orderId, tenantId, initialDetail)

  if (loading) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Loading order…</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Loading this order…</p>
        </div>
      </>
    )
  }

  if (error || !detail) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Couldn&apos;t open this order</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {error ?? "This order no longer exists — it may have been closed on another terminal."}
          </p>
        </div>
      </>
    )
  }

  const label = detail.restaurant_tables?.label
    ? `Table ${detail.restaurant_tables.label}`
    : "Takeaway"

  return (
    <>
      <DialogHeader>
        <DialogTitle>{label}</DialogTitle>
      </DialogHeader>
      <AmendFlow
        detail={detail}
        data={data}
        currency={currency}
        refetch={refetch}
        onClose={onClose}
      />
    </>
  )
}
