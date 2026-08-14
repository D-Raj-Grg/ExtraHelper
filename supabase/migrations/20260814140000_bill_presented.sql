-- Presenting the bill is a step, not a side effect of taking money.
--
-- The real sequence at a table is: the guest asks for the bill, a slip goes out,
-- the guest checks it, and only then do they hand over cash or a card. Until now
-- the only paper this system produced for a bill came *after* `status` flipped
-- to `paid` (see `enqueue_bill_print`), so the slip the guest actually reads was
-- either printed from a browser page or not at all.
--
-- A cashier can now queue the estimate at any point. Nothing is locked by doing
-- so — a table that orders another round after asking for the bill is normal,
-- and a lock would make the app fight the floor. Instead we remember *what was
-- on the slip that went out*, so the screen can say "this changed since you
-- printed it" and offer a reprint. That is the whole feature: a fact, not a
-- gate.
--
-- Two columns rather than one: a timestamp alone cannot answer "did it change",
-- because `recompute_bill` does not touch `updated_at` and a note edit would
-- read the same as a new round of drinks. The total that was on the paper is the
-- only thing that settles it.

alter table public.bills
  add column if not exists bill_printed_at timestamptz,
  add column if not exists bill_printed_total_cents integer;

comment on column public.bills.bill_printed_at is
  'When an estimate was last queued for this bill. Null until one is.';
comment on column public.bills.bill_printed_total_cents is
  'The total on that estimate. Differs from total_cents once the bill moves on.';

-- ---------------------------------------------------------------------------
-- Stamp it where the paper is actually asked for.
-- ---------------------------------------------------------------------------
--
-- Inside `enqueue_print_job` rather than in a second RPC the clients call after
-- it: both front ends already queue through this one function, and a stamp that
-- lives beside the insert cannot be forgotten by a caller or land without the
-- job. Same argument list, so the existing grants carry over — changing the
-- arity would have created an overload and left the old body live.
--
-- Only an unsettled bill is stamped. A reprint of a paid receipt is history, not
-- a bill being presented, and stamping it would make the screen claim the guest
-- is holding a slip that is out of date.

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
    when _doc = 'bill' then 'checkout.view'
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
