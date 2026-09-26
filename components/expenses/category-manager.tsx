"use client"

import { useState, useTransition } from "react"
import { ArchiveIcon, CheckIcon, PlusIcon, TagsIcon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"

import { archiveExpenseCategory, saveExpenseCategory } from "@/app/(app)/expenses/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { ExpenseCategory } from "@/lib/expense-constants"

/**
 * Add, rename and retire expense categories. Retired, not deleted: past
 * entries keep their category and the day-close totals keep their labels.
 */
export function CategoryManager({ categories }: { categories: ExpenseCategory[] }) {
  const [newName, setNewName] = useState("")
  const [pending, start] = useTransition()

  const run = (work: () => Promise<{ error: string } | { ok: true } | undefined>, done: string) =>
    start(async () => {
      const result = await work()
      if (result && "error" in result) toast.error(result.error)
      else toast.success(done)
    })

  const active = categories.filter((c) => !c.archived)
  const archived = categories.filter((c) => c.archived)

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" className="h-11">
            <TagsIcon className="size-4" />
            Categories
          </Button>
        }
      />
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Expense categories</DialogTitle>
          <DialogDescription>
            What staff pick from when they log a spend. Retiring one hides it from the form; past
            entries keep it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = newName
              run(async () => {
                const r = await saveExpenseCategory(null, name)
                if (r && "ok" in r) setNewName("")
                return r
              }, "Category added")
            }}
          >
            <Field className="flex-1">
              <FieldLabel htmlFor="new-category">New category</FieldLabel>
              <Input
                id="new-category"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={60}
                placeholder="Cooking oil"
                className="h-11"
              />
            </Field>
            <Button type="submit" className="h-11" disabled={pending || !newName.trim()}>
              <PlusIcon className="size-4" />
              Add
            </Button>
          </form>

          <ul className="divide-y rounded-lg border">
            {active.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                disabled={pending}
                onRename={(name) => run(() => saveExpenseCategory(c.id, name), "Renamed")}
                onArchive={() => run(() => archiveExpenseCategory(c.id), `Retired ${c.name}`)}
              />
            ))}
          </ul>

          {archived.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">Retired</p>
              <ul className="divide-y rounded-lg border">
                {archived.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1">
                    <span className="text-sm text-muted-foreground">{c.name}</span>
                    <Button
                      variant="ghost"
                      className="h-11"
                      disabled={pending}
                      onClick={() =>
                        run(() => saveExpenseCategory(c.id, c.name), `Restored ${c.name}`)
                      }
                    >
                      <Undo2Icon className="size-4" />
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function CategoryRow({
  category,
  disabled,
  onRename,
  onArchive,
}: {
  category: ExpenseCategory
  disabled: boolean
  onRename: (name: string) => void
  onArchive: () => void
}) {
  const [name, setName] = useState(category.name)
  const dirty = name.trim() !== category.name && name.trim() !== ""

  return (
    <li className="flex items-center gap-2 px-3 py-1">
      <Input
        aria-label={`Rename ${category.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        className="h-11 flex-1 border-transparent shadow-none focus-visible:border-ring"
      />
      {dirty ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Save name for ${category.name}`}
          disabled={disabled}
          onClick={() => onRename(name)}
        >
          <CheckIcon />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`Retire ${category.name}`}
        disabled={disabled}
        onClick={onArchive}
      >
        <ArchiveIcon />
      </Button>
    </li>
  )
}
