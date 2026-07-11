import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

// Next 16: `middleware` was renamed to `proxy` (Node.js runtime, no edge config).
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets and image files, so auth logic
     * never blocks CSS/JS/images from loading.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
