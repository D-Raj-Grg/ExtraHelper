"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import { CheckIcon, SearchIcon, XIcon } from "lucide-react"

import { searchCustomers } from "@/app/(app)/pos/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { PosCustomer } from "@/components/pos/types"

export function customerLabel(c: PosCustomer): string {
  if (c.name && c.phone) return `${c.name} · ${c.phone}`
  return c.name || c.phone || "Unnamed customer"
}

/**
 * Type-ahead customer picker. The till only holds the first 200 customers
 * (loadPosData caps the fetch so a large CRM isn't shipped to every device), so
 * an empty query shows that recent list and typing searches the rest through
 * the searchCustomers server action.
 *
 * Controlled by id; the picked customer object is kept locally only so the
 * chosen name/phone can be shown even when the match came from search and isn't
 * in `recent`.
 */
export function CustomerPicker({
  id,
  value,
  recent,
  onSelect,
  disabled = false,
}: {
  id?: string
  value: string | null
  recent: PosCustomer[]
  onSelect: (customer: PosCustomer | null) => void
  disabled?: boolean
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PosCustomer[]>(recent.slice(0, 20))
  const [pending, startTransition] = useTransition()

  // A search-picked customer may not be in the capped `recent` list, so remember
  // the last pick to keep its label showable. The *displayed* selection is still
  // derived from the controlled `value`, so a parent-side clear wins.
  const [lastPicked, setLastPicked] = useState<PosCustomer | null>(null)
  const picked =
    value === null
      ? null
      : (recent.find((c) => c.id === value) ??
        (lastPicked?.id === value ? lastPicked : null))

  // Debounced search. Under 2 chars falls back to the recent list. The reset
  // lives inside the timer callback so no setState runs in the effect body.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const t = setTimeout(
      () => {
        if (q.length < 2) setResults(recent.slice(0, 20))
        else startTransition(async () => setResults(await searchCustomers(q)))
      },
      q.length < 2 ? 0 : 200,
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function pick(c: PosCustomer) {
    setLastPicked(c)
    onSelect(c)
    setOpen(false)
    setQuery("")
  }

  function clear() {
    onSelect(null)
    setQuery("")
  }

  // A customer is chosen: show it as a chip with a clear button, no dropdown.
  if (picked && value) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{customerLabel(picked)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={clear}
          disabled={disabled}
          aria-label="Clear customer"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          className="pl-9"
          placeholder="Search name or phone…"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {pending ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {query.trim().length < 2 ? "No customers yet." : "No matches — add name + phone below."}
            </li>
          ) : (
            results.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className={cn(
                    "flex w-full items-center rounded-sm px-3 py-2 text-left text-sm",
                    "hover:bg-accent focus:bg-accent focus:outline-none",
                  )}
                >
                  <span className="min-w-0 truncate">{customerLabel(c)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
