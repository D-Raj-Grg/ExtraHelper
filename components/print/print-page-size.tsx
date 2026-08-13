"use client"

import { useEffect } from "react"

/**
 * Sets the printed page to the exact size of the slip.
 *
 * `@page { size: 80mm auto }` looks right and is invalid: `size` takes one
 * length, two lengths, or the bare keyword `auto` — never a length plus `auto`.
 * The whole declaration is dropped, so the sheet stays Letter/A4 and the receipt
 * prints in the middle of it with a gutter each side and a blank tail. That is
 * the bug this component exists to fix; do not "simplify" it back to `auto`.
 *
 * A roll has no fixed height, so the height has to be a real length measured off
 * the rendered slip. That only works if the slip lays out identically on screen
 * and in print — keep print-only padding/sizing off the measured element, or the
 * page comes out taller (blank feed) or shorter (a spilled second page) than the
 * content.
 */
export function PrintPageSize({
  targetId,
  widthMm,
}: {
  targetId: string
  widthMm: number
}) {
  useEffect(() => {
    const style = document.createElement("style")
    document.head.appendChild(style)

    const apply = () => {
      const el = document.getElementById(targetId)
      if (!el) return
      // +2mm of slack: rounding the other way spills one blank page — on a roll
      // that is a whole extra slip of paper fed and torn off.
      const heightMm = Math.ceil(el.getBoundingClientRect().height * (25.4 / 96)) + 2
      style.textContent = `
        @media print {
          @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
          html, body { margin: 0 !important; }
        }
      `
    }

    apply()
    // The slip can change after mount (revalidation, "Print again"), and the
    // dialog is the last moment the height is knowable.
    window.addEventListener("beforeprint", apply)
    return () => {
      window.removeEventListener("beforeprint", apply)
      style.remove()
    }
  }, [targetId, widthMm])

  return null
}
