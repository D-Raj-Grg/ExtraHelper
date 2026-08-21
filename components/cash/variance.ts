/**
 * Variance is `counted − expected` (see close_cash_session): negative means the
 * drawer came up short, positive means it was over. Both are worth a second
 * look, but only short is a loss — so they don't share a colour.
 *
 * Shared by the Cash page's shift reports and the day-close sheet, which read
 * the same numbers and must not describe them two different ways.
 */
export function variance(cents: number): { label: string; tone: string } {
  if (cents === 0) return { label: "Balanced", tone: "text-emerald-600 dark:text-emerald-400" }
  if (cents < 0) return { label: "Short", tone: "text-destructive" }
  return { label: "Over", tone: "text-amber-600 dark:text-amber-400" }
}
