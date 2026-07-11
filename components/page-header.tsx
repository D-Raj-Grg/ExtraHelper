import { cn } from "@/lib/utils"

type Width = "standard" | "narrow" | "full"

const WIDTH: Record<Width, string> = {
  standard: "max-w-5xl",
  narrow: "max-w-lg",
  full: "max-w-none",
}

/**
 * Standard content wrapper for staff pages — one consistent width policy +
 * padding so every page lines up. `standard` for most pages, `narrow` for
 * form/detail pages, `full` for edge-to-edge surfaces.
 */
export function PageShell({
  width = "standard",
  className,
  children,
}: {
  width?: Width
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("mx-auto w-full p-6 md:p-10", WIDTH[width], className)}>
      {children}
    </div>
  )
}

/**
 * Uniform page heading: title + optional description, with an optional actions
 * slot pinned to the right. Replaces the hand-rolled header block each page had.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-6 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
