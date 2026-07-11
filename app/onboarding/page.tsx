import { redirect } from "next/navigation"
import { OnboardingForm } from "@/components/onboarding-form"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant } from "@/lib/supabase/tenant"

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Already onboarded → straight to the dashboard.
  const tenant = await getActiveTenant()
  if (tenant) redirect("/")

  const defaultName =
    (user.user_metadata?.restaurant_name as string | undefined) ?? ""

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <OnboardingForm defaultName={defaultName} />
      </div>
    </div>
  )
}
