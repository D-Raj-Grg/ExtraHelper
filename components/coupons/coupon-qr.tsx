"use client"

import { couponUrl } from "@/lib/coupon-constants"
import { QrCard, useOrigin } from "@/components/qr-card"

/**
 * The flyer square. It encodes the storefront link with the code pre-filled,
 * so a guest who scans it lands on the menu with the deal already noticed.
 * The mobile app reads the same square and pulls the code out of the link.
 */
export function CouponQr({
  slug,
  code,
  summary,
}: {
  /** The tenant's storefront slug; empty when there is no storefront yet. */
  slug: string
  code: string
  /** "10% off · min NPR 1,000" — printed under the square. */
  summary: string
}) {
  const origin = useOrigin()
  const url = slug && origin ? couponUrl(origin, slug, code) : code
  return (
    <QrCard
      url={url}
      title={code}
      subtitle={summary}
      filename={`coupon-${code.toLowerCase()}`}
      alt={`QR for coupon ${code}`}
    >
      <p className="text-2xl font-bold tracking-widest tabular-nums">{code}</p>
      <p className="text-sm text-muted-foreground">{summary}</p>
      {!slug ? (
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          This restaurant has no online storefront yet, so the square carries the bare code. Staff
          can still scan it from the app.
        </p>
      ) : null}
    </QrCard>
  )
}
