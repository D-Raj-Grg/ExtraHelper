"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { postCount, setCountActual } from "@/app/(app)/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Row = {
  id: string
  name: string
  uom: string
  theoretical: number
  actual: number
  variance: number
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "")
}

export function StockCountSheet({
  countId,
  rows,
  posted,
}: {
  countId: string
  rows: Row[]
  posted: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Local actual values for live variance; server persists on blur.
  const [actuals, setActuals] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.id, fmt(r.actual)])),
  )

  function save(row: Row) {
    const val = Number(actuals[row.id])
    if (!Number.isFinite(val) || val < 0 || val === row.actual) return
    startTransition(async () => {
      const res = await setCountActual(row.id, countId, val)
      if (res && "error" in res) toast.error(res.error)
    })
  }

  const changed = rows.filter((r) => Number(actuals[r.id]) !== r.theoretical).length

  function post() {
    startTransition(async () => {
      const res = await postCount(countId)
      if (res && "error" in res) toast.error(res.error)
      else {
        toast.success("Count posted — stock reconciled.")
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Theoretical</th>
              <th className="px-3 py-2 text-right font-medium">Counted</th>
              <th className="px-3 py-2 text-right font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const live = Number(actuals[r.id])
              const variance = Number.isFinite(live) ? live - r.theoretical : r.variance
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">
                    {r.name} <span className="text-xs text-muted-foreground">{r.uom}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{fmt(r.theoretical)}</td>
                  <td className="px-3 py-2 text-right">
                    {posted ? (
                      fmt(r.actual)
                    ) : (
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={actuals[r.id]}
                        onChange={(e) => setActuals((s) => ({ ...s, [r.id]: e.target.value }))}
                        onBlur={() => save(r)}
                        className="ml-auto h-8 max-w-24 text-right text-sm"
                      />
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      variance === 0
                        ? "text-muted-foreground"
                        : variance < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-green-600 dark:text-green-400"
                    }`}
                  >
                    {variance > 0 ? "+" : ""}
                    {fmt(variance)}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No inventory items to count.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {posted ? (
        <p className="text-sm text-green-600 dark:text-green-400">
          This count has been posted and stock reconciled.
        </p>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {changed} item(s) with variance
          </span>
          <Button disabled={pending || rows.length === 0} onClick={post}>
            {pending ? "Posting…" : "Post count & reconcile"}
          </Button>
        </div>
      )}
    </div>
  )
}
