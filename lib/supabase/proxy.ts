import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/** Public routes without a session: /t QR dine-in, /s storefront, /book reservations. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/t", "/s", "/book"]
// `/` is the app home (dashboard) — auth-required, not public.
// PWA static files must be fetchable without a session (install + SW register).
const PUBLIC_EXACT: string[] = [
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/favicon.png",
]

function isPublic(pathname: string) {
  if (PUBLIC_EXACT.includes(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

/**
 * Refreshes the Supabase auth session on every request and enforces route
 * protection. Must run before rendering so Server Components see a fresh session.
 *
 * Critical: do not run logic between `createServerClient` and `getUser()` — it
 * can desync tokens and randomly log users out.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Unauthenticated hitting a protected route → login.
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated hitting an auth page → home.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return response
}
