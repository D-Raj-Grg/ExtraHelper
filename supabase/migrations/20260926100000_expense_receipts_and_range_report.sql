-- ============================================================================
-- Expense receipt photos + expense totals for range reports.
--
-- Receipts live in a PRIVATE bucket (unlike menu-images): a supplier bill can
-- carry a phone number, an account, a price the owner would rather not share.
-- Path: {tenant_id}/{expense_id}/{random}.{ext}. A fresh name per upload, so no
-- upsert is needed and a stale signed URL can never show the new picture.
--
--   * write/delete: a member who may change that expense (its logger, or
--     expenses.manage) — same rule as assert_may_change_expense, minus the
--     same-day limit for the logger's own photo, which is evidence not money.
--   * read: the expense is visible to you — your own, or expenses.view.
--
-- set_expense_receipt links (or clears) the photo on the row and audits it.
-- report_expenses gives the Reports page a range total, by category, paid-from
-- and day, bucketed by business day so it agrees with Day close.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- May the caller attach/remove a photo on the expense a storage path names?
create or replace function public.may_touch_expense_receipt(_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.expenses e
    where (storage.foldername(_name))[1] = e.tenant_id::text
      and (storage.foldername(_name))[2] = e.id::text
      and e.tenant_id in (select public.current_tenant_ids())
      and (e.created_by = auth.uid() or public.has_permission(e.tenant_id, 'expenses.manage'))
  );
$$;
revoke execute on function public.may_touch_expense_receipt(text) from public, anon;
grant  execute on function public.may_touch_expense_receipt(text) to authenticated;

create or replace function public.may_read_expense_receipt(_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.expenses e
    where (storage.foldername(_name))[1] = e.tenant_id::text
      and (storage.foldername(_name))[2] = e.id::text
      and e.tenant_id in (select public.current_tenant_ids())
      and (e.created_by = auth.uid() or public.has_permission(e.tenant_id, 'expenses.view'))
  );
$$;
revoke execute on function public.may_read_expense_receipt(text) from public, anon;
grant  execute on function public.may_read_expense_receipt(text) to authenticated;

drop policy if exists expense_receipts_read on storage.objects;
create policy expense_receipts_read on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-receipts' and public.may_read_expense_receipt(name));

drop policy if exists expense_receipts_write on storage.objects;
create policy expense_receipts_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expense-receipts' and public.may_touch_expense_receipt(name));

drop policy if exists expense_receipts_delete on storage.objects;
create policy expense_receipts_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'expense-receipts' and public.may_touch_expense_receipt(name));

-- Link a freshly uploaded photo to its expense, or clear it (_path null).
-- Returns the previous path so the caller can delete the old object.
create or replace function public.set_expense_receipt(_id uuid, _path text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _e public.expenses;
begin
  select * into _e from public.expenses where id = _id for update;
  if _e.id is null then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;
  if not (_e.created_by = _uid or public.has_permission(_e.tenant_id, 'expenses.manage')) then
    raise exception 'only the person who logged it or a manager can change its receipt'
      using errcode = '42501';
  end if;
  if _path is not null then
    if _path not like _e.tenant_id::text || '/' || _e.id::text || '/%' then
      raise exception 'that photo does not belong to this expense' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects
                   where bucket_id = 'expense-receipts' and name = _path) then
      raise exception 'upload the photo first' using errcode = 'P0002';
    end if;
  end if;

  update public.expenses set receipt_path = _path, updated_at = now() where id = _id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_e.tenant_id, _uid,
          case when _path is null then 'expense_receipt_remove' else 'expense_receipt_set' end,
          'expense', _id, jsonb_build_object('previous', _e.receipt_path, 'path', _path));

  return _e.receipt_path;
end $$;
revoke execute on function public.set_expense_receipt(uuid, text) from anon, public;
grant  execute on function public.set_expense_receipt(uuid, text) to authenticated;

