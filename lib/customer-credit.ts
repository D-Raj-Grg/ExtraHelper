/** Row shape of the `customer_credit_summary` RPC (bigint columns arrive as strings/numbers). */
export type CustomerCreditRow = {
  customer_id: string
  outstanding_cents: number | string
  unpaid_bills: number | string
  oldest_unpaid: string | null
}

export type CustomerCredit = { outstanding_cents: number; unpaid_bills: number }

/** Normalise the RPC rows into a lookup by customer id plus the grand total. */
export function indexCredit(rows: unknown): { byCustomer: Map<string, CustomerCredit>; totalCents: number } {
  const list = (rows ?? []) as CustomerCreditRow[]
  const byCustomer = new Map<string, CustomerCredit>()
  let totalCents = 0
  for (const r of list) {
    const outstanding = Number(r.outstanding_cents)
    byCustomer.set(r.customer_id, { outstanding_cents: outstanding, unpaid_bills: Number(r.unpaid_bills) })
    totalCents += outstanding
  }
  return { byCustomer, totalCents }
}
