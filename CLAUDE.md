# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Travel Tracker is a single self-contained HTML file (`index.html`, ~15,300 lines) — no build step,
no package manager, no test suite. It's a private, invite-only web app for tracking one family's
NetJets fractional-jet usage, The Private Suite ("PS", the LAX private terminal)
reservations/billing, and a Trips view (labeled "My Trips" in the nav — flights, hotels, and
other reservations) whose data lives in its own private Drive file, `trips-data.json` (see "Tripsy
Trips" below — the name survives from the Tripsy service the data was migrated off on 2026-08-04).

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

(The old "Tripsy snapshot-only refresh" auto-push exception is retired with the Tripsy migration —
there is no snapshot to refresh anymore; every push needs the normal go-ahead.)

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
  tripsyPendingChanges: [...],     // VESTIGIAL (always empty since the Tripsy migration): trip
                                    // changes now apply directly to trips-data.json
  tripsyAttachments: [...],        // metadata for docs attached to a trip/event (bytes live in
                                    // their own separate Drive file, not inlined here)
  tripsyGeneratedPdfs: [...],      // metadata for saved "Generate PDF" exports (same separate-
                                    // Drive-file-for-bytes shape as tripsyAttachments), so Preview
                                    // can offer a past export back when a trip has more than one
  tripsyParseProposals: [...],     // draft events extracted from a flagged attachment or a
                                    // forwarded confirmation email, awaiting owner review
  tripsyEmailIntake: [...],        // raw forwarded confirmation emails the app found in Gmail,
                                    // awaiting the scheduled cloud parse run (see below)
  tripsyUpdatePages: [...],        // saved Itinerary -> Update comparisons (tour-operator PDF vs.
                                    // Tripsy), one per trip, kept until every row is resolved or a
                                    // referenced event is edited some other way (see below)
  syncTimestamps: {...},           // { reservations, psBalance, tripsyEmailScan } ISO strings,
                                    // last successful sync/check for each
  gmailCalendarAccessEmails: [...],// lowercased emails (besides OWNER_EMAIL) opted into requesting
                                    // Gmail scope at sign-in, set from the Users utility page
}
```

Note what's conspicuously absent: the trip/event data itself. It lives in its own Drive file,
`trips-data.json`, read/written directly by the app (same folder, same sharing model) — kept
separate so the large trips payload isn't rewritten on every unrelated save. See "Tripsy Trips"
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

**Trip data lives in a private Drive file, `trips-data.json`** (same folder as
`flight-log-data.json`; shape `{schemaVersion, updatedAt, trips:[...]}`), loaded by
`ensureTripsyDecrypted()`/`fetchTripsDataFromDrive` and cached as `tripsyDecryptedTrips` (both
names kept from the earlier era so their many readers stayed untouched). Access control is Drive
sharing itself, exactly like `flight-log-data.json` — no passphrase, no encryption. **This data
was migrated OFF Tripsy on 2026-08-04**: it was exported once via `tools/build_tripsy_snapshot.py`
(kept in the repo — it documents the raw→display transform and will drive the planned backfill of
pre-2026 historical trips, which are not in the file yet); Tripsy itself is now a **frozen
archive** that the app neither reads nor writes. Before that, the data was an AES-encrypted
point-in-time snapshot baked into this public file and republished by a thrice-daily "Tripsy Trips
Refresh" cloud routine — that whole apparatus (encrypted blob, passphrase, pending-changes queue,
push/applied relays, Tripsy Refresh utility page, refresh lifecycle) was removed in the migration's
step 4; git history has it if ever needed.

- **Direct writes — every edit is real the moment it saves**: any edit/delete/create the owner
  makes on the Trips page (per-event Edit/Delete icons, "Delete Trip", the per-trip Add-item menu,
  doc-parse imports, "create a new trip" on the review page) still funnels through the ONE entry
  point `Store.queueTripsyChange` (name kept so its dozens of call sites stayed untouched), which
  now applies the same plain-data change object directly to the trips array via
  `applyTripsyChangeToTrips` — display fields re-derived with `tripsyRawToDisplay`, created events
  minted local numeric ids by `tripsyMintLocalId()` (epoch-millis-scaled, far above Tripsy's old id
  ranges), trips/events kept sorted, arrays REPLACED rather than mutated so a failed save rolls
  back by restoring the prior reference — then writes the whole file back with `persistTripsData()`
  (same optimistic-concurrency head-revision guard as `persistDriveData`: a conflicting write from
  another device reloads the newer copy, re-applies this change onto it, and retries, bounded).
  `importTripsyParseProposalEvent`/`acceptTripsyParseProposalCluster` split into two ordered writes
  (trip data first, then proposal bookkeeping in `flight-log-data.json`, each with conflict retry).
  `driveData.tripsyPendingChanges` still exists in the data model but is permanently empty; the
  timeline's pending-overlay plumbing (`getEffectiveTripsyEvent`/`getEffectiveTripsyTrip`,
  `pendingCreates`, `cancelTripsyChange`) is retained but inert-on-empty by construction.
- **Attachments, and doc/email parsing — always human-reviewed, never automatic**: the owner can
  attach a file (boarding pass, confirmation, full itinerary) to a trip or event
  (`renderTripsyAttachPanel`, `index.html:7777`; metadata in `driveData.tripsyAttachments`, actual
  bytes uploaded to their own separate Drive file rather than inlined into the shared JSON) and
  optionally flag it "for parsing into trip data." Nothing in the browser reads that flag on its
  own; the parsing is headless and automatic, mirroring the email-intake pipeline below (as of
  2026-07-22 — previously it was desktop/browser-only). The **`tripsy-trips-refresh` cloud routine**
  (step 1c) reads `flight-log-data.json` for attachments with `purpose:'parse'` and
  `parseStatus:'pending'`, downloads each flagged file straight from Drive via its Drive connector
  (`download_file_content` — the full-scope connector *can* read these app-uploaded attachments,
  despite older task-doc claims to the contrary), extracts event fields, and writes a
  `tripsy-doc-proposals.json` relay the app drains on its next open (`drainTripsyDocProposals` →
  `Store.applyDrainedDocProposals`). So flagged documents parse with NO browser or desktop — the
  whole flow works from an iPad (upload+flag → cloud parses 3×/day → review/import). **Supported
  formats: PDF, Word `.docx`, and images** (`image/jpeg`/`png`/`heic`/`webp`/`gif` — a photo or
  screenshot of a printed itinerary/confirmation, read natively by the Read tool's vision). This
  parse logic lives in the cloud routine's inline prompt (managed at
  `https://claude.ai/code/routines`, since the cloud sandbox can't read `.claude/`); if you change
  what formats parse, update it there. The owner can also fire it on demand from the badge panel's
  **Run Parse Now** button (via the Cloudflare Worker).
  Independently, there's an **email-intake pipeline** for confirmations the owner forwards to
  `kaganworldtravel@gmail.com`. The scan (`scanTripsyEmailIntake`) searches the owner's Gmail for
  that address in *either* direction — `(to:kaganworldtravel@gmail.com OR from:kaganworldtravel@gmail.com)`
  — so it catches both confirmations the owner forwarded *to* the alias (a Sent copy Gmail always
  keeps, whether or not the alias is a separate mailbox) *and* ones the alias account forwarded back
  *to* the owner's inbox. (It used to be `in:sent to:alias`, which silently missed the alias→owner
  direction — a real reservation update was lost that way; dedup is per message-id.) It's split so no
  browser is ever needed: the **app** (on any device, owner only, in
  `runTripsyEmailIntake`/`scanTripsyEmailIntake`, `index.html:2515` area) searches Gmail
  for those forwards and appends each one's plain-text body to `driveData.tripsyEmailIntake`; the
  **cloud parse routine** (headless — it reads `flight-log-data.json` directly via its Drive
  connector) parses each into
  events and writes them to a separate `tripsy-email-proposals.json` Drive file; the **app** drains
  that file on its next open (`drainTripsyEmailProposals`), staging into the same proposal queue and
  deleting the relay file. Claude never touches the app's domain or `flight-log-data.json` writes.
  **Email *attachments* are captured too (as of 2026-07-24).** `scanTripsyEmailIntake` also walks each
  forwarded email's payload for a real parseable attachment (image/PDF/`.docx`; inline logos and
  tracking pixels are filtered out by requiring `Content-Disposition: attachment` or size ≥ 40KB),
  fetches its bytes from Gmail, uploads them to their own Drive file, and stages each as a
  `scope:'email'`, `purpose:'parse'` entry in `driveData.tripsyAttachments` (deduped by
  `sourceEmailId`+`gmailAttachmentId`). This deliberately reuses the **document** pipeline rather than
  the email one: the attachment is then read by the routine's doc-parse step (which handles
  images), NOT the email-body step — so an image-only confirmation (empty text body, all the detail
  in the photo) doesn't arrive with `bodyLen=0` and get marked `empty`. `scope:'email'` keeps
  these off trip cards; they show on the Parsing Docs page as "from a forwarded email". Only *new*
  forwards benefit — an already-scanned email id isn't re-fetched.
  Both sources stage their finds into the exact same queue, `driveData.tripsyParseProposals`
  (`Store.saveTripsyParseProposal`, `index.html:1760`) — **nothing extracted becomes a real Tripsy
  change until the owner explicitly reviews it** on the "Review Parsed Docs" page
  (`renderTripsyParseReview`, `index.html:13995` area): Import / Modify-then-import / Reject per
  event, with a trip-reassignment dropdown (or "Create a new trip") if the date-based guess is
  wrong. A small badge appears directly on any trip card whose date range matches a
  still-pending proposal event (`data-tripsy-review-proposals`): a **green ✓ circle** when the owner
  just needs to review it, but a **bare yellow ⚠️ triangle** (no circular chip) while any of that
  trip's pending proposal events still has an unresolved potential conflict
  (`pendingParseTripConflicts`, judged with `tripsyParseConflictTripKeys`/`tripsyParseFindConflicts`)
  — it stays yellow until the conflict is resolved (import-with-conflict, modify one side out of
  overlap, delete the existing event, or ignore the new one), then flips to the green circle (see the
  badge color rule below).
