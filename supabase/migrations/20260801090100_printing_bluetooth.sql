-- Bluetooth printers, part 2 of 2 — plus a capability filter on the queue.
--
-- Two changes, both driven by the Flutter app becoming a third drainer of
-- `print_jobs` alongside QZ Tray in a browser and the headless Node agent:
--
-- 1. `printers.bt_address` + the 'bluetooth' connection, so a phone can be told
--    which device to open. The address is a property of the printer and is the
--    same everywhere; only the pairing is per-device.
--
-- 2. `claim_print_jobs` grows `_connections` and `_render_modes`. A claimer
--    that cannot drive a job must not take it — a phone with no Bluetooth
--    pairing claiming the counter's USB ticket means the paper simply never
--    comes out. Both default to null, which means "anything", so the browser
--    worker and the Node agent keep their current behaviour byte for byte.
--
--    Consequence worth knowing: if *every* drainer filters, a job nothing can
--    drive sits queued rather than failing loudly. The browser worker
--    deliberately keeps passing null so an open till is always the catch-all.
--
-- Both functions change arity. `create or replace` cannot: it would quietly
-- create an overload and leave the old body live, so this is drop + create,
-- with revoke/grant re-issued against the full new signature (a new argument
-- list is a new function object, old grants do not carry over, and `public`
-- holds EXECUTE by default).

alter table public.printers
  add column if not exists bt_address text;

alter table public.printers drop constraint if exists printers_target_present;
alter table public.printers add constraint printers_target_present check (
  (connection = 'network' and host is not null and length(btrim(host)) > 0)
  or (connection = 'usb'
      and usb_vendor_id is not null and length(btrim(usb_vendor_id)) > 0
      and usb_product_id is not null and length(btrim(usb_product_id)) > 0)
  or (connection = 'system' and system_name is not null and length(btrim(system_name)) > 0)
  or (connection = 'bluetooth' and bt_address is not null and length(btrim(bt_address)) > 0)
);

-- ---------------------------------------------------------------------------
-- save_printer — same body, one more address field
-- ---------------------------------------------------------------------------

drop function if exists public.save_printer(
  uuid, uuid, text, public.printer_connection, text, integer, text, text, text,
  integer, public.printer_render_mode, boolean, boolean, uuid, boolean, jsonb
);

