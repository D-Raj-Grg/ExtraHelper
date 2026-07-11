"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type OnboardingState = { error: string } | undefined

/**
 * Provision the caller's restaurant: creates tenant + settings + default branch
 * + owner membership atomically via the `provision_tenant` SECURITY DEFINER
 * function (authenticated users can't INSERT tenants directly under RLS).
 * Idempotent — a user who already has a tenant is sent straight to the dashboard.
 */
export async function provisionTenant(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("restaurantName") ?? "").trim()
  const currency = String(formData.get("currency") ?? "USD").trim()
  const timezone = String(formData.get("timezone") ?? "UTC").trim()

  if (!name) return { error: "Restaurant name is required." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { error } = await supabase.rpc("provision_tenant", {
    _name: name,
    _currency: currency,
    _timezone: timezone,
  })
  if (error) return { error: error.message }

  revalidatePath("/", "layout")
  redirect("/")
}
