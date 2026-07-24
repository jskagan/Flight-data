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
  tripsyGeneratedPdfs: [...],      // metadata for saved "Generate PDF" exports (same separate-
                                    // Drive-file-for-bytes shape as tripsyAttachments), so Preview
                                    // can offer a past export back when a trip has more than one
  tripsyParseProposals: [...],     // draft events extracted from a flagged attachment or a
                                    // forwarded confirmation email, awaiting owner review
  tripsyEmailIntake: [...],        // raw forwarded confirmation emails the app found in Gmail,
                                    // awaiting parse by a tripsy-trips-refresh run (see below)
  tripsyUpdatePages: [...],        // saved Itinerary -> Update comparisons (tour-operator PDF vs.
                                    // Tripsy), one per trip, kept until every row is resolved or a
                                    // referenced event is edited some other way (see below)
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
Instead, a Claude Code agent following the `tripsy-trips-refresh` runbook (see the Git workflow
section above for its push-authorization scope) talks to a Tripsy MCP connector, builds a plain JSON snapshot
of every trip/event in range, and embeds it **encrypted** directly in `index.html` as
`TRIPSY_ENCRYPTED` (AES-256-GCM, key derived via PBKDF2 from a passphrase kept in a private Drive
file, decrypted client-side via `decryptTripsyData()`, `index.html:6471`) — necessary because this
repo is public and the trip data includes confirmation codes, phone numbers, and addresses.
`TRIPSY_SNAPSHOT_GENERATED_AT` tracks when the embedded snapshot was last refreshed. The sync
window is `TRIP_SYNC_DAYS_BACK`/`TRIP_SYNC_DAYS_FORWARD` (`index.html:2450`, currently 60 days
back / 1095 forward, i.e. 3 years).

**How a refresh actually gets triggered** — three routes, all running the same procedure:

- **Scheduled (cloud routine).** A Claude Code cloud routine, "Tripsy Trips Refresh", runs at
  **9:00am / 5:00pm / 11:00pm Pacific** (cron `0 0,6,16 * * *`, fixed in UTC — so an hour earlier
  during PST). It executes in Anthropic's cloud, so it fires with every local device switched off.
  Managed at `https://claude.ai/code/routines`. Its prompt carries the whole runbook **inline**,
  because the cloud sandbox clones this repo from GitHub and `.claude/` is gitignored — so edits to
  the local runbook do *not* propagate to it; update both if the procedure changes.
- **On demand, desktop (preferred).** Double-click `~/Desktop/Refresh Tripsy Trips.command`. It runs
  `claude -p` headlessly with a fixed `--allowedTools` list, so it never prompts. This is the path
  `LOCAL_SETUP.md` documents: it reads `flight-log-data.json` and the passphrase, and writes the
  relay files, through the **Google Drive for Desktop mount** as ordinary local files rather than
  the Drive connector (whose `create_file` currently fails from cloud sessions).
- **On demand, by hand.** Tell any local Claude Code session "run a Tripsy refresh"; it follows
  `~/.claude/scheduled-tasks/tripsy-trips-refresh/SKILL.md`. That file is untracked and
  machine-local — it is the runbook text, not a schedule by itself.

  **A note on scheduling — don't be fooled by empty `crontab`/`launchd`.** There genuinely IS (was)
  a second scheduler: the **Claude desktop app runs its own scheduled tasks**, registered in
  `~/Library/Application Support/Claude/claude-code-sessions/<userId>/<workspaceId>/scheduled-tasks.json`,
  which fires `SKILL.md` as a `<scheduled-task>` local run. This is **invisible to `crontab` and
  `launchd`** — checking only those and concluding "nothing is scheduled" is wrong (that mistake was
  made on 2026-07-20). A `tripsy-trips-refresh` entry there ran daily at **8:24am** (`cronExpression`
  `24 8 * * *`) and duplicated the cloud routine; it was set `enabled:false` on 2026-07-21 to
  consolidate on the cloud routine. If you need to know what's scheduled, read that `scheduled-tasks.json`
  and the cloud `https://claude.ai/code/routines` — not the OS schedulers.

