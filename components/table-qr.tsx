"use client"

import { QrCard, useOrigin } from "@/components/qr-card"

/** Scannable QR for a table's dine-in link (`/t/{token}`). Print + download. */
export function TableQr({ token, label }: { token: string; label: string }) {
  const origin = useOrigin()
  const url = origin ? `${origin}/t/${token}` : ""
  return (
    <QrCard
      url={url}
      title={`Table ${label}`}
      subtitle="Scan to order"
      filename={`table-${label}-qr`}
      alt={`QR for table ${label}`}
    />
  )
}
