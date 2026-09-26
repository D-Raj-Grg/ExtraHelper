-- ============================================================================
-- Order notifications: review follow-ups to 20260926120000.
--
-- 1. False "New order" on split. split_order_items inserts the carved-off order
--    straight into in_kitchen; the kitchen already has those items. Only an
--    INSERT landing in `placed` (QR / online) is a new order. Staff orders are
--    created as draft and fired by UPDATE, which still notifies.
-- 2. The status-unchanged early return ran inside the function, which with the
--    exception block meant a savepoint per row -- including the repeat
--    `set status = 'closed'` every checkout issues on every order on the bill.
--    The filter now lives in the trigger's WHEN clause, so those rows never
--    enter the function at all.
-- 3. order_id / bill_id cascade from orders/bills with no index: every order or
--    bill delete (tenant deletion included) seq-scanned notifications.
-- 4. refund_payment moves a paid bill back to partial; a later payment would
--    announce "Bill paid" a second time. Once per bill.
-- 5. A bill with no table said "Counter" even for delivery. It now names the
--    order type of the bill's first order.
-- 6. Retention: rows are only useful for a few days. pg_cron prunes > 30 days,
--    so the unread count (created_at > cursor) never scans months of history.
-- ============================================================================

create index if not exists idx_notifications_order
  on public.notifications(order_id) where order_id is not null;
create index if not exists idx_notifications_bill
  on public.notifications(bill_id) where bill_id is not null;

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
  -- Status-change filtering is the trigger's WHEN clause (see below).
  if tg_op = 'INSERT' then
    if new.status <> 'placed' then return new; end if;
    _kind := 'order_new';       _title := 'New order';
  elsif new.status in ('placed', 'in_kitchen') and old.status = 'draft' then
    _kind := 'order_new';       _title := 'New order';
  elsif new.status = 'preparing' then
    _kind := 'order_preparing'; _title := 'Preparing';
  elsif new.status = 'ready' then
    _kind := 'order_ready';     _title := 'Ready to serve';
  elsif new.status = 'served' then
    _kind := 'order_served';    _title := 'Served';
  elsif new.status = 'billed' then
    _kind := 'order_billed';    _title := 'Billed';
  elsif new.status = 'cancelled' and old.status <> 'draft' then
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
drop trigger if exists trg_orders_notify_insert on public.orders;
drop trigger if exists trg_orders_notify_update on public.orders;

create trigger trg_orders_notify_insert
  after insert on public.orders
  for each row when (new.status = 'placed')
  execute function public.notify_order_status();

create trigger trg_orders_notify_update
  after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public.notify_order_status();

create or replace function public.notify_bill_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _label text;
  _type  text;
begin
  if exists (select 1 from notifications n
             where n.bill_id = new.id and n.kind = 'bill_paid') then
    return new;
  end if;

  select t.label into _label from restaurant_tables t where t.id = new.table_id;
  if _label is null then
    select o.order_type::text into _type
      from orders o where o.bill_id = new.id
      order by o.created_at limit 1;
  end if;

  insert into notifications
    (tenant_id, kind, bill_id, order_type, table_label, amount_cents, title, body, actor_id)
  values
    (new.tenant_id, 'bill_paid', new.id, _type, _label, new.total_cents, 'Bill paid',
     case
       when _label is not null then 'Table ' || _label
       when _type = 'pickup'   then 'Takeaway'
       when _type = 'delivery' then 'Delivery'
       when _type = 'qr'       then 'QR order'
       else 'Counter'
     end,
     auth.uid());

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
  for each row when (new.status = 'paid' and old.status is distinct from new.status)
  execute function public.notify_bill_paid();

-- Retention.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'prune_notifications') then
    perform cron.unschedule('prune_notifications');
  end if;
  perform cron.schedule(
    'prune_notifications',
    '17 3 * * *',
    $cron$delete from public.notifications where created_at < now() - interval '30 days'$cron$
  );
end $$;
