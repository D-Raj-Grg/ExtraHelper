"use client"

import { DownloadIcon, PrinterIcon } from "lucide-react"
import { toCsv, type CsvColumn } from "@/lib/csv"
import { Button } from "@/components/ui/button"

/** CSV download + browser print (→ save as PDF) for a report table. */
export function ExportButtons({
  rows,
  columns,
  filename,
}: {
  rows: Record<string, unknown>[]
  columns: CsvColumn[]
  filename: string
}) {
  function downloadCsv() {
    const csv = toCsv(rows, columns)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex gap-2 print:hidden">
      <Button size="sm" variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
        <DownloadIcon className="size-4" /> CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <PrinterIcon className="size-4" /> Print / PDF
      </Button>
    </div>
  )
}
