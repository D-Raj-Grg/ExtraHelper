"use client"

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react"
import { savePreferences } from "@/app/(app)/preferences/actions"
import {
  SCALE_PX,
  clampScale,
  type Theme,
} from "@/lib/preferences-constants"

type Prefs = {
  theme: Theme
  scale: number
  minScale: number
  maxScale: number
  toggleTheme: () => void
  incScale: () => void
  decScale: () => void
}

const PreferencesContext = createContext<Prefs | null>(null)

/**
 * Holds theme + text-scale, seeded from the server (DB → cookies → props).
 * Applies to <html> immediately (optimistic) and persists each change to the
 * DB via a Server Action. The root layout already paints the correct initial
 * state from cookies, so this mainly handles live toggles + first-login sync.
 */
export function PreferencesProvider({
  initialTheme,
  initialScale,
  children,
}: {
  initialTheme: Theme
  initialScale: number
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [scale, setScale] = useState<number>(clampScale(initialScale))

  // Reflect state onto <html> before paint (class for dark, font-size for scale).
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    root.style.fontSize = `${SCALE_PX[scale]}px`
  }, [theme, scale])

  const persist = useCallback((t: Theme, s: number) => {
    void savePreferences(t, s)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark"
      persist(next, scale)
      return next
    })
  }, [persist, scale])

  const incScale = useCallback(() => {
    setScale((prev) => {
      const next = clampScale(prev + 1)
      if (next !== prev) persist(theme, next)
      return next
    })
  }, [persist, theme])

  const decScale = useCallback(() => {
    setScale((prev) => {
      const next = clampScale(prev - 1)
      if (next !== prev) persist(theme, next)
      return next
    })
  }, [persist, theme])

  return (
    <PreferencesContext.Provider
      value={{
        theme,
        scale,
        minScale: 0,
        maxScale: SCALE_PX.length - 1,
        toggleTheme,
        incScale,
        decScale,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences(): Prefs {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error("usePreferences must be used within a PreferencesProvider")
  return ctx
}
