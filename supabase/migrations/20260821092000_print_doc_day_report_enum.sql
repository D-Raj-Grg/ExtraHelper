-- A new enum value must be committed before anything can reference it, so this
-- lives in its own migration and the queue changes follow in the next one.
-- Same split as 20260815160000_print_doc_receipt_enum.sql.
alter type public.print_doc add value if not exists 'day_report';
