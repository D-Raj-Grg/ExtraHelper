"use client"

import { useActionState, useState, useTransition } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { resendConfirmation, signup, type AuthState } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { UtensilsCrossedIcon } from "lucide-react"

export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signup,
    undefined,
  )

  if (state && "confirm" in state) {
    return <ConfirmScreen email={state.confirm} className={className} {...props} />
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form action={formAction}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-8 items-center justify-center rounded-md">
              <UtensilsCrossedIcon className="size-6" />
            </div>
            <h1 className="text-xl font-bold">Create your ExtraHelper account</h1>
            <FieldDescription>
              Already have an account? <Link href="/login">Sign in</Link>
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="fullName">Your name</FieldLabel>
            <Input
              id="fullName"
              name="fullName"
              type="text"
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="restaurantName">Restaurant name</FieldLabel>
            <Input
              id="restaurantName"
              name="restaurantName"
              type="text"
              placeholder="Acme Diner"
              autoComplete="organization"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="m@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <FieldDescription>At least 8 characters.</FieldDescription>
          </Field>
          {state && "error" in state ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating account…" : "Create Account"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        By creating an account, you agree to our{" "}
        <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  )
}

function ConfirmScreen({
  email,
  className,
  ...props
}: React.ComponentProps<"div"> & { email: string }) {
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState<string | null>(null)

  function resend() {
    setNote(null)
    startTransition(async () => {
      const res = await resendConfirmation(email)
      setNote(res && "error" in res ? res.error : "Sent — check your inbox again.")
    })
  }

  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", className)} {...props}>
      <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
        <UtensilsCrossedIcon className="size-6" />
      </div>
      <h1 className="text-xl font-bold">Check your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a confirmation link to <span className="font-medium">{email}</span>. Click it to
        activate your account, then sign in.
      </p>
      {note ? (
        <p className="text-sm text-muted-foreground" role="status">
          {note}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button variant="outline" disabled={pending} onClick={resend}>
          {pending ? "Resending…" : "Resend confirmation email"}
        </Button>
        <Button nativeButton={false} render={<Link href="/login" />}>
          Back to sign in
        </Button>
      </div>
    </div>
  )
}
