"use client"

import * as React from "react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { TenantSwitcher } from "@/components/tenant-switcher"
import { usePermissions } from "@/components/permission-provider"
import type { TenantMembership } from "@/lib/supabase/tenant"

// nav item title → permission key required to see it (missing → always visible).
const NAV_PERM: Record<string, string> = {
  Dashboard: "dashboard.view",
  Notifications: "notifications.view",
  POS: "order.view",
  "Kitchen (KDS)": "kds.view",
  "Online Orders": "online.view",
  "Cash Drawer": "cash.view",
  Inventory: "inventory.view",
  Purchasing: "purchasing.view",
  Reports: "reports.view",
  Loyalty: "loyalty.view",
  Menu: "menu.view",
  "Floors & Tables": "tables.view",
  Reservations: "reservations.view",
  Team: "staff.view",
  Billing: "billing.view",
  "Audit Log": "audit.view",
  Settings: "settings.view",
}
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, ListIcon, ChartBarIcon, FolderIcon, UsersIcon, CameraIcon, FileTextIcon, Settings2Icon, CircleHelpIcon, SearchIcon, DatabaseIcon, FileChartColumnIcon, FileIcon, CommandIcon, BellIcon } from "lucide-react"

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Dashboard",
      url: "/",
      icon: <LayoutDashboardIcon />,
    },
    {
      title: "Notifications",
      url: "/notifications",
      icon: <BellIcon />,
    },
    {
      title: "POS",
      url: "/pos",
      icon: <ChartBarIcon />,
    },
    {
      title: "Kitchen (KDS)",
      url: "/kds",
      icon: <CameraIcon />,
    },
    {
      title: "Online Orders",
      url: "/online",
      icon: <FileIcon />,
    },
    {
      title: "Cash Drawer",
      url: "/cash",
      icon: <FileTextIcon />,
    },
    {
      title: "Inventory",
      url: "/inventory",
      icon: <DatabaseIcon />,
    },
    {
      title: "Purchasing",
      url: "/purchasing",
      icon: <FileChartColumnIcon />,
    },
    {
      title: "Reports",
      url: "/reports",
      icon: <ChartBarIcon />,
    },
    {
      title: "Loyalty",
      url: "/loyalty",
      icon: <UsersIcon />,
    },
    {
      title: "Menu",
      url: "/menu",
      icon: <ListIcon />,
    },
    {
      title: "Floors & Tables",
      url: "/tables",
      icon: <FolderIcon />,
    },
    {
      title: "Reservations",
      url: "/reservations",
      icon: <ListIcon />,
    },
    {
      title: "Team",
      url: "/team",
      icon: <UsersIcon />,
    },
  ],
  navClouds: [
    {
      title: "Capture",
      icon: (
        <CameraIcon
        />
      ),
      isActive: true,
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
    {
      title: "Proposal",
      icon: (
        <FileTextIcon
        />
      ),
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
    {
      title: "Prompts",
      icon: (
        <FileTextIcon
        />
      ),
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
  ],
  navSecondary: [
    {
      title: "Billing",
      url: "/billing",
      icon: <FileTextIcon />,
    },
    {
      title: "Audit Log",
      url: "/audit",
      icon: <FileTextIcon />,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: <Settings2Icon />,
    },
    {
      title: "Get Help",
      url: "#",
      icon: (
        <CircleHelpIcon
        />
      ),
    },
    {
      title: "Search",
      url: "#",
      icon: (
        <SearchIcon
        />
      ),
    },
  ],
  documents: [
    {
      name: "Data Library",
      url: "#",
      icon: (
        <DatabaseIcon
        />
      ),
    },
    {
      name: "Reports",
      url: "#",
      icon: (
        <FileChartColumnIcon
        />
      ),
    },
    {
      name: "Word Assistant",
      url: "#",
      icon: (
        <FileIcon
        />
      ),
    },
  ],
}
export function AppSidebar({
  user,
  tenants,
  activeTenantId,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user?: { name: string; email: string; avatar: string }
  tenants?: TenantMembership[]
  activeTenantId?: string
}) {
  const perms = usePermissions()
  const canSee = (title: string) => {
    const p = NAV_PERM[title]
    return !p || perms.has(p)
  }
  const navMain = data.navMain.filter((i) => canSee(i.title))
  const navSecondary = data.navSecondary.filter((i) => canSee(i.title))
  const multiTenant = (tenants?.length ?? 0) > 1
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {multiTenant && activeTenantId ? (
          <TenantSwitcher tenants={tenants!} activeId={activeTenantId} />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="data-[slot=sidebar-menu-button]:p-1.5!"
                render={<a href="/" />}
              >
                <CommandIcon className="size-5!" />
                <span className="text-base font-semibold">
                  {tenants?.[0]?.name ?? "ExtraHelper"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user ?? data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
