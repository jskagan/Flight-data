# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Travel Tracker is a single self-contained HTML file (`index.html`, ~5,800 lines) — no build step,
no package manager, no test suite. It's a private, invite-only web app for tracking one family's
NetJets fractional-jet usage, The Private Suite ("PS", the LAX private terminal)
reservations/billing, and a TripIt-synced Trips view (flights, hotels, and other reservations,
pulled via Google Calendar).

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
applied) after the fact. If the diff touches anything else, the normal go-ahead rule applies. This
exception also covers the `tripsy-trips-refresh-retry` and `tripsy-trips-refresh-retry-2` scheduled
tasks (9:00am/9:30am conditional retries of that same task's pending-changes step) — same scope,
same diff restriction, no separate authorization needed for them.

The user runs multiple sessions against this repo (different devices, sometimes in parallel), so
`main` can move without this session knowing. **Every session should start with `git fetch origin`
and a look at `git log main..origin/main`**, before making any local edits — catching divergence
early (as an FYI at the start of a session) is much cheaper than discovering it as a rejected push
after a chunk of work is already done. If `origin/main` has commits this session doesn't, merge
them in (don't discard or force-push over them) and verify the result before continuing.

## Data flow / architecture

All app state lives in **one JSON file in Google Drive** (`flight-log-data.json`), shared between
every signed-in user via the Drive API — this is what keeps desktop and iPad in sync (see the
`STORAGE` section, `index.html:553` area). The in-memory shape is:

```
driveData = {
  invoices: [...],                 // parsed NetJets PDF invoices
  report: {...} | null,            // cached passenger-hours report
  reservations: [...],             // PS reservations, from Gmail
  psBalanceDeductions: [...],      // PS balance deductions, from Gmail
  tripitEvents: [...],             // flat list of synced TripIt/Calendar events (see below)
  tripitTripOverrides: {...},      // per-trip hidden/shown overrides, keyed by trip key
  syncTimestamps: {...},           // { reservations, psBalance, tripit } ISO strings, last successful sync
  gmailCalendarAccessEmails: [...],// lowercased emails (besides OWNER_EMAIL) opted into requesting
                                    // Gmail/Calendar scope at sign-in, set from the Users utility page
}
```

All reads/writes go through the `Store` object (`index.html:716`), which mutates
`driveData` in memory and then calls `persistDriveData()` to PATCH the whole file back to Drive.
There is no server — auth and API calls happen entirely client-side via Google Identity Services
(OAuth token client) and the Drive/Gmail/Calendar REST APIs.

**Auth model** (`index.html:5626` area to end): a single hardcoded `OWNER_EMAIL` gets
read/write access (upload, edit, delete, sync); anyone else who signs in with a Google account the
owner has shared the Drive file with gets read-only access. This is enforced both at the UI level
(hiding buttons) and at the real Google Drive sharing-permission level.

OAuth scope is split into two tiers rather than one flat `DRIVE_SCOPE` string. `DRIVE_SCOPE_BASE`
(`drive` + `userinfo.email`) is what everyone needs, since that's the only way anyone — owner or
viewer — actually reads the shared Drive file. `DRIVE_SCOPE_EXTRA` (`gmail.readonly` +
`calendar.readonly`) is only needed by accounts that run the Gmail/Calendar sync pipelines below —
today that's `OWNER_EMAIL`, plus whoever the owner has opted in from the Users utility page
(`driveData.gmailCalendarAccessEmails`, toggled via `renderUsersListBody()`,
`index.html:4499` area). Because Google requires picking OAuth scope *before* knowing who's
signing in, `initGoogleAuth()` can't look up a given browser's real access level ahead of the
consent screen — instead it caches which tier this device needed last time in `localStorage`
(`SCOPE_TIER_KEY`) and requests that same tier again, defaulting to the full tier when unset so an
unrecognized device behaves like before this split existed. `completeSignIn()` corrects that cached
hint after every sign-in once the real identity is known, so it's only ever wrong for one sign-in
per device. This is why toggling a user's access on the Users page takes effect on their *next*
sign-in, not immediately — and note the toggle only changes which scopes get *requested*; the
sync pipelines themselves stay hardcoded to `OWNER_EMAIL` regardless of who else has the extra
scope granted.

The "Authorized Users" list on the Users utility page isn't a separate registry — it's read live
from the Drive file's real sharing permissions (`listDriveFilePermissions()`, `index.html:658`
area) via `permissions.list`, which is the same source of truth Step 3 on that page tells the owner
to edit directly in Drive's own Share dialog.

### The four data pipelines

1. **NetJets invoices** — user uploads a PDF; it's parsed client-side with pdf.js into flight legs,
   passengers, and billed hours. Parser lives in the `PARSER` section
   (`index.html:1596`). It was validated against one real sample invoice and is tuned to
   that exact document template (fixed column x-positions, regexes) — expect to extend it
   carefully as new invoice layouts are seen, not rewrite it generically. Note
   `itemToPosition()` (`index.html:1608`) handles two different PDF text-matrix
   orientations found across pages of the same invoice.
2. **PS Reservations** — Gmail is searched (via `gmail.readonly` scope) for "Confirmed:" emails
   from PS Member Services and parsed into reservation records, keyed by reservation number (not
   Gmail message id, since one reservation can get multiple emails as it changes). See
   `index.html:974`.
3. **PS Balance** — separate Gmail search over "PS Receipt: Reservation #" emails, parsed into
   discrete balance deductions. See `index.html:1237`.
4. **TripIt Trips** — see its own section below (`index.html:1402`).

All three sync-based pipelines (2-4) share the same UI shape: a "Last synced" timestamp + "Force
Sync" button on their own page (`wireForceSyncButton`/`updateLastSyncedLabel`,
`index.html:1978` area), **and** all three fire automatically in the background on every app
startup (`runBackgroundSyncs`, `index.html:1559`) — owner-only, run sequentially (not
in parallel, to avoid two overlapping Drive PATCH writes racing each other), refreshing whichever
page happens to be open once each finishes. Cached data always shows immediately on load; syncing
happens invisibly behind it (stale-while-revalidate). Failures are logged, not surfaced to the
user, since this runs unattended on every open.

