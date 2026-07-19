# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Travel Tracker is a single self-contained HTML file (`index.html`, ~15,300 lines) — no build step,
no package manager, no test suite. It's a private, invite-only web app for tracking one family's
NetJets fractional-jet usage, The Private Suite ("PS", the LAX private terminal)
reservations/billing, and a Tripsy-API-backed Trips view (labeled "My Trips" in the nav — flights,
hotels, and other reservations), synced by a Claude Code scheduled task rather than an in-browser
API call (see "Tripsy Trips" below).

Open the file directly in a browser (or serve the directory statically) to run it — there is
nothing to install or compile. The file **must** be named `index.html`, not something more
descriptive — this repo is deployed via GitHub Pages (`jskagan.github.io/Flight-data`, repo
`jskagan/Flight-data`), which requires that exact filename as the served entry point.

The repo also has a few source image assets (`Interior.jpeg`, `Home.png`, etc.) sitting alongside
`index.html` — these are **not** served/referenced at runtime. They exist only as the originals
behind base64 constants embedded directly in the JS (e.g. `FOPBP_PHOTO_B64`,
`TRIPIT_HOME_ICON_B64`) — the whole app, including every image, is meant to be one deployable
file. If you're asked to embed a new image, resize/compress it first (`sips` on macOS is fine —
see git history for examples) before base64-encoding it into a `const`; these add up fast (the
crew photo alone is ~450KB after compression, chosen over its ~2.5MB original specifically to keep
page-load reasonable).

## Git workflow

This repo is connected to GitHub and GitHub Pages serves `main` directly — a push here goes live
immediately. **Never run `git commit` or `git push` without first describing the diff in plain
language and getting the user's explicit go-ahead.** This applies every session, not just when
the user asks for it in the moment — don't treat silence or an unrelated request as consent to
commit pending changes.

**Exception: Tripsy Trips snapshot-only refreshes.** When following the "Refresh Tripsy Trips
snapshot" procedure (see `TRIPSY_SNAPSHOT_GENERATED_AT`/`TRIPSY_ENCRYPTED` in `index.html`) and the
resulting diff touches *only* those two constants — no other lines changed — commit and push
without asking first. Still describe what was refreshed (trip/event counts, any pending changes
applied) after the fact. If the diff touches anything else, the normal go-ahead rule applies.
(There used to be two companion `tripsy-trips-refresh-retry`/`-retry-2` tasks that retried the
pending-changes step when a browser session wasn't available; they were removed once that step
became headless — the main task now applies pending changes on every run with no browser, so no
retry is needed.)

Every refresh summary must say whether the top-right Tripsy pending-changes badge is now green
(i.e. whether `tripsyChangesReadyToClear` is true for `driveData.tripsyPendingChanges` given the
just-refreshed `TRIPSY_SNAPSHOT_GENERATED_AT`) — not just what changed. If it's green, say so
explicitly and remind the user they can clear it from the Tripsy Refresh page.

