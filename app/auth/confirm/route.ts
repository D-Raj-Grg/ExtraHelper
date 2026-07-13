import { type NextRequest, NextResponse } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

/** Only allow same-origin relative redirects — blocks open-redirect via `next`. */
function safeNext(raw: string | null): string {
  const v = raw ?? "/"
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/"
  return v
}

/**
 * Email confirmation / magic-link callback. Handles both the SSR token_hash
 * flow (verifyOtp) and the PKCE code flow (exchangeCodeForSession), then sends
 * the now-signed-in user on to `next`. On failure → /login with an error flag.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type") as EmailOtpType | null
  const code = url.searchParams.get("code")
  const next = safeNext(url.searchParams.get("next"))

  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      // Attach any pending email invites (Google OAuth / magic-link path — the
      // password-login + email-OTP actions already do this).
      await supabase.rpc("claim_invites")
      return NextResponse.redirect(new URL(next, url.origin))
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      await supabase.rpc("claim_invites")
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirm", url.origin))
}
