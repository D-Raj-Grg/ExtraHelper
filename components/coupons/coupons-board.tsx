"use client"

import { useState, useTransition } from "react"
import {
  BanIcon,
  CheckIcon,
  ClockIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  QrCodeIcon,
  TicketPercentIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { deleteCoupon, setCouponActive } from "@/app/(app)/coupons/actions"
import {
  COUPON_STATUS_LABEL,
  couponStatus,
  couponSummary,
  type CouponRow,
  type CouponStatus,
} from "@/lib/coupon-constants"
import { formatDateTime, money } from "@/lib/format"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CouponForm } from "./coupon-form"
import { CouponQr } from "./coupon-qr"

/** Icon + colour + word — never colour alone. */
const STATUS_STYLE: Record<CouponStatus, { icon: React.ReactNode; className: string }> = {
  active: { icon: <CheckIcon />, className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  paused: { icon: <PauseIcon />, className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  scheduled: { icon: <ClockIcon />, className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  expired: { icon: <BanIcon />, className: "bg-muted text-muted-foreground" },
  used_up: { icon: <BanIcon />, className: "bg-muted text-muted-foreground" },
}

function StatusBadge({ status }: { status: CouponStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <Badge variant="secondary" className={cn(s.className)}>
      {s.icon}
      {COUPON_STATUS_LABEL[status]}
    </Badge>
  )
}

function dateOnly(iso: string, timezone: string): string {
  // formatDateTime pins locale + zone for hydration; strip the time part.
  return formatDateTime(iso, timezone).replace(/,\s*\d{1,2}:\d{2}\s*(AM|PM)$/i, "")
}

function validity(c: CouponRow, timezone: string): string {
  const from = c.valid_from ? dateOnly(c.valid_from, timezone) : null
  // Stored as the exclusive start of the next day; show the day it covers.
  const to = c.valid_to ? dateOnly(new Date(new Date(c.valid_to).getTime() - 1).toISOString(), timezone) : null
  if (from && to) return `${from} – ${to}`
  if (from) return `From ${from}`
  if (to) return `Through ${to}`
  return "Always"
}

/**
 * Every campaign, what it does, and how it has done. Editors are held open
 * by id and read the row from the live list, so a revalidation never leaves
 * a sheet showing stale figures.
 */
export function CouponsBoard({
  coupons,
  loadError,
  slug,
  currency,
  timezone,
  canManage,
}: {
  coupons: CouponRow[]
  loadError: string | null
  slug: string
  currency: string
  timezone: string
  canManage: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [qrId, setQrId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const editing = coupons.find((c) => c.id === editingId) ?? null
  const showingQr = coupons.find((c) => c.id === qrId) ?? null
  const deleting = coupons.find((c) => c.id === deletingId) ?? null

  // Rendered once per request on the server and again on the client; the
  // status only flips on a day boundary, so a stale second is harmless.
  // eslint-disable-next-line react-hooks/purity -- see above
  const now = Date.now()

  const run = (work: () => Promise<{ error: string } | { ok: true; id: string } | undefined>, done: string) =>
    start(async () => {
      const result = await work()
      if (result && "error" in result) toast.error(result.error)
      else toast.success(done)
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {coupons.length === 0
            ? "No coupons yet."
            : `${coupons.length} ${coupons.length === 1 ? "coupon" : "coupons"}`}
        </p>
        {canManage ? (
          <Button className="h-11" onClick={() => setCreating(true)}>
            <PlusIcon className="size-4" />
            New coupon
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load coupons: {loadError}. Reload the page; if it keeps failing, the
          database migration may not be applied yet.
        </p>
      ) : coupons.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <TicketPercentIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-base font-semibold">No coupons yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Create your first coupon, print its QR, and put it on the flyer. A guest who scans it
            lands on your menu with the code already noticed; a cashier types it at checkout.
          </p>
          {canManage ? (
            <Button className="h-11" onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" />
              Create a coupon
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50 text-left">
              <TableRow>
                <TableHead className="px-3 py-2 font-medium">Code</TableHead>
                <TableHead className="px-3 py-2 font-medium">Discount</TableHead>
                <TableHead className="px-3 py-2 font-medium">Valid</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Uses</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Given</TableHead>
                <TableHead className="px-3 py-2 font-medium">Status</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c) => {
                const status = couponStatus(c, now)
                return (
                  <TableRow key={c.id}>
                    <TableCell className="px-3 py-2">
                      <p className="font-mono font-semibold tracking-wide">{c.code}</p>
                      {c.name ? <p className="text-xs text-muted-foreground">{c.name}</p> : null}
                    </TableCell>
                    <TableCell className="px-3 py-2">{couponSummary(c, currency)}</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap">{validity(c, timezone)}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">
                      {c.used_count}
                      {c.usage_limit !== null ? (
                        <span className="text-muted-foreground"> / {c.usage_limit}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">
                      {c.redemptions > 0 ? money(c.discount_given_cents, currency) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setQrId(c.id)}
                        aria-label={`QR code for ${c.code}`}
                      >
                        <QrCodeIcon />
                      </Button>
                      {canManage ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => setCouponActive(c, !c.is_active),
                                c.is_active ? `Paused ${c.code}` : `Resumed ${c.code}`,
                              )
                            }
                            aria-label={c.is_active ? `Pause ${c.code}` : `Resume ${c.code}`}
                          >
                            {c.is_active ? <PauseIcon /> : <PlayIcon />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditingId(c.id)}
                            aria-label={`Edit ${c.code}`}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeletingId(c.id)}
                            aria-label={`Delete ${c.code}`}
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {creating ? (
        <CouponForm
          key="new"
          open
          onOpenChange={(o) => !o && setCreating(false)}
          coupon={null}
          currency={currency}
          timezone={timezone}
        />
      ) : null}
      {editing ? (
        <CouponForm
          key={editing.id}
          open
          onOpenChange={(o) => !o && setEditingId(null)}
          coupon={editing}
          currency={currency}
          timezone={timezone}
        />
      ) : null}

      <Dialog open={showingQr !== null} onOpenChange={(o) => !o && setQrId(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Flyer QR</DialogTitle>
            <DialogDescription>
              Print this on the flyer or post it with the photo. Scanning it opens your menu with
              the code already applied; the code itself works typed, too.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {showingQr ? (
              <CouponQr slug={slug} code={showingQr.code} summary={couponSummary(showingQr, currency)} />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.redemptions > 0
                ? `${deleting.code} has been used on ${deleting.redemptions} ${
                    deleting.redemptions === 1 ? "bill" : "bills"
                  }, so it can't be deleted — those bills still point at it. Pause it instead: printed QR codes stop working, and the record stays.`
                : `Printed QR codes for ${deleting?.code ?? "this coupon"} stop working. Nobody has used it, so nothing else is lost.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleting && deleting.redemptions > 0 ? (
              <AlertDialogAction
                disabled={pending || !deleting.is_active}
                onClick={() => {
                  const row = deleting
                  setDeletingId(null)
                  run(() => setCouponActive(row, false), `Paused ${row.code}`)
                }}
              >
                Pause instead
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                disabled={pending}
                onClick={() => {
                  const row = deleting
                  if (!row) return
                  setDeletingId(null)
                  run(() => deleteCoupon(row.id), `Deleted ${row.code}`)
                }}
              >
                Delete coupon
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
