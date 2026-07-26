"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type AuthState =
  | { error: string }
  | { confirm: string }
  | { otpSent: string }
  | undefined

// Basic shape check — the real gate is Supabase, but this catches typos early.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Turn Supabase's terse auth errors into guidance the user can act on. */
function friendlyAuthError(err: { code?: string; message: string }): string {
  const code = err.code ?? ""
  const msg = err.message.toLowerCase()
  if (code === "email_address_invalid" || (msg.includes("email") && msg.includes("invalid"))) {
    return "That email address was rejected. Some domains (e.g. .dev, .local, disposable addresses) aren't accepted — try another email."
  }
  if (code === "user_already_exists" || msg.includes("already registered")) {
    return "An account with this email already exists. Try signing in instead."
  }
  if (code === "weak_password" || msg.includes("password")) {
    return "That password was rejected. Use at least 8 characters with a mix of letters and numbers."
  }
  return err.message
}

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

  // Attach any pending staff invites for this (verified) email → pending
  // membership awaiting admin approval.
  await supabase.rpc("claim_invites")

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
  const fullName = String(formData.get("fullName") ?? "").trim()

  if (!email || !password) return { error: "Email and password are required." }
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." }
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." }

  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // full_name feeds the profiles row via the handle_new_user trigger.
      data: { restaurant_name: restaurantName, full_name: fullName },
      emailRedirectTo: origin ? `${origin}/auth/confirm?next=/` : undefined,
    },
  })
  if (error) return { error: friendlyAuthError(error) }

  // Email confirmation enabled → no session yet. Tell the user to check email
  // instead of bouncing to /login (which looks like a silent failure).
  if (!data.session) return { confirm: email }

  revalidatePath("/", "layout")
  redirect("/")
}

/** Resend the signup confirmation email. */
export async function resendConfirmation(email: string): Promise<AuthState> {
  const clean = email.trim()
  if (!clean) return { error: "Email is required." }

  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: clean,
    options: {
      emailRedirectTo: origin ? `${origin}/auth/confirm?next=/` : undefined,
    },
  })
  if (error) return { error: error.message }
  return { confirm: clean }
}

/**
 * Passwordless email OTP — step 1. Sends a 6-digit code to an existing account.
 * `shouldCreateUser: false` keeps the login surface for existing accounts only;
 * new accounts go through /signup.
 */
export async function sendEmailOtp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  if (!email || !EMAIL_RE.test(email))
    return { error: "Enter a valid email address." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) return { error: friendlyAuthError(error) }

  return { otpSent: email }
}

/**
 * Passwordless email OTP — step 2. Verifies the 6-digit code and signs the user
 * in, then redirects to `next` (or home) on success.
 */
export async function verifyEmailOtp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim()
  const token = String(formData.get("token") ?? "").trim()
  const next = safeNext(String(formData.get("next") ?? "") || "/")

  if (!email || !token) return { error: "Enter the code we emailed you." }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  })
  if (error) return { error: friendlyAuthError(error) }

  // Attach any pending staff invites for this (now-verified) email.
  await supabase.rpc("claim_invites")

  revalidatePath("/", "layout")
  redirect(next)
}

/**
 * Google OAuth. Kicks off the PKCE flow and redirects the browser to Google's
 * consent screen. Google redirects back to /auth/confirm, which exchanges the
 * code for a session. Returns void (always redirects).
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get("next") ?? "") || "/")
  const origin = (await headers()).get("origin") ?? ""

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  })

  if (error || !data?.url) redirect("/login?error=oauth")
  redirect(data.url)
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}