### TripIt Trips (`index.html:1402` section; render code `index.html:4627` area)

TripIt's own developer API is closed to new integrations, and its `.ics` feed isn't reliably
fetchable from a browser (no CORS headers). Instead: **the user subscribes their own Google
Calendar to TripIt's feed** (one-time manual step in Google Calendar's UI, outside this app), and
`syncTripitFromCalendar()` (`index.html:1482`) reads that calendar via the Google Calendar API —
found by name match (any calendar with "tripit" in its title, `findTripitCalendarId`,
`index.html:1430`) — over a rolling window (`TRIPIT_SYNC_DAYS_BACK`/`FORWARD`, currently 60 days
back / 1095 forward, i.e. 3 years).

- **Trip grouping**: Calendar API events are flat (no `tripId`), but TripIt's feed emits one
  all-day "trip header" event per trip whose `description` starts with `"<name> is in <location>"`
  — `classifyTripitEvent()` (`index.html:1465`) detects these, and `groupTripitEventsIntoTrips()`
  (`index.html:4760`) reconstructs trips from them at render time by date-range containment.
  Events matching no header land in a synthetic "Other Plans" bucket rather than being dropped.
- **Categories**: flight / transportation / lodging / dining / concert / tour / other. Only
  flight/transportation/lodging/other are ever auto-detected (via a bracket tag TripIt embeds in
  the description, e.g. `[Flight]`, with keyword fallback); dining/concert/tour only ever get set
  by a manual edit. Categories drive left-edge indentation on the Trips page (flights flush left,
  more specific categories indent further).
2. **Hide vs. delete** (both event- and trip-level) — two *different*, both non-destructive-by-
   default mechanisms:
   - Hiding: per-event (`Store.setTripitEventHidden`) or per-trip
     (`Store.setTripitTripOverride`, keyed by a stable trip key = the header event's Calendar id,
     or a fixed `TRIPIT_OTHER_PLANS_KEY` for the Other Plans bucket). Reversible from the page's
     "Show Hidden" panel / each card's "Show Hidden Events" button. Trips also auto-hide once
     `TRIPIT_AUTO_HIDE_DAYS` (10) past their last activity — *unless* explicitly un-hidden via
     "Show", which overrides the auto-hide rule permanently until re-hidden (`isTripEffectivelyHidden`,
     `index.html:4816`).
   - Deleting: `syncTripitFromCalendar()` permanently removes an entire trip's events once
     `TRIPIT_AUTO_DELETE_DAYS` (60) past last activity — on every sync, including already-hidden
     events, and cleans up the orphaned override. This is separate from (and independent of) the
     10-day hide rule and from the Calendar API's own fetch window.
