"use client"

import * as React from "react"
import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"

/**
 * Spinner for the nav item you just clicked. `useLinkStatus` only reports
 * `pending` for the enclosing `<Link>`, so this has to render *inside* the
 * link — it is a child of the SidebarMenuButton that renders as one.
 *
 * The 150ms fade-in lives in `.nav-pending` (globals.css) so a prefetched
 * route that lands immediately never flashes a spinner.
 */
export function NavPending() {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return <Loader2Icon aria-hidden className="nav-pending ml-auto" />
}

/**
 * Which nav url is the current one — the *longest* match, not every match.
 * "/reports" is a prefix of "/reports/day", so a plain prefix test lights up
 * two rows at once on the day-close page. Resolved across all urls at the
 * sidebar level for that reason, then compared by identity per row.
 */
export function useActiveUrl(urls: string[]): string | null {
  const pathname = usePathname()
  let best: string | null = null
  for (const url of urls) {
    const matches =
      url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`)
    if (matches && (best === null || url.length > best.length)) best = url
  }
  return best
}

/**
 * The `render` element for every sidebar nav button. `next/link` rather than a
 * bare `<a>`: an anchor reloads the document, which re-runs the whole app
 * layout (auth + tenant + permissions + settings reads) before anything is
 * painted, so every nav click felt frozen. Link prefetches the route's loading
 * skeleton and swaps client-side instead.
 *
 * On mobile the sidebar is a Sheet over the page — a full reload used to close
 * it for free, a client transition doesn't, so close it by hand.
 */
export function SidebarNavLink({
  href,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  // Prefetch on intent, not on sight. Every staff route is dynamic, so a
  // prefetch is a real server render down to the loading boundary — and all
  // ~20 nav rows are in the viewport at once, which with the default would
  // fire ~20 of them the moment the sidebar paints (and again each time the
  // mobile sheet opens). Hover/focus/touch buys the same head start on the
  // one route the user is actually reaching for.
  const [intent, setIntent] = React.useState(false)
  const arm = () => setIntent(true)

  // `props` is spread first, then each handler re-declared to run both: this
  // element is cloned by `useRender` in SidebarMenuButton, so it arrives
  // carrying the button's own handlers — spreading last would silently drop
  // everything below it.
  return (
    <Link
      {...props}
      href={href}
      prefetch={intent ? null : false}
      onMouseEnter={(e) => {
        arm()
        props.onMouseEnter?.(e)
      }}
      onFocus={(e) => {
        arm()
        props.onFocus?.(e)
      }}
      onTouchStart={(e) => {
        arm()
        props.onTouchStart?.(e)
      }}
      onClick={(e) => {
        if (isMobile) setOpenMobile(false)
        props.onClick?.(e)
      }}
    />
  )
}