- **The consolidated top-right status badge** (`tripsy-status-badge`;
  `computeTripsyStatus`/`updateTripsyStatusBadge`/`renderTripsyStatusPanel`) is a single indicator
  with three prioritized states: **red 🛑** = a Drive write genuinely failed (in-memory
  `tripsyFailedWrites`, recorded by `tripsyRecordFailedWrite` inside `queueTripsyChange`'s catch —
  each entry renders its own "Write Failed" block with a Dismiss button and stays until the owner
  dismisses it; an auth-expired failure gets a clearer "Session Expired → reload & sign in"
  treatment); **yellow ⚠️** = a Claude parse step is needed (docs flagged-but-unparsed via
  `parseStatus:'pending'`, or forwarded emails saved-but-unparsed via
  `tripsyEmailsAwaitingParseCount()`), *or* any trip card is showing its yellow ⚠️ conflict flag
  (`tripsyParseConflictTripKeys` — the global badge mirrors any individual trip flag), *or* —
  transient, never persisted — a Drive write is in flight right now (`tripsyInFlightWrites`,
  wrapped generically around `queueTripsyChange` by
  `tripsyBeginInFlightWrite`/`tripsyEndInFlightWrite`, rendered as plain non-clickable text);
  **green 🟢** = the owner's turn in the app (proposals to review). Yellow outranks green so the
  owner clears the parse step first. Clicking opens a panel listing each specific reason, linking to
  where it's handled, plus (non-green states) a **Run Parse Now** button that fires the cloud parse
  routine through the Cloudflare Worker (`runTripsyRefreshViaWorker`, gated by the owner-only
  "Tripsy Refresh Worker Secret" Drive file). One caveat: conflict detection needs the loaded trips
  to date-match proposals against, so before `trips-data.json` loads the badge can briefly read
  green while a trip card would read yellow — `syncTripsyRelays` loads trips before its badge
  refresh and `renderTripsyEventsList` refreshes the badge after each render to close that gap.
  Owner-only.
- **Categories**: flight / transportation / hotel / dining / concert / tour / spa / reception /
  cooking / other — each event's display `type`, derived from its `tripsyRaw.category` slug
  (`TRIPSY_ACTIVITY_CATEGORY_TO_TYPE`, mirrored in `tools/build_tripsy_snapshot.py`), including the
  owner's custom category slugs.
- **Manual edit overrides**: the per-event Edit panel queues an `edit_event`/`edit_trip` pending
  change (see above) rather than touching the locally-decrypted snapshot directly — the edit only
  becomes real once a refresh applies it, at which point the next snapshot pull reflects it
  natively (there's no separate client-side override layer to reconcile, unlike TripIt's old
  `ev.overrides` model). Saving is optimistic: `renderTripsyEditPanel`'s Save handler (the one form
  behind the timeline's own Edit button, the Add-item panel, and a pending-create item's Edit) closes
  the panel and fires `onClose` immediately, then does the (geocode, for a new activity, plus) actual
  `Store.queueTripsyChange` write in the background — so queuing one change never delays the owner
  from immediately opening and saving another, anywhere in the app. The surrounding timeline isn't
  re-rendered until that write actually succeeds; if it fails instead, this SAME panel node reopens
  pre-filled with exactly what was typed (not the original values) plus an error toast, so nothing
  is lost. `renderTripsyEditTripPanel`'s Save does the same. The one exception is the Review Parsed
  Docs page's inline "Modify New"/"Modify Existing" conflict editors, which pass a `createOptions.onSave`
  callback instead of writing directly — that's a different feature's own async flow (with its own
  `rerender()`/`ctx.overrides` bookkeeping) and stays blocking.
- **Typing a name on a LODGING or DINING form auto-fills address + website**
  (`tripsyWireNameLookupAutofill`, backed by `tripsyLookupPlaceContactDetails` — the same
  Places `searchText` endpoint as the geocoder, different field mask). Only those two: every
  `hosting` event, and an `activity` whose category is `restaurant` — a concert or tour is named
  for the performance rather than the venue, and transportation has no name field. It fires on
  `change` (blur/Enter), never `input`, so it's one billed call per finished name; it only fills
  a field that is EMPTY, so it can only ever add information; the trip's own `location` is
  appended to the query (bare "Founders" resolves somewhere arbitrary); a request token makes it
  latest-wins; and filled fields get a synthetic `input` event so the form's change detection
  reveals Save/Cancel rather than leaving an auto-filled address looking already-saved. It names
  the matched place in a small status line under the field so a wrong match is obvious. Fails
  soft and silently — no Places key, no match, or a network error just leaves the fields blank.
