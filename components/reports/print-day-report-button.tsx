"use client"

import { useTransition } from "react"
import { ReceiptTextIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { usePrint } from "@/components/print/use-print"

/**
 * Queues the day-close sheet for the thermal printer.
 *
 * Deliberately separate from ExportButtons' "Print / PDF", which drives the
 * browser: one puts the sheet on the counter's roll, the other opens the OS
 * print dialog. Labelled so nobody has to guess which is which.
 */
export function PrintDayReportButton({ day }: { day: string }) {
  const [pending, startTransition] = useTransition()
  const { printDayReport } = usePrint()

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(async () => void (await printDayReport(day)))}
    >
      <ReceiptTextIcon className="size-4" />
      {pending ? "Queueing…" : "Print Z-report"}
    </Button>
  )
}
