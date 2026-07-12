"use client"

import { usePathname } from "next/navigation"
import { AppearanceControls } from "@/components/appearance-controls"
import { OfflineBadge } from "@/components/offline-badge"
import { NotificationBell } from "@/components/notification-bell"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Longest-prefix match → page name shown in the header. Keep in sync with the
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

function titleFor(pathname: string): string {
  const match = TITLES.find(([prefix]) =>
    prefix === "/" ? pathname === "/" : pathname.startsWith(prefix),
  )
  return match?.[1] ?? "Dashboard"
}

export function SiteHeader() {
  const pathname = usePathname()
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">{titleFor(pathname)}</h1>
        <div className="ml-auto flex items-center gap-2">
          <NotificationBell />
          <OfflineBadge />
          <AppearanceControls />
        </div>
      </div>
    </header>
  )
}
