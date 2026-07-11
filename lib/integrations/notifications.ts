/**
 * Notification adapter (rule #6). Email / SMS / push behind one interface,
 * selected per tenant + channel. Used for reservations, receipts (digital),
 * low-stock alerts, subscription dunning.
 */

export type NotificationInput = {
  tenantId: string
  channel: "email" | "sms" | "push"
  to: string
  subject?: string
  body: string
  metadata?: Record<string, string>
}

export type NotificationResult = { status: "sent" | "queued" | "failed"; id: string }

export interface NotificationProvider {
  readonly key: string
  send(input: NotificationInput): Promise<NotificationResult>
}

/**
 * Console provider — logs instead of sending (dev default). Swap for
 * Resend/SES/Twilio/FCM adapters per tenant.
 */
export const consoleNotificationProvider: NotificationProvider = {
  key: "console",
  async send(input: NotificationInput): Promise<NotificationResult> {
    // eslint-disable-next-line no-console
    console.log(`[notify:${input.channel}] → ${input.to}: ${input.body}`)
    return { status: "queued", id: `console_${input.channel}` }
  },
}

const providers = new Map<string, NotificationProvider>([
  [consoleNotificationProvider.key, consoleNotificationProvider],
])

export function registerNotificationProvider(provider: NotificationProvider): void {
  providers.set(provider.key, provider)
}

export function getNotificationProvider(
  key: string | null | undefined,
): NotificationProvider {
  return (key && providers.get(key)) || consoleNotificationProvider
}