- **Manual edit overrides**: the per-event Edit panel lets you correct date/description/category/
  notes without touching the synced data — stored as `ev.overrides` and resolved via
  `getEffectiveTripitEvent()`, which every grouping/sorting/rendering path reads through, so an
  edited date can move an event into a different trip. "Reset to synced data" clears the override.
- **Hidden state survives re-sync**: since each sync wholesale-replaces `driveData.tripitEvents`
  from a fresh Calendar API pull, `hidden` and `overrides` are explicitly carried forward by
  matching Calendar event ids between the old and new lists (Calendar ids are stable for the same
  underlying event).
- **Display times are the event's own local time, not the viewer's**: `formatTripitTime`/
  `formatTripitDateRange` (`index.html:4680` area) read the literal date/time digits straight out
  of the stored ISO string rather than letting `new Date(...).toLocaleString()` reinterpret them in
  the browser's time zone — a flight's 4:25pm departure should read 4:25pm no matter where the app
  is being viewed from.
- **Collapse/expand per trip card** is a personal display preference stored in `localStorage`
  (`isTripCollapsed`/`setTripCollapsed`, `index.html:4599` area) — deliberately *not* in
  `driveData`, since view-only users have no Drive write access to persist anything into the
  shared file.
- Home's "Upcoming Trips" card and the Trips page's bottom-left icon row (NetJets/P-S/Home) are
  just extra entry points into the same `renderTripitTrips`/`groupTripitEventsIntoTrips` code —
  no separate data path.

### Review / ambiguity resolution

Parsed invoice legs that couldn't be fully/confidently parsed get `_warnings` and show up in the
**Review Queue**; a human resolves them by editing fields, which clears `_warnings` and triggers a
passenger-report recompute (`resolveLeg()`, `index.html:2315`). Airport-code ambiguities
are resolved via a separate lazily-fetched airport-code lookup.

### View routing

No framework/router — `navigate(view, param)` (`index.html:2382`) is a plain if/else
dispatcher that renders into a single `#main` element by calling one of the `render*` functions.
Nav rail buttons carry `data-view`/`data-param` attributes wired up at the bottom of the file.
Key views and where to find them:

| View | Function | Location |
|---|---|---|
| Home dashboard | `renderHome` | `index.html:5357` |
| Upload PDF invoice | `renderUpload` | `index.html:2454` |
| Invoice list / detail | `renderInvoiceList` / `renderInvoiceDetail` | `index.html:2602` / `2677` |
| Review Queue / Resolved Issues | `renderReviewQueue` / `renderResolvedIssues` | `index.html:3183` / `3245` |
| Passenger report (Hours/Legs/Flight Log × Totals/Kagan/Lopata) | `renderPassengerReport` | `index.html:3760` |
| PS Reservations / Balance / Invoices | `renderReservations` / `renderPsBalance` / `renderPsInvoices` | `index.html:4004` / `4246` / `4039` |
| Trips (TripIt via Google Calendar) | `renderTripitTrips` | `index.html:5115` |
| Trends chart | `renderTrends` | `index.html:5197` |

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
- **Responsive layout**: a single `@media (max-width: 1100px)` block (`index.html:332` area)
  collapses the left nav rail into a horizontal scrollable top bar. The 1100px threshold is
  deliberate, not arbitrary — it needs to clear a 12.9" iPad Pro's portrait width (1024px CSS
  pixels) while still showing the normal sidebar in that same device's landscape orientation
  (1366px). If nav layout looks wrong on a specific device, check its CSS viewport width against
  this breakpoint before changing anything else.
- Everything — HTML, CSS, and JS — lives in this one file by design (it's distributed/opened as a
  single artifact). Don't split it into separate files/modules unless explicitly asked.
- **FOP-BP branding easter egg**: clicking either logo (`#fopbp-logo-splash`/`#fopbp-logo-signin`,
  the small logo, or `#fopbp-logo-home`/`#fopbp-logo-trips`, the wide banner) shows a crew photo
  full-screen for 4 seconds (`showFopBpPhoto`/`hideFopBpPhoto`, `index.html:5216` area) via a
  single shared `#fopbp-photo-overlay` div. Purely cosmetic, no data involved — if these ids ever
  stop resolving (e.g. a page's markup gets restructured), the click handler will throw on
  `getElementById(...).addEventListener`, so keep the ids in sync with wherever the logos move.
