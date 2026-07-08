# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Travel Tracker is a single self-contained HTML file (`index.html`, ~4,800 lines) — no build step,
no package manager, no test suite. It's a private, invite-only web app for tracking one family's
NetJets fractional-jet usage, The Private Suite ("PS", the LAX private terminal)
reservations/billing, and (in progress) a TripIt-synced Trips view.

Open the file directly in a browser (or serve the directory statically) to run it — there is
nothing to install or compile. The file **must** be named `index.html`, not something more
descriptive — this repo is deployed via GitHub Pages (`jskagan.github.io/Flight-data`, repo
`jskagan/Flight-data`), which requires that exact filename as the served entry point.

## Git workflow

This repo is connected to GitHub and GitHub Pages serves `main` directly — a push here goes live
immediately. **Never run `git commit` or `git push` without first describing the diff in plain
language and getting the user's explicit go-ahead.** This applies every session, not just when
the user asks for it in the moment — don't treat silence or an unrelated request as consent to
commit pending changes.

## Data flow / architecture

All app state lives in **one JSON file in Google Drive** (`flight-log-data.json`), shared between
every signed-in user via the Drive API — this is what keeps desktop and iPad in sync (see the
`STORAGE` section, `index.html:576`). The in-memory shape is:

```
driveData = {
  invoices: [...],               // parsed NetJets PDF invoices
  report: {...} | null,          // cached passenger-hours report
  reservations: [...],           // PS reservations, from Gmail
  psBalanceDeductions: [...],    // PS balance deductions, from Gmail
}
```

All reads/writes go through the `Store` object (`index.html:705`), which mutates
`driveData` in memory and then calls `persistDriveData()` to PATCH the whole file back to Drive.
There is no server — auth and API calls happen entirely client-side via Google Identity Services
(OAuth token client) and the Drive/Gmail REST APIs.

**Auth model** (`index.html:5508` to end): a single hardcoded `OWNER_EMAIL` gets
read/write access (upload, edit, delete); anyone else who signs in with a Google account the
owner has shared the Drive file with gets read-only access. This is enforced both at the UI level
(hiding buttons) and at the real Google Drive sharing-permission level.

### The three data pipelines

1. **NetJets invoices** — user uploads a PDF; it's parsed client-side with pdf.js into flight legs,
   passengers, and billed hours. Parser lives in the `PARSER` section
   (`index.html:1585`). It was validated against one real sample invoice and is tuned to
   that exact document template (fixed column x-positions, regexes) — expect to extend it
   carefully as new invoice layouts are seen, not rewrite it generically. Note
   `itemToPosition()` (`index.html:1597`) handles two different PDF text-matrix
   orientations found across pages of the same invoice.
2. **PS Reservations** — Gmail is searched (via `gmail.readonly` scope) for "Confirmed:" emails
   from PS Member Services and parsed into reservation records, keyed by reservation number (not
   Gmail message id, since one reservation can get multiple emails as it changes). See
   `index.html:963`.
3. **PS Balance** — separate Gmail search over "PS Receipt: Reservation #" emails, parsed into
   discrete balance deductions. See `index.html:1226`.

### Review / ambiguity resolution

Parsed invoice legs that couldn't be fully/confidently parsed get `_warnings` and show up in the
**Review Queue**; a human resolves them by editing fields, which clears `_warnings` and triggers a
passenger-report recompute (`resolveLeg()`, `index.html:2304`). Airport-code ambiguities
are resolved via a separate lazily-fetched airport-code lookup
(`index.html:2841`).

### View routing

No framework/router — `navigate(view, param)` (`index.html:2371`) is a plain if/else
dispatcher that renders into a single `#main` element by calling one of the `render*` functions.
Nav rail buttons carry `data-view`/`data-param` attributes wired up at the bottom of the file.
Key views and where to find them:

| View | Function | Location |
|---|---|---|
| Home dashboard | `renderHome` | `index.html:5247` |
| Upload PDF invoice | `renderUpload` | `index.html:2443` |
| Invoice list / detail | `renderInvoiceList` / `renderInvoiceDetail` | `index.html:2591` / `2666` |
| Review Queue / Resolved Issues | `renderReviewQueue` / `renderResolvedIssues` | `index.html:3172` / `3234` |
| Passenger report (Totals/Kagan/Lopata) | `renderPassengerReport` | `index.html:3749` |
| PS Reservations / Balance / Invoices | `renderReservations` / `renderPsBalance` / `renderPsInvoices` | `index.html:3961` area |
| Trends chart | `renderTrends` | `index.html:5117` |

Utilities-only views (Users, Delete/Re-Parse PS Reservations & Invoices) are owner-only, hidden in
the nav until sign-in confirms `isOwner`.

## Notable constraints

- **iPad/Safari compatibility**: the pdf.js version is pinned and several ES2024 features
  (`Promise.withResolvers`, `ReadableStream` async iteration, `Array.fromAsync`) are polyfilled by
  hand at the top of the file (`index.html:32`) because Claude's iPad app WebView lacks
  them. Do not "simplify" by bumping pdf.js or removing these polyfills without testing on that
  WebView specifically — both have caused real, previously-fixed crashes.
- Everything — HTML, CSS, and JS — lives in this one file by design (it's distributed/opened as a
  single artifact). Don't split it into separate files/modules unless explicitly asked.
