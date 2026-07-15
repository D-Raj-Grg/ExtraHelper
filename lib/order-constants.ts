/**
 * Plain-English labels + tones for the order/bill lifecycles. Staff never see
 * the raw enum (`in_kitchen`), and one status means one colour app-wide.
 * Kept in a plain module so both Server and Client Components can import it.
 */

const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  placed: "Placed",
  in_kitchen: "In kitchen",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  billed: "Billed",
  closed: "Closed",
  cancelled: "Cancelled",
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status.replace(/_/g, " ")
}

export const ORDER_STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  placed: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  in_kitchen: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  preparing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  served: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  billed: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

const BILL_STATUS_LABEL: Record<string, string> = {
  open: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  void: "Void",
  refunded: "Refunded",
}

export function billStatusLabel(status: string): string {
  return BILL_STATUS_LABEL[status] ?? status.replace(/_/g, " ")
}

export const BILL_STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  void: "bg-muted text-muted-foreground",
  refunded: "bg-destructive/10 text-destructive",
}
