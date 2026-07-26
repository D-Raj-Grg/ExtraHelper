"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import {
  getBillPrintJob,
  getKotPrintJob,
  getTestPrintJob,
} from "@/app/(app)/print/actions"
import { dispatchJob } from "@/lib/print/dispatch"
import { usePrintAgent } from "./print-provider"

/**
 * The one way the app prints. Every caller — fire, re-fire, KDS, checkout,
 * settings test — goes through here so routing, the job log and the browser
 * fallback stay identical everywhere.
 */
export function usePrint() {
  const { connected, sendRaw, status } = usePrintAgent()

  const printKot = useCallback(
    async (kotId: string, opts?: { reprint?: boolean; quiet?: boolean }) => {
      const job = await getKotPrintJob(kotId, { reprint: opts?.reprint })
      if ("error" in job) {
        toast.error(job.error)
        return "failed" as const
      }
      return dispatchJob(job, { connected, sendRaw, quiet: opts?.quiet })
    },
    [connected, sendRaw],
  )

  /**
   * A whole order's tickets: one summary toast, not one per station — and it
   * reports what actually happened, including the ones that didn't print.
   */
  const printKots = useCallback(
    async (kotIds: string[], opts?: { reprint?: boolean }) => {
      if (!kotIds.length) return
      const results = await Promise.all(
        kotIds.map((id) => printKot(id, { reprint: opts?.reprint, quiet: true })),
      )
      const count = (kind: string) => results.filter((r) => r === kind).length
      const printed = count("agent")
      const browser = count("browser")
      const failed = count("failed")
      const word = (n: number) => `${n} ticket${n === 1 ? "" : "s"}`
      if (printed) toast.success(`${opts?.reprint ? "Re-printed" : "Printed"} ${word(printed)}`)
      if (browser)
        toast.warning(`${word(browser)} opened in the browser — no printer connected`)
      if (failed) toast.error(`${word(failed)} could not be printed`)
    },
    [printKot],
  )

  const printBill = useCallback(
    async (billId: string) => {
      const job = await getBillPrintJob(billId)
      if ("error" in job) {
        toast.error(job.error)
        return "failed" as const
      }
      return dispatchJob(job, { connected, sendRaw })
    },
    [connected, sendRaw],
  )

  const printTest = useCallback(
    async (printerId: string) => {
      const job = await getTestPrintJob(printerId)
      if ("error" in job) {
        toast.error(job.error)
        return "failed" as const
      }
      return dispatchJob(job, { connected, sendRaw })
    },
    [connected, sendRaw],
  )

  return { agentStatus: status, connected, printKot, printKots, printBill, printTest }
}
