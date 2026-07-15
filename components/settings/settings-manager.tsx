"use client"

import { useActionState, useState } from "react"
import { updateSettings, type SettingsState } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BranchesTab } from "./branches-tab"
import { ChargesTab } from "./charges-tab"
import { GeneralTab } from "./general-tab"
import { ReceiptTab } from "./receipt-tab"
import type { Branch, TaxRule } from "./types"

export function SettingsManager({
  restaurantName,
  currency,
  timezone,
  serviceCharge,
  packagingFee,
  taxRules,
  receipt,
  blockNegativeStock,
  paymentGateway,
  logoUrl,
  branches,
  canManageBranches,
}: {
  restaurantName: string
  currency: string
  timezone: string
  serviceCharge: number
  packagingFee: number
  taxRules: TaxRule[]
  receipt: { header: string; footer: string; terms: string }
  blockNegativeStock: boolean
  paymentGateway: string
  logoUrl: string | null
  branches: Branch[]
  canManageBranches: boolean
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    undefined,
  )
  const [rules, setRules] = useState<TaxRule[]>(taxRules)
  const [tab, setTab] = useState("general")

  // Branches save inline, so the shared save bar would be a dead control there.
  const showSaveBar = tab !== "branches"

  return (
    // Panels stay mounted: the action reads every field from one FormData, so
    // fields on hidden tabs must still submit.
    <form action={formAction}>
      <input type="hidden" name="taxRules" value={JSON.stringify(rules)} />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList variant="line" className="mb-6 w-full justify-start overflow-x-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="charges">Charges &amp; tax</TabsTrigger>
          <TabsTrigger value="receipt">Receipt &amp; branding</TabsTrigger>
          {canManageBranches ? <TabsTrigger value="branches">Branches</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="general" keepMounted>
          <GeneralTab
            restaurantName={restaurantName}
            currency={currency}
            timezone={timezone}
            paymentGateway={paymentGateway}
            blockNegativeStock={blockNegativeStock}
          />
        </TabsContent>
        <TabsContent value="charges" keepMounted>
          <ChargesTab
            serviceCharge={serviceCharge}
            packagingFee={packagingFee}
            rules={rules}
            setRules={setRules}
          />
        </TabsContent>
        <TabsContent value="receipt" keepMounted>
          <ReceiptTab receipt={receipt} logoUrl={logoUrl} />
        </TabsContent>
        {canManageBranches ? (
          <TabsContent value="branches">
            <BranchesTab branches={branches} />
          </TabsContent>
        ) : null}
      </Tabs>

      {showSaveBar ? (
        <div className="sticky bottom-0 z-10 -mx-6 mt-6 flex flex-wrap items-center justify-end gap-3 border-t bg-background/80 px-6 py-3 backdrop-blur md:-mx-10 md:px-10">
          {state && "error" in state ? (
            <p className="mr-auto text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          {state && "ok" in state ? (
            <p className="mr-auto text-sm text-emerald-600 dark:text-emerald-400" role="status">
              Settings saved.
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
