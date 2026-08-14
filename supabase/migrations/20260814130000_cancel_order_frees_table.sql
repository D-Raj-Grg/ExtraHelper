-- ============================================================================
-- Cancelling an order left its table stuck on 'occupied'.
--
-- cancel_order (20260718090000) voided the lines and flipped the order to
-- 'cancelled', but never touched restaurant_tables — so state stayed
-- 'occupied' and current_order_id kept pointing at the dead order. Every other
-- order-leaves-a-table path (transfer_order, split_order_items) already routes
-- through refresh_table_state; cancel was the one that didn't.
--
-- Same arity, so `create or replace` is safe here (no drop/re-grant dance).
-- refresh_table_state has EXECUTE revoked from everyone, which is fine: this is
-- a security-definer function, so the `perform` runs as the owner.
-- ============================================================================

create or replace function public.cancel_order(_order_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _status public.order_status;
  _table uuid;
begin
  select tenant_id, status, table_id into _tenant, _status, _table
  from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'cancels require a manager' using errcode = '42501';
  end if;
  if coalesce(trim(_reason), '') = '' then
    raise exception 'cancel reason is required' using errcode = '22023';
  end if;
  if _status in ('billed', 'closed', 'cancelled') then
    raise exception 'order can no longer be cancelled' using errcode = '22023';
  end if;

  update public.order_items
  set is_void = true, void_reason = _reason
  where order_id = _order_id and is_void = false;

  update public.orders set status = 'cancelled' where id = _order_id;

  -- Frees the table when this was its last live order; otherwise re-points
  -- current_order_id at whatever is still open there (split/merged tables).
  perform public.refresh_table_state(_table, _tenant);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cancel', 'order', _order_id,
          jsonb_build_object('reason', _reason));
end $$;

revoke execute on function public.cancel_order(uuid, text) from anon, public;
grant execute on function public.cancel_order(uuid, text) to authenticated;

-- Backfill: tables left occupied/bill_requested by the old bug. Only touches
-- tables with no remaining live order, so a genuinely busy table is untouched.
-- 'reserved' and 'cleaning' are deliberate human states with no order behind
-- them — never sweep those.
update public.restaurant_tables t
set state = 'free', current_order_id = null
where t.state in ('occupied', 'bill_requested')
  and not exists (
    select 1 from public.orders o
    where o.table_id = t.id
      and o.tenant_id = t.tenant_id
      and o.status not in ('closed', 'cancelled')
  );
