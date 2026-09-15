"use client"

import * as React from "react"

import { NavPending, SidebarNavLink } from "@/components/nav-link"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  items,
  activeUrl = null,
  ...props
}: {
  items: {
    title: string
    url: string
    icon: React.ReactNode
  }[]
  /** Resolved once across the whole sidebar — see `useActiveUrl`. */
  activeUrl?: string | null
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SecondaryItem key={item.title} item={item} activeUrl={activeUrl} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Own component so each row can use the active/pending hooks. */
function SecondaryItem({
  item,
  activeUrl,
}: {
  item: { title: string; url: string; icon: React.ReactNode }
  activeUrl: string | null
}) {
  const isActive = item.url === activeUrl
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        aria-current={isActive ? "page" : undefined}
        render={<SidebarNavLink href={item.url} />}
      >
        {item.icon}
        <span>{item.title}</span>
        <NavPending />
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
