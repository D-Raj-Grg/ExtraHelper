import { PageShell } from "@/components/page-header"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Loading shells for `loading.tsx`. Every staff page is `force-dynamic`, so
 * without a loading file Next can't prefetch anything and the browser sits on
 * the old screen until the server answers — the "click, freeze, jump" people
 * reported. A loading file gives the route a prefetchable shell and makes the
 * transition start on the click instead of on the response.
 *
 * These mirror the real page's frame (same PageShell width, same header block,
 * roughly the same first rows) so the swap to real content doesn't jolt.
 */

function HeaderSkeleton({ actions = false }: { actions?: boolean }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {actions ? <Skeleton className="h-9 w-28 shrink-0" /> : null}
    </div>
  )
}

/** Rows of a data table: header strip + n rows. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3">
          <div className="flex gap-4">
            {Array.from({ length: cols }).map((_, i) => (
              <Skeleton key={i} className={cn("h-4", i === 0 ? "w-40" : "w-20")} />
            ))}
          </div>
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 border-b px-4 py-4 last:border-b-0">
            {Array.from({ length: cols }).map((_, i) => (
              <Skeleton key={i} className={cn("h-4", i === 0 ? "w-40" : "w-20")} />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** Grid of tiles — POS menu items, tables, KDS tickets. */
export function TileGridSkeleton({ tiles = 12 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: tiles }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  )
}

/** Row of stat cards. */
export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

type Variant = "table" | "tiles" | "dashboard" | "form"

/**
 * Whole-page shell. `variant` picks the body; the frame (width, header block)
 * is identical to the real page so only the content area changes on swap.
 */
export function PageSkeleton({
  variant = "table",
  width,
  actions = false,
}: {
  variant?: Variant
  width?: React.ComponentProps<typeof PageShell>["width"]
  actions?: boolean
}) {
  return (
    <PageShell width={width}>
      <HeaderSkeleton actions={actions} />
      {variant === "table" ? <TableSkeleton /> : null}
      {variant === "tiles" ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-24" />
            ))}
          </div>
          <TileGridSkeleton />
        </div>
      ) : null}
      {variant === "dashboard" ? (
        <div className="space-y-6">
          <StatRowSkeleton />
          <Card>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="space-y-2">
                  <Skeleton className="h-5 w-28" />
                </CardHeader>
                <CardContent className="space-y-3">
                  {Array.from({ length: 4 }).map((_, r) => (
                    <Skeleton key={r} className="h-4 w-full" />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
      {variant === "form" ? (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </CardHeader>
              <CardContent className="space-y-4">
                {Array.from({ length: 3 }).map((_, f) => (
                  <div key={f} className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-9 w-full max-w-sm" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        Loading
      </span>
    </PageShell>
  )
}
