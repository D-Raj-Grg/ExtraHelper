# Printing

Tickets and bills are **queued in Postgres**, not printed by whichever screen happens to be open. Creating a KOT queues it; settling a bill queues the receipt. Something then takes the job off the queue and puts it on paper.

That indirection is the whole design, and it buys three things:

- An order from the QR menu, the online store or the Flutter app prints without any of them knowing printing exists.
- Two open POS tabs cannot print the same ticket twice — a job is *claimed* before it is sent.
- A print that fails stays visible and retryable in **Settings → Printers**, instead of disappearing with a toast nobody saw.

## Who puts it on paper

A browser cannot print to a thermal printer on its own — JavaScript has no raw socket, and `window.print()` goes through a printer driver and a page dialog. So something native has to take the job off the queue. There are three, and they all read the same queue:

**Local** (default) — the browser drives the printers through **QZ Tray**, a small program on the till computer. Any open ExtraHelper screen keeps the queue moving. Network, USB and system printers, and image mode.

**Cloud** — a headless agent (`tools/print-agent`) on a machine in the restaurant. No browser needs to be open at all. **Network printers only**, text mode.

**The phone** — the ExtraHelper app on Android or iOS, with **Printing → Print from this device** switched on. Nothing to install on any computer. WiFi printers on both platforms; Bluetooth on Android. Independent of the Local/Cloud switch, because neither a browser nor the shop agent can reach a Bluetooth printer anyway.

Switch modes in Settings → Printers. Nothing is lost by changing your mind, and several drainers can run at once — a job is *claimed* before it is sent, so whichever gets there first prints it and the rest step over the locked row.

Each drainer says what it can drive when it claims, so a ticket is never taken off the queue by something that cannot finish it. The browser is deliberately the catch-all: it claims every render mode, which is why an image-mode ticket waits for an open till.

## Setting up Local mode

Settings → Printers → **Set it up** walks through this and watches the connection live — leave it open while you install and it ticks itself green. There is nothing to reload.

