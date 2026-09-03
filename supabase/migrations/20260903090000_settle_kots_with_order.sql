-- ============================================================================
-- A settled order leaves its kitchen tickets on the board forever.
--
-- The KDS board (app/(app)/kds/page.tsx) filters `kots` on ticket status alone
-- -- no order-status filter, no date bound -- and nothing in the checkout path
-- has ever written `kots` or `kot_items`. `sync_order_status_from_kots` flows
-- kitchen -> order and explicitly refuses to touch billed/closed/cancelled;
-- there is no reverse sync. So a ticket the kitchen never bumped stays on the
-- screen after the guest has paid and gone, and every cook learns to ignore the
-- bottom of the list.
--
-- The rule already existed twice, both times as a CLIENT-SIDE display filter
-- with `kots.status` still saying 'new' in the database:
--   * isKotCompleted()          -- lib/pos-constants.ts, the POS KOT tab
--   * KdsTicket.isCompleted     -- Flutter, lib/data/supabase/kds_repository.dart
-- The KDS board is the one surface that never got it. This puts the rule in
-- Postgres so every client, the printer and the reports share one answer.
--
-- WHY A TRIGGER AND NOT A PATCH PER RPC
-- 14 SQL sites write orders.status to billed/closed/cancelled (record_payment,
-- create_bill_for_order, add_order_to_bill, public_pay_order,
-- redeem_points_for_bill, cancel_order and their historical redefinitions) AND
-- app/api/webhooks/[gateway]/route.ts writes orders.status='closed' directly
-- with the service role, bypassing every RPC. One trigger on `orders` is the
-- only choke point that catches all of them.
--
-- THE RULE
--   order -> closed / cancelled : sweep ALL live tickets. The money is in, or
--                                 the order is dead. Nothing more gets cooked.
--   order -> billed             : sweep only the tickets that already exist at
--                                 that instant.
--
-- `billed` is included because leave_bill_on_credit (20260820120000) is a real
-- checkout -- guest gone, tables freed -- that leaves the order on `billed`
-- permanently. A closed-only rule strands those tickets forever.
--
-- `billed` can NOT be a blanket status filter, which is why the sweep happens
-- at the transition rather than at read time: the amend RPCs (20260816090000,
-- 20260817090000) add items to a billed-but-unpaid order and fire a REAL new
-- ticket. Treating `billed` as history would hide food the guest is being
-- charged for. A ticket inserted after this sweep is simply not in the swept
-- set, so it stays live. 7 such post-bill tickets exist in production today --
-- this is not a theoretical case.
--
-- THE `when` CLAUSE IS LOAD-BEARING, NOT HYGIENE.
-- `update orders set status = 'closed' where bill_id = _bill_id` (seven call
-- sites) writes the column on EVERY order on the bill, including ones already
-- closed -- and `after update of status` fires on the column being ASSIGNED,
-- not on it changing. Without `old.status is distinct from new.status` a repeat
-- write would re-sweep and eat a post-bill amend ticket, i.e. exactly the case
-- the rule exists to protect.
--
-- Two conventions carried over from the existing ticket writers (set_kot_status,
-- set_kot_item_status in 20260731140000 / 20260722091000):
--   * a VOIDED line is never moved;
--   * `recalled` is treated as live work.
-- On `recalled` this DELIBERATELY differs from mark_order_served, which skips
-- recalled in all cases: that function runs mid-service, where a recalled
-- ticket means a cook is actively re-working a dish. Here, on `closed` or
-- `cancelled` the guest has paid or the order is abandoned, so a recalled
-- ticket is swept -- it is the single most likely stale survivor, because
-- recall_kot is what puts a ticket back on the board after it was bumped. On
-- `billed` it is left alone, for the same reason post-bill amend tickets are.
--
-- Deliberately does NOT call sync_order_status_from_kots: it has nothing to do
-- for an order in these states, and it raises 42501 when auth.uid() is null --
-- which is precisely the service-role webhook path this trigger exists to cover.
-- ============================================================================

-- 1) Indexes. Neither existed. The trigger runs on the hot checkout path and
--    both the trigger and the backfill join on these columns;
--    idx_kots_tenant(tenant_id, created_at desc) serves neither. Without them
--    every bill close seq-scans the tenant's whole ticket history -- the same
--    unbounded-growth shape as the bug being fixed.
--    Plain `create index`, not `concurrently`: apply_migration runs inside a
--    transaction and CONCURRENTLY is rejected there (25001). At 191/302 rows
--    the SHARE lock is a non-event.
create index if not exists idx_kots_order on public.kots(order_id);
create index if not exists idx_kot_items_kot on public.kot_items(kot_id);