The user runs multiple sessions against this repo (different devices, sometimes in parallel), so
`main` can move without this session knowing. **Every session should start with `git fetch origin`
and a look at `git log main..origin/main`**, before making any local edits — catching divergence
early (as an FYI at the start of a session) is much cheaper than discovering it as a rejected push
after a chunk of work is already done. If `origin/main` has commits this session doesn't, merge
them in (don't discard or force-push over them) and verify the result before continuing.

## Data flow / architecture

All app state lives in **one JSON file in Google Drive** (`flight-log-data.json`), shared between
every signed-in user via the Drive API — this is what keeps desktop and iPad in sync (see the
`STORAGE` section, `index.html:934` area). The in-memory shape is:

```
driveData = {
  invoices: [...],                 // parsed NetJets PDF invoices
  report: {...} | null,            // cached passenger-hours report
  reservations: [...],             // PS reservations, from Gmail
  psBalanceDeductions: [...],      // PS balance deductions, from Gmail
  tripsyPendingChanges: [...],     // queued edit/delete/create changes awaiting push to Tripsy
  tripsyAttachments: [...],        // metadata for docs attached to a trip/event (bytes live in
                                    // their own separate Drive file, not inlined here)
  tripsyParseProposals: [...],     // draft events extracted from a flagged attachment or a
                                    // forwarded confirmation email, awaiting owner review
  tripsyEmailIntake: [...],        // raw forwarded confirmation emails the app found in Gmail,
                                    // awaiting parse by a tripsy-trips-refresh run (see below)
  syncTimestamps: {...},           // { reservations, psBalance, tripsyEmailScan } ISO strings,
                                    // last successful sync/check for each
  gmailCalendarAccessEmails: [...],// lowercased emails (besides OWNER_EMAIL) opted into requesting
                                    // Gmail scope at sign-in, set from the Users utility page
}
```

Note what's conspicuously absent: the Tripsy trip/event data itself. Unlike every other pipeline,
that data never touches `driveData` — it's a separate encrypted blob embedded directly in
`index.html` and refreshed by a scheduled task outside the browser entirely. See "Tripsy Trips"
below.

All reads/writes go through the `Store` object (`index.html:1285`), which mutates
`driveData` in memory and then calls `persistDriveData()` to PATCH the whole file back to Drive.
There is no server — auth and API calls happen entirely client-side via Google Identity Services
(OAuth token client) and the Drive/Gmail REST APIs.

**Auth model** (`index.html:15075`-`15227` area): a single hardcoded `OWNER_EMAIL` gets
read/write access (upload, edit, delete, sync); anyone else who signs in with a Google account the
owner has shared the Drive file with gets read-only access. This is enforced both at the UI level
(hiding buttons) and at the real Google Drive sharing-permission level.

OAuth scope is split into two tiers rather than one flat `DRIVE_SCOPE` string. `DRIVE_SCOPE_BASE`
(`drive` + `userinfo.email`) is what everyone needs, since that's the only way anyone — owner or
viewer — actually reads the shared Drive file. `DRIVE_SCOPE_EXTRA` (`gmail.readonly`) is only
needed by accounts that run the Gmail sync pipelines below — today that's `OWNER_EMAIL`, plus
whoever the owner has opted in from the Users utility page (`driveData.gmailCalendarAccessEmails`,
toggled via `renderUsersListBody()`, `index.html:5479` area). Because Google requires picking OAuth
scope *before* knowing who's signing in, `initGoogleAuth()` can't look up a given browser's real
access level ahead of the consent screen — instead it caches which tier this device needed last
time in `localStorage` (`SCOPE_TIER_KEY`) and requests that same tier again, defaulting to the full
tier when unset so an unrecognized device behaves like before this split existed.
`completeSignIn()` corrects that cached hint after every sign-in once the real identity is known,
so it's only ever wrong for one sign-in per device. This is why toggling a user's access on the
Users page takes effect on their *next* sign-in, not immediately — and note the toggle only
changes which scopes get *requested*; the sync pipelines themselves stay hardcoded to
`OWNER_EMAIL` regardless of who else has the extra scope granted.

The "Authorized Users" list on the Users utility page isn't a separate registry — it's read live
from the Drive file's real sharing permissions (`listDriveFilePermissions()`, `index.html:1001`
area) via `permissions.list`, which is the same source of truth Step 3 on that page tells the owner
to edit directly in Drive's own Share dialog.

### The data pipelines

1. **NetJets invoices** — user uploads a PDF; it's parsed client-side with pdf.js into flight legs,
   passengers, and billed hours. Parser lives in the `PARSER` section
   (`index.html:2581`). It was validated against one real sample invoice and is tuned to
   that exact document template (fixed column x-positions, regexes) — expect to extend it
   carefully as new invoice layouts are seen, not rewrite it generically. Note
   `itemToPosition()` (`index.html:2593`) handles two different PDF text-matrix
   orientations found across pages of the same invoice.
2. **PS Reservations** — Gmail is searched (via `gmail.readonly` scope) for "Confirmed:" emails
   from PS Member Services and parsed into reservation records, keyed by reservation number (not
   Gmail message id, since one reservation can get multiple emails as it changes). See
   `index.html:2015`.
3. **PS Balance** — separate Gmail search over "PS Receipt: Reservation #" emails, parsed into
   discrete balance deductions. See `index.html:2282`.
4. **Tripsy Trips** — see its own section below. Architecturally different from the other three:
   trip data is pulled entirely *outside* the browser (a Claude Code scheduled task talking to a
   Tripsy API connector), not via an in-browser Gmail/API sync.

