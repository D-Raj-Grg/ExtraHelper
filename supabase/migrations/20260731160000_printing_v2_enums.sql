-- Printing v2, part 1 of 2: the type vocabulary.
--
-- Split from the rest because `alter type ... add value` cannot be used by
-- anything in the same transaction that adds it, and every migration here runs
-- inside one. Part 2 consumes these.
--
-- What the new types are for:
--
--   * `print_doc` replaces `printer_role`. A printer no longer has one role —
--     it carries a *set* of documents, and carrying a document means "print it
--     here automatically". That is the model the RestroX-style setup screen
--     needs (Full KOT / KOT / BOT / Bills / Order Slip), and it is also the
--     only way two printers can both print the bill (counter and back office).
--   * `usb` connection: QZ addresses a USB printer by vendor/product id
--     (`qz.usb.claimDevice`), which is a different call path from a named
--     system printer — so it is a different connection kind, not a flavour of
--     `system`.
--   * `printer_render_mode`: ESC/POS text is CP437, so a Devanagari dish name
--     prints as `????`. `image` sends the ticket as rasterised HTML instead,
--     which prints any script. Text stays the default — it is faster and
--     sharper for Latin kitchen tickets.
--   * `station_kind`: what makes a ticket a BOT rather than a KOT.
--   * `claimed` / `cancelled` job states: a queued job is claimed by exactly
--     one browser tab or print agent before it is sent, so two open POS tabs
--     cannot print the same ticket twice.

do $$ begin
  create type public.print_doc as enum ('kot', 'bot', 'full_kot', 'order_slip', 'bill', 'test');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.printer_render_mode as enum ('text', 'image');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.station_kind as enum ('kitchen', 'bar');
exception when duplicate_object then null; end $$;

alter type public.printer_connection add value if not exists 'usb';

alter type public.print_job_status add value if not exists 'claimed';
alter type public.print_job_status add value if not exists 'cancelled';
