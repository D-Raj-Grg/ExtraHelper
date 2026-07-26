"use client"

import { useActionState } from "react"
import { updateProfile, uploadAvatar, type ProfileState } from "@/app/(app)/profile/actions"
import { initialsFor } from "@/lib/initials"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function Msg({ state }: { state: ProfileState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  if (state && "ok" in state) return <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>
  return null
}

export function ProfileForm({
  fullName,
  username,
  avatarUrl,
  email,
}: {
  fullName: string
  username: string
  avatarUrl: string | null
  email: string
}) {
  const [pState, pAction, pPending] = useActionState<ProfileState, FormData>(updateProfile, undefined)
  const [aState, aAction, aPending] = useActionState<ProfileState, FormData>(uploadAvatar, undefined)

  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-center gap-4">
        <Avatar className="size-16 rounded-lg">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName || email} /> : null}
          <AvatarFallback className="rounded-lg text-lg">{initialsFor(fullName, email)}</AvatarFallback>
        </Avatar>
        <form action={aAction} className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">Avatar (max 3 MB)</label>
          <div className="flex items-center gap-2">
            <Input type="file" name="avatar" accept="image/*" className="max-w-xs" required />
            <Button type="submit" size="sm" variant="secondary" disabled={aPending}>
              {aPending ? "Uploading…" : "Upload"}
            </Button>
          </div>
          <Msg state={aState} />
        </form>
      </section>

      <form action={pAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Full name</label>
          <Input name="fullName" defaultValue={fullName} placeholder="Jane Doe" className="max-w-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Handle</label>
          <div className="flex max-w-sm items-center gap-1">
            <span className="text-muted-foreground">@</span>
            <Input
              name="username"
              defaultValue={username}
              placeholder="janedoe"
              pattern="[a-z0-9_]{3,30}"
              className="flex-1"
            />
          </div>
          <span className="text-xs text-muted-foreground">3–30 chars · lowercase letters, numbers, underscores</span>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Email</label>
          <Input value={email} disabled className="max-w-sm" />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pPending}>
            {pPending ? "Saving…" : "Save profile"}
          </Button>
          <Msg state={pState} />
        </div>
      </form>
    </div>
  )
}