- **Display times are the event's own local time, not the viewer's**: event start/end are stored
  as literal local-time digits (no real UTC offset) by the refresh task, and read back out verbatim
  by `parseTripLocalParts`/`formatTripTime` (`index.html:6235` area) rather than being
  reinterpreted through the browser's own time zone — a flight's 4:25pm departure should read
  4:25pm no matter where the app is being viewed from.
  **The corollary bites when you need "today"**: because event days carry no real offset, comparing
  them against a device-clock date is comparing two different things. Travel View's open-on-today
  jump got this wrong and opened on TOMORROW for a traveler whose device timezone hadn't caught up
  (a WiFi-only iPad, or checking before departure) — one day off across the midnight boundary.
  `tripsyTravelViewTodayKey(trip, firstDay, lastDay)` takes the real UTC instant (`new Date()` is
  still trustworthy for that — only deriving a LOCAL date from it was wrong) and reinterprets it
  through an IANA zone actually carried on one of the trip's own events (`timezone`, or a
  transportation leg's `departureTimezone`/`arrivalTimezone`), accepting it only when that zone's
  today falls inside the trip's date range AND is within a day of the device's own guess — the
  second guard stops one stray or malformed zone on an odd record from hijacking the answer. Falls
  back to the device date when nothing qualifies. Note `tripsyTravelTripCandidates` still uses a
  device-local today deliberately: it picks WHICH trip is current, so there's no trip-specific zone
  to reinterpret through yet.
- **Itinerary/day views start from the earliest event, not the trip's `start_date`**: the day
  ranges, "Day N" numbering, and empty-day span all derive their first day from
  `tripsyItineraryStartDayKey(trip)` — the earliest day any visible, dated event falls on — rather
  than the trip's own `starts_at` (which drifts, e.g. Tripsy leaving the old start after a flight
  time moves, producing a leading day with nothing on it). Falls back to `trip.start` only when the
  trip has no dated events. The range's *end* is derived the same way from
  `tripsyItineraryEndDayKey(trip)` (the last day any visible dated event falls on), so a stale
  `end_date` can't add a trailing empty day either.
- **Collapse/expand per trip card** is a personal display preference stored in `localStorage`
  (`isTripsyTripCollapsed`/`setTripsyTripCollapsed`, `index.html:6313` area) — deliberately *not*
  in `driveData`, since view-only users have no Drive write access to persist anything into the
  shared file.
