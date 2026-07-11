// Shared, dependency-free preference constants — safe to import from both
// Server Components (root layout) and Client Components (provider/controls).

export type Theme = "light" | "dark"

/** Root font-size (px) for each text-scale index 0..4. Default is index 2 (16px). */
export const SCALE_PX = [14, 15, 16, 18, 20] as const

export const DEFAULT_THEME: Theme = "light"
export const DEFAULT_SCALE = 2

export const THEME_COOKIE = "pref-theme"
export const SCALE_COOKIE = "pref-scale"

/** Clamp an arbitrary number to a valid scale index. */
export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCALE
  return Math.min(SCALE_PX.length - 1, Math.max(0, Math.round(n)))
}
