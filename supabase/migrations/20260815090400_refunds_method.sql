-- ============================================================================
-- Refunds gain a method.
--
-- refunds.payment_id has existed since the billing migration and refund_payment
-- has never written it, so a refund's tender was unrecoverable. Expected cash
-- has to subtract cash refunds, which means knowing which refunds were cash.
--
-- Backfill only where the answer is unambiguous: a bill settled entirely by one
-- method. Mixed-tender bills stay null, and null is treated as NON-cash by the
-- expected calculation — a historical guess must never move a variance figure.
--
-- Live behaviour change: refunding a split-tender bill now raises unless the
-- caller names the method. That is deliberate. The alternative — silently
-- recording an unknown tender — would under-count cash refunds and reintroduce
-- exactly the kind of invisible drift this whole feature exists to remove.
-- ============================================================================

alter table public.refunds add column if not exists method public.payment_method;

update public.refunds r
set method = m.only_method
from (
  select p.bill_id, min(p.method::text)::public.payment_method as only_method
  from public.payments p
  where p.status = 'completed'
  group by p.bill_id
  having count(distinct p.method) = 1
) m
where r.bill_id = m.bill_id and r.method is null;

-- A new arg list is a new function object, so `create or replace` would leave
-- the 3-arg body live as an overload and PostgREST would resolve to whichever
-- matched. Drop first, then re-issue the grants naming the full new signature.
drop function if exists public.refund_payment(uuid, integer, text);

create function public.refund_payment(
  _bill_id      uuid,
  _amount_cents integer,
  _reason       text,
  _method       public.payment_method default null
)
returns public.bill_status
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  _tenant uuid; _total integer; _paid integer; _refunded integer;
  _net integer; _status public.bill_status; _method_resolved public.payment_method;
  _distinct integer;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.refund') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _amount_cents <= 0 then
    raise exception 'refund must be positive' using errcode = '22023';
  end if;

  select coalesce(sum(amount_cents), 0) into _paid
  from public.payments where bill_id = _bill_id and status = 'completed';
  select coalesce(sum(amount_cents), 0) into _refunded
  from public.refunds where bill_id = _bill_id;

  if _amount_cents > _paid - _refunded then
    raise exception 'refund exceeds net paid' using errcode = '22023';
  end if;

  -- Caller wins. Otherwise infer, but only from a single-tender bill: guessing
  -- on a split bill would silently mis-state the drawer.
  _method_resolved := _method;
  if _method_resolved is null then
    select count(distinct method) into _distinct
    from public.payments where bill_id = _bill_id and status = 'completed';
    if _distinct = 1 then
      select method into _method_resolved
      from public.payments where bill_id = _bill_id and status = 'completed' limit 1;
    else
      raise exception 'this bill was paid by more than one method — say which one to refund'
        using errcode = '22023';
    end if;
  end if;

  insert into public.refunds (tenant_id, bill_id, amount_cents, reason, approved_by, method)
  values (_tenant, _bill_id, _amount_cents, _reason, auth.uid(), _method_resolved);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'refund', 'bill', _bill_id,
          jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason,
                             'method', _method_resolved));

  _net := _paid - (_refunded + _amount_cents);
  _status := case when _net <= 0 then 'void'
                  when _net < _total then 'partial'
                  else 'paid' end;
  update public.bills set status = _status where id = _bill_id;
  return _status;
end $function$;

revoke execute on function public.refund_payment(uuid, integer, text, public.payment_method) from anon, public;
grant execute on function public.refund_payment(uuid, integer, text, public.payment_method) to authenticated;