Pipelines 2-3 share a common UI shape: a "Last synced" timestamp + "Force Sync" button on their
own page (`wireForceSyncButton`/`updateLastSyncedLabel`, `index.html:3075`/`2501` area), **and**
both fire automatically in the background on every app startup (`runBackgroundSyncs`,
`index.html:2506`) — owner-only, run sequentially (not in parallel, to avoid two overlapping Drive
PATCH writes racing each other), refreshing whichever page happens to be open once each finishes.
Cached data always shows immediately on load; syncing happens invisibly behind it
(stale-while-revalidate). Failures are logged, not surfaced to the user, since this runs
unattended on every open. Tripsy Trips does not fit this shape at all — see below for how it
actually refreshes.

### Tripsy Trips (labeled "My Trips" in the nav; render code `index.html:12301`/`14198` area)

Tripsy's own API isn't reachable from a public browser (no public/CORS-friendly developer access),
so there is no in-browser sync at all for this pipeline — unlike PS Reservations/Balance above.
Instead, a daily Claude Code scheduled task (`tripsy-trips-refresh` — see the Git workflow section
above for its push-authorization scope) talks to a Tripsy MCP connector, builds a plain JSON snapshot
of every trip/event in range, and embeds it **encrypted** directly in `index.html` as
`TRIPSY_ENCRYPTED` (AES-256-GCM, key derived via PBKDF2 from a passphrase kept in a private Drive
file, decrypted client-side via `decryptTripsyData()`, `index.html:6471`) — necessary because this
repo is public and the trip data includes confirmation codes, phone numbers, and addresses.
`TRIPSY_SNAPSHOT_GENERATED_AT` tracks when the embedded snapshot was last refreshed. The sync
window is `TRIP_SYNC_DAYS_BACK`/`TRIP_SYNC_DAYS_FORWARD` (`index.html:2450`, currently 60 days
back / 1095 forward, i.e. 3 years).

- **Pending changes, not live writes (headless push via a Drive relay)**: the browser can't call
  Tripsy's API directly, so any edit/delete/create the owner makes on the Trips page (per-event
  Edit/Delete icons, "Delete Trip", the per-trip Add-item menu, "create a new trip" on the review
  page) is queued as a plain-data change in `driveData.tripsyPendingChanges`
  (`Store.queueTripsyChange`/`cancelTripsyChange`/`listTripsyPendingChanges`, `index.html:1454`
  area) rather than applied immediately. A `tripsy-trips-refresh` run (step 1a) applies each to the
  real Tripsy API — **fully headless**: it reads the queue by reading `flight-log-data.json`
  directly via its Drive connector, applies via the `tripsy_` connectors, and (since it can't write
  that file) reports per-change results in a `tripsy-applied-changes.json` Drive relay file. The app
  drains that relay on its next open (`drainTripsyAppliedChanges`/`Store.applyDrainedPushResults`,
  `index.html:2515`/`1858` area): `applied` → removed from the queue, `unverified` →
  `pushConfirmationFailed` (red), `failed` → left to retry. This is the same Drive-relay pattern as
  the email pipeline, in reverse, and it's what lets a refresh push from an iPad Claude session with
  no browser. **The badge flag is confirmation-based, not snapshot-timestamp-based**: a change shows
  yellow ("waiting to push") as long as it's in the queue and not yet explicitly confirmed applied —
  it only clears when a relay marks that exact change `applied` — so a push that fails stays yellow
  instead of being falsely inferred "done" from the snapshot clock advancing. The "Tripsy Refresh"
  utility page (`renderUtilitiesTripsyRefresh`, `index.html:5757`) explains the states and its
  "Check Now" button drains the relays on demand.
