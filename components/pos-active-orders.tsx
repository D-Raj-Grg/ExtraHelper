"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type Row = { id: string; status: string; restaurant_tables: { label: string } | null }

const ACTIVE = ["draft", "placed", "in_kitchen", "preparing", "ready", "served"]

/** Live active-orders list — seeded from the server, kept fresh via Realtime. */
export function PosActiveOrders({ initial, tenantId }: { initial: Row[]; tenantId: string }) {
  const [rows, setRows] = useState<Row[]>(initial)
  useEffect(() => setRows(initial), [initial])

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("orders")
      .select("id, status, restaurant_tables!orders_table_id_fkey(label)")
      .eq("tenant_id", tenantId)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
    if (data) setRows(data as unknown as Row[])
  }, [tenantId])

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 150)
    }
    const filter = `tenant_id=eq.${tenantId}`
    const channel = supabase
      .channel(`pos:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter }, ping)
      .subscribe()
    const safety = setInterval(() => void refetch(), 45000)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      void supabase.removeChannel(channel)
    }
  }, [tenantId, refetch])

  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No active orders.</p>

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="w-full text-sm">
        <TableBody>
          {rows.map((o) => (
            <TableRow key={o.id} className="border-b last:border-0">
              <TableCell className="px-4 py-2 font-medium">
                {o.restaurant_tables?.label ? `Table ${o.restaurant_tables.label}` : "Takeaway"}
              </TableCell>
              <TableCell className="px-4 py-2 capitalize text-muted-foreground">
                {o.status.replace("_", " ")}
              </TableCell>
              <TableCell className="px-4 py-2 text-right">
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/pos/${o.id}`} />}>
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
