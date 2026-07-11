import { stopImpersonation } from "@/app/(app)/admin/actions"

/** Persistent warning bar shown while a platform admin is impersonating a tenant. */
export function ImpersonationBanner({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-700 dark:text-amber-300">
      <span>
        Viewing as <span className="font-semibold">{name}</span> — impersonation mode.
      </span>
      <form action={stopImpersonation}>
        <button type="submit" className="rounded-md border border-amber-500/50 px-2 py-0.5 text-xs font-medium hover:bg-amber-500/20">
          Exit
        </button>
      </form>
    </div>
  )
}
