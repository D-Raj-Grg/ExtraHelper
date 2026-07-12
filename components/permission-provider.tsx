"use client"

import { createContext, useContext, useMemo } from "react"

const PermissionContext = createContext<Set<string>>(new Set())

/** Hydrates the user's permission keys (resolved server-side) for client gating. */
export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: string[]
  children: React.ReactNode
}) {
  const set = useMemo(() => new Set(permissions), [permissions])
  return <PermissionContext.Provider value={set}>{children}</PermissionContext.Provider>
}

export function usePermissions(): Set<string> {
  return useContext(PermissionContext)
}

export function useHasPermission(key: string): boolean {
  return useContext(PermissionContext).has(key)
}
