/**
 * Picks the payload for a printer.
 *
 * Text mode is finished ESC/POS built here. Image mode ships the document
 * model instead and lets the browser rasterise it (see
 * `components/print/raster.ts`) — the server has no text engine that can shape
 * Devanagari, and the browser already has one.
 *
 * Plain module — nothing here reaches for `lib/supabase/server`.
 */

import type { PrintDocModel } from "./docs"
import { renderEscPos } from "./escpos-render"
import type { PrinterRef, PrintPayload } from "./types"

export function renderForPrinter(
  doc: PrintDocModel,
  printer: PrinterRef | null,
): PrintPayload {
  const paperWidthMm = printer?.paperWidth ?? 80

  if (printer?.renderMode === "image") {
    return { kind: "image", doc, paperWidthMm }
  }

  return {
    kind: "raw",
    base64: renderEscPos(doc, {
      paperWidthMm,
      // With no printer resolved this is a browser fallback anyway; assume the
      // common case rather than emitting cut codes into a preview.
      autoCut: printer?.autoCut ?? true,
      openDrawer: printer?.openDrawer ?? false,
    }).toBase64(),
  }
}
