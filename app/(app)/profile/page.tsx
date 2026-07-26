import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { ProfileForm } from "@/components/profile-form"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  const profile = await getProfile()
  if (!profile) redirect("/login")

  return (
    <PageShell width="narrow">
      <PageHeader title="Your profile" description="Your name, handle and avatar." />
      <ProfileForm
        fullName={profile.fullName ?? ""}
        username={profile.username ?? ""}
        avatarUrl={profile.avatarUrl}
        email={profile.email ?? ""}
      />
    </PageShell>
  )
}
