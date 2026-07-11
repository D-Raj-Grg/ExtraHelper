"use client"

import { useActionState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { login, type AuthState } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { UtensilsCrossedIcon } from "lucide-react"

export function LoginForm({
  className,
  next,
  ...props
}: React.ComponentProps<"div"> & { next?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    undefined,
  )

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form action={formAction}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-8 items-center justify-center rounded-md">
              <UtensilsCrossedIcon className="size-6" />
            </div>
            <h1 className="text-xl font-bold">Sign in to ExtraHelper</h1>
            <FieldDescription>
              Don&apos;t have an account?{" "}
              <Link href="/signup">Sign up</Link>
            </FieldDescription>
          </div>
          <input type="hidden" name="next" value={next ?? ""} />
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
              autoComplete="current-password"
              required
            />
          </Field>
          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Signing in…" : "Login"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
