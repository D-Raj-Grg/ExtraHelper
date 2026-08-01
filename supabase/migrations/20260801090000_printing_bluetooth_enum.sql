-- Bluetooth printers, part 1 of 2: the enum value alone.
--
-- A new enum value cannot be *used* in the same transaction that adds it —
-- Postgres refuses with "unsafe use of new value of enum type". The check
-- constraint and the RPCs that reference 'bluetooth' therefore live in
-- 20260801090100, exactly as printing v2 split its enums out of the schema.
--
-- Why Bluetooth at all: the Flutter app is a native process and can drive a
-- thermal printer itself. Over WiFi it uses a socket on port 9100 like anything
-- else; over Bluetooth (Android only — iOS classic SPP needs MFi) it needs the
-- printer's address, and that address belongs on the printer row, not on the
-- device. Pairing is per-device and stays an OS concern.

alter type public.printer_connection add value if not exists 'bluetooth';
