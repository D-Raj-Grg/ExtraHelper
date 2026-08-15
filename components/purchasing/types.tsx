import {
  CheckCircle2Icon,
  FileTextIcon,
  SendIcon,
  TruckIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type Supplier = {
  id: string
  name: string
  contact: string | null
  email: string | null
  phone: string | null
  archived_at: string | null
}

export type SupplierBalance = {
  supplier_id: string
  supplier_name: string
  received_cents: number
  paid_cents: number
  outstanding_cents: number
  archived_at: string | null
}

export type ItemOpt = { id: string; name: string; uom: string }

export type POLineSummary = {
  id: string
  qty_ordered: number
  qty_received: number
  unit_cost_cents: number
}

export type POLine = POLineSummary & {
  inventory_items: { id: string; name: string; uom: string } | null
}

export type PO = {
  id: string
  status: string
  created_at: string
  supplier_id: string | null
  suppliers: { name: string } | null
  po_items: POLineSummary[]
}

export type SupplierPayment = {
  id: string
  supplier_id: string
  po_id: string | null
  amount_cents: number
  method: string
  paid_at: string
  note: string | null
  voided_at: string | null
  void_reason: string | null
  suppliers: { name: string } | null
}

export type PurchasingSummary = {
  owed_cents: number
  owed_suppliers: number
  open_pos: number
  awaiting_delivery: number
  month_spend_cents: number
  month_start: string
}

/** Ordered value of an order — what you asked for. */
export function orderedCents(po: Pick<PO, "po_items">) {
  return po.po_items.reduce((s, l) => s + Number(l.qty_ordered) * Number(l.unit_cost_cents), 0)
}

/** Received value — what actually arrived, and therefore what you owe. */
export function receivedCents(po: Pick<PO, "po_items">) {
  return po.po_items.reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_cost_cents), 0)
}

export function isOpen(status: string) {
  return status === "draft" || status === "sent" || status === "partial"
}

/** Status carries an icon and a label — never colour alone. */
export const PO_STATUS: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground", icon: FileTextIcon },
  sent: {
    label: "Sent",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    icon: SendIcon,
  },
  partial: {
    label: "Part received",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: TruckIcon,
  },
  received: {
    label: "Received",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: CheckCircle2Icon,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-destructive/10 text-destructive",
    icon: XCircleIcon,
  },
}

export function StatusBadge({ status }: { status: string }) {
  const s = PO_STATUS[status] ?? PO_STATUS.draft
  const Icon = s.icon
  return (
    <Badge className={cn("gap-1 whitespace-nowrap", s.className)}>
      <Icon className="size-3.5" />
      {s.label}
    </Badge>
  )
}

/**
 * Outstanding rendered so the *word* carries the meaning and colour only
 * reinforces it — the table has to survive a grayscale screenshot.
 */
export function OutstandingCell({ cents, money }: { cents: number; money: string }) {
  if (cents > 0)
    return <span className="text-amber-700 dark:text-amber-400">{money} owing</span>
  if (cents < 0) return <span className="text-muted-foreground">{money} paid ahead</span>
  return <span className="text-muted-foreground">Settled</span>
}