-- expenses_day: now carries receipt_path.
create or replace function public.expenses_day(_tenant uuid, _day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _today date;
  _d date;
  _all boolean;
  _manage boolean;
begin
  if not (public.has_permission(_tenant, 'expenses.create')
          or public.has_permission(_tenant, 'expenses.view')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  _today  := public.tenant_business_today(_tenant);
  _d      := least(coalesce(_day, _today), _today);
  _all    := public.has_permission(_tenant, 'expenses.view');
  _manage := public.has_permission(_tenant, 'expenses.manage');

  return jsonb_build_object(
    'day', _d,
    'today', _today,
    'day_label', to_char(_d, 'FMDay, FMMon FMDD, YYYY'),
    'can_view_all', _all,
    'can_manage', _manage,
    'can_close_day', public.has_permission(_tenant, 'reports.view'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id,
               'category_id', e.category_id,
               'category', c.name,
               'amount_cents', e.amount_cents,
               'note', e.note,
               'paid_from', e.paid_from,
               'created_at', e.created_at,
               'by', coalesce(pr.full_name, case when pr.username is not null then '@' || pr.username end),
               'voided', e.voided_at is not null,
               'void_reason', e.void_reason,
               'receipt_path', e.receipt_path,
               'can_attach', e.created_by = _uid or _manage,
               'editable', e.voided_at is null
                           and (_manage or (e.created_by = _uid and e.business_date = _today)))
             order by e.created_at desc)
      from public.expenses e
      join public.expense_categories c on c.id = e.category_id
      left join public.profiles pr on pr.id = e.created_by
      where e.tenant_id = _tenant and e.business_date = _d
        and (_all or e.created_by = _uid)
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Range report. A business day belongs to [_from, _to) when the instant it
-- starts does — so a rolling "last 7 days" counts 7 trading days, and a
-- custom range (midnight to midnight) counts every day in it, cutoff or not.
-- ---------------------------------------------------------------------------
create or replace function public.report_expenses(_tenant uuid, _from timestamptz, _to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _tz text; _cut integer;
  _d1 date; _d2 date;
begin
  if not public.has_permission(_tenant, 'reports.view') then
    return null;
  end if;

  select coalesce(s.timezone, 'UTC'), coalesce(s.day_cutoff_minutes, 0) into _tz, _cut
  from public.tenant_settings s where s.tenant_id = _tenant;
  _tz := coalesce(_tz, 'UTC'); _cut := coalesce(_cut, 0);

  -- First and last business day whose start instant falls in the window.
  _d1 := public.business_day(_from, _tz, _cut);
  if ((_d1::timestamp + make_interval(mins => _cut)) at time zone _tz) < _from then
    _d1 := _d1 + 1;
  end if;
  _d2 := public.business_day(_to - interval '1 microsecond', _tz, _cut);

  return (
    with ex as (
      select e.*, c.name as category
      from public.expenses e
      join public.expense_categories c on c.id = e.category_id
      where e.tenant_id = _tenant and e.voided_at is null
        and e.business_date between _d1 and _d2
    )
    select jsonb_build_object(
      'from_day', _d1,
      'to_day', _d2,
      'total_cents', coalesce((select sum(amount_cents) from ex), 0)::bigint,
      'count', (select count(*) from ex)::bigint,
      'by_paid_from', jsonb_build_object(
        'cash',   coalesce((select sum(amount_cents) from ex where paid_from = 'cash'), 0)::bigint,
        'online', coalesce((select sum(amount_cents) from ex where paid_from = 'online'), 0)::bigint,
        'owner',  coalesce((select sum(amount_cents) from ex where paid_from = 'owner'), 0)::bigint),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('name', x.category, 'amount_cents', x.amt, 'count', x.n)
                         order by x.amt desc)
        from (select category, sum(amount_cents)::bigint amt, count(*)::bigint n
              from ex group by category) x), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', x.business_date,
                                            'day_label', to_char(x.business_date, 'Dy, Mon FMDD'),
                                            'amount_cents', x.amt, 'count', x.n)
                         order by x.business_date desc)
        from (select business_date, sum(amount_cents)::bigint amt, count(*)::bigint n
              from ex group by business_date) x), '[]'::jsonb)
    )
  );
end $$;
revoke execute on function public.report_expenses(uuid, timestamptz, timestamptz) from anon, public;
grant  execute on function public.report_expenses(uuid, timestamptz, timestamptz) to authenticated;

