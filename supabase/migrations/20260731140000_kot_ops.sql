-- Kitchen ticket ops: bump a ticket, recall one, stamp it printed.
--
-- Same shape as the 86 / table-state hole closed on 2026-07-27, and missed for
-- the same reason: `bumpKot`, `recallKot` and `markKotPrinted` wrote `kots` and
-- `kot_items` straight through PostgREST. RLS on both tables is
-- `apply_tenant_rls` — tenant-scoped only — and the role check lived inside a
-- TypeScript server action. So any member of the restaurant (a waiter, a
-- receptionist, an inventory clerk) could bump or recall any ticket through the
-- API, and `kds.bump` — which `set_kot_item_status` has enforced since
-- 2026-07-22 — was bypassed entirely on the whole-ticket path.
--
-- These hold the rule in Postgres so the web and the Flutter kitchen board
-- share one answer.
--
-- Two deliberate differences from the code they replace:
--
--   * `recall_kot` writes `'recalled'`. The web action wrote `'preparing'`,
--     which made the `recalled` enum value unreachable — so
--     `mark_order_served`'s `status <> 'recalled'` exclusion never fired and a
--     ticket pulled back to the board could be swept to served underneath the
--     cook. It also audits: pulling a served ticket back is a manager-visible
--     act, and nothing recorded it.
--   * A voided line is never moved. `set_kot_item_status` already excludes
--     voided lines when it derives the ticket; the whole-ticket path used to
--     move every line regardless, which resurrected cancelled dishes on the
--     board.

create or replace function public.set_kot_status(_kot_id uuid, _status public.kot_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _order uuid;
begin
  select tenant_id, order_id into _tenant, _order
    from public.kots where id = _kot_id;
  if _tenant is null then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;

  -- Note the argument order: has_permission(_tenant, _key). The generated
  -- types list them alphabetically, which does not reveal the real order, and
  -- plpgsql resolves inner calls at run time — a reversed call creates cleanly
  -- and fails on every bump in production.
  if not public.has_permission(_tenant, 'kds.bump') then
    raise exception 'not authorized to move a ticket' using errcode = '42501';
  end if;

  update public.kots set status = _status
   where id = _kot_id and tenant_id = _tenant;

  update public.kot_items ki set status = _status
   where ki.kot_id = _kot_id
     and ki.tenant_id = _tenant
     and not exists (
       select 1 from public.order_items oi
        where oi.id = ki.order_item_id and oi.is_void
     );

  if _order is not null then
    perform public.sync_order_status_from_kots(_order);
  end if;
end $$;

create or replace function public.recall_kot(_kot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _order uuid; _station text;
begin
  select k.tenant_id, k.order_id, s.name
    into _tenant, _order, _station
  from public.kots k
  left join public.kitchen_stations s on s.id = k.station_id
  where k.id = _kot_id;

  if _tenant is null then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'kds.bump') then
    raise exception 'not authorized to recall a ticket' using errcode = '42501';
  end if;

  update public.kots set status = 'recalled'
   where id = _kot_id and tenant_id = _tenant;

  update public.kot_items ki set status = 'recalled'
   where ki.kot_id = _kot_id
     and ki.tenant_id = _tenant
     and not exists (
       select 1 from public.order_items oi
        where oi.id = ki.order_item_id and oi.is_void
     );

  if _order is not null then
    perform public.sync_order_status_from_kots(_order);
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _tenant, auth.uid(), 'kot_recall', 'kot', _kot_id,
    jsonb_build_object('station', coalesce(_station, 'Expo'), 'order_id', _order)
  );
end $$;

-- Printing is a KDS/POS affordance rather than a state change, so it rides on
-- `kds.view` — whoever can see the ticket can reprint it. Not audited: a
-- reprint moves no money and no food.
create or replace function public.mark_kot_printed(_kot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.kots where id = _kot_id;
  if _tenant is null then
    raise exception 'ticket not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'kds.view') then
    raise exception 'not authorized to print a ticket' using errcode = '42501';
  end if;

  update public.kots set printed_at = now()
   where id = _kot_id and tenant_id = _tenant;
end $$;

revoke execute on function public.set_kot_status(uuid, public.kot_status) from public, anon;
revoke execute on function public.recall_kot(uuid) from public, anon;
revoke execute on function public.mark_kot_printed(uuid) from public, anon;
grant execute on function public.set_kot_status(uuid, public.kot_status) to authenticated;
grant execute on function public.recall_kot(uuid) to authenticated;
grant execute on function public.mark_kot_printed(uuid) to authenticated;
