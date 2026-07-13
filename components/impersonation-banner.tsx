import { stopImpersonation } from "@/app/(app)/admin/actions"
import { Button } from "@/components/ui/button"

/** Persistent warning bar shown while a platform admin is impersonating a tenant. */
export function ImpersonationBanner({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-700 dark:text-amber-300">
      <span>
        Viewing as <span className="font-semibold">{name}</span> — impersonation mode.
      </span>
      <form action={stopImpersonation}>
        <Button type="submit" variant="outline" size="sm">
          Exit
        </Button>
      </form>
    </div>
  )
}