-- Day close: flag which items carry a photo.
create or replace function public.daily_report_build(_tenant uuid, _day date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _core jsonb := public.daily_report_core(_tenant, _day);
  _d date := (_core->>'day')::date;
  _from timestamptz := (_core->>'from')::timestamptz;
  _to timestamptz := (_core->>'to')::timestamptz;
  _drawer boolean;
  _cash_in bigint; _online_in bigint; _cash_ref bigint; _online_ref bigint;
  _cash_exp bigint; _online_exp bigint; _owner_exp bigint;
  _close public.day_closings;
  _expected_cash bigint; _expected_online bigint;
begin
  select coalesce(cash_drawer_enabled, false) into _drawer
  from public.tenant_settings where tenant_id = _tenant;

  select coalesce(sum(amount_cents) filter (where method = 'cash'), 0),
         coalesce(sum(amount_cents) filter (where method not in ('cash', 'points')), 0)
    into _cash_in, _online_in
  from public.payments
  where tenant_id = _tenant and status = 'completed'
    and created_at >= _from and created_at < _to;

  select coalesce(sum(amount_cents) filter (where method::text = 'cash'), 0),
         coalesce(sum(amount_cents) filter (where method is not null and method::text not in ('cash', 'points')), 0)
    into _cash_ref, _online_ref
  from public.refunds
  where tenant_id = _tenant and created_at >= _from and created_at < _to;

  select coalesce(sum(amount_cents) filter (where paid_from = 'cash'), 0),
         coalesce(sum(amount_cents) filter (where paid_from = 'online'), 0),
         coalesce(sum(amount_cents) filter (where paid_from = 'owner'), 0)
    into _cash_exp, _online_exp, _owner_exp
  from public.expenses
  where tenant_id = _tenant and business_date = _d and voided_at is null;

  select * into _close from public.day_closings where tenant_id = _tenant and business_date = _d;

  _expected_cash   := _cash_in - _cash_ref - _cash_exp;
  _expected_online := _online_in - _online_ref - _online_exp;

  return _core || jsonb_build_object(
    'cash_drawer_enabled', coalesce(_drawer, false),
    'expenses', jsonb_build_object(
      'total_cents', _cash_exp + _online_exp + _owner_exp,
      'count', (select count(*) from public.expenses
                where tenant_id = _tenant and business_date = _d and voided_at is null),
      'by_paid_from', jsonb_build_object('cash', _cash_exp, 'online', _online_exp, 'owner', _owner_exp),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('name', x.name, 'amount_cents', x.amt, 'count', x.n)
                         order by x.amt desc)
        from (select c.name, sum(e.amount_cents)::bigint amt, count(*)::bigint n
              from public.expenses e join public.expense_categories c on c.id = e.category_id
              where e.tenant_id = _tenant and e.business_date = _d and e.voided_at is null
              group by c.name) x
      ), '[]'::jsonb),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'at', e.created_at,
                 'time', to_char(e.created_at at time zone (_core->>'timezone'), 'HH24:MI'),
                 'category', c.name, 'note', e.note, 'amount_cents', e.amount_cents,
                 'paid_from', e.paid_from,
                 'receipt_path', e.receipt_path,
                 'by', coalesce(pr.full_name, case when pr.username is not null then '@' || pr.username end))
               order by e.created_at)
        from public.expenses e
        join public.expense_categories c on c.id = e.category_id
        left join public.profiles pr on pr.id = e.created_by
        where e.tenant_id = _tenant and e.business_date = _d and e.voided_at is null
      ), '[]'::jsonb)
    ),
    'cash_book', jsonb_build_object(
      'cash_sales_cents', _cash_in,
      'cash_refunds_cents', _cash_ref,
      'cash_expenses_cents', _cash_exp,
      'expected_cash_cents', _expected_cash,
      'online_sales_cents', _online_in,
      'online_refunds_cents', _online_ref,
      'online_expenses_cents', _online_exp,
      'expected_online_cents', _expected_online,
      'closed', _close.tenant_id is not null,
      'counted_cash_cents', _close.cash_counted_cents,
      'counted_online_cents', _close.online_counted_cents,
      'cash_variance_cents', case when _close.tenant_id is not null
                                  then _close.cash_counted_cents - _expected_cash end,
      'online_variance_cents', case when _close.online_counted_cents is not null
                                    then _close.online_counted_cents - _expected_online end,
      'note', _close.note,
      'closed_at', _close.closed_at,
      'closed_by', (select coalesce(pr.full_name, '@' || pr.username)
                    from public.profiles pr where pr.id = _close.closed_by)
    )
  );
end $$;
revoke execute on function public.daily_report_build(uuid, date) from public, anon, authenticated;
