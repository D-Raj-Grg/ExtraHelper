"use client"

import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { ORDER_DETAIL_SELECT } from "@/lib/pos-constants"
import type { PosOrderDetail } from "@/components/pos/types"

type State = {
  detail: PosOrderDetail | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * The order the modal has open, kept live. Seeds from `initial` when we got
 * here by deep link (/pos/[orderId] renders it server-side); otherwise fetches
 * on open, because a card click doesn't navigate.
 */
export function useOrderDetail(
  orderId: string,
  tenantId: string,
  initial?: PosOrderDetail | null,
): State {
  const seeded = initial && initial.id === orderId ? initial : null

  const [detail, setDetail] = useState<PosOrderDetail | null>(seeded)
  const [loading, setLoading] = useState(!seeded)
  const [error, setError] = useState<string | null>(null)

  // Reseeding from the server prop is derived state, so it's adjusted during
  // render — in an effect it would paint the stale order for a frame first.
  // Keyed on the id: `initial` is a server prop and gets a new identity on
  // every revalidate, so comparing by value would reseed endlessly.
  const [seededId, setSeededId] = useState<string | null>(seeded?.id ?? null)
  if (seeded && seededId !== seeded.id) {
    setSeededId(seeded.id)
    setDetail(seeded)
    setLoading(false)
  }

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from("orders")
      .select(ORDER_DETAIL_SELECT)
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { referencedTable: "order_items" })
      .maybeSingle()
    if (err) {
      setError("Couldn't load this order. Check your connection and try again.")
      setLoading(false)
      return
    }
    setError(null)
    setDetail((data as unknown as PosOrderDetail) ?? null)
    setLoading(false)
  }, [orderId, tenantId])

  // The effect keeps only the genuinely external work: fetch the order when we
  // weren't handed one (a card tap doesn't navigate, so there's no server prop).
  //
  // set-state-in-effect is disabled because it misreads this one: refetch is
  // async, so its setState calls land in a promise continuation, not
  // synchronously in the effect body. That's the "subscribe to an external
  // system, setState in a callback" shape the rule explicitly allows — the
  // analysis just can't see through the await.
  const needsFetch = !seeded
  useEffect(() => {
    if (!needsFetch) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch()
  }, [needsFetch, refetch])

  return { detail, loading, error, refetch: () => void refetch() }
}
