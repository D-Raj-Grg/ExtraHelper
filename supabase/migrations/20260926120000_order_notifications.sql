-- ============================================================================
-- Order lifecycle notifications.
--
-- Staff want to hear about every step of an order, not just its arrival:
-- new order -> preparing -> ready -> served -> billed -> paid (and cancelled).
-- Until now the web bell only watched `orders.status = 'placed'`, and the phone
-- had nothing.
--
-- One event table, written by triggers, read by both clients over realtime:
--   * web  -> bell with unread badge, feed and live toast
--   * phone -> OS notification (flutter_local_notifications) + the same feed
--
-- WHY TRIGGERS
-- orders.status is written from ~20 SQL sites (fire_order, the KOT sync, the
-- checkout RPCs) plus a service-role webhook. A trigger is the single choke
-- point, exactly like settle_kots_with_order (20260903090000).
--
-- `old.status is distinct from new.status` is load-bearing for the same reason
-- it is there: several RPCs re-assign status on every order on a bill.
--
-- "New order" fires on entering placed OR in_kitchen from draft (the POS fires
-- straight to the kitchen and never passes through placed), and NOT on
-- placed -> in_kitchen, which is the same order being acknowledged.
--
-- Read state is a per-user cursor rather than a row per recipient: a tenant
-- with 15 staff would otherwise write 15 rows per status change on the hot path.
-- ============================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null check (kind in
                 ('order_new','order_preparing','order_ready','order_served',
                  'order_billed','order_cancelled','bill_paid')),
  order_id     uuid references public.orders(id) on delete cascade,
  bill_id      uuid references public.bills(id) on delete cascade,
  order_type   text,
  table_label  text,
  amount_cents integer,
  title        text not null,
  body         text not null,
  -- Who caused it, so a client can skip alerting the person who tapped the
  -- button. Null for service-role / QR paths.
  actor_id     uuid,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notifications_tenant_created
  on public.notifications(tenant_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated
  using (public.has_permission(tenant_id, 'notifications.view') or public.is_platform_admin());
-- No insert/update/delete policies: only the security-definer triggers write.

create table if not exists public.notification_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

alter table public.notification_reads enable row level security;

drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and tenant_id in (select public.current_tenant_ids()));

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------

create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _kind  text;
  _title text;
  _label text;
  _where text;
  _type  text;
  _total integer;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.status in ('placed', 'in_kitchen')
     and (tg_op = 'INSERT' or old.status = 'draft') then
    _kind := 'order_new';      _title := 'New order';
  elsif new.status = 'preparing' then
    _kind := 'order_preparing'; _title := 'Preparing';
  elsif new.status = 'ready' then
    _kind := 'order_ready';     _title := 'Ready to serve';
  elsif new.status = 'served' then
    _kind := 'order_served';    _title := 'Served';
  elsif new.status = 'billed' then
    _kind := 'order_billed';    _title := 'Billed';
  elsif new.status = 'cancelled' and tg_op = 'UPDATE' and old.status <> 'draft' then
    _kind := 'order_cancelled'; _title := 'Order cancelled';
  else
    return new;
  end if;

  select t.label into _label from restaurant_tables t where t.id = new.table_id;
  _type := new.order_type::text;
  _where := case
    when _label is not null then 'Table ' || _label
    when _type = 'pickup'   then 'Takeaway'
    when _type = 'delivery' then 'Delivery'
    when _type = 'qr'       then 'QR order'
    else 'Dine in'
  end;

  if _kind = 'order_billed' and new.bill_id is not null then
    select b.total_cents into _total from bills b where b.id = new.bill_id;
  end if;

  insert into notifications
    (tenant_id, kind, order_id, bill_id, order_type, table_label, amount_cents,
     title, body, actor_id)
  values
    (new.tenant_id, _kind, new.id, new.bill_id, _type, _label, _total,
     _title, _where, auth.uid());

  return new;
exception when others then
  -- A notification is never worth failing an order write over.
  raise warning 'notify_order_status: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.notify_order_status() from public, anon, authenticated;

drop trigger if exists trg_orders_notify on public.orders;
create trigger trg_orders_notify
  after insert or update of status on public.orders
  for each row execute function public.notify_order_status();

create or replace function public.notify_bill_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _label text;
begin
  if new.status <> 'paid' or old.status is not distinct from new.status then
    return new;
  end if;

  select t.label into _label from restaurant_tables t where t.id = new.table_id;

  insert into notifications
    (tenant_id, kind, bill_id, table_label, amount_cents, title, body, actor_id)
  values
    (new.tenant_id, 'bill_paid', new.id, _label, new.total_cents, 'Bill paid',
     coalesce('Table ' || _label, 'Counter'), auth.uid());

  return new;
exception when others then
  raise warning 'notify_bill_paid: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.notify_bill_paid() from public, anon, authenticated;

drop trigger if exists trg_bills_notify on public.bills;
create trigger trg_bills_notify
  after update of status on public.bills
  for each row execute function public.notify_bill_paid();

-- ---------------------------------------------------------------------------
-- Mark read
-- ---------------------------------------------------------------------------

create or replace function public.mark_notifications_read(_tenant uuid)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _at timestamptz := now();
begin
  if auth.uid() is null or not public.has_permission(_tenant, 'notifications.view') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into notification_reads (user_id, tenant_id, last_read_at)
  values (auth.uid(), _tenant, _at)
  on conflict (user_id, tenant_id) do update set last_read_at = excluded.last_read_at;
  return _at;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid) from public, anon;
grant  execute on function public.mark_notifications_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
