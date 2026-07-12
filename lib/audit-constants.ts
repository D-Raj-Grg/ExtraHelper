// Shared pill styles for audit_logs actions — used by /audit and the
// Notification "Activity" tab.
export const ACTION_STYLES: Record<string, string> = {
  void: "bg-red-500/10 text-red-600 dark:text-red-400",
  discount: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  refund: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  price_change: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  tenant_suspend: "bg-red-500/10 text-red-600 dark:text-red-400",
  tenant_activate: "bg-green-500/10 text-green-600 dark:text-green-400",
  role_change: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  impersonate: "bg-red-500/10 text-red-600 dark:text-red-400",
}
