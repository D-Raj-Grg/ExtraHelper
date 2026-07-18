-- ============================================================================
-- Order-card actions: pin an order to the top of the POS board, and cancel a
-- whole order (order-level void). Cancel is manager-gated + audited (rule #5);
-- pinning is a plain preference, no gate.
-- ============================================================================

-- Pin marker. Nullable on purpose: a null means "not pinned" (the "a flag nobody
-- set is not false" rule), and it doubles as the sort key — pinned-first is just
-- `order by pinned_at desc nulls last`.
alter table public.orders add column if not exists pinned_at timestamptz;

-- Cancel an entire order. Voids every remaining line (which fires the same
-- stock-restore trigger void_order_item relies on), flips the order to
-- 'cancelled', and writes one audit row. Manager-gated, reason required.
create or replace function public.cancel_order(_order_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _status public.order_status;
begin
  select tenant_id, status into _tenant, _status
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

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cancel', 'order', _order_id,
          jsonb_build_object('reason', _reason));
end $$;

revoke execute on function public.cancel_order(uuid, text) from anon, public;
grant execute on function public.cancel_order(uuid, text) to authenticated;
