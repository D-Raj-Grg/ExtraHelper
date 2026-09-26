"use client"

import { useActionState, useRef, useState, useTransition } from "react"
import {
  BanIcon,
  ImageIcon,
  ImagePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ReceiptIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  removeExpenseReceipt,
  updateExpense,
  uploadExpenseReceipt,
  voidExpense,
  type ExpenseState,
} from "@/app/(app)/expenses/actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  paidFromLabel,
  RECEIPT_ACCEPT,
  type ExpenseCategory,
  type ExpenseRow,
  type PaidFrom,
} from "@/lib/expense-constants"
import { formatTime, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ExpenseFields } from "./expense-fields"

/**
 * The day's entries. Editors are held open by id and read the row from the
 * live list, so a revalidation never leaves a dialog showing stale figures.
 */
export function ExpenseList({
  expenses,
  categories,
  currency,
  timezone,
  showBy,
}: {
  expenses: ExpenseRow[]
  categories: ExpenseCategory[]
  currency: string
  timezone: string
  showBy: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const editing = expenses.find((e) => e.id === editingId) ?? null
  const voiding = expenses.find((e) => e.id === voidingId) ?? null

  // One hidden picker for the whole list; the menu says which row it's for.
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachFor, setAttachFor] = useState<string | null>(null)
  const [photoPending, startPhoto] = useTransition()

  const pickPhoto = (id: string) => {
    setAttachFor(id)
    fileRef.current?.click()
  }

  const onPhoto = (file: File | undefined) => {
    const id = attachFor
    if (fileRef.current) fileRef.current.value = ""
    if (!file || !id) return
    startPhoto(async () => {
      const fd = new FormData()
      fd.set("id", id)
      fd.set("receipt", file)
      const result = await uploadExpenseReceipt(fd)
      if (result && "error" in result) toast.error(result.error)
      else toast.success("Receipt attached")
    })
  }

  const removePhoto = (id: string) =>
    startPhoto(async () => {
      const result = await removeExpenseReceipt(id)
      if (result && "error" in result) toast.error(result.error)
      else toast.success("Receipt removed")
    })

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
        <ReceiptIcon className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-medium">Nothing logged for this day</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Every time someone spends restaurant money — rice, gas, a ride for staff — add it on the
          left. It lands in tonight&apos;s count on Day close.
        </p>
      </div>
    )
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(ev) => onPhoto(ev.target.files?.[0])}
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Time</TableHead>
              <TableHead className="px-3 py-2 font-medium">What</TableHead>
              <TableHead className="px-3 py-2 font-medium">Paid from</TableHead>
              {showBy ? <TableHead className="px-3 py-2 font-medium">By</TableHead> : null}
              <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
              <TableHead className="w-12 px-3 py-2">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id} className={cn(e.voided && "text-muted-foreground")}>
                <TableCell className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatTime(e.created_at, timezone)}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <span className={cn("block font-medium", e.voided && "line-through")}>
                    {e.note}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.category}</span>
                  {e.receipt_url ? (
                    <a
                      href={e.receipt_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <ImageIcon className="size-3" aria-hidden />
                      Receipt
                    </a>
                  ) : null}
                  {e.voided ? (
                    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <Badge variant="outline">
                        <BanIcon className="size-3" aria-hidden />
                        Voided
                      </Badge>
                      {e.void_reason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-2 whitespace-nowrap">
                  {paidFromLabel(e.paid_from)}
                </TableCell>
                {showBy ? (
                  <TableCell className="px-3 py-2 text-muted-foreground">{e.by ?? "—"}</TableCell>
                ) : null}
                <TableCell
                  className={cn(
                    "px-3 py-2 text-right font-medium tabular-nums",
                    e.voided && "line-through",
                  )}
                >
                  {money(e.amount_cents, currency)}
                </TableCell>
                <TableCell className="px-1 py-1 text-right">
                  {!e.voided && (e.editable || e.can_attach) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label={`Actions for ${e.note}`}
                            disabled={photoPending && attachFor === e.id}
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {e.editable ? (
                          <DropdownMenuItem onClick={() => setEditingId(e.id)}>
                            <PencilIcon />
                            Edit
                          </DropdownMenuItem>
                        ) : null}
                        {e.can_attach ? (
                          <DropdownMenuItem onClick={() => pickPhoto(e.id)}>
                            <ImagePlusIcon />
                            {e.receipt_url ? "Replace receipt photo" : "Attach receipt photo"}
                          </DropdownMenuItem>
                        ) : null}
                        {e.can_attach && e.receipt_url ? (
                          <DropdownMenuItem onClick={() => removePhoto(e.id)}>
                            <Trash2Icon />
                            Remove receipt photo
                          </DropdownMenuItem>
                        ) : null}
                        {e.editable ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setVoidingId(e.id)}
                          >
                            <BanIcon />
                            Void
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <EditExpenseDialog
          key={editing.id}
          expense={editing}
          categories={categories}
          currency={currency}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      {voiding ? (
        <VoidExpenseDialog
          key={voiding.id}
          expense={voiding}
          currency={currency}
          onClose={() => setVoidingId(null)}
        />
      ) : null}
    </>
  )
}

function EditExpenseDialog({
  expense,
  categories,
  currency,
  onClose,
}: {
  expense: ExpenseRow
  categories: ExpenseCategory[]
  currency: string
  onClose: () => void
}) {
  const [category, setCategory] = useState(expense.category_id)
  const [paidFrom, setPaidFrom] = useState<PaidFrom>(expense.paid_from)
  // An archived category stays pickable on the row that already uses it.
  const options = categories.some((c) => c.id === expense.category_id)
    ? categories
    : [...categories, { id: expense.category_id, name: expense.category, archived: true }]

  const [state, action, pending] = useActionState<ExpenseState, FormData>(
    async (prev, formData) => {
      const result = await updateExpense(prev, formData)
      if (result && "ok" in result) {
        toast.success("Expense updated")
        onClose()
      }
      return result
    },
    undefined,
  )

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent size="md">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>Edit expense</DialogTitle>
            <DialogDescription>The change is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <input type="hidden" name="id" value={expense.id} />
            <ExpenseFields
              idPrefix="edit-expense"
              currency={currency}
              categories={options}
              category={category}
              onCategory={setCategory}
              paidFrom={paidFrom}
              onPaidFrom={setPaidFrom}
              defaultAmount={(expense.amount_cents / 100).toString()}
              defaultNote={expense.note}
            />
            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VoidExpenseDialog({
  expense,
  currency,
  onClose,
}: {
  expense: ExpenseRow
  currency: string
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Void {money(expense.amount_cents, currency)} — {expense.note}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            It stops counting toward the day&apos;s expenses and expected cash. The entry stays
            visible, struck through, with your reason.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="void-reason">Reason</FieldLabel>
          <Input
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={280}
            placeholder="Entered twice"
            className="h-11"
            autoFocus
          />
          {error ? (
            <FieldDescription className="text-destructive" role="alert">
              {error}
            </FieldDescription>
          ) : null}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11"
            disabled={pending || !reason.trim()}
            onClick={() =>
              start(async () => {
                const result = await voidExpense(expense.id, reason)
                if (result && "error" in result) {
                  setError(result.error)
                  return
                }
                toast.success("Expense voided")
                onClose()
              })
            }
          >
            {pending ? "Voiding…" : "Void expense"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
