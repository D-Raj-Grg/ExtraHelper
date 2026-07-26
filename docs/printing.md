# Printing

Tickets and receipts print through a **local print agent** ([QZ Tray](https://qz.io/download/)) — a small app on the counter computer that the browser talks to over `localhost`. It pushes raw ESC/POS to the printer, so there is no OS print dialog in the middle of a rush.

The agent is **optional**. With it off, every print falls back to opening the browser print view, which is how printing worked before this module. Nothing breaks; it just needs a click.

## Setting up a shop

1. Install QZ Tray on the computer the POS runs on (Windows, macOS or Linux).
2. Give each network printer a **fixed IP** in the router. On a changing (DHCP) address it stops printing the next time the router restarts.
3. **Settings → Printers → Add printer** — name, IP + port (usually 9100), paper width, and whether it prints kitchen tickets, receipts, or both. Mark one of each as the default.
4. **Test print** on each printer. The test page includes a column ruler: if it wraps, the paper-width setting is wrong.
5. **Menu → Stations** — point each kitchen station at its printer. Grill tickets to the grill, bar tickets to the bar. A station with no printer uses the default kitchen printer.

## Routing

| Document | Goes to |
| --- | --- |
| Kitchen ticket | the station's printer → the default `kot`/`both` printer → the browser |
| Receipt | the default `receipt`/`both` printer → the browser |

## Silent printing

The agent will pop an "allow this?" prompt for every job unless it trusts our certificate. Two server-side variables remove the prompt:

| Variable | What it is |
| --- | --- |
| `QZ_PRIVATE_KEY` | PEM private key used to sign requests. **Server only** — never `NEXT_PUBLIC_`. |
| `QZ_PUBLIC_CERT` | Matching public certificate, served to the agent by `/api/qz/cert`. |
| `QZ_PRIVATE_KEY_PASSPHRASE` | Optional, if the key is encrypted. |

Generate the pair from QZ Tray → **Advanced → Site Manager** (it offers to write an `override.crt` into its own install directory, which is what makes it trust a self-signed certificate). Install that `override.crt` on each shop's computer.

With the variables unset, `/api/qz/sign` returns an empty signature rather than an error: printing still works, the operator just confirms once.

## Security

`/api/qz/sign` is the sensitive endpoint — a signature authorises the agent to act on the operator's machine. It requires a signed-in user with an active tenant membership, and only signs a well-formed SHA-256 digest. The agent hashes the request client-side before asking us to sign it, so the call name is not visible at signing time; the session is the real gate.

## Files

- `lib/print/escpos.ts` — byte builder (alignment, magnification, columns, cut, drawer)
- `lib/print/templates.ts` — kitchen ticket, receipt, test page
- `app/(app)/print/actions.ts` — resolve printer, render, log the job
- `lib/print/dispatch.ts` + `components/print/use-print.ts` — send to the agent, or fall back
- `components/print/print-provider.tsx` — the agent connection
- `app/kot/[kotId]`, `app/receipt/[billId]` — the browser fallback views
