"use client"

import { useEffect, useRef } from "react"
import { markKotPrinted } from "@/app/(app)/kds/actions"

/** Fires the browser print dialog once on mount and stamps printed_at. */
export function PrintOnLoad({ kotId }: { kotId: string }) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void markKotPrinted(kotId)
    // Let layout settle before printing.
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [kotId])

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print mt-4 w-full rounded-md border py-2 text-sm font-medium hover:bg-muted"
    >
      Print again
    </button>
  )
}
