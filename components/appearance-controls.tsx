"use client"

import { Moon, Sun } from "lucide-react"
import { usePreferences } from "@/components/preferences-provider"
import { Button } from "@/components/ui/button"

/**
 * Header appearance controls: text-size stepper (A− / A+) + dark-mode toggle.
 * State lives in PreferencesProvider (persisted per-user).
 */
export function AppearanceControls() {
  const { theme, scale, minScale, maxScale, toggleTheme, incScale, decScale } =
    usePreferences()

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center rounded-md border">
        <Button
          size="icon"
          variant="ghost"
          className="size-8 rounded-r-none"
          onClick={decScale}
          disabled={scale <= minScale}
          aria-label="Decrease text size"
          title="Decrease text size"
        >
          <span className="text-xs font-semibold">A−</span>
        </Button>
        <span className="w-4 text-center text-xs text-muted-foreground tabular-nums">
          {scale + 1}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 rounded-l-none"
          onClick={incScale}
          disabled={scale >= maxScale}
          aria-label="Increase text size"
          title="Increase text size"
        >
          <span className="text-sm font-semibold">A+</span>
        </Button>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
      >
        {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </Button>
    </div>
  )
}
