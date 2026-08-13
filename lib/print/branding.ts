/**
 * The shape of `tenant_settings.receipt_template`.
 *
 * The column is untyped JSONB, so this is the only description of it that
 * exists — every reader hand-casts to it rather than inventing its own idea of
 * what the keys are. Two parallel representations live in here on purpose:
 * `*_url` is what the screen shows, `print_assets` is what paper gets, because
 * a thermal head cannot fetch a URL and a browser should not be shown a packed
 * 1-bit bitmap.
 *
 * Plain module — no server imports.
 */

import type { DocImage } from "./docs"

export type ReceiptTemplate = {
  header?: string
  footer?: string
  terms?: string
  logo_url?: string
  qr_url?: string
  qr_caption?: string
  /** Baked at upload; see components/print/bake-image.ts. */
  print_assets?: {
    logo?: DocImage
    qr?: DocImage
  }
}

export type PrintBranding = {
  logo?: DocImage
  qr?: DocImage
  qrCaption?: string
}

export function brandingFrom(template: ReceiptTemplate): PrintBranding {
  return {
    logo: template.print_assets?.logo,
    qr: template.print_assets?.qr,
    qrCaption: template.qr_caption,
  }
}