**The transform itself is committed code, not runbook prose: `tools/build_tripsy_snapshot.py`.**
Every refresh route above pulls the raw Tripsy records, assembles them into that script's input
shape (`{"trips":[{"trip":{…}, "activities":[…], "hostings":[…], "transportations":[…]}]}`), and
runs the script to produce the snapshot plaintext — then encrypts that. It is a pure function (raw
JSON in, plaintext out; no passphrase, no network, no encryption), which is why it lives in this
public repo. It exists because re-deriving the transform from prose each run kept drifting (event-id
shape, `""`-vs-`null`, key order, the `→` arrow, the transportation-title rule) and hand-retyping
raw records silently corrupted data (a curly apostrophe flattened, a U+200E mark dropped); reading
raw JSON in code makes both impossible. **One caveat**: the app *also* recomputes display fields for
pending (unsynced) events client-side in `tripsyRawToDisplay`/`tripsyTransportationFallbackSummary`
(`index.html`) — the single-file/no-imports app can't share the Python module — so the
transportation-`summary` rule (route-first title, shortened endpoints) exists in both places and
must be kept in lockstep. A refresh's step-12 diff against the decrypted live snapshot is the test
that catches drift between them.

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
  parse logic is **triplicated and must be kept in lockstep** — the cloud routine's inline STEP 1c
  (managed at `https://claude.ai/code/routines`, since the cloud sandbox can't read `.claude/`), the
  local `~/.claude/scheduled-tasks/tripsy-trips-refresh/SKILL.md` step 1c (desktop/on-demand
  refresh), and the on-demand `~/.claude/scheduled-tasks/tripsy-pdf-parse/RUN_NOW.md` fallback all
  parse the same formats the same way. (Images were unsupported until 2026-07-24, and the local
  `SKILL.md` was missing step 1c entirely — a desktop refresh silently skipped doc-parsing — both
  fixed then; if you change what formats parse, update all three.)
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
  wrong. A small badge appears directly on any trip card whose date range matches a
  still-pending proposal event (`data-tripsy-review-proposals`): a **green ✓ circle** when the owner
  just needs to review it, but a **bare yellow ⚠️ triangle** (no circular chip) while any of that
  trip's pending proposal events still has an unresolved potential conflict
  (`pendingParseTripConflicts`, judged with `tripsyParseConflictTripKeys`/`tripsyParseFindConflicts`)
  — it stays yellow until the conflict is resolved (import-with-conflict, modify one side out of
  overlap, delete the existing event, or ignore the new one), then flips to the green circle (see the
  badge color rule below).
- **The consolidated top-right status badge** (`tripsy-status-badge`, `index.html:875`;
  `computeTripsyStatus`/`updateTripsyStatusBadge`/`renderTripsyStatusPanel`, `index.html:13795`
  area) is a single indicator with three prioritized states, replacing what used to be two separate
  badges (pending-changes + doc-parse). The color rule is consistent across every Tripsy signal:
  **red 🛑** = a push genuinely failed/unverified; **yellow ⚠️** = a Claude step is needed (changes
  waiting to push, docs flagged-but-unparsed, or emails saved-but-unparsed) *or* any trip card is
  showing its yellow ⚠️ conflict flag (`tripsyParseConflictTripKeys`) — so the global badge mirrors
  any individual trip flag that's yellow; yellow deliberately outranks green so the
  owner clears it first; **green 🟢** = the owner's turn in the app (proposals to review).
  One caveat on that mirroring: conflict detection needs the *decrypted* trips to date-match
  proposals against, so it only works once `tripsyDecryptedTrips` is populated. `syncTripsyRelays`
  attempts a silent `ensureTripsyDecrypted()` before its badge refresh (covering startup on any
  device that unlocks without prompting), and `renderTripsyEventsList` refreshes the badge after
  each render — but on a device that can't unlock silently (first visit, rotated passphrase) the
  badge can briefly read green while a trip card would read yellow, until something decrypts.
  There's no green "clear the pushed changes" state anymore — applied changes
  are auto-removed from the queue when a relay confirms them, so a queued change is always either
  yellow (unconfirmed) or red (unverified). Clicking opens a panel listing the specific reason(s)
  for the current state, each linking to where it's handled. Per-trip flags are green once any
  conflict is resolved (a matched proposal is post-parse by definition), but show yellow while a
  potential conflict is still unresolved (see the per-trip badge note above). Owner-only.
  `tripsyEmailsAwaitingParseCount()` reads `driveData.tripsyEmailIntake` (entries not yet
  `parsedAt`) to drive the yellow "N forwarded emails waiting to be parsed" reason.
  One yellow reason is transient rather than driven off `driveData`: `tripsyInFlightWrites`
  (module-level, never persisted — there's no way to represent "a write is in progress" in the data
  model, only "queued" or not once it finishes) tracks a Drive write actually in flight right now.
  This (and the failed-write tracking below) lives inside `Store.queueTripsyChange` itself, generically
  — every Tripsy change, from anywhere in the app, funnels through that one function, so wrapping it
  there covers all of them at once rather than each caller instrumenting its own call: the badge goes
  yellow the instant ANY change is queued (matters most for actions like the Update page's "Add Event"
  that resolve their row optimistically, fading out before the write actually finishes — without this
  the badge would give no sign the save hadn't landed yet), for exactly as long as that one
  `persistDriveData()` round-trip takes. `tripsyBeginInFlightWrite`/`tripsyEndInFlightWrite` add/remove
  an entry and immediately refresh the badge; this reason renders as plain (non-clickable) text in the
  panel, since there's nowhere to navigate to for "still saving." A write that genuinely FAILS is a
  separate, similarly transient/in-memory `tripsyFailedWrites` list, but unlike `tripsyInFlightWrites`
  it does NOT auto-clear: it turns the badge red — outranking even a `pushConfirmationFailed` change,
  and combining with one if both are present — and each entry renders its own "Write Failed" block (red
  label, a human description built from `TRIPSY_PENDING_CHANGE_LABEL[change.type]` plus
  `change.eventSummary`/`change.tripName`, and its own Dismiss button) that stays listed until the
  owner explicitly dismisses it (`tripsyRecordFailedWrite`/`tripsyDismissFailedWrite`). A failed write
  also rolls `driveData.tripsyPendingChanges`/`tripsyUpdatePages` back to exactly how they looked
  before that call (snapshotted before any mutation, restored in the `catch`) — every mutation inside
  `queueTripsyChange` REPLACES those arrays rather than mutating in place, and the change was already
  pushed into them before the `persistDriveData()` call that actually failed, so without this rollback
  a failed write still left the change sitting in memory looking successfully queued once the red
  banner was dismissed.
- **Categories**: flight / transportation / hotel / dining / concert / tour / other, derived from
  Tripsy's own activity/transportation type slugs at refresh time (see `tripsy-trips-refresh`'s own
  category-mapping step for the exact rules) — unlike the old TripIt integration this replaced,
  there's no category that can *only* ever be set by a manual edit.
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
- **Display times are the event's own local time, not the viewer's**: event start/end are stored
  as literal local-time digits (no real UTC offset) by the refresh task, and read back out verbatim
  by `parseTripLocalParts`/`formatTripTime` (`index.html:6235` area) rather than being
  reinterpreted through the browser's own time zone — a flight's 4:25pm departure should read
  4:25pm no matter where the app is being viewed from.
- **Collapse/expand per trip card** is a personal display preference stored in `localStorage`
  (`isTripsyTripCollapsed`/`setTripsyTripCollapsed`, `index.html:6313` area) — deliberately *not*
  in `driveData`, since view-only users have no Drive write access to persist anything into the
  shared file.
- **The "Update" comparison (tour-operator PDF vs. Tripsy) is saved, not ephemeral**: the owner can
  upload a PDF from a trip's Itinerary → Modify → Update menu, which calls
  `compareTripsyItineraryPdf` and shows a row per PDF/Tripsy difference (match/conflict/pdf_only/
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
