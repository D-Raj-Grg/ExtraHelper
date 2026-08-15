import {
  BanknoteIcon,
  CreditCardIcon,
  GlobeIcon,
  LandmarkIcon,
  QrCodeIcon,
  SmartphoneIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react"

import type { Database } from "@/lib/supabase/database.types"

/**
 * How money arrives at the till.
 *
 * A plain module on purpose: the checkout panel, the split dialog, the bill view
 * and the reports table are a mix of client and server components, and anything
 * that reaches `lib/supabase/server` from a client component drags `next/headers`
 * into the browser bundle and fails the build.
 *
 * eSewa, FonePay, a bank transfer and a generic wallet are **record-only**. The
 * guest scans a QR, shows the confirmation, and the cashier records what was
 * taken — the same trust model as a card on a terminal. No gateway call stands
 * behind them, which is exactly why they queue offline like cash. `online` is
 * the one method that charges through the adapter in `lib/integrations/payments`
 * and therefore the one that needs a connection.
 */
export type PaymentMethod = Database["public"]["Enums"]["payment_method"]

export type PaymentMethodSpec = {
  value: PaymentMethod
  label: string
  icon: LucideIcon
  /** Charged through the gateway adapter — unusable without a connection. */
  needsOnline: boolean
  /** Offer a field for the guest-side transaction id, so it reconciles later. */
  takesReference: boolean
}

/**
 * The methods a cashier picks from, in the order they appear. Cash and card
 * lead because they are still most of the volume; the wallets follow in the
 * order Nepal restaurants ask for them.
 *
 * `points` is absent: loyalty is redeemed through its own dialog and its own
 * RPC (`redeem_points_for_bill`, which burns the points atomically), never by
 * picking a method here. It still has a label below, because reports and the
 * payment list have to render rows the redemption wrote.
 */
export const PAYMENT_METHODS: readonly PaymentMethodSpec[] = [
  { value: "cash", label: "Cash", icon: BanknoteIcon, needsOnline: false, takesReference: false },
  {
    value: "card",
    label: "Card",
    icon: CreditCardIcon,
    needsOnline: false,
    takesReference: true,
  },
  {
    value: "esewa",
    label: "eSewa",
    icon: SmartphoneIcon,
    needsOnline: false,
    takesReference: true,
  },
  {
    value: "fonepay",
    label: "FonePay",
    icon: QrCodeIcon,
    needsOnline: false,
    takesReference: true,
  },
  {
    value: "bank",
    label: "Bank transfer",
    icon: LandmarkIcon,
    needsOnline: false,
    takesReference: true,
  },
  {
    value: "wallet",
    label: "Wallet",
    icon: WalletIcon,
    needsOnline: false,
    takesReference: true,
  },
  {
    value: "online",
    label: "Card (online)",
    icon: GlobeIcon,
    needsOnline: true,
    takesReference: false,
  },
] as const

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  esewa: "eSewa",
  fonepay: "FonePay",
  bank: "Bank transfer",
  wallet: "Wallet",
  online: "Card (online)",
  points: "Loyalty points",
  // Supplier-side only: money that never passed through the till. Absent from
  // PAYMENT_METHODS above, so it is never offered at checkout.
  other: "Other",
}

/** Enum values never reach staff — reports and receipts go through here. */
export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method
}

export function paymentMethodIcon(method: string): LucideIcon | null {
  return PAYMENT_METHODS.find((m) => m.value === method)?.icon ?? null
}

export function paymentMethodTakesReference(method: string): boolean {
  return PAYMENT_METHODS.find((m) => m.value === method)?.takesReference ?? false
}

/** The payments reference column is capped server-side; mirror it in the UI. */
export const PAYMENT_REFERENCE_MAX = 120
