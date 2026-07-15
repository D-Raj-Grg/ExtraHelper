export type TaxRule = { name: string; rate: number; inclusive: boolean }
export type Branch = { id: string; name: string; address: string | null; is_default: boolean }

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "NPR", "AED", "SGD", "AUD", "CAD", "JPY"]

export const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
]

/** Shared card grid: two columns from `lg`, cards top-aligned so uneven
 * heights don't stretch. Every settings tab uses this so the rhythm matches. */
export const CARD_GRID = "grid items-start gap-6 lg:grid-cols-2"
