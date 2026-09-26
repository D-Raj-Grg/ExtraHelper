-- ============================================================================
-- expenses_day: one business day of expenses, for the mobile app.
--
-- The phone cannot say what "today" is (no IANA database, a 4am cutoff), so
-- this resolves the day server-side the way daily_report does, and returns the
-- rows already named and already marked editable by the same rule
-- assert_may_change_expense enforces. Visibility mirrors the expenses RLS
-- policy: your own rows, or everyone's with expenses.view.
-- ============================================================================

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

revoke execute on function public.expenses_day(uuid, date) from anon, public;
grant  execute on function public.expenses_day(uuid, date) to authenticated;
