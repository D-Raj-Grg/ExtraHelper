import { Skeleton } from "@/components/ui/skeleton"

/** Streamed placeholder while a tab's aggregates come back from Postgres. */
export function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading report">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
