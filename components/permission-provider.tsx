"use client"

import { createContext, useContext, useMemo } from "react"

const PermissionContext = createContext<Set<string>>(new Set())

/**
 * Hydrates the user's permission keys (resolved server-side) for client gating.
 *
 * Mounted around the sidebar only (`app-sidebar-section.tsx`), not the whole
 * app — that is what lets the sidebar's permission read stream behind a
 * Suspense boundary instead of blocking the page. A consumer outside that
 * subtree reads the empty default set, so page-level gating belongs in the
 * server component (`requirePermission` / `getMyPermissions`), which is the
 * honest place for it anyway. Widen this provider if that ever changes.
 *
 * Other islands that need client gating mount their own copy rather than
 * widening this one: the header bell unwraps the layout's unawaited
 * `getMyPermissions` promise behind its own Suspense boundary, and
 * /notifications wraps its feed with the keys its guard already read.
 */
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
