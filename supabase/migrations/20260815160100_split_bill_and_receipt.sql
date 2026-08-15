-- Split "bill" into two documents, part 2 of 2: routing and the settle trigger.
--
-- `bill`    — the estimate a cashier presents before a rupee moves.
-- `receipt` — what comes out once the bill is settled.
--
-- They are two switches now because they are two decisions. A counter that
-- hands over a printed bill still may not want a second slip after a card tap,
-- and a takeaway till may want the receipt and never the estimate.
--
-- Existing tenants keep exactly the behaviour they have: every printer that
-- carries `bill` today is given `receipt` as well, same copy count. Turning one
-- off is then a deliberate act in the setup screen, not something this
-- migration decides for them.

-- ---------------------------------------------------------------------------
-- Carry every existing assignment across.
-- ---------------------------------------------------------------------------

insert into public.printer_documents (tenant_id, printer_id, doc, copies)
select pd.tenant_id, pd.printer_id, 'receipt'::public.print_doc, pd.copies
  from public.printer_documents pd
 where pd.doc = 'bill'
on conflict (printer_id, doc) do nothing;

-- ---------------------------------------------------------------------------
-- enqueue_print_job: the new doc is a checkout document too.
-- ---------------------------------------------------------------------------
--
-- Same argument list, so the existing grants carry over — changing the arity
-- would create an overload and leave the old body live.
--
-- The `bill_printed_at` stamp stays on `bill` alone. A receipt is history: it
-- says what was paid, not what the guest is holding while they decide, so
-- stamping it would make the checkout screen claim a slip went stale when it
-- never went out.

create or replace function public.enqueue_print_job(
  _tenant    uuid,
  _doc       public.print_doc,
  _printer_id uuid,
  _kot_id    uuid,
  _bill_id   uuid,
  _order_id  uuid,
  _copies    integer,
  _idem      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _job uuid; _branch uuid; _needed text;
begin
  if _tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin() then
    raise exception 'unknown restaurant' using errcode = '42501';
  end if;

  _needed := case
    when _doc in ('kot', 'bot', 'full_kot', 'order_slip') then 'order.view'
    when _doc in ('bill', 'receipt') then 'checkout.view'
    else 'settings.edit'
  end;
  if not public.has_permission(_tenant, _needed) then
    raise exception 'not authorized to print this' using errcode = '42501';
  end if;

  select coalesce(o.branch_id, b.branch_id) into _branch
    from (select 1) x
    left join public.orders o on o.id = _order_id
    left join public.bills  b on b.id = _bill_id;

  insert into public.print_jobs (
    tenant_id, printer_id, doc, kot_id, bill_id, order_id, branch_id, copies, idempotency_key
  ) values (
    _tenant, _printer_id, _doc, _kot_id, _bill_id, _order_id, _branch,
    greatest(1, least(5, coalesce(_copies, 1))), _idem
  )
  on conflict do nothing
  returning id into _job;

  if _job is null and _idem is not null then
    select id into _job from public.print_jobs
     where tenant_id = _tenant and idempotency_key = _idem;
  end if;

  -- The bill went out on paper. Remember what it said.
  if _doc = 'bill' and _bill_id is not null and _job is not null then
    update public.bills
       set bill_printed_at = now(),
           bill_printed_total_cents = total_cents
     where id = _bill_id
       and tenant_id = _tenant
       and status in ('open', 'partial');
  end if;

  return _job;
end $$;

-- ---------------------------------------------------------------------------
-- The settle trigger now fires `receipt`, and only `receipt`.
-- ---------------------------------------------------------------------------
--
-- A printer carrying `bill` but not `receipt` produces no paper here — which is
-- the point of the split.
--
-- The idempotency key moves to `receipt:<bill>:<printer>` so it can no longer
-- collide with an estimate that was presented on the same printer earlier. Two
-- documents, two keys.

create or replace function public.enqueue_bill_print()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Settled, not created: a receipt for a bill nobody has paid is waste paper.
  if new.status <> 'paid' or old.status = 'paid' then
    return new;
  end if;

  insert into public.print_jobs (
    tenant_id, printer_id, doc, bill_id, branch_id, copies, idempotency_key
  )
  select new.tenant_id, p.id, 'receipt', new.id, new.branch_id, pd.copies,
         'receipt:' || new.id::text || ':' || p.id::text
    from public.printer_documents pd
    join public.printers p on p.id = pd.printer_id
   where pd.tenant_id = new.tenant_id
     and pd.doc = 'receipt'
     and p.is_active
     and (new.branch_id is null or p.branch_id is null or p.branch_id = new.branch_id)
  on conflict do nothing;

  return new;
end $$;
