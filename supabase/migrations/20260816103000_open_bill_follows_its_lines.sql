-- ============================================================================
-- An open bill's total must follow its order lines. Always, whoever moved them.
--
-- Fallout from 20260816090000, which let a `billed` order take new lines while
-- its bill is unpaid. Adding goes through `amend_order_add_item`, which
-- recomputes the bill itself — but a line added that way lands with
-- `status = 'draft'`, and *that* re-opens two plain table writes against it:
--
--   * `setLineQty`  — updates order_items.qty where status in (draft, placed)
--   * `removeItem`  — deletes the row outright, with no status filter at all
--
-- Neither recomputes anything, because until now neither could ever run against
-- an order that had a bill. So the water bottle you add is charged correctly,
-- and then:
--
--   * step it 1 → 2 and the guest is charged for one         (undercharge)
--   * delete it as a mistyped line and the charge stays      (overcharge)
--
-- Money either way, and silent both times: `bill_items` and `bills.total_cents`
-- simply keep describing an order that no longer exists.
--
-- Fixing the two callers would leave the same hole open for the Flutter app,
-- the offline queue replaying a stale edit, and anything reaching PostgREST
-- directly. The invariant isn't "these two actions should recompute", it's
-- "an open bill equals the sum of its lines" — so it belongs on the table.
--
-- Scope is deliberately narrow: only when the parent order is actually on a
-- bill, and only while that bill is still `open`. An order being composed has
-- no bill_id and costs one indexed lookup per line change; a `partial`, `paid`
-- or `void` bill is money that has already been counted and is never rewritten
-- from here — the RPCs that are allowed to touch a settled bill (void_order_item,
-- refund_payment) still do their own recompute, as they always have.
--
-- `security definer` is required: recompute_bill has EXECUTE revoked from
-- authenticated (20260713100000), so the trigger has to run as the owner.
-- ============================================================================

create or replace function public.trg_sync_open_bill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _order   uuid;
  _bill    uuid;
  _bstatus public.bill_status;
begin
  -- DELETE has no NEW; everything else has no meaningful OLD on insert.
  if tg_op = 'DELETE' then
    _order := old.order_id;
  else
    _order := new.order_id;
  end if;

  select o.bill_id into _bill from public.orders o where o.id = _order;
  if _bill is null then
    -- The common case by far: an order still being composed. Nothing to sync.
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select b.status into _bstatus from public.bills b where b.id = _bill;
  if _bstatus = 'open' then
    perform public.recompute_bill(_bill);
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

-- No caller should ever invoke this by hand.
revoke execute on function public.trg_sync_open_bill() from anon, authenticated, public;

drop trigger if exists trg_order_item_sync_bill on public.order_items;
create trigger trg_order_item_sync_bill
  after insert or update or delete on public.order_items
  for each row execute function public.trg_sync_open_bill();
