"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { AppearanceControls } from "@/components/appearance-controls"
import { OfflineBadge } from "@/components/offline-badge"
import { NotificationBell } from "@/components/notification-bell"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

// Longest-prefix match → section name shown in the header. Keep in sync with the
// nav labels in `components/app-sidebar.tsx`.
const TITLES: [prefix: string, label: string][] = [
  ["/pos", "POS"],
  ["/kds", "Kitchen (KDS)"],
  ["/online", "Online Orders"],
  ["/menu", "Menu"],
  ["/tables", "Floors & Tables"],
  ["/reservations", "Reservations"],
  ["/inventory", "Inventory"],
  ["/purchasing", "Purchasing"],
  ["/reports", "Reports"],
  ["/loyalty", "Loyalty"],
  ["/cash", "Cash Drawer"],
  ["/billing", "Billing"],
  ["/bill", "Bill"],
  ["/notifications", "Notifications"],
  ["/audit", "Audit Log"],
  ["/settings", "Settings"],
  ["/admin", "Super Admin"],
  ["/", "Dashboard"],
]

// Sub-page label for deep routes → renders a second, current (non-link) crumb.
// Longest-prefix match. Section crumb stays a link back to the list.
const SUBPAGES: [prefix: string, label: string][] = [
  ["/inventory/count/", "Stock count"],
]

type Crumb = { label: string; href?: string }

function crumbsFor(pathname: string): Crumb[] {
  const section = TITLES.find(([prefix]) =>
    prefix === "/" ? pathname === "/" : pathname.startsWith(prefix),
  )
  if (!section) return [{ label: "Dashboard" }]

  const [sectionPrefix, sectionLabel] = section
  const sub = SUBPAGES.find(([prefix]) => pathname.startsWith(prefix))
  if (!sub) return [{ label: sectionLabel }]

  // Section becomes a link back to its list; sub-page is the current crumb.
  return [{ label: sectionLabel, href: sectionPrefix }, { label: sub[1] }]
}

export function SiteHeader() {
  const pathname = usePathname()
  const crumbs = crumbsFor(pathname)
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <Breadcrumb>
          <BreadcrumbList className="text-base">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1
              return (
                <BreadcrumbItem key={crumb.label}>
                  {last || !crumb.href ? (
                    <BreadcrumbPage className="font-medium">
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <>
                      <BreadcrumbLink render={<Link href={crumb.href} />}>
                        {crumb.label}
                      </BreadcrumbLink>
                      <BreadcrumbSeparator />
                    </>
                  )}
                </BreadcrumbItem>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <NotificationBell />
          <OfflineBadge />
          <AppearanceControls />
        </div>
      </div>
    </header>
  )
}
