"use client"

import { useRef, useState, useTransition } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { createBranch, deleteBranch, updateBranch } from "@/app/(app)/settings/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { Branch } from "./types"

/**
 * Branch rows save on blur and the add-row posts on click — neither can be a
 * nested <form>, since the whole tab set lives inside the settings form.
 */
export function BranchesTab({ branches }: { branches: Branch[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)

  const runUpdate = (id: string, fields: { name?: string; address?: string | null }) =>
    startTransition(async () => {
      const res = await updateBranch(id, fields)
      setError(res && "error" in res ? res.error : null)
    })
  const runDelete = (id: string) =>
    startTransition(async () => {
      const res = await deleteBranch(id)
      setError(res && "error" in res ? res.error : null)
    })
  const runCreate = () => {
    const name = nameRef.current?.value.trim() ?? ""
    if (!name) {
      setError("Branch name is required.")
      nameRef.current?.focus()
      return
    }
    const fd = new FormData()
    fd.set("name", name)
    fd.set("address", addressRef.current?.value ?? "")
    startTransition(async () => {
      const res = await createBranch(undefined, fd)
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      setError(null)
      if (nameRef.current) nameRef.current.value = ""
      if (addressRef.current) addressRef.current.value = ""
    })
  }

  return (
    <Card className="lg:max-w-3xl">
      <CardHeader>
        <CardTitle>Branches</CardTitle>
        <CardDescription>
          Locations for this restaurant. Edits save when you leave a field; the default branch
          anchors existing data and can&apos;t be renamed or removed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {branches.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Branch name: ${b.name}`}
                defaultValue={b.name}
                disabled={b.is_default || pending}
                onBlur={(e) =>
                  !b.is_default && e.target.value !== b.name
                    ? runUpdate(b.id, { name: e.target.value })
                    : undefined
                }
                className="min-w-32 flex-1"
              />
              <Input
                aria-label={`Address of ${b.name}`}
                placeholder="Address"
                defaultValue={b.address ?? ""}
                disabled={b.is_default || pending}
                onBlur={(e) =>
                  !b.is_default && e.target.value !== (b.address ?? "")
                    ? runUpdate(b.id, { address: e.target.value })
                    : undefined
                }
                className="min-w-32 flex-1"
              />
              {b.is_default ? (
                <Badge variant="secondary">Default</Badge>
              ) : (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => runDelete(b.id)}
                  aria-label={`Delete branch ${b.name}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </div>
          ))}

          <div className="mt-1 flex flex-wrap items-end gap-2 border-t pt-4">
            <Input
              ref={nameRef}
              aria-label="New branch name"
              placeholder="New branch name"
              className="min-w-32 flex-1"
            />
            <Input
              ref={addressRef}
              aria-label="New branch address"
              placeholder="Address (optional)"
              className="min-w-32 flex-1"
            />
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={runCreate}>
              <PlusIcon className="size-4" /> {pending ? "Adding…" : "Add branch"}
            </Button>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
