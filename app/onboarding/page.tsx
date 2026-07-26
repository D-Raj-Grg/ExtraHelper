import { redirect } from "next/navigation"
import { OnboardingForm } from "@/components/onboarding-form"
import { createClient } from "@/lib/supabase/server"
import {
  getActiveTenant,
  getTenantMemberships,
  getPendingMemberships,
} from "@/lib/supabase/tenant"
import { getProfile } from "@/lib/supabase/profile"

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { add } = await searchParams
  const isAdd = add === "1"

  // Already onboarded → dashboard, UNLESS explicitly adding another restaurant.
  const tenant = await getActiveTenant()
  if (tenant && !isAdd) redirect("/")

  const [profile, memberships, pending] = await Promise.all([
    getProfile(),
    getTenantMemberships(),
    getPendingMemberships(),
  ])
  const defaultName =
    (user.user_metadata?.restaurant_name as string | undefined) ?? ""

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-md">
        <OnboardingForm
          defaultName={defaultName}
          isAdd={isAdd}
          hasTenant={Boolean(tenant)}
          profile={{
            fullName: profile?.fullName ?? null,
            username: profile?.username ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            email: profile?.email ?? null,
          }}
          memberships={memberships}
          pending={pending}
        />
      </div>
    </div>
  )
}
