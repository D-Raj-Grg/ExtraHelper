-- Per-dish KOT status. kot_items.status has existed since the billing schema
-- but nothing ever wrote it independently — bumpKot moved a ticket and all of
-- its lines in lockstep. A kitchen plates dish by dish, so the dish is the unit
-- of work: this sets one line, then *derives* the ticket from its lines, then
-- lets the existing sync_order_status_from_kots derive the order. One
-- round-trip, one transaction — a client doing three writes could interleave
-- with another terminal and leave the ticket disagreeing with its lines.

create or replace function public.set_kot_item_status(_kot_item_id uuid, _status public.kot_status)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  _tenant  uuid;
  _kot     uuid;
  _order   uuid;
  _minrank integer;
  _next    public.kot_status;
begin
  select ki.tenant_id, ki.kot_id, k.order_id
    into _tenant, _kot, _order
  from public.kot_items ki
  join public.kots k on k.id = ki.kot_id
  where ki.id = _kot_item_id;

  if _tenant is null then
    raise exception 'ticket line not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'kds.bump') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.kot_items set status = _status
  where id = _kot_item_id and tenant_id = _tenant;

  -- Ticket = its least-advanced *live* line. Same rank ladder as
  -- sync_order_status_from_kots so the two never disagree; 'recalled' ranks
  -- with 'preparing' (it is back on the board and being cooked).
  select min(case ki.status
               when 'new' then 1
               when 'preparing' then 2
               when 'recalled' then 2
               when 'ready' then 3
               when 'served' then 4
               else 1 end)
    into _minrank
  from public.kot_items ki
  left join public.order_items oi on oi.id = ki.order_item_id
  where ki.kot_id = _kot and ki.tenant_id = _tenant
    and coalesce(oi.is_void, false) = false;

  -- Every line voided ⇒ nothing left to derive from; leave the ticket as it is
  -- rather than silently declaring a fully-cancelled ticket "served".
  if _minrank is not null then
    _next := case _minrank
               when 1 then 'new'
               when 2 then 'preparing'
               when 3 then 'ready'
               else 'served' end;
    update public.kots set status = _next
    where id = _kot and tenant_id = _tenant and status <> _next;
  end if;

  if _order is not null then
    perform public.sync_order_status_from_kots(_order);
  end if;
end $function$;

revoke execute on function public.set_kot_item_status(uuid, public.kot_status) from public, anon;
grant execute on function public.set_kot_item_status(uuid, public.kot_status) to authenticated;
