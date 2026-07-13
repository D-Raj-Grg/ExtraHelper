"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  login,
  sendEmailOtp,
  signInWithGoogle,
  verifyEmailOtp,
  type AuthState,
} from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { UtensilsCrossedIcon } from "lucide-react"

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}

export function LoginForm({
  className,
  next,
  notice,
  ...props
}: React.ComponentProps<"div"> & { next?: string; notice?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    undefined,
  )
  const [showOtp, setShowOtp] = useState(false)

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
          {notice ? (
            <p className="text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}
          {state && "error" in state ? (
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

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-3">
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next ?? ""} />
          <Button type="submit" variant="outline" className="w-full">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>

        {showOtp ? (
          <EmailOtp next={next} />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setShowOtp(true)}
          >
            Sign in with a code
          </Button>
        )}
      </div>
    </div>
  )
}

function EmailOtp({ next }: { next?: string }) {
  const [sendState, sendAction, sending] = useActionState<AuthState, FormData>(
    sendEmailOtp,
    undefined,
  )
  const [verifyState, verifyAction, verifying] = useActionState<
    AuthState,
    FormData
  >(verifyEmailOtp, undefined)

  const sentEmail = sendState && "otpSent" in sendState ? sendState.otpSent : null

  if (sentEmail) {
    return (
      <form action={verifyAction}>
        <FieldGroup>
          <input type="hidden" name="next" value={next ?? ""} />
          <input type="hidden" name="email" value={sentEmail} />
          <Field>
            <FieldLabel htmlFor="otp-token">Enter code</FieldLabel>
            <Input
              id="otp-token"
              name="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              required
            />
            <FieldDescription>
              We emailed a 6-digit code to{" "}
              <span className="font-medium">{sentEmail}</span>.
            </FieldDescription>
          </Field>
          {verifyState && "error" in verifyState ? (
            <p className="text-sm text-destructive" role="alert">
              {verifyState.error}
            </p>
          ) : null}
          <Field>
            <Button type="submit" disabled={verifying}>
              {verifying ? "Verifying…" : "Verify"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    )
  }

  return (
    <form action={sendAction}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="otp-email">Email</FieldLabel>
          <Input
            id="otp-email"
            name="email"
            type="email"
            placeholder="m@example.com"
            autoComplete="email"
            required
          />
        </Field>
        {sendState && "error" in sendState ? (
          <p className="text-sm text-destructive" role="alert">
            {sendState.error}
          </p>
        ) : null}
        <Field>
          <Button type="submit" variant="outline" disabled={sending}>
            {sending ? "Sending…" : "Send code"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