1. Install [QZ Tray](https://qz.io/download/) on the till computer and start it.
2. **Download override.crt** from that dialog and drop it in the QZ Tray folder:
   - Windows `C:\Program Files\qz-tray`
   - macOS `/Applications/qz-tray`
   - Linux `/opt/qz-tray`

   Restart QZ. Without it, QZ asks for permission on every single ticket.
3. The **Direct printing** card says Connected.

Signing is what makes printing silent. Set `QZ_PUBLIC_CERT` and `QZ_PRIVATE_KEY` (and `QZ_PRIVATE_KEY_PASSPHRASE` if the key has one) in the environment. Unset, the app returns an empty signature and QZ falls back to prompting — printing still works, it just isn't silent.

## Setting up Cloud mode

1. Create a staff account for the agent (a `kitchen` role is enough).
2. `cp tools/print-agent/config.example.json config.json`, fill it in.
3. `node tools/print-agent/agent.mjs ./config.json` — as a service, or under `pm2`/`systemd`.
4. Switch Printing mode to **Cloud**.

The agent uses no service role key and no shared secret; it signs in as that user and RLS scopes what it can see, exactly as for a person at a till.

## Setting up the phone

1. Install the ExtraHelper app and sign in.
2. **Printing** in the drawer → **Print from this device**.
3. WiFi: nothing else to do — the printer's IP from Settings → Printers is all it needs.
4. Bluetooth: pair the printer in the phone's own Bluetooth settings first. The Printing screen then lists it with its address; copy that into a **Bluetooth** printer on the web.

The app build needs `APP_URL` pointing at the web app (`--dart-define-from-file=env.json`) — that is where a claimed job is turned into ESC/POS, so a ticket from a phone is byte-identical to one from the till. Without it the switch is disabled and says why.

Bluetooth is an Android answer: iOS classic Bluetooth needs an MFi chip these printers do not carry. On iPhone, use WiFi.

## Adding a printer

| Field | Notes |
|---|---|
| Paper width | 58mm and 80mm thermal, 76mm impact. Sets the column count — get it wrong and amounts wrap onto their own line. |
| Connection | **Network** (IP + port, usually 9100) · **USB** (vendor + product ID, or Scan) · **System** (the name your OS gives it) · **Bluetooth** (the printer's address, which the phone app shows once it is paired). USB and System are driven by QZ Tray in the browser, so they work in **Local mode only**; Bluetooth is driven by the phone app only. |
| How it prints | **Text** is ESC/POS: fastest and sharpest, but Latin only — a Nepali dish name prints as `????`. **Image** draws the whole ticket and prints any script. Image needs a browser, so it works in Local mode only — neither the cloud agent nor the phone app can draw one yet. |
| Cut the paper | Off for printers with no cutter, or the cut command prints as stray characters. |
| Open the cash drawer | Only the printer with a drawer wired to it, and only on cash. |
| Branch | A printer tied to a branch only ever prints that branch's orders. |

**Network printers need a static IP.** On DHCP the address changes when the router restarts and printing stops until somebody notices.

## What a printer prints

Assigning a document to a printer *is* the auto-print switch:

| Document | Queued when |
|---|---|
| **KOT** | a kitchen station's ticket is created |
| **BOT** | a bar station's ticket is created (station type = Bar) |
| **Full KOT** | the first ticket of an order — one consolidated ticket for the pass |
| **Order slip** | on demand, from the order card. The guest's itemised copy, with prices |
| **Bill & receipt** | the bill is settled |

Several printers may carry the same document; all of them print it. A printer with **nothing** assigned still exists and can be chosen for a manual print — it just never fires on its own.

Kitchen and bar tickets check the station's own printer first (Menu → Stations). Only when a station has no printer does the document assignment decide.

## How a job is resolved

```
KOT / BOT   station.printer_id  →  printers carrying kot/bot  →  nothing queued
everything else                 →  printers carrying that document
```

If nothing is queued, the UI offers the browser print view (`/kot/<id>`, `/receipt/<id>`) as an explicit click. It is never opened for you: a `window.open` after an `await` is a popup, and browsers eat it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Disconnected" on the Direct printing card | QZ Tray isn't running. Start it — the setup dialog reconnects on its own. |
| QZ asks permission every print | `override.crt` isn't installed, or `QZ_PRIVATE_KEY` isn't set. |
| Nothing prints, no error | Nothing is assigned that document. Check the Printers table. |
| Printed twice | Two agents claiming, or a manual reprint. `claimed_by` on the job says which. |
| Scan finds nothing | QZ Tray isn't running. A browser cannot list OS printers on its own — there is no such API. |
| Pages of random characters | The printer isn't ESC/POS. An office inkjet or laser prints the raw control codes as nonsense; this needs a thermal receipt printer. |
| `????` instead of Nepali | The printer is in text mode. Switch it to image. |
| Amount on its own line | Paper width is wrong for the printer. |
| Job stuck on "Printing" | The claimer died. It re-queues itself after 60 seconds. |
| A job sits on "Waiting" forever | Nothing that can drive it is running. A Bluetooth ticket needs the phone app; an image-mode ticket needs an open browser with QZ Tray. |
| The phone's Printing switch is greyed out | The app was built without `APP_URL`. |
| The phone never prints a Bluetooth ticket | Bluetooth is off, permission was declined, or the printer is paired with a *different* phone. Pairing is per device. |

## Where the code lives

| | |
|---|---|
| Schema, RPCs, enqueue triggers | `supabase/migrations/20260731160000_printing_v2_enums.sql`, `20260731160100_printing_v2.sql`, `20260731170000_printing_v2_guards.sql`, `20260801090000_printing_bluetooth_enum.sql`, `20260801090100_printing_bluetooth.sql` |
| Document model + builders | `lib/print/docs.ts` |
| ESC/POS text renderer | `lib/print/escpos.ts`, `lib/print/escpos-render.ts` |
| Payload choice | `lib/print/render.ts` |
| Job → bytes | `lib/print/job-render.ts` (shared by the server action and the API route) |
| Queue actions | `app/(app)/print/actions.ts` |
| Browser worker | `components/print/auto-print-worker.tsx` |
| Canvas rasteriser (image mode) | `components/print/raster.ts` |
| QZ bridge | `components/print/print-provider.tsx` |
| Headless agent | `tools/print-agent/` |
| Phone drainer | `../extrahelper_flutter/lib/data/print/` (repository, render client, WiFi + Bluetooth transports, drain loop) |
| Phone settings screen | `../extrahelper_flutter/lib/features/settings/printing_screen.dart` |
| Settings UI | `components/settings/printers-tab.tsx`, `components/settings/printer-sheet.tsx` |
