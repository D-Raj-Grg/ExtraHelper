import { LoginForm } from "@/components/login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams
  const notice =
    error === "confirm"
      ? "That confirmation link was invalid or expired. Please sign in, or sign up again."
      : undefined
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm next={next} notice={notice} />
      </div>
    </div>
  )
}
