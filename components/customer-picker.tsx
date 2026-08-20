"use client"

import { useEffect, useRef, useState } from "react"
import { SearchIcon } from "lucide-react"

import { searchCustomers, type CustomerHit } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Find a guest who has been in before, and put the bill back on *them*.
 *
 * Attaching by name and phone can only find someone again through the number —
 * a guest saved with a name and nothing else comes back as a fresh duplicate
 * every visit, and their points with them. A picked row carries an id, which is
 * what `attach_bill_customer_by_id` takes.
 */
export function CustomerPicker({
  id,
  label = "Someone who has been in before",
  currency,
  pointsValueCents,
  disabled,
  onPick,
}: {
  /** Distinct per mount — two pickers on one page must not share a label. */
  id: string
  label?: string
  currency: string
  pointsValueCents: number
  disabled: boolean
  onPick: (customerId: string) => void
}) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<CustomerHit[]>([])
  const [searching, setSearching] = useState(false)

  /**
   * Only the newest search may write `hits`. Typing fires several and they come
   * back out of order — an older, slower one landing last would put results for
   * an abandoned query under the cashier's cursor.
   */
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    // Debounced: a server action per keystroke is a round trip per keystroke.
    // The spinner is raised inside the timeout, not in the effect body — React
    // treats a synchronous setState there as a cascading render.
    const t = setTimeout(async () => {
      setSearching(true)
      const found = await searchCustomers(query)
      if (mine !== seq.current) return
      setHits(found)
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const rate = Math.max(1, pointsValueCents)

  return (
    <div>
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="relative">
          <SearchIcon
            className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={id}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone"
            className="pl-8"
          />
        </div>
      </Field>
      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border">
        {hits.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {searching ? "Looking…" : "Nobody by that name or number yet."}
          </p>
        ) : (
          <ul className="divide-y">
            {hits.map((hit) => (
              <li key={hit.id} className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {hit.name ?? hit.phone ?? "Guest"}
                  </p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">
                    {hit.phone && hit.name ? `${hit.phone} · ` : ""}
                    {hit.points} pts · {money(hit.points * rate, currency)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onPick(hit.id)}>
                  Attach
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
