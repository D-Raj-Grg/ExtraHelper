import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { BookForm } from "@/components/book-form"

export const dynamic = "force-dynamic"

export default async function BookPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc("storefront_menu", { _slug: slug })
  if (!data) notFound()
  const store = data as { tenant_name: string; timezone?: string }
  const name = store.tenant_name
  const timezone = store.timezone ?? "UTC"

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background p-6">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold">{name}</h1>
        <p className="text-sm text-muted-foreground">Book a table</p>
      </div>
      <BookForm slug={slug} timezone={timezone} />
    </div>
  )
}
