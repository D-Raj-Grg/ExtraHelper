"use client"

import { useEffect, useRef } from "react"
import { markKotPrinted } from "@/app/(app)/kds/actions"
import { Button } from "@/components/ui/button"

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
    <Button
      type="button"
      variant="outline"
      onClick={() => window.print()}
      className="no-print mt-4 w-full"
    >
      Print again
    </Button>
  )
}
