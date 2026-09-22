"use client"

import { LinkQr } from "@/components/link-qr"

/**
 * Scannable QR for a table's dine-in link (`/t/{token}`).
 *
 * A thin wrapper over `LinkQr`, which holds the encoding, printing and
 * downloading — the review page prints its own card the same way.
 */
export function TableQr({ token, label }: { token: string; label: string }) {
  return (
    <LinkQr
      path={`/t/${token}`}
      heading={`Table ${label}`}
      sub="Scan to order"
      fileName={`table-${label}-qr`}
      alt={`QR for table ${label}`}
    />
  )
}
