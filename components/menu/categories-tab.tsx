"use client"

import { useActionState, useState, useTransition } from "react"
import { createCategory, updateCategory } from "@/app/(app)/menu/actions"
import type { MenuState } from "@/app/(app)/menu/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormError, InlineError, type Category } from "./types"

export function CategoriesTab({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState<MenuState, FormData>(createCategory, undefined)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="text-sm text-muted-foreground">
          Menu sections like Starters or Drinks. Items are grouped by these on the ordering screen. Inactive
          categories stay hidden from staff and customers.
        </p>
      </div>

      {categories.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-2 text-left">Name</TableHead>
                <TableHead className="px-4 py-2 text-left">Status</TableHead>
                <TableHead className="px-4 py-2 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <CategoryRow key={c.id} category={c} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No categories yet — add one like “Starters” to group your items.
        </p>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-name">New category</Label>
          <Input id="category-name" name="name" placeholder="e.g. Starters" className="w-56" required />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add category"}
        </Button>
        <FormError state={state} />
      </form>
    </div>
  )
}

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <TableRow className="border-b last:border-0">
      <TableCell className="px-4 py-2">
        {editing ? (
          <>
            <Label htmlFor={`category-edit-${category.id}`} className="sr-only">
              Category name
            </Label>
            <Input
              id={`category-edit-${category.id}`}
              className="h-8 w-48"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </>
        ) : (
          <span className="font-medium">{category.name}</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={category.is_active}
            disabled={pending}
            aria-label={`${category.name} active`}
            onCheckedChange={(v) =>
              startTransition(async () => {
                const res = await updateCategory(category.id, { isActive: Boolean(v) })
                if (res && "error" in res) setErr(res.error)
              })
            }
          />
          Active
        </label>
      </TableCell>
      <TableCell className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await updateCategory(category.id, { name })
                    if (res && "error" in res) setErr(res.error)
                    else setEditing(false)
                  })
                }
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="link"
                onClick={() => {
                  setEditing(false)
                  setName(category.name)
                  setErr(null)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" aria-label={`Rename ${category.name}`} onClick={() => setEditing(true)}>
              Rename
            </Button>
          )}
          <InlineError msg={err} />
        </div>
      </TableCell>
    </TableRow>
  )
}
