"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type AuthState = { error: string } | undefined

/** Only allow same-origin relative redirects — blocks open-redirect via `next`. */
function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/"
  }
  return raw
}

/** Email + password login. Redirects to `next` (or home) on success. */
export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = safeNext(String(formData.get("next") ?? "") || "/")

  if (!email || !password) return { error: "Email and password are required." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  revalidatePath("/", "layout")
  redirect(next)
}

/**
 * Sign up a new account. The restaurant name is stashed in user metadata so the
 * tenant onboarding wizard (Milestone 0) can provision the tenant afterwards.
 */
export async function signup(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const restaurantName = String(formData.get("restaurantName") ?? "").trim()

  if (!email || !password) return { error: "Email and password are required." }
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { restaurant_name: restaurantName } },
  })
  if (error) return { error: error.message }

  revalidatePath("/", "layout")
  // If email confirmation is enabled the session isn't active yet; the login
  // page surfaces that. Otherwise the proxy sends them on to the home page.
  redirect("/")
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}
