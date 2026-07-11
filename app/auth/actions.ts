"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type AuthState = { error: string } | { confirm: string } | undefined

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

  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { restaurant_name: restaurantName },
      emailRedirectTo: origin ? `${origin}/auth/confirm?next=/` : undefined,
    },
  })
  if (error) return { error: error.message }

  // Email confirmation enabled → no session yet. Tell the user to check email
  // instead of bouncing to /login (which looks like a silent failure).
  if (!data.session) return { confirm: email }

  revalidatePath("/", "layout")
  redirect("/")
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}
