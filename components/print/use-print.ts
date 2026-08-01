"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { enqueuePrint, type EnqueueInput } from "@/app/(app)/print/actions"
import { usePrintAgent } from "./print-provider"

/**
 * The one way the app asks for paper.
 *
 * Nothing prints from here. Every caller — fire, re-fire, KDS, checkout,
 * settings test — queues the document, and whichever machine has the agent
 * takes it off the queue (see auto-print-worker.tsx, or the headless agent in
 * cloud mode). That is what makes a ticket print exactly once no matter how
 * many POS tabs are open, and what lets an order placed from a QR menu print
 * with no browser involved at all.
 */
export type PrintOutcome = "queued" | "no-printer" | "failed"

export function usePrint() {
  const { connected, status } = usePrintAgent()

  const print = useCallback(async (input: EnqueueInput): Promise<PrintOutcome> => {
    const res = await enqueuePrint(input)

    if ("error" in res) {
      toast.error(res.error)
      return "failed"
    }

    if ("noPrinter" in res) {
      const url = res.fallbackUrl
      toast.warning("No printer is set up for this yet.", {
        description: url
          ? "Open the print view, or add a printer in Settings → Printers."
          : "Add one in Settings → Printers.",
        // An explicit click, so the popup blocker never eats it — which is
        // exactly what happened when this opened itself after an await.
        action: url
          ? { label: "Open print view", onClick: () => window.open(url, "_blank", "noopener") }
          : undefined,
      })
      return "no-printer"
    }

    if (!res.jobIds.length) {
      toast.error("That document could not be queued.")
      return "failed"
    }
    return "queued"
  }, [])

  /** A whole order's tickets. One call per station; the worker reports. */
  const printKots = useCallback(
    async (kotIds: string[], opts?: { reprint?: boolean }) => {
      if (!kotIds.length) return
      await Promise.all(
        kotIds.map((kotId) => print({ doc: "kot", kotId, reprint: opts?.reprint })),
      )
    },
    [print],
  )

  const printKot = useCallback(
    (kotId: string, opts?: { reprint?: boolean }) =>
      print({ doc: "kot", kotId, reprint: opts?.reprint }),
    [print],
  )

  const printBill = useCallback(
    (billId: string) => print({ doc: "bill", billId, reprint: true }),
    [print],
  )

  const printOrderSlip = useCallback(
    (orderId: string) => print({ doc: "order_slip", orderId, reprint: true }),
    [print],
  )

  const printFullKot = useCallback(
    (orderId: string) => print({ doc: "full_kot", orderId, reprint: true }),
    [print],
  )

  const printTest = useCallback(
    (printerId: string) => print({ doc: "test", printerId, reprint: true }),
    [print],
  )

  return {
    agentStatus: status,
    connected,
    print,
    printKot,
    printKots,
    printBill,
    printOrderSlip,
    printFullKot,
    printTest,
  }
}
