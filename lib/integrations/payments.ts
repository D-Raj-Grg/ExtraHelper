/**
 * Payment gateway adapter (rule #6). Business logic depends only on this
 * interface — never on a concrete gateway. Gateways are registered by key and
 * selected per tenant from settings, so Stripe / eSewa / Khalti / … are
 * swappable without touching billing code.
 */

export type PaymentIntentInput = {
  tenantId: string
  amountCents: number
  currency: string
  /** Idempotency key (rule #4) — same key must never double-charge. */
  idempotencyKey: string
  metadata?: Record<string, string>
}

export type PaymentResult = {
  status: "succeeded" | "pending" | "failed"
  reference: string
  raw?: unknown
}

export type RefundInput = {
  tenantId: string
  reference: string
  amountCents: number
  idempotencyKey: string
}

export interface PaymentGateway {
  readonly key: string
  createPayment(input: PaymentIntentInput): Promise<PaymentResult>
  refund(input: RefundInput): Promise<PaymentResult>
}

/**
 * Manual gateway — cash / card-on-terminal recorded by the cashier. No external
 * call; the payment is trusted as taken. Always available as the fallback so a
 * tenant can transact before wiring an online gateway.
 */
export const manualGateway: PaymentGateway = {
  key: "manual",
  async createPayment(input: PaymentIntentInput): Promise<PaymentResult> {
    return { status: "succeeded", reference: `manual_${input.idempotencyKey}` }
  },
  async refund(input: RefundInput): Promise<PaymentResult> {
    return { status: "succeeded", reference: `refund_${input.reference}` }
  },
}

/**
 * Sandbox gateway — simulates an online card charge (always succeeds) so the
 * end-to-end pay flow works before a real gateway (Stripe / eSewa / Khalti) is
 * wired. A real gateway implements the same PaymentGateway interface and
 * registers under its own key; per-tenant config selects which one.
 */
export const sandboxGateway: PaymentGateway = {
  key: "sandbox",
  async createPayment(input: PaymentIntentInput): Promise<PaymentResult> {
    return { status: "succeeded", reference: `sandbox_ch_${input.idempotencyKey}` }
  },
  async refund(input: RefundInput): Promise<PaymentResult> {
    return { status: "succeeded", reference: `sandbox_re_${input.reference}` }
  },
}

const gateways = new Map<string, PaymentGateway>([
  [manualGateway.key, manualGateway],
  [sandboxGateway.key, sandboxGateway],
])

export function registerGateway(gateway: PaymentGateway): void {
  gateways.set(gateway.key, gateway)
}

/** Resolve a gateway by key (from tenant settings). Falls back to manual. */
export function getGateway(key: string | null | undefined): PaymentGateway {
  return (key && gateways.get(key)) || manualGateway
}
