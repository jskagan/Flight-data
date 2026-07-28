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

  **⚠️ GUARDRAIL — before running a refresh, confirm the runbook is actually here.** If you are asked
  to "run a Tripsy refresh", FIRST check that `~/.claude/scheduled-tasks/tripsy-trips-refresh/SKILL.md`
  exists. If it does **not**, you are on an iPad/iPhone/`claude.ai/code`/other cloud-cloned session
  (`.claude/` is gitignored, so a fresh clone of this repo never contains it). Do **NOT** try to
  improvise a refresh from this CLAUDE.md — you'd be missing the actual procedure (passphrase location,
  AES/PBKDF2 params, the pending-changes/email/doc-parse steps, the two-const diff gating) and would
  likely push a broken snapshot or silently skip the push/parse steps. Instead **STOP and tell the
  user**: *"This device doesn't have the refresh runbook, so I can't run it here. Use **Run now** on
  the **Tripsy Trips Refresh** routine at claude.ai/code/routines — it has the runbook baked in and
  does the whole thing (push queued changes, parse flagged docs/photos and forwarded emails, pull data,
  republish)."* Only proceed with a hand-run refresh when that `SKILL.md` is present (i.e. you're on
  the owner's Mac).

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
  **Email *attachments* are captured too (as of 2026-07-24).** `scanTripsyEmailIntake` also walks each
  forwarded email's payload for a real parseable attachment (image/PDF/`.docx`; inline logos and
  tracking pixels are filtered out by requiring `Content-Disposition: attachment` or size ≥ 40KB),
  fetches its bytes from Gmail, uploads them to their own Drive file, and stages each as a
  `scope:'email'`, `purpose:'parse'` entry in `driveData.tripsyAttachments` (deduped by
  `sourceEmailId`+`gmailAttachmentId`). This deliberately reuses the **document** pipeline rather than
  the email one: the attachment is then read by the refresh's doc-parse **step 1c** (which handles
  images), NOT step 1b — so an image-only confirmation (empty text body, all the detail in the photo)
  no longer arrives with `bodyLen=0`, get marked `empty` by step 1b, and vanish. `scope:'email'` keeps
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
- **Attire is a generated, saved packing guide, two PARALLEL Claude calls per (re)generation**: a "👔 Attire"
  button on each trip card (`index.html:19741` area, between Itinerary and Search) opens
  `showTripsyAttireOverlay` (`index.html:16879`), which renders whatever's already saved
  (`driveData.tripsyAttireGuides`, `Store.getTripsyAttireGuide`/`saveTripsyAttireGuide`/
  `deleteTripsyAttireGuide`) or, for the owner, an empty state with a Generate button —
  `generateTripsyAttireGuide` (`index.html:17450`). Every event on the trip gets assigned one of 7
  dress-code tiers (Athletic / Casual / Smart Casual / Semi-formal / Cocktail / Formal / Black Tie,
  `TRIPSY_ATTIRE_CATEGORY_COLOR`/`_LABEL`/`_ORDER`) by `generateTripsyAttireCategories`
  (`index.html:14312`, same `fetchAnthropicApiKeyFromDrive` + streamed-`json_schema` pattern as
  `compareTripsyItineraryPdf`, `model: 'claude-sonnet-5'` for both calls) — which fires **two
  concurrent Claude calls via `Promise.all`** (shared plumbing: `tripsyAttireClaudeCall`), because
  on a large trip the single serial output stream WAS the generation wait: one call emits the
  per-event array (category / `alternate_category` / `continues_previous_event` — the per-event
  `note` field was retired in this split, it was stored but never rendered anywhere and cost about
  half the events stream), and the other emits `person_guidance` for two travelers ("him"/"her",
  both assumed to attend every event), making its own PRIVATE tier/continuity judgments over the
  same event list (never emitted) rather than waiting on the events call — the two align closely in
  practice and the mechanical block grouping governs what the UI displays either way. Per event,
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
  `person_guidance.{him,her}.outfits{}` gives a SEPARATE
  suggested outfit count per tier (deliberately not the same number as the block count — e.g. 7
  black-tie occasions can still often share 3-4 restyled outfits via accessories, which is Claude's
  judgment call, not JS's) plus that person's own `essentials[]`; the Attire overlay renders these
  as two "Him"/"Her" cards in the Packing Summary, each row showing just the category name and that
  person's outfit suggestion (the underlying occasion count still drives `guide.counts` and the
  category drill-down, but isn't displayed on the row itself). Weather is fetched
  live via the same Open-Meteo pipeline the day-bar chips already use
  (`tripsyWeatherTargetsByDay`/`tripsyLoadWeather`/`tripsyGetWeather`) and folded into the GUIDANCE
  call's prompt only (it informs essentials/packing items like a rain layer or warm coat; the events
  call gets no weather at all, since weather was never allowed to change an event's category and the
  per-event notes it used to color are retired) — never stored in the guide itself
  (re-fetched fresh each generation, same cache as everywhere else). Unlike `tripsyUpdatePages` above, a saved guide
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
  `showTripsyAttireCategoryEvents`) listing the SPECIFIC events behind that occasion count, oldest
  first (`tripsyAttireEventsForCategory`, a plain filter over `guide.days` by **`displayCategory`** —
  the block-dressiest tier, not the per-event base) — e.g. clicking "Formal" under Him shows the
  Concert **and** the two Cocktail receptions folded into the same time-block around it, since with
  no time to change between them all three are worn (and displayed) at Formal. (This is the
  block-dress-level-propagation model — see the `displayCategory` note under the manual-override
  bullet below; before it, the receptions kept their own Cocktail tier and this drill-down showed
  only the Concert.)
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
- **Detailed Packing List, one per person, nested under the Packing Summary cards**: each Him/Her
  card's aggregate outfit counts (above) are complemented by a real itemized garment list — a
  prominent amber/orange "View Detailed List" button (`.tripsy-attire-packinglist-btn`, the one CTA
  each card wants to draw the eye to, deliberately styled apart from the plain outline buttons
  elsewhere in Attire) opens `showTripsyAttirePackingListOverlay`, an overlay listing
  `guide.packingList.{him,her}[]` (`{id, name, quantity, checked, eventIds}`). The button always
  sits flush at the bottom of its card (`.tripsy-attire-person-card` is a flex column;
  `.tripsy-attire-person-card-body` wraps the rows+essentials above it with `flex:1` so IT absorbs
  the card's leftover height) — since the grid row already stretches both cards to equal height,
  this keeps the Him and Her buttons aligned on the same horizontal line regardless of how long
  either person's essentials list is. Seeded once from a
  new `packing_list` field on `generateTripsyAttireCategories`'s `person_guidance` schema
  (part of the guidance half of that function's two parallel calls, no extra round trip beyond
  them) — the prompt asks for the same anchor-garment-plus-restyled-
  accessories logic worked out by hand this session (suits/dresses counted low and reused; a fresh
  dress shirt *and* a different tie per formal **time-block** for him, since a shirt worn through one
  evening isn't practical to re-wear but the suit/tie are; different jewelry/scarves for her; casual
  basics sized for realistic once-a-week laundry rotation, not one item per day), plus an `event_ids`
  per item where it reasonably maps to specific occasions. **All garment/outfit counting is done per
  TIME-BLOCK, not per event** — the prompt explicitly redefines "occasion" to mean one time-block (a
  maximal run of `continues_previous_event`-linked same-day events worn as one outfit, e.g. a
  pre-concert reception → concert → post-concert reception evening = ONE wearing), so a continuous
  evening counts as one anchor wearing / one fresh shirt, not one per sub-event. This uses the same
  `continues_previous_event` signal that drives `computeTripsyAttireBlocks`, so the packing counts
  track the block-based occasion counts the UI shows — but it's the model's in-call grouping (the
  mechanical blocks aren't fed back into the same call), so the two align closely rather than by
  construction. **A Refresh never touches an existing
  `packingList`** — `generateTripsyAttireGuide` fetches the previously-saved guide first and, if it
  already has a non-empty `packingList`, carries it over untouched into the freshly-regenerated
  guide instead of reseeding from Claude's new output; only a first generation (or a guide from
  before this field existed) seeds it. This is the same "owner's edits are sticky, no
  auto-invalidation" philosophy as the category-override bullet above, just for a second kind of
  edit. Every mutation (check/uncheck, rename, requantify, delete, add) is owner-gated exactly like
  the rest of Attire (viewers see the same list read-only — checkboxes disabled, no Add/Edit/Delete
  — never fully hidden, since seeing what's packed needs no write access) and persists straight to
  `driveData` via the same `Store.saveTripsyAttireGuide`, since checked-state is real shared trip
  data, not a personal display preference (unlike `isTripsyTripCollapsed`/`tripsyUpdateShowMatches`,
  which are deliberately `localStorage`/session-only specifically because a non-owner viewer has no
  Drive write access to persist anything into the shared file at all). Clicking an item's name opens
  a small popup listing exactly which event(s) it's linked to (date/time/name, resolved against
  `guide.days`), each clickable to jump to that event on My Trips via the same
  `tripsyAttireGoToEvent` the Daily Dress Guide's own event titles already use — hiding the popup
  and the packing-list overlay first so nothing is left stacked on top of My Trips underneath.
  Adding a new item prompts "Link to specific events?"; accepting opens a checkbox picker over every
  event on the trip (grouped by day, `guide.days`), pre-checked from the item's current `eventIds` —
  the same picker an existing item's own "Link to Events…" button reopens to change its links later.
  Both the event-link picker and the linked-events popup share one generic small overlay
  (`getOrCreateTripsyAttirePackingPopupOverlay`) since neither is ever open at the same time as the
  other — the same "one generic modal, several drill-downs" precedent
  `getOrCreateTripsyAttireDetailOverlay` already established for the category drill-down.
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
