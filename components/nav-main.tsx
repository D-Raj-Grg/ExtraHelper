"use client"

import { useNewOrder } from "@/components/pos/new-order-provider"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { PlusIcon } from "lucide-react"

type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
}

export function NavMain({
  items,
  groups = [],
  showNewOrder = true,
}: {
  items: NavItem[]
  groups?: { label: string; items: NavItem[] }[]
  /** Holds order.view. Server-side guards and RLS are the real gate. */
  showNewOrder?: boolean
}) {
  const { openNewOrder } = useNewOrder()

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {showNewOrder ? (
            <SidebarMenuItem>
              {/* Opens the composer, not just the board — a button called "New
                  order" that lands you on a list and asks you to press another
                  button is lying about what it does. A dialog rather than a
                  route, so taking an order from the stock count or the cash
                  drawer doesn't cost the page you were on. */}
              <SidebarMenuButton
                tooltip="New order"
                className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                onClick={() => openNewOrder()}
              >
                <PlusIcon />
                <span>New order</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton tooltip={item.title} render={<a href={item.url} />}>
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
      {groups.map((group) => (
        <SidebarGroupContent key={group.label} className="mt-2">
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton tooltip={item.title} render={<a href={item.url} />}>
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      ))}
    </SidebarGroup>
  )
}