create function public.save_printer(
  _tenant         uuid,
  _id             uuid,
  _name           text,
  _connection     public.printer_connection,
  _host           text,
  _port           integer,
  _system_name    text,
  _usb_vendor_id  text,
  _usb_product_id text,
  _bt_address     text,
  _paper_width    integer,
  _render_mode    public.printer_render_mode,
  _auto_cut       boolean,
  _open_drawer    boolean,
  _branch_id      uuid,
  _is_active      boolean,
  _docs           jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _printer uuid; _limit integer; _used integer;
begin
  -- Argument order is (tenant, key). The generated types list them
  -- alphabetically, which hides the real order and fails only at run time.
  if not public.has_permission(_tenant, 'settings.edit') then
    raise exception 'not authorized to change printers' using errcode = '42501';
  end if;
  if _name is null or length(btrim(_name)) = 0 then
    raise exception 'give the printer a name' using errcode = '22023';
  end if;
  if _branch_id is not null and not exists (
    select 1 from public.branches where id = _branch_id and tenant_id = _tenant
  ) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;

  if _id is null then
    _limit := public.tenant_limit(_tenant, 'printers');
    if _limit is not null then
      select count(*) into _used from public.printers where tenant_id = _tenant;
      if _used >= _limit then
        raise exception 'your plan allows % printers', _limit using errcode = '22023';
      end if;
    end if;

    insert into public.printers (
      tenant_id, branch_id, name, connection, host, port, system_name,
      usb_vendor_id, usb_product_id, bt_address, paper_width, render_mode,
      auto_cut, open_drawer, is_active
    ) values (
      _tenant, _branch_id, btrim(_name), _connection,
      nullif(btrim(coalesce(_host, '')), ''), coalesce(_port, 9100),
      nullif(btrim(coalesce(_system_name, '')), ''),
      nullif(btrim(coalesce(_usb_vendor_id, '')), ''),
      nullif(btrim(coalesce(_usb_product_id, '')), ''),
      nullif(upper(btrim(coalesce(_bt_address, ''))), ''),
      _paper_width, _render_mode, _auto_cut, _open_drawer, _is_active
    )
    returning id into _printer;
  else
    update public.printers set
      branch_id      = _branch_id,
      name           = btrim(_name),
      connection     = _connection,
      host           = nullif(btrim(coalesce(_host, '')), ''),
      port           = coalesce(_port, 9100),
      system_name    = nullif(btrim(coalesce(_system_name, '')), ''),
      usb_vendor_id  = nullif(btrim(coalesce(_usb_vendor_id, '')), ''),
      usb_product_id = nullif(btrim(coalesce(_usb_product_id, '')), ''),
      -- Stored upper-case: a MAC typed in lower case is the same device, and
      -- the platform APIs hand it back upper-case.
      bt_address     = nullif(upper(btrim(coalesce(_bt_address, ''))), ''),
      -- Re-addressing the device invalidates the cached interface/endpoint.
      usb_interface  = case when connection is distinct from _connection
                             or usb_vendor_id is distinct from nullif(btrim(coalesce(_usb_vendor_id, '')), '')
                            then null else usb_interface end,
      usb_endpoint   = case when connection is distinct from _connection
                             or usb_vendor_id is distinct from nullif(btrim(coalesce(_usb_vendor_id, '')), '')
                            then null else usb_endpoint end,
      paper_width    = _paper_width,
      render_mode    = _render_mode,
      auto_cut       = _auto_cut,
      open_drawer    = _open_drawer,
      is_active      = _is_active
    where id = _id and tenant_id = _tenant
    returning id into _printer;

    if _printer is null then
      raise exception 'printer not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.printer_documents where printer_id = _printer;
  insert into public.printer_documents (tenant_id, printer_id, doc, copies)
  select _tenant, _printer,
         (d ->> 'doc')::public.print_doc,
         greatest(1, least(5, coalesce((d ->> 'copies')::integer, 1)))
    from jsonb_array_elements(coalesce(_docs, '[]'::jsonb)) d
   where (d ->> 'doc') <> 'test'
  on conflict do nothing;

  return _printer;
end $$;

-- ---------------------------------------------------------------------------
-- claim_print_jobs — claim only what the caller can actually drive
-- ---------------------------------------------------------------------------

drop function if exists public.claim_print_jobs(uuid, uuid, text, integer);

create function public.claim_print_jobs(
  _tenant       uuid,
  _branch       uuid,
  _claimer      text,
  _limit        integer,
  _connections  text[] default null,
  _render_modes text[] default null
)
returns setof public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if _tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin() then
    raise exception 'unknown restaurant' using errcode = '42501';
  end if;

  -- A tab that claimed a job and was then closed must not strand it.
  update public.print_jobs
     set status = 'queued', claimed_at = null, claimed_by = null
   where tenant_id = _tenant
     and status = 'claimed'
     and claimed_at < now() - interval '60 seconds';

  -- `for update skip locked` is the whole trick: a second POS tab or a second
  -- agent asking at the same moment steps over the locked rows instead of
  -- queueing behind them, so nobody waits and nobody prints a duplicate.
  return query
  update public.print_jobs j
     set status = 'claimed', claimed_at = now(), claimed_by = _claimer
   where j.id in (
     select c.id from public.print_jobs c
      where c.tenant_id = _tenant
        and c.status = 'queued'
        and (_branch is null or c.branch_id is null or c.branch_id = _branch)
        -- A job with no printer resolved is nobody's to take.
        and (
          (_connections is null and _render_modes is null)
          or exists (
            select 1 from public.printers p
             where p.id = c.printer_id
               and (_connections is null or p.connection::text = any(_connections))
               and (_render_modes is null or p.render_mode::text = any(_render_modes))
          )
        )
      order by c.created_at
      for update skip locked
      limit greatest(1, least(25, coalesce(_limit, 5)))
   )
  returning j.*;
end $$;

-- ---------------------------------------------------------------------------
-- Grants. New argument lists are new function objects: the old grants are gone
-- with the old functions, and `public` holds EXECUTE on a fresh one by default.
-- ---------------------------------------------------------------------------

revoke execute on function public.save_printer(
  uuid, uuid, text, public.printer_connection, text, integer, text, text, text, text,
  integer, public.printer_render_mode, boolean, boolean, uuid, boolean, jsonb
) from public, anon;
revoke execute on function public.claim_print_jobs(uuid, uuid, text, integer, text[], text[]) from public, anon;

grant execute on function public.save_printer(
  uuid, uuid, text, public.printer_connection, text, integer, text, text, text, text,
  integer, public.printer_render_mode, boolean, boolean, uuid, boolean, jsonb
) to authenticated;
grant execute on function public.claim_print_jobs(uuid, uuid, text, integer, text[], text[]) to authenticated;