-- 2) The sweep.
--
-- security definer is required, not stylistic: kots/kot_items carry
-- apply_tenant_rls (tenant_id in current_tenant_ids()). public_pay_order is
-- reachable by `anon`, who is not a member of any tenant, and the service-role
-- webhook runs with no auth.uid() at all. Under the default SECURITY INVOKER
-- the nested updates would be evaluated against the caller's RLS and could fail
-- silently. Both tables are owned by postgres with relforcerowsecurity = false,
-- so a definer body owned by postgres bypasses the policy.
create or replace function public.settle_kots_with_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ticket headers. A ticket whose lines were all voided still leaves the board.
  update public.kots k
     set status = 'served'
   where k.order_id  = new.id
     and k.tenant_id = new.tenant_id
     and k.status <> 'served'
     and (new.status <> 'billed' or k.status <> 'recalled');

  -- Lines. Never move a voided line (the set_kot_status rule), and mirror the
  -- header's `recalled` carve-out so a ticket and its dishes cannot disagree.
  update public.kot_items ki
     set status = 'served'
   where ki.tenant_id = new.tenant_id
     and ki.status <> 'served'
     and (new.status <> 'billed' or ki.status <> 'recalled')
     and exists (
       select 1 from public.kots k
        where k.id = ki.kot_id and k.order_id = new.id
     )
     and not exists (
       select 1 from public.order_items oi
        where oi.id = ki.order_item_id and oi.is_void
     );

  return null;  -- after trigger: return value is ignored
end $$;

-- Trigger functions are not callable through PostgREST and PostgreSQL does not
-- check EXECUTE when a trigger fires, so this is revoked with no grant back --
-- the same posture as trg_sync_open_bill (20260816103000). `authenticated` is
-- named explicitly: Supabase's default privileges grant EXECUTE to it as well
-- as to public/anon, and revoking only `public, anon` leaves it reachable.
revoke execute on function public.settle_kots_with_order() from public, anon, authenticated;

drop trigger if exists trg_orders_settle_kots on public.orders;
create trigger trg_orders_settle_kots
  after update of status on public.orders
  for each row
  when (
    old.status is distinct from new.status
    and new.status in ('billed', 'closed', 'cancelled')
  )
  execute function public.settle_kots_with_order();

-- 3) leave_bill_on_credit is the one checkout the trigger cannot see.
--
-- It deliberately keeps the bill on open/partial (nothing was collected, and
-- inventing `paid` would fabricate takings) and leaves the order on `billed`;
-- it only frees the tables. So the order never transitions again, and a ticket
-- fired AFTER its bill went out would sit on the board forever -- the same bug
-- this migration exists to fix, just narrower.
--
-- The guest has definitively left on this path, so there is no live kitchen
-- work to protect and the `billed` carve-outs do not apply: sweep everything on
-- every order of the bill, recalled included, voided lines excepted as always.
-- Same arity, so `create or replace` is safe and no grants need re-issuing.
create or replace function public.leave_bill_on_credit(_bill_id uuid)
returns public.bill_status language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _customer uuid;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _status not in ('open', 'partial') then
    raise exception 'bill is already %', _status using errcode = '22023';
  end if;

  select customer_id into _customer
  from public.orders where bill_id = _bill_id and customer_id is not null limit 1;
  if _customer is null then
    raise exception 'attach a customer before leaving this bill unpaid' using errcode = '23514';
  end if;

  update public.restaurant_tables t
  set state = 'free', current_order_id = null
  from public.orders o
  where o.bill_id = _bill_id and o.tenant_id = _tenant and t.id = o.table_id;

  -- New: the kitchen is done here too. The order stays `billed`, so nothing
  -- else will ever sweep these.
  update public.kots k
     set status = 'served'
   where k.tenant_id = _tenant
     and k.status <> 'served'
     and exists (
       select 1 from public.orders o
        where o.id = k.order_id and o.bill_id = _bill_id
     );

  update public.kot_items ki
     set status = 'served'
   where ki.tenant_id = _tenant
     and ki.status <> 'served'
     and exists (
       select 1 from public.kots k
         join public.orders o on o.id = k.order_id
        where k.id = ki.kot_id and o.bill_id = _bill_id
     )
     and not exists (
       select 1 from public.order_items oi
        where oi.id = ki.order_item_id and oi.is_void
     );

  return _status;
end $$;

revoke execute on function public.leave_bill_on_credit(uuid) from public, anon;
grant execute on function public.leave_bill_on_credit(uuid) to authenticated;

-- 4) Backfill the existing pile.
--
-- `bills.created_at` IS the billing instant -- create_bill_for_order inserts the
-- bill row and sets orders.status='billed' in the same block -- so
-- `kots.created_at < bills.created_at` is the exact analogue of the trigger's
-- "existed at that instant", not a heuristic. Verified against production
-- before writing this: all 8 billed-stale tickets predate their own bill.
--
-- Expect 12 kots and 17 kot_items. Anything else means stop and look.
update public.kots k
   set status = 'served'
  from public.orders o
       left join public.bills b on b.id = o.bill_id
 where o.id = k.order_id
   and k.status in ('new','preparing','ready','recalled')
   and ( o.status in ('closed','cancelled')
         or ( o.status = 'billed'
              and b.created_at is not null
              and k.created_at < b.created_at
              and k.status <> 'recalled' ) );

update public.kot_items ki
   set status = 'served'
  from public.kots k
       join public.orders o on o.id = k.order_id
       left join public.bills b on b.id = o.bill_id
 where k.id = ki.kot_id
   and ki.status in ('new','preparing','ready','recalled')
   and ( o.status in ('closed','cancelled')
         or ( o.status = 'billed'
              and b.created_at is not null
              and k.created_at < b.created_at
              and ki.status <> 'recalled' ) )
   and not exists (
     select 1 from public.order_items oi
      where oi.id = ki.order_item_id and oi.is_void
   );
