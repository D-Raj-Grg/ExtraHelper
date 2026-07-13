"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export type ProfileState = { error: string } | { ok: true } | undefined

const USERNAME_RE = /^[a-z0-9_]{3,30}$/

/** Update the signed-in user's profile (display name + @handle). */
export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in." }

  const fullName = String(formData.get("fullName") ?? "").trim()
  const username = String(formData.get("username") ?? "").trim().toLowerCase()
  if (username && !USERNAME_RE.test(username))
    return { error: "Handle must be 3–30 chars: lowercase letters, numbers, underscores." }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName || null, username: username || null })
    .eq("id", user.id)
  if (error) {
    if (error.code === "23505") return { error: "That handle is already taken." }
    return { error: error.message }
  }
  revalidatePath("/profile")
  revalidatePath("/", "layout")
  return { ok: true }
}

/** Upload an avatar image → profiles.avatar_url (avatars bucket, own folder). */
export async function uploadAvatar(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in." }

  const file = formData.get("avatar")
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." }
  if (file.size > 3 * 1024 * 1024) return { error: "Avatar must be under 3 MB." }

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")
  const path = `${user.id}/avatar.${ext}`
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (upErr) return { error: upErr.message }
  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path)
  const url = `${pub.publicUrl}?v=${Date.now()}`

  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id)
  if (error) return { error: error.message }
  revalidatePath("/profile")
  revalidatePath("/", "layout")
  return { ok: true }
}
