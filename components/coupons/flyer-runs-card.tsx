import Link from "next/link"
import { ArrowRightIcon, PauseIcon, PrinterIcon } from "lucide-react"

import { couponEndDay, type CouponBatchRow } from "@/lib/coupon-constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/**
 * The printed flyer runs, summarised on the Coupons page. Their individual
 * codes (hundreds per run) stay out of the campaign list below; this is where
 * a run shows up and how many of its flyers have come back.
 */
export function FlyerRunsCard({
  runs,
  currency,
  timezone,
}: {
  runs: CouponBatchRow[]
  currency: string
  timezone: string
}) {
  if (runs.length === 0) return null
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PrinterIcon className="size-4" aria-hidden /> Flyer print runs
          </CardTitle>
          <CardDescription>One unique code per printed flyer. Each works once.</CardDescription>
        </div>
        <Button variant="outline" className="h-11" nativeButton={false} render={<Link href="/coupons/flyers" />}>
          Open flyers
          <ArrowRightIcon className="size-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50 text-left">
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Deal</TableHead>
                <TableHead>Valid till</TableHead>
                <TableHead className="text-right">Printed</TableHead>
                <TableHead className="text-right">Redeemed</TableHead>
                <TableHead className="text-right">Left</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.type === "percent" ? `${b.value}% off` : `${currency} ${b.value} off`}</TableCell>
                  <TableCell>{b.valid_to ? couponEndDay(b.valid_to, timezone) : "No end"}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.issued}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.redeemed}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.issued - b.redeemed}</TableCell>
                  <TableCell>
                    {b.active === 0 ? (
                      <Badge variant="outline">
                        <PauseIcon /> Paused
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