- **Attachments, and doc/email parsing — always human-reviewed, never automatic**: the owner can
  attach a file (boarding pass, confirmation, full itinerary) to a trip or event
  (`renderTripsyAttachPanel`, `index.html:7777`; metadata in `driveData.tripsyAttachments`, actual
  bytes uploaded to their own separate Drive file rather than inlined into the shared JSON) and
  optionally flag it "for parsing into trip data." Nothing in the browser reads that flag on its
  own — a separate, on-demand-only Claude Code runbook
  (`~/.claude/scheduled-tasks/tripsy-pdf-parse/RUN_NOW.md`, triggered by asking to "process flagged
  Tripsy docs"; deliberately not scheduled) reads the flagged file and extracts event fields.
  Independently, there's an **email-intake pipeline** for confirmations the owner forwards to
  `kaganworldtravel@gmail.com`. The scan (`scanTripsyEmailIntake`) searches the *owner's own* Sent
  folder for `to:` that address, so it works whether or not that address is actually a separate
  mailbox anyone reads — Gmail always keeps a Sent copy regardless of recipient. It's split so no
  browser is ever needed: the **app** (on any device, owner only, in
  `runTripsyEmailIntake`/`scanTripsyEmailIntake`, `index.html:2515` area) searches Gmail
  for those forwards and appends each one's plain-text body to `driveData.tripsyEmailIntake`; the
  **`tripsy-trips-refresh` task** (step 1b, headless — it reads `flight-log-data.json` directly via
  its Drive connector, which *can* see that file despite older task-doc claims) parses each into
  events and writes them to a separate `tripsy-email-proposals.json` Drive file; the **app** drains
  that file on its next open (`drainTripsyEmailProposals`), staging into the same proposal queue and
  deleting the relay file. Claude never touches the app's domain or `flight-log-data.json` writes.
  Both sources stage their finds into the exact same queue, `driveData.tripsyParseProposals`
  (`Store.saveTripsyParseProposal`, `index.html:1760`) — **nothing extracted becomes a real Tripsy
  change until the owner explicitly reviews it** on the "Review Parsed Docs" page
  (`renderTripsyParseReview`, `index.html:13995` area): Import / Modify-then-import / Reject per
  event, with a trip-reassignment dropdown (or "Create a new trip") if the date-based guess is
  wrong. A small green ✓ circle appears directly on any trip card whose date range matches a
  still-pending proposal event (`data-tripsy-review-proposals`) — green, not yellow, because by the
  time a proposal is matched to a trip the parsing is already done and it's the owner's turn to
  review (see the badge color rule below).
- **The consolidated top-right status badge** (`tripsy-status-badge`, `index.html:875`;
  `computeTripsyStatus`/`updateTripsyStatusBadge`/`renderTripsyStatusPanel`, `index.html:13795`
  area) is a single indicator with three prioritized states, replacing what used to be two separate
  badges (pending-changes + doc-parse). The color rule is consistent across every Tripsy signal:
  **red 🛑** = a push genuinely failed/unverified; **yellow ⚠️** = a Claude step is needed (changes
  waiting to push, docs flagged-but-unparsed, or emails saved-but-unparsed) — yellow deliberately
  outranks green so the owner runs the refresh first; **green 🟢** = the owner's turn in the app
  (proposals to review). There's no green "clear the pushed changes" state anymore — applied changes
  are auto-removed from the queue when a relay confirms them, so a queued change is always either
  yellow (unconfirmed) or red (unverified). Clicking opens a panel listing the specific reason(s)
  for the current state, each linking to where it's handled. Per-trip flags are always green (a
  matched proposal is post-parse by definition); yellow lives only in this global badge. Owner-only.
  `tripsyEmailsAwaitingParseCount()` reads `driveData.tripsyEmailIntake` (entries not yet
  `parsedAt`) to drive the yellow "N forwarded emails waiting to be parsed" reason.
- **Categories**: flight / transportation / hotel / dining / concert / tour / other, derived from
  Tripsy's own activity/transportation type slugs at refresh time (see `tripsy-trips-refresh`'s own
  category-mapping step for the exact rules) — unlike the old TripIt integration this replaced,
  there's no category that can *only* ever be set by a manual edit.
- **Manual edit overrides**: the per-event Edit panel queues an `edit_event`/`edit_trip` pending
  change (see above) rather than touching the locally-decrypted snapshot directly — the edit only
  becomes real once a refresh applies it, at which point the next snapshot pull reflects it
  natively (there's no separate client-side override layer to reconcile, unlike TripIt's old
  `ev.overrides` model).
- **Display times are the event's own local time, not the viewer's**: event start/end are stored
  as literal local-time digits (no real UTC offset) by the refresh task, and read back out verbatim
  by `parseTripLocalParts`/`formatTripTime` (`index.html:6235` area) rather than being
  reinterpreted through the browser's own time zone — a flight's 4:25pm departure should read
  4:25pm no matter where the app is being viewed from.
