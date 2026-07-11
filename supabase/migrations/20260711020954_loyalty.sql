-- ============================================================================
-- Loyalty / CRM. Earn/burn points against a customer's loyalty account.
-- Trusted (SECURITY DEFINER, owner/manager). Auto-assigns a tier by balance.
-- ============================================================================

create or replace function public.loyalty_adjust(
  _customer_id uuid,
  _points integer,          -- positive magnitude
  _type public.loyalty_txn_type,   -- earn | burn | adjust
  _reference text default null
)
returns integer             -- new balance
language plpgsql security definer set search_path = public
as $$
declare
  _tenant uuid; _account uuid; _balance integer; _delta integer; _new integer; _tier text;
begin
  select tenant_id into _tenant from public.customers where id = _customer_id;
  if _tenant is null then raise exception 'customer not found' using errcode='P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'loyalty changes require a manager' using errcode='42501';
  end if;
  if _points <= 0 then raise exception 'points must be positive' using errcode='22023'; end if;

  -- Upsert the account.
  insert into public.loyalty_accounts (tenant_id, customer_id, points_balance)
  values (_tenant, _customer_id, 0)
  on conflict (tenant_id, customer_id) do nothing;
  select id, points_balance into _account, _balance
  from public.loyalty_accounts where tenant_id = _tenant and customer_id = _customer_id;

  _delta := case when _type = 'burn' then -_points else _points end;
  _new := _balance + _delta;
  if _new < 0 then raise exception 'insufficient points' using errcode='22023'; end if;

  _tier := case when _new >= 500 then 'gold' when _new >= 100 then 'silver' else 'bronze' end;
  update public.loyalty_accounts set points_balance = _new, tier = _tier where id = _account;

  insert into public.loyalty_transactions (tenant_id, loyalty_account_id, type, points, reference)
  values (_tenant, _account, _type, _points, _reference);

  return _new;
end $$;

revoke execute on function public.loyalty_adjust(uuid, integer, public.loyalty_txn_type, text) from anon, public;
grant execute on function public.loyalty_adjust(uuid, integer, public.loyalty_txn_type, text) to authenticated;