- **The "Update" comparison (tour-operator PDF vs. Tripsy) is saved, not ephemeral**: the owner can
  upload a PDF from a trip's Itinerary → Modify → Update menu, which calls
  `compareTripsyItineraryPdf` (`claude-sonnet-5`, streamed `json_schema`; sets `thinking:
  {type:'adaptive'}` + `effort: 'medium'` EXPLICITLY — see the Attire section's note on Sonnet 5's
  adaptive-thinking-by-default trap, which this call had too; raise to `high` first if comparison
  accuracy regresses) and shows a row per PDF/Tripsy difference (match/conflict/pdf_only/
  tripsy_only) for the owner to Accept/Ignore/Modify/Add/Delete one at a time — a `pdf_only` row's
  "Modify New" combines Add Event's instant `create_event` queue with immediately opening that new
  pending item's own edit form (the same one the timeline's pencil icon on a pending-create row
  opens), pre-filled with whatever Claude already extracted, rather than requiring a separate Add
  then a separate Edit (`handleTripsyUpdateModifyNew`, `index.html:13621` area)
  (`runTripsyUpdateComparison`, `index.html:13634` area). The result is saved to
  `driveData.tripsyUpdatePages` (one entry per trip, `Store.getTripsyUpdatePage`/
  `saveTripsyUpdatePage`/`deleteTripsyUpdatePage`) the moment it's generated, so closing the overlay
  or reloading never loses it — clicking Update again on a trip with a saved page resumes straight
  into it (`showTripsyUpdatePage`) instead of asking for another upload; "Upload New PDF" in the
  overlay toolbar starts a fresh comparison on purpose, which supersedes it. A "Show/Hide Matches"
  toggle next to it hides `match`-status rows by default (`tripsyUpdateShowMatches`, a personal
  per-session display preference, never persisted) so the owner sees only actual differences; it
  resets to hidden every time a comparison is freshly generated or resumed
  (`tripsyUpdateResetShowMatches`). The page is deleted
  automatically in exactly two cases: **(1)** every row has been resolved (Accepted/Added/Modified-
  New/Deleted/Ignored/Dismissed — `persistTripsyUpdatePageState`, called after each), or **(2)** the owner edits
  or deletes one of the specific events the page references through some path *other than* the
  Update page's own actions (the per-event Edit panel, the timeline's Delete button, doc/email-parse
  import, etc.) — that snapshot is now stale, so `Store.queueTripsyChange` drops the page rather than
  leave it showing differences against events that no longer match reality. Actions taken *through*
  the Update page itself (Accept/Add/Delete, and Modify Existing's jump into the real edit panel) are
  stamped `source: 'tripsy_update_page'` on the pending change they queue specifically so this check
  can tell those apart from an unrelated edit to the same event.
- **Attire is a generated, saved packing guide — events categorized FIRST, then per-person guidance sized off the finalized time-block counts**: a "👔 Attire"
  button on each trip card (`index.html:19741` area, between Itinerary and Search) opens
  `showTripsyAttireOverlay` (`index.html:16879`), which renders whatever's already saved
  (`driveData.tripsyAttireGuides`, `Store.getTripsyAttireGuide`/`saveTripsyAttireGuide`/
  `deleteTripsyAttireGuide`) or, for the owner, an empty state with a Generate button —
  `generateTripsyAttireGuide` (`index.html:17450`). Every event on the trip gets assigned one of 7
  dress-code tiers (Athletic / Casual / Smart Casual / Semi-formal / Cocktail / Formal / Black Tie,
  `TRIPSY_ATTIRE_CATEGORY_COLOR`/`_LABEL`/`_ORDER`) by `generateTripsyAttireCategories`
  (`index.html:14312`, same `fetchAnthropicApiKeyFromDrive` + streamed-`json_schema` pattern as
  `compareTripsyItineraryPdf`, `model: 'claude-sonnet-5'` for both calls) — which runs the events categorization FIRST (on a fresh generate; reused verbatim on a Refresh), then
  fires the per-person **him + her guidance calls concurrently via `Promise.all`** off the finalized
  per-tier counts (shared plumbing: `tripsyAttireClaudeCall`), each
  passing an EXPLICIT `thinking`/`effort` (events: `{type:'disabled'}` + `low`; guidance:
  `{type:'adaptive'}` + `medium`). **Setting these explicitly is the single biggest latency lever
  here, and the default is a trap**: `claude-sonnet-5` runs *adaptive thinking by default* when
  `thinking` is omitted, at the default effort of `high`. Omitting it made one refresh take ~5.5
  minutes (~107s events / ~284s guidance before their first text token) — and because thinking
  blocks stream with EMPTY text under the default `display:"omitted"`, none of that time appeared as
  streaming; the timing logs blamed "time to first token" and it looked like the API was stalling.
  `tripsyAttireClaudeCall` now also timestamps the thinking `content_block_start` separately so that
  time can never hide inside the TTFT number again. **This default is MODEL-SPECIFIC, which is why
  only some of this app's Claude calls were affected**: on `claude-sonnet-5` omitting `thinking` runs
  adaptive, but on `claude-opus-4-8` omitting it runs *without* thinking. So both Sonnet 5 call sites
  (this one and `compareTripsyItineraryPdf`) now set `thinking` explicitly, while the three Opus 4.8
  narrative calls (`generateTripsyItineraryNarrative`, `generateTripsySummaryBlurbs`,
  `generateTripsyEventNarrative`) are correctly left alone — adding `thinking` there would make them
  SLOWER, not faster. Check the model before assuming a call has this problem. Both halves are structured extraction against a
  fixed schema, so deep chain-of-thought buys little for the EVENTS half — it's pure per-event
  classification against a 7-value enum, so thinking is off there (measured: 108s → 18.7s, with
  time-to-first-token collapsing 79,461ms → 2,607ms). The GUIDANCE half is the live tradeoff, and
  **the only dial that moves total wall-clock** — the two guidance halves (him/her) run in parallel so
  their contribution is whichever is slower; on a fresh generate the events call now runs BEFORE them
  and adds to the total (a Refresh skips it), but guidance always dominates. Measured on a 67-event trip:
  | guidance setting | guidance time | total | packing-list output |
  |---|---|---|---|
  | *(no `thinking` param — the sonnet-5 default of adaptive+`high`)* | ~290–324s | ~5.2 min | 16.7–17.6K chars |
  | `adaptive` + `medium` | 103s | 1.8 min | 9.2K chars — **owner reported missing garment lines** |
  | `adaptive` + `high` | ~290s | ~5 min | detail restored |
  | `adaptive` + `medium` + explicit COMPLETENESS-IS-REQUIRED prompt rule | *(current)* | | |
  The last row is the open experiment: whether the thinness at `medium` was mere terseness (fixable
  by telling it not to compress) rather than lost reasoning. **If the Detailed List is thin, go back
  to `high`** — this list is what the owner actually packs from, so a missing line is a missing
  garment, and correctness beats the clock. Judge it by opening the list, not by the timing log. Two calls, because
  on a large trip the single serial output stream WAS the generation wait: one call emits the
  per-event array (category / `alternate_category` / `continues_previous_event` — the per-event
  `note` field was retired in this split, it was stored but never rendered anywhere and cost about
  half the events stream), and the other emits `person_guidance` for two travelers ("him"/"her",
  both assumed to attend every event). The guidance call is handed a **finalized, tier-tagged
  TIME-BLOCKS list + per-tier occasion counts** as input: block TIMING comes from
  `tripsyAttireComputeTimeBlocks` (plain JS: consecutive same-day events ≤3h apart, unknown times
  treated as continuous — the timing half of `tripsyAttireOutfitChangeNeeded`), and block TIERS come
  from the events categorization, which now runs BEFORE guidance on a fresh generate and is reused on
  a Refresh (`tripsyAttireTieredTimeBlocks` + authoritative `tierCounts`, threaded via the
  `eventsOnly`/`skipEvents` options of `generateTripsyAttireCategories`). So the guidance call does
  NOT re-judge tiers — it takes each block's tier as given and counts every quantity per BLOCK. This is what keeps judgment (how many
  ties N formal blocks actually warrant is still the model's call) while removing the guesswork about
  what the blocks ARE — previously it re-derived grouping per event and drifted, e.g. quoting "5-6
  ties" across 11 tie-linked events that mechanically form just 4 blocks. Per event,
  `continues_previous_event` is a boolean — Claude's own judgment (from
  the event titles/venues and the clock time together, not a fixed threshold) on whether this event
  flows directly from the one before it with no realistic time to go back and change, e.g. a
  "Pre-concert Reception" → "Concert" → "Post-concert Reception" reads as one continuous evening
  even across a couple of hours between each part, the same way a noon reception flowing straight
  into a 1pm concert does — plain arithmetic alone kept mis-splitting exactly these cases. Actually
  deciding how events chain into outfit-worthy "time-blocks" from there is still **not** asked of
  Claude — that's a mechanical reduce over each event's category + `continues_previous_event` done
  afterward in plain JS (`computeTripsyAttireBlocks`/`tripsyAttireContinuesPrevious`,
  `index.html:14472`/`14582`), so it can never get the grouping arithmetic wrong and never needs a
  second API call to re-derive; `continues_previous_event: true` always wins outright, falling back
  to a mechanical gap+category rule when it's `false` or (for a guide saved before this field
  existed) simply absent. Within the 4 "plan around this" tiers (Black Tie/Formal/Cocktail/
  Semi-formal) that fallback also chains across a plain CATEGORY CHANGE, not just an exact match, as
  long as the gap is short and same-day; the 3 "mix and match" tiers (Athletic/Smart Casual/Casual)
  still only chain within an exact match there, since those are just counted (`counts{}`, a flat
  block-count per ALL 7 tiers, shared between both people), never itemized. Per person,
  `person_guidance.{him,her}.garments[]` — an ARRAY of `{category, reuse_note, items[]}`, one entry
  per tier that has occasions — gives the ACTUAL GARMENTS to pack. It is deliberately an array keyed
  by a `category` enum rather than an object with one property per tier: the object form spelled out
  7 nested tier definitions per person (14 across him+her) and the API rejected the request outright
  with *"The compiled grammar is too large"*. Keep this flat if it ever needs extending, and read it
  through `tripsyAttireGarmentEntry`, which tolerates the array form, the short-lived object-map
  form, and neither. Each entry has an `items[]`
  of `{name, quantity}` (e.g. 2 suits / 5 dress shirts / 5 ties) plus a `reuse_note` string — rather
  than a single "N outfits" count. The rule the prompt enforces: say only what is NEEDED, never prose
  about how things get restyled; and when a tier needs no additional copy of an anchor garment
  because a DRESSIER tier's already covers it, that garment is omitted from `items[]` and named in
  `reuse_note` instead (rendered parenthetically, e.g. "(use one Formal suit)"), so each tier lists
  only what's genuinely ADDITIONAL. The 3 mix-and-match tiers itemize TOPS and BOTTOMS counts sized
  for once-a-week laundry rotation. Plus that person's own `essentials[]`; the Attire overlay renders
  these as two "Him"/"Her" cards in the Packing Summary, each row being the category name with its
  garment lines beneath it, one garment per line (`.tripsy-attire-person-row` is a flex COLUMN for
  this; the old right-aligned single-line `.tripsy-attire-person-count` is gone). A tie line under
  **Cocktail** additionally renders a muted "Optional" tag — `tripsyAttireGarmentIsOptional`, a
  deterministic renderer rule (NOT a model output) so the tag can't flicker between generations,
  since a tie is genuinely optional at Cocktail but expected at Formal/Black Tie; its `\b` word
  boundary is what keeps "ties" from matching inside words like "panties". A guide generated
  before `garments{}` existed still carries the old `outfits{}` string, which the row renderer falls
  back to as a single "N outfits" line rather than showing the tier empty. The underlying occasion
  count still drives `guide.counts` and the category drill-down, but isn't displayed on the row
  itself. Weather is fetched
  live via the same Open-Meteo pipeline the day-bar chips already use
  (`tripsyWeatherTargetsByDay`/`tripsyLoadWeather`/`tripsyGetWeather`) and folded into the GUIDANCE
  call's prompt only (it informs essentials/packing items like a rain layer or warm coat; the events
  call gets no weather at all, since weather was never allowed to change an event's category and the
  per-event notes it used to color are retired) — never stored in the guide itself
  (re-fetched fresh each generation, same cache as everywhere else).
  **Once a trip has STARTED, a Refresh stops touching the packing side**: from its first event day
  onward (`tripsyTripHasStarted`, off `tripsyItineraryStartDayKey` vs `tripsyTodayDayKey`) the guide
  re-categorizes events only — `personGuidance` (garment counts/essentials), `packingList` and
  `laundryDays` are carried over verbatim from the previous guide and the guidance Claude call is
  skipped entirely (also the slow half, so a mid-trip Refresh is fast). The reason is correctness,
  not just speed: the bag is already packed, and packing picks/skips are keyed by tier + line NAME,
  so a regenerated list that renames or resizes a line silently strands every selection made against
  the old one. Such a guide is stamped `packingFrozen: true`. The behavior is surfaced in all three
  places the owner meets it: the ⚠️ tap-through confirm dialog gets its own started-trip wording
  (and an "Update dress codes" button instead of "Refresh now") rather than the usual copy promising
  re-sized packing quantities and discarded packing-list edits; the stale note says the same; and the
  success toast confirms the list was kept as-is. Unlike `tripsyUpdatePages` above, a saved guide
  never auto-invalidates on an unrelated edit — `showTripsyAttireOverlay` just recomputes a light,
  non-cryptographic fingerprint (`tripsyAttireFingerprint`) from the trip's current events and shows
  a non-blocking "may be out of date — Refresh" note if it no longer matches the saved one, since
  Attire is an informational summary rather than a row-by-row diff against an external document
  where drift would actually matter. `renderTripsyAttireOverlayContent` lays out the main report
  top-to-bottom as the Him/Her "Packing Summary" cards first, then a "Daily Dress Guide". Dress Code
  Definitions is its own page instead (`showTripsyAttireDefinitions`/
  `getOrCreateTripsyAttireDefinitionsOverlay`, reached via the toolbar's Definitions button) — a full
  reference chart (`TRIPSY_ATTIRE_DRESS_CODE_CHART`, transcribed from an owner-provided "Master Dress
  Code Guide" PDF, White Tie/Business Formal/Business Casual rows dropped since they're not tiers
  this app's own taxonomy uses) with a column each for Suit/Jacket & Neckwear, Bottoms, Footwear
  (grouped under a centered "Men" super-header, soft blue column tint) and Style & Length, Fabric &
  Details, Footwear (grouped under a centered "Women" super-header, soft pink column tint) — wide
  enough that this page gets its own modal (`#tripsy-attire-definitions-overlay`, max-width 1100px
  with its own `overflow-x:auto` table wrapper) rather than reusing the generic small "detail" modal
  the category drill-down below uses. Each row's own dress-code name renders with the exact same
  colored badge style (`tripsyAttireBadgeStyle`) used everywhere else in Attire, keyed off that row's `category`
  field so a future palette change to `TRIPSY_ATTIRE_CATEGORY_COLOR` is picked up here for free. The
  Daily Dress Guide (`renderTripsyAttireOverlayContent`'s `dailyDressGuideHtml`) states
  what to wear before the day's first event, lists every event as just its title and start–stop
  time (no address/note — this is a dressing schedule, not the itinerary, which is what the
  category drill-down and My Trips' own timeline are for), and inserts a "⇄ Change to…" marker
  right before any event that actually needs a DIFFERENT outfit from the one before it
  (`tripsyAttireOutfitChangeNeeded`, same `continues_previous_event`-first/gap+category-fallback
  logic as the block-chaining above) across ALL 7 tiers, not just the 4 itemized ones, since "when
  do I need to change" is just as real a question for a casual→athletic transition as a
  semi-formal→cocktail one; a cocktail→formal→cocktail evening correctly shows only ONE change
  marker (into the block) since itemized tiers chain across a category change. This is deliberately
  a DIFFERENT question from `tripsyAttireContinuesPrevious` (which `computeTripsyAttireBlocks` uses
  for the trip-wide summary's occasion COUNTS above) — an identical category never needs a change
  no matter how much time passed (e.g. a casual morning walk and a casual dinner 6 hours later),
  even though the same two events are correctly counted as two separate occasions elsewhere in the
  guide; both functions share the same `tripsyAttireGapWithinThreeHours` timing check, just applied
  under different rules. Both the "Start the day in…" lead-in and every
  "⇄ Change to…" marker share one highlighted style (`.tripsy-attire-dressguide-instruction`) so
  they read as instructions, not commentary. Each day's header is the exact same "day bar" (date +
  weather chip + Day N) My Trips' own timeline uses (`tripsyAttireDayBarHtml`, a deliberate copy of
  `renderTripsyEventsListImpl`'s `dayHeaderHtml` closure rather than a shared extraction, since the
  original captures several My-Trips-only locals) — weather is fetched fresh at render time
  (`tripsyAttireLoadWeatherBar`, the same `tripsyWeatherTargetsByDay`/`tripsyLoadWeather` pipeline
  the generation prompt itself uses for weather, never stored in the guide) and threaded through
  every re-render, including after a category override, so it's never refetched needlessly. Every
  Him/Her category row is clickable
  (`data-tripsy-attire-category-link`, wired at the end of `renderTripsyAttireOverlayContent`) and
  opens a small drill-down modal (`getOrCreateTripsyAttireDetailOverlay`/
  `showTripsyAttireCategoryEvents`) listing the SPECIFIC events behind that occasion count **grouped
  by date** — one amber day header per date, with that day's events beneath it as an indented time +
  name (the date is no longer repeated per row, and the address is not shown; this is a "when am I
  dressed like this" list, not the itinerary). Day groups are formed by collapsing runs of the same
  `dayKey` in `tripsyAttireEventsForCategory`'s output, which already walks `guide.days` in order, so
  both the day order and the within-day time order come for free without re-sorting formatted
  "4:25 PM" strings (which don't sort chronologically). Events are oldest
  first (`tripsyAttireEventsForCategory`, a plain filter over `guide.days` by **`displayCategory`** —
  the block-dressiest tier, not the per-event base) — e.g. clicking "Formal" under Him shows the
  Concert **and** the two Cocktail receptions folded into the same time-block around it, since with
  no time to change between them all three are worn (and displayed) at Formal. (This is the
  block-dress-level-propagation model — see the `displayCategory` note under the manual-override
  bullet below; before it, the receptions kept their own Cocktail tier and this drill-down showed
  only the Concert.)
- **The Daily Dress Guide has a multi-select dress-code filter** (`Filter` in its toolbar;
  `tripsyDressGuideFilter`, a Set, empty = show everything). The dropdown
  (`tripsyDressGuideOpenFilterMenu`, same `positionTripsyFixedMenu` shell as every other Tripsy
  menu) lists only the tiers this trip actually uses (`tripsyDressGuideUsedCategories`) with a count
  each, as checkbox rows that toggle in place — the menu deliberately stays open between picks and
  re-renders the guide behind it. Matching is on `tripsyAttireDisplayCategory`, the tier actually
  displayed, so filtering to Formal also catches a lesser event folded into a Formal block.
  Filtered-out events emit nothing (their lead-in belongs to them), and a day with no matches drops
  out rather than showing an empty day bar; the lead-in/⇄-change text for events that DO show is
  still computed over the full day, so it stays truthful about the real schedule. An on-page note
  lists the active tiers with a "Show all" button, since a partial day list would otherwise look
  like missing data. The filter resets every time the page opens, so one left on can't silently hide
  days on the next visit.
- **An event's title jumps to its own read-only detail view on My Trips, and back again**
  (`tripsyAttireGoToEvent`, available to every viewer, not owner-gated — viewing that detail panel
  on My Trips needs no write access either): hides (not destroys) the Attire overlay, navigates to
  `tripsytrips`, strips the Attire guide's own `-checkin`/`-checkout`/`-begin`/`-end` suffix (from
  `expandMultiDayTripsyEvents`) and converts the guide's `<resource>-<id>` hyphen event id to the
  `<resource>:<id>` colon form `tripsyEventKey` produces — the form the timeline's
  `data-tripsy-view-event`/`data-tripsy-edit-panel` are keyed by (that panel is shared by both
  halves of a split multi-day event); suffix-stripping alone left the hyphen form, so the row lookup
  never matched and the jump timed out straight back to Attire (fixed 2026-07-27). Then clicks that
  event's own row to open it. There are 3
  separate places the My Trips timeline can close that panel (the row-toggle click, the panel's own
  Close button, `tripsyCloseOpenViewPanels`' outside-click handler) with no shared choke point, so
  rather than patching all 3, `tripsyAttireWatchEventPanelClose` polls the panel's `data-mode`
  attribute (waiting to actually observe it open before arming the close-detection) and fires a
  callback once it flips back off — which reopens Attire (`showTripsyAttireOverlay`) and scrolls to
  the same event row (`tripsyAttireScrollToEventRow`, same amber-flash convention as the existing
  day-level `tripsyGoToTripDay`). Once armed, it locks onto that EXACT DOM node rather than
  re-querying the selector on every tick, since My Trips can legitimately re-render its own timeline
  out from under an open panel (a background sync landing mid-view — see `runBackgroundSyncs`'s
  stale-while-revalidate note above), which replaces the panel element with a fresh, closed one that
  has nothing to do with the owner actually closing anything; re-querying by selector would catch
  that fresh element and bounce straight back to Attire the instant My Trips happened to redraw. If
  the locked-onto node disappears from the DOM entirely instead (that same kind of re-render, or the
  owner navigating elsewhere/collapsing the trip), the watcher stops silently without reopening
  Attire — that's not "closing the event." A second, separate timing issue lives on the way IN
  rather than the way back: right after `navigate('tripsytrips')` resolves, the target row's
  `data-tripsy-view-event` trigger may not be in the DOM yet on a real trip page (photos, weather
  chips, many events all rendering) — `tripsyAttireWaitForEventTrigger` polls (50ms, up to ~3s) for
  it to appear instead of assuming a fixed delay is enough. A too-short fixed wait here looks exactly
  like "click bounces straight back to Attire," but is a render-timing race, not the row genuinely
  missing — this bit a real trip with enough events that a small mocked test never would.
- **Block dress-level propagation (`displayCategory`)**: adjacent events with no time to change
  between them form one "time-block" and are all worn as — and displayed as — the block's DRESSIEST
  tier. `computeTripsyAttireBlocks` is the single grouping for this: it splits each day into runs at
  `tripsyAttireOutfitChangeNeeded` boundaries (the SAME rule that draws the Daily Dress Guide's "⇄
  change" markers), takes each run's most-formal BASE tier, and stamps it onto every event in the run
  as `displayCategory` (`tripsyAttireDisplayCategory(ev)` falls back to the base `category` for a
  guide saved before this existed). **Every screen shows `displayCategory`**, not the per-event base:
  the daily-guide badges (`tripsyAttireEventBadgeHtml`); the "Start the day in…"/"⇄ Change to…"
  instructions (a marker now appears exactly when `displayCategory` differs from the previous event,
  so the designation is constant within a block and only ever changes at a marker — no more per-event
  base tiers showing mid-block); the Him/Her occasion counts (`guide.counts`, now one per run at its
  dressiest tier, so a cocktail→formal→cocktail evening is ONE Formal occasion and ZERO Cocktail);
  and the tier drill-down (`tripsyAttireEventsForCategory`). `ev.category` stays the per-event BASE
  tier (Claude's pick or a manual override) so runs can always be re-derived; `displayCategory` is
  the derived block tier. It's recomputed in-memory at the top of `renderTripsyAttireOverlayContent`
  (so existing guides pick it up on open, no regeneration) and persisted on generate/override. This
  one grouping deliberately unifies the displayed tier, the change markers, and the occasion counts —
  which also retired the old casual↔formal count-elevation edge (a non-itemized event no longer
  breaks a run). Since `computeTripsyAttireBlocks` no longer calls `tripsyAttireContinuesPrevious`,
  that function is now unused (kept as documentation of the older continuity-first grouping).
- **Owner-only manual category override, per event**: in the day-by-day table, each event's badge
  is itself a clickable trigger (`tripsyAttireEventBadgeHtml` — viewers get the same plain,
  non-interactive badge everywhere else in the guide instead) opening a 7-item dropdown
  (`getOrCreateTripsyAttireCategoryMenu`, same `positionTripsyFixedMenu` anchoring every other
  Tripsy dropdown uses) to reassign that one event's BASE category by hand (the badge shows
  `displayCategory`, so on a lesser event in a dressier block the dropdown sets a base tier that may
  or may not change what's displayed). Picking a genuinely different category
  (`tripsyAttireOverrideCategory`) sets `ev.category`, marks it `categoryOverridden: true` — shown as
  " (selected)" next to the badge, visible to viewers too — then re-derives
  `displayCategory`/`blocks`/`counts` via `computeTripsyAttireBlocks` and saves. **Cascade
  confirmation**: because an override can move its time-block's dressiest tier, it can change the
  DISPLAYED tier of the block's other members (who share one outfit with it). When it would,
  `tripsyAttireOverrideCategory` first snapshots every event's `displayCategory`, applies the change
  tentatively, diffs, and if any OTHER event moved it REVERTS and shows a confirm dialog
  (`tripsyAttireConfirmCascade` / `getOrCreateTripsyAttireConfirmOverlay`) listing each affected event
  and its before→after tier; the owner confirms (re-applies + saves) or cancels (nothing changes). An
  override that affects no other event applies directly with no dialog. The ambiguous two-badge pick
  is only offered on the block-DOMINANT event (`disp === ev.category`), since resolving a lesser
  event's ambiguity can't change what's worn. Deliberately does **not** re-run
  `generateTripsyAttireCategories` or touch `personGuidance`/`essentials` — those are Claude's own
  judgment calls from the full trip context; only what's mechanically re-derivable (`displayCategory`,
  block lists, counts) updates. Picking the SAME category as already shown is a no-op.
- **Genuinely ambiguous events show both candidate categories as a pickable pair**: alongside each
  event's `category`, `generateTripsyAttireCategories` may also return a non-empty
  `alternate_category` — reserved for real ambiguity (e.g. a private dinner that could honestly read
  as either Semi-formal or Cocktail), not general uncertainty; most events leave it `''`. While an
  event has an unresolved `alternateCategory` (`ev.categoryOverridden` still false),
  `tripsyAttireEventBadgeHtml` renders BOTH badges side by side separated by "/" — each its own
  button (`data-tripsy-attire-ambiguous-pick`) — instead of the usual single clickable badge.
  Clicking either calls the exact same `tripsyAttireOverrideCategory` the manual dropdown override
  uses, so picking one behaves identically to a manual override (`categoryOverridden: true`, sticky,
  the split view never reappears for that event) — this is a second entry point into that one
  mechanism, not a separate one. `.tripsy-attire-dressguide-event` is `flex-wrap: wrap` specifically
  so this wider two-badge pair can drop to its own line rather than overflowing at narrower widths,
  the same way the single-badge case already fit.
- **`guide.packingList` is data now, not its own screen**: each item is
  `{id, name, quantity, group, category, checked, eventIds}`, seeded at generate time from
  `person_guidance.packing_list`. There used to be a standalone "View Detailed List" overlay
  (`showTripsyAttirePackingListOverlay`, `.tripsy-attire-packinglist-btn`, plus a shared popup for
  event links) — **all of that is gone**; the wardrobe packing screens below replaced it. The list is
  still generated and still read, in exactly two places: `tripsyWardrobeNeedByTier` turns it into the
  per-tier **need lines** that drive every packing screen, and the Packing Summary's **Footwear**
  block renders its `group: 'footwear'` items (Claude keeps shoes out of `garments[]`, so without
  that they'd never appear in the summary at all). `checked`/`eventIds` are vestigial — nothing reads
  them today.

### Packing: the Wardrobe, the two screens, and how a need is satisfied

A persistent garment library lives at **Utilities → Wardrobe** (`driveData.tripsyWardrobe`, records
`{id, name, group, tiers[], color, quantity, person, driveFileId, …}`). Per trip, two overlays sit on
top of it and **both read their need lines from the one function, `tripsyWardrobeNeedByTier`** — so
they agree by construction rather than by two implementations staying in step:

| Screen | Function | What it's for |
|---|---|---|
| Plan Packing List | `tripsyWardrobePackForTrip` | pick which garments cover each need line |
| Packing Status | `tripsyWardrobePackingList` | mark what's physically packed; Selected/Packed per line |

Each has a header button opening the other, passing an `onClose` callback so closing the second
reopens the first with fresh numbers. Both use one **contextual Close**: on a garment detail screen
it returns to the list of need lines, on the list it closes the page. Keep that single-button shape —
a separate always-close button lands beside it on the detail screen wearing the same label.

- **Allocation is per LINE, not per tier.** A pick is keyed `id::tier::line` (the line's NAME, not
  its index — indices shift whenever the guide is regenerated, which is also why skip keys use
  names), persisted in `driveData.tripsyTripWardrobe`. `availableFor` subtracts copies allocated to
  any *other* line, so one owned pair can't silently satisfy two lines. Entries saved before this
  are migrated on load by `tripsyWardrobeResolveSelectionLines`, which stamps the line the OLD
  algorithm would have chosen — without a line an entry counts against availability while being
  impossible to deselect. That function also re-homes swim picks (see below).
  `tripsyWardrobeAssignGarments` honours an explicit `item.line`, falling back to its own matching
  when absent, which is what lets all five call sites share it.
- **A packed suit covers a tier's blazer + trousers — including one packed for another tier.** A
  tier whose need is "blazer (or informal suit) + trousers" (e.g. Cocktail) DROPS both lines once
  any selected suit is wearable at that tier, judged by the garment's own `tiers` — so a suit going
  in the bag for the Formal occasions also dresses the cocktail nights, and neither a sport coat nor
  separate trousers is asked for. Done in `tripsyWardrobeNeedByTier` (which reads the trip's
  selection from `driveData` directly, same as the custom lines above) so every call site sees the
  same lines. A tier whose real need IS a suit keeps its suit line. With no suit selected, both
  lines stay, so the owner can pick either a suit or a blazer+trousers. Picks stranded on a dropped
  line just stop counting toward that tier, freeing them for the tiers that need them.
- **Skips reduce a line's need**; they don't mark it satisfied. `driveData.tripsyTripAttireDone` is a
  map `key -> count` (`tripsyNormalizeAttireSkips` / `tripsyAttireSkippedFor`); the key name is
  historical — it used to be a flat ARRAY of "this optional line is Done" keys, which normalise to
  `-1`, read back as "skip whatever this line still needs". `-1` is never written fresh, and skips
  are clamped to the need so a stale one can't drive it negative. In the UI a **Skip** card sits in
  the garment grid on any unmet line (with **Unskip**); when more than one item is outstanding it
  asks how many. **Done** now appears only once a line's need is MET, and merely returns to the list.
- **Composed outfits go stale STRUCTURALLY, not on any event edit.** An outfit dresses a
  time-block, so `tripsyOutfitsUncoveredBlocks` compares the trip's CURRENT blocks
  (`tripsyEnumerateAttireBlocks` — adjacent/close same-dress-level events are already one block)
  against the saved outfits as a multiset of `dayKey|tier`, and flags only a block nothing covers.
  So: an event added next to an existing block at a similar dress level folds in and is NOT flagged;
  a deleted event can only shrink blocks, so it never flags; a moved event flags only if it lands
  somewhere uncovered (e.g. another day). A new block, a block whose tier moved (including by manual
  override), or a second block of the same tier on a day that had one, all flag. The per-block stale
  note in the outfit modal uses `tripsyOutfitBlockTierMoved` (that block's own level, ignoring
  deleted events). A changed packing selection still flags via `selectionFingerprint`. This replaced
  a blunt `guide.eventFingerprint` comparison that fired on ANY event edit; `outfits.guideFingerprint`
  is still written but no longer consulted.
- **Garment photos for the compose prompt are cached in memory** (`tripsyOutfitPhotoCache`,
  `driveFileId` → `Promise<base64>`). A REGENERATE otherwise re-downloaded and re-resized every
  selected garment's picture from Drive, identical bytes to the run a minute before — dozens of
  round trips before the API call even starts. The PROMISE is cached (two overlapping composes
  share one download) and a rejection evicts itself, so a transient failure isn't remembered as
  "no photo"; a re-photographed garment gets a new `driveFileId`, so a stale entry can't outlive
  its picture. Session-scoped, never persisted — a speed cache, not data. Two `[outfit timing]`
  console lines (photo phase, and total with garment/block counts) sit alongside the
  `[attire timing] outfit composition` line the API call itself logs, so the next "why is this
  slow" is answered by reading the split rather than guessing.
- **The "you finished — create outfits?" prompt** (`tripsyPackingCompleteDialog`, via
  `maybeCongratulate`) fires on the incomplete→complete transition, from the **Done** button or from
  `closePage`, *not* from every pick — picking the last garment used to interrupt mid-flow. Ordinary
  mutations just re-render, leaving `planWasComplete` stale-but-false, which is exactly what lets the
  transition still be detected later; whichever of Done/close comes first records it, so it can't
  prompt twice.
- **Essentials are packable; they're excluded from OUTFITS instead.** Underwear/socks/undershirt
  lines live in the tier-agnostic **General** pseudo-tier and are filled by real wardrobe garments
  like anything else. What they're kept out of is outfit composition —
  `tripsyWardrobeGarmentExcludedFromOutfits`, applied when composing, in the swap picker, **and when
  rendering** an outfit (a look composed earlier still lists them in its saved `garmentIds`, so
  filtering only at compose time leaves them on screen).
- **Never-photographed lines** (`tripsyWardrobeLineIsNeverPhotographed`: group `essentials`, or type
  socks/dress-socks/underwear/undershirt) suppress the "No Picture" card, which otherwise drew a
  second, near-identical glyph card beside the real garment — same emoji, same shape, told apart only
  by its label. Still shown where generics already exist, so those stay removable.
- **Garment types are matched by name**, `tripsyGarmentTypeKey`, and **order in that function is
  load-bearing**: swim before `suit` (a "bathing suit" is not tailoring), dress-socks before socks,
  socks before the trailing dress/gown rule ("dress socks" was typing as a gown), undershirt before
  the generic shirt rule ("t-shirts" was typing as `shirt`). Plurals must be explicit — a whole-word
  test silently mistyped `loafers`, `sneakers`, `tuxedos`, `dresses`, `swimwear`. `dress-shirt` vs
  `shirt` is the precedent for every specific/generic split. **`tripsyAttirePackingGroupOf` has the
  same ordering traps and must agree with it** (it read "bathing suit" as `dress_wear` for the same
  reason). When changing either, re-type every name in the live data against the previous
  implementation and diff — that catches what reasoning about the regex does not.
- **A trip that STARTS with a flight wears its first outfit rather than packing it.** The outfit for
  that first time block is on your body when you leave, so it's deducted from every packing analysis:
  one top, one bottom and one pair of shoes at the block's own tier, plus the underwear and socks
  worn with them (outerwear deliberately excluded — a coat is carried and re-worn regardless). One
  shared `tripsyWardrobeFlightWornClaimer` hands out each role once and is used by all three
  surfaces — the need lines, the Packing Summary rows and its Footwear block — so they can't drift;
  `tripsyAttireQuantityMinusOne` handles ranges ("8-9" → "7-8") and a line reduced to nothing drops
  out. Applied at READ time, not in the guide's own counts, so it works on an already-generated guide
  (a Refresh would discard manual overrides and packing-list edits). A flight is identified as a
  transportation event whose title begins "Flight" — the guide's saved events carry no Tripsy
  category, only `resource`, and that title shape is what `tools/build_tripsy_snapshot.py`'s
  transportation-title rule produces ("Flight from LAX to LHR • …" against "Car from …"/"Train from
  …").
  **But it's still WORN, so it stays pickable and reachable by the outfit composer.** Deducting
  alone made the garment vanish: with the packed need at 0 the line disappeared, so there was
  nothing to select the jeans against, and `composeTripsyOutfits` — whose pool is whatever is
  SELECTED for the trip — never knew they existed, even though they're on your body all trip. So
  each claimed role also gets a **companion need line** in the same tier, named
  `"<role> — wearing on the flight"` (`TRIPSY_FLIGHT_WORN_ROLE_LABEL` +
  `TRIPSY_FLIGHT_WORN_SUFFIX`, so "Top"/"Bottoms"/"Shoes"), need 1, flagged
  `flightWorn: true`; essentials are skipped (underwear/socks are worn, not styled — no point
  asking which). Because selections are keyed `id::tier::line`, a pick against one of these flows
  into the composer's pool for free. Within a tier the claim goes to whichever line comes first,
  which picked the wrong bottom — this trip's casual tier lists "shorts" ahead of "trousers", so
  the flight-worn bottom came out as SHORTS — so shorts and swimwear are offered to the claimer
  LAST (a tier with only shorts still claims one). That rank is typed off the line NAME, not
  `ln.typeKey`: the mix-and-match tiers collapse their lines to generic group lines, so
  casual/smart-casual/athletic lines carry no type at all — exactly the tiers a flight departs in.
  The companion is named for the ROLE, never for the line it was deducted from: on a
  mix-and-match tier the claimed line is whichever the tier happened to offer, and this trip's
  casual tier has only ONE bottoms line ("Shorts"), so `"Shorts — wearing on the flight"` read
  plainly wrong when the garment being asked for is the jeans. Those tiers are untyped generic
  group lines anyway, so any `pants` garment already matched — the specific word carried no
  behaviour and only misled. A role name is also stable across regenerations, which the
  `id::tier::line` selection key wants. `tripsyWardrobePackedNeedLines` strips them for **Packing
  Status**, which is a checklist of things to physically put in a bag; **Plan Packing List** keeps
  them, since picking which jeans you fly in is the whole point. `composeTripsyOutfits` reads the
  selection's stored line name through `tripsyWardrobeLineIsFlightWorn` to label those garments
  `WORN ON THE DEPARTING FLIGHT` in the prompt, and the re-wear rules say the flight counts as one
  wear: the flight-worn **top** is used up and must not be assigned to any block before the first
  wash day, while its bottoms/shoes have spent one of their many wears and stay freely available
  (jeans/trousers are ~20 wears, not the ~10 the prompt used to say).
- **A partial-itinerary PDF only compares the days it actually covers**: `compareTripsyItineraryPdf`
  determines the PDF's own date range from its day headings (`pdf_date_range`, part of the schema) —
  which can be narrower than the trip's real date range, e.g. a supplement covering just the middle
  leg of a longer trip. A currently-tracked event dated outside that range is never returned as
  `tripsy_only` (the prompt says so explicitly; `runTripsyUpdateComparison` also filters defensively
  in case Claude doesn't fully comply), so days the PDF doesn't mention at all never get flagged as
  "missing." When the PDF's range is narrower than the trip's, the owner sees a blocking `alert()`
  stating exactly which dates were compared before the Update page renders.

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

### Offline (Travel View only)

The app works with no signal, but **only Travel View** — deliberately, since it's read-only. Three
pieces:

- **`sw.js`** — the one real exception to "everything lives in `index.html`" (a service worker
  cannot be inlined or registered from a blob URL; `manifest.json` is the existing sidecar
  precedent). It caches the app SHELL so the page opens with no network. **Strategy is
  NETWORK-FIRST**, not cache-first: this app republishes constantly, so a cache-first worker would
  strand users on a stale build — the classic footgun. Same-origin shell requests only; Drive/Google/
  Anthropic calls are auth-bearing and never touched. Bump `CACHE_VERSION` to evict.
- **The trip data** is cached separately by the app, in IndexedDB (`travel-tracker-offline` DB,
  bumped to v2 for an `appCache` store; `tripsyCacheTripsForOffline`/`loadTripsyOfflineTrips`).
  Every successful `fetchTripsDataFromDrive` writes a copy stamped with `cachedAt`. All of it fails
  soft — no IndexedDB simply means no offline mode.
- **Getting in without sign-in**: Google auth needs the network, so with no signal the sign-in gate
  offers "Open Travel View (offline)" whenever a cached copy exists (`maybeOfferOfflineTravelView`).
  It sets a minimal `driveData` so `Store` readers don't throw on null, and empties
  `tripsyPsReservations` (P/S cards live in `flight-log-data.json`, which isn't loaded offline).

`tripsyTripsAreOffline` marks that the in-memory trips came from cache. It drives Travel View's
`.tv-offline` strip — **"Offline — this schedule is not live. Last refreshed &lt;when&gt;"**, rendered
inside the sticky topbar of BOTH Travel View shells so it can't scroll away — and it BLOCKS My Trips
from rendering (`unlockTripsyTrips`), which shows an "Offline" card instead. That block is the
point: My Trips edits, and saving an edit made against a stale cached copy would overwrite newer
data. Note the Claude iPad WebView has no service worker, so offline doesn't apply there.

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