- **Collapse/expand per trip card** is a personal display preference stored in `localStorage`
  (`isTripsyTripCollapsed`/`setTripsyTripCollapsed`, `index.html:6313` area) — deliberately *not*
  in `driveData`, since view-only users have no Drive write access to persist anything into the
  shared file.

### Review / ambiguity resolution

Parsed invoice legs that couldn't be fully/confidently parsed get `_warnings` and show up in the
**Review Queue**; a human resolves them by editing fields, which clears `_warnings` and triggers a
passenger-report recompute (`resolveLeg()`, `index.html:3313`). Airport-code ambiguities
are resolved via a separate lazily-fetched airport-code lookup.

### View routing

No framework/router — `navigate(view, param)` (`index.html:3383`) is a plain if/else
dispatcher that renders into a single `#main` element by calling one of the `render*` functions.
Nav rail buttons carry `data-view`/`data-param` attributes wired up at the bottom of the file.
Key views and where to find them:

| View | Function | Location |
|---|---|---|
| Home dashboard | `renderHome` | `index.html:14758` |
| Upload PDF invoice | `renderUpload` | `index.html:3460` |
| Invoice list / detail | `renderInvoiceList` / `renderInvoiceDetail` | `index.html:3608` / `3683` |
| Review Queue / Resolved Issues | `renderReviewQueue` / `renderResolvedIssues` | `index.html:4189` / `4251` |
| Passenger report (Hours/Legs/Flight Log × Totals/Kagan/Lopata) | `renderPassengerReport` | `index.html:4954` |
| PS Reservations / Balance / Invoices | `renderReservations` / `renderPsBalance` / `renderPsInvoices` | `index.html:5193` / `5617` / `5251` |
| My Trips (Tripsy) | `renderTripsyTrips` | `index.html:14198` |
| Review Parsed Docs (Tripsy proposal review) | `renderTripsyParseReview` | `index.html:13995` |
| Trends chart | `renderTrends` | `index.html:14524` |

Utilities-only views (Users, Delete/Re-Parse PS Reservations & Invoices) are owner-only, hidden in
the nav until sign-in confirms `isOwner`.

The NetJets report's Hours/Legs/Flight Log mode is a nav-rail-driven toggle (not a URL param) —
`passengerReportMode`, set by clicking the nav submenu items, independent of the
Totals/Kagan/Lopata filter which *is* passed as `navigate`'s `param`.

## Notable constraints

- **iPad/Safari compatibility**: the pdf.js version is pinned and several ES2024 features
  (`Promise.withResolvers`, `ReadableStream` async iteration, `Array.fromAsync`) are polyfilled by
  hand at the top of the file (`index.html:28` area) because Claude's iPad app WebView lacks
  them. Do not "simplify" by bumping pdf.js or removing these polyfills without testing on that
  WebView specifically — both have caused real, previously-fixed crashes.
- **Responsive layout**: a single `@media (max-width: 1100px)` block (`index.html:342` area)
  collapses the left nav rail into a horizontal scrollable top bar. The 1100px threshold is
  deliberate, not arbitrary — it needs to clear a 12.9" iPad Pro's portrait width (1024px CSS
  pixels) while still showing the normal sidebar in that same device's landscape orientation
  (1366px). If nav layout looks wrong on a specific device, check its CSS viewport width against
  this breakpoint before changing anything else.
- Everything — HTML, CSS, and JS — lives in this one file by design (it's distributed/opened as a
  single artifact). Don't split it into separate files/modules unless explicitly asked.
- **FOP-BP branding easter egg**: clicking either logo (`#fopbp-logo-splash`/`#fopbp-logo-signin`,
  the small logo, or `#fopbp-logo-home`/`#fopbp-logo-tripsytrips`/`#fopbp-logo-netjetsoverview`,
  the wide banner) shows a crew photo full-screen for 4 seconds
  (`showFopBpPhoto`/`hideFopBpPhoto`, `index.html:14615` area) via a single shared
  `#fopbp-photo-overlay` div. Purely cosmetic, no data involved — if these ids ever stop resolving
  (e.g. a page's markup gets restructured), the click handler will throw on
  `getElementById(...).addEventListener`, so keep the ids in sync with wherever the logos move.
