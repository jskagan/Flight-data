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

**Because every save re-uploads the WHOLE file, stale bytes cost every write on every device** —
`pruneDriveDataInMemory(trips)` (right above `persistDriveData`) keeps it lean, run owner-only in
two passes: trip-blind at sign-in, and trip-aware once `ensureTripsyDecrypted` has real trips
(never against an empty or offline-cached trips list, which would wipe caches wholesale). It
deliberately does NOT persist — the next write that happens anyway carries it. What it prunes
(measured 2026-08-11: 649KB → 509KB): the readerless `trips` + `tripsyKnownFlights` relics; the
`body` of any intake email already stamped `parsedAt` (the id stays — it's the scan's dedup key,
and the cloud routine only parses entries WITHOUT `parsedAt`); `triedPhotoNames` capped to the
last 20 (one entry had grown to 103 tokens); weather cache entries >14 days past; and narrative
rows whose trip no longer exists. If a new cache key is ever added to `driveData`, decide its
prune rule here at the same time.
There is no server — auth and API calls happen entirely client-side via Google Identity Services
(OAuth token client) and the Drive/Gmail REST APIs.

**Finding the data file is deterministic and blip-proof — never weaken this** (incident, found
2026-09-10 while chasing an unlabeled email: THREE duplicate `flight-log-data.json` files appeared
2026-08-18→08-24 and the app silently migrated onto the newest 54KB one, stranding the original
520KB file — wardrobe, invoices, attire guides, outfits, laundry history, favorites, the Places
key — and this, not anything P/S-specific, was 08-18's "why did my P/S reservations disappear").
Two weaknesses compounded: Drive's `files.list` name search rides an **eventually-consistent
search index** that can transiently return 200-with-zero-results for a file that exists, and
`completeSignIn`'s owner path CREATED a fresh file on any empty result; then with several
same-named files, `files[0]` of an unordered search is Drive's relevance ranking, which favored
the newest. Three defenses in `findDriveDataFile`/`completeSignIn` (`dupedatafile_test.js`): the
last-known file id is cached per device (`DRIVE_DATA_FILE_ID_KEY`) and verified by a **direct
`files.get` first** (id lookups don't touch the search index); when the search does run, matches
sort by `createdTime` and the **OLDEST wins** (the original is by definition the oldest, so every
device converges on it no matter how many stray copies exist); and the owner create path
re-confirms an empty result after a 3s delay — only two agreeing empty answers create. **The
repair lives IN THE APP and self-heals any recurrence**: when the search finds several same-named
files, `completeSignIn` (owner-only, before the data loads) runs `repairDriveDataDuplicates` —
download every copy, merge via `tripsyMergeDataCopies` (oldest copy is the base since it holds
what a fresh copy can never rebuild — wardrobe, attire, invoices, keys; newest overlays it —
Gmail-derived arrays re-sync as supersets; intake unions by id newest-wins; attachments union on
`sourceEmailId`+`fileName` since Gmail attachment ids are per-fetch tokens re-minted per rescan,
preferring an already-parsed entry over a pending twin so nothing re-parses; plain-object caches
merge per key newest-wins; stranded mid-copy proposals are NOT resurrected), write the result
into the OLDEST file, trash the rest. Validated against the four real incident files: the in-app
merge reproduced the hand-built merge exactly.
**A recurrence, 2026-10-22, with two more defenses** ("Please figure out the stray duplicate"):
a 6 KB `flight-log-data.json` appeared at 04:41 UTC — empty invoices/reservations, the insurance
doc list, a weather cache for Fukuoka/Oita/Seoul, nothing else: the exact shape of the
offline/splash-preview stand-in's MINIMAL `driveData` (`enterOfflineMode` adds the cached
insurance docs). Travel View's weather chips ran `tripsyLoadWeather` → `persistDriveData()`, which
with no `driveFileId` CREATED a file. And no daily-use device ever repaired it, because the
sign-in repair only runs when the NAME SEARCH runs, and a device whose cached id verifies never
searches. Fixes: **(1)** `persistDriveData` never creates a file — with no id open it logs and
keeps the write in memory (the only create is `completeSignIn`'s double-checked owner path), and
`tripsyLoadWeather` skips its persist offline; **(2)** `sweepDriveDataDuplicates` (owner-only,
from `runBackgroundSyncs`, once per session) lists same-named files: on the OLDEST it merges the
strays into the live data via `tripsyMergeDataCopies` through the ordinary guarded write and
trashes them (toast); on a NEWER copy it forgets the cached id so the next sign-in's search runs
the full repair; **(3)** in `tripsyMergeDataCopies` an EMPTY array in the newest copy never
replaces a non-empty one — a shell copy's `reservations: []` is no information, not a deletion
(the invoices rule, generalized). The stray itself held nothing the main file lacks.
`dupedatafile_test.js`.

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

**Returning devices sign in silently** (asked 2026-08-17 as "automatically sign users in using
biometric information … on the same devices they generally use" — true biometric/WebAuthn sign-in
is architecturally impossible here: access is a Google OAuth token only Google can mint, and there
is no server for a passkey to authenticate against; a passkey added to the GOOGLE account at
myaccount.google.com → Security is what makes Google's own re-auth prompts biometric). What the
app CAN do, and now does: the cached access token only lives ~1h, and past that a daily-use device
was bounced to the sign-in screen for a tap even though the browser's Google session was usually
still alive. `initGoogleAuth` now, on a device that chose "remember me" (a `TOKEN_CACHE_KEY` entry
exists, even expired — the same signal the mid-session refresh keys on), tries
`refreshDriveAccessToken(8000)` (the silent `prompt:''` grant, shorter timeout so a dead session
can't hold a blank splash) behind the splash BEFORE showing the gate — success is a zero-tap
sign-in; any failure falls back to exactly the old sign-in screen. **HOW it failed decides the
fallback** (follow-up 2026-08-18: "couldn't reach the sign-in servers" appeared on a connected,
just-signed-out device): only the 8s TIMEOUT — Google never answered at all — counts as network
evidence and forces the offline offer (auto-opening cached Travel View on a Travel-View-preference
device); an OAuth-level error (`interaction_required` etc. — signed out of Google, or ITP blocking
the silent iframe) means Google ANSWERED, so the network is provably fine and the plain sign-in
screen shows with only the unforced offer (which respects `navigator.onLine`). A device that never
chose "remember me" is unaffected.

**Persistent sign-in — the auth Worker (`tools/auth-worker/`)** (asked 2026-08-29: "keep me logged
in … on a device that must be unlocked"). The silent grant above helped but kept failing on the
owner's iPad, and the reason is structural, not a bug: `initTokenClient` is the browser-only token
flow and **never issues a refresh token**, so its only silent renewal is a hidden
`accounts.google.com` iframe — exactly what Safari/iOS **ITP blocks**. Hence a re-login roughly
hourly. (Device unlock can't fix this: Face ID authenticates you to the DEVICE, not to Google, and
there's no relying-party server for a passkey. A passkey on the *Google account* only makes
Google's own re-auth prompt biometric.) A refresh token needs the authorization-CODE flow, which
needs a client secret, which can never sit in this public file — so it lives in a Cloudflare Worker
(a second one, separate from the `tripsy-refresh-proxy` parse trigger, so auth can't break it).
Sign-in now uses `initCodeClient` (`ux_mode:'popup'`, and **both** `access_type:'offline'` and
`prompt:'consent'` — without the latter an already-granted account gets a code that exchanges to an
access token with NO refresh token, and persistence silently never starts working); the code goes to
`/auth/exchange`, which stores the refresh token in Worker KV and returns a random 32-byte
**`device_id`** the app keeps in `localStorage` (`DEVICE_ID_KEY`). Startup and the mid-session 401
path both call `/auth/token` FIRST — an ordinary fetch, so ITP has nothing to block — falling back
to the untouched GIS paths otherwise.
**Everything here fails soft, deliberately**: an undeployed, unconfigured or unreachable Worker
leaves the original flow working exactly as before (this is why it could ship before the Worker was
deployed), and sign-in is the whole app, so that fallback matters more than the feature. That
fallback is *gated*, not just caught: `probeAuthWorker()` hits `/auth/health` once at startup and
`startSignIn` reads the cached `_authWorkerAvailable` **synchronously** — anything but a definite
`true` (unfinished, unreachable, unconfigured) takes the old token flow. Two reasons it's shaped
this way: without the gate an undeployed Worker gave TWO popups (a code popup whose exchange fails,
then the token-flow popup it falls back to), and the check can't be `await`ed inside the click
handler because that loses the click's user activation and Safari/iPad blocks the popup outright —
the same trap `openDriveFileInNewTab` documents. `/auth/health` is answered BEFORE the Worker's own
not-configured guard, so it can report `configured:false` instead of failing with it. The
pre-Worker startup logic was MOVED VERBATIM into `continueWithGisStartup()` (hence
`silentsignin_test.js`/`offlinesignin_test.js` now extract both functions and concatenate them).
Two rules worth keeping: a `/auth/token` **401 is permanent** (revoked/expired/unknown → clear the
credential, fall back to interactive sign-in) while **any other failure keeps it** (a flaky
connection must never sign a device out for good); and **Sign out must call `/auth/revoke`** before
clearing local state, or the next load just mints a new token and the owner never actually signs
out. A `device_id` is a session credential — Drive (plus Gmail where granted) until revoked — see
that folder's README for the security notes and the Google Cloud Console / KV setup.

The "Authorized Users" list on the Users utility page isn't a separate registry — it's read live
from the Drive file's real sharing permissions (`listDriveFilePermissions()`, `index.html:1001`
area) via `permissions.list`, which is the same source of truth Step 3 on that page tells the owner
to edit directly in Drive's own Share dialog.

**Trips-only viewers** (`driveData.tripsOnlyEmails`, `Store.getTripsOnlyEmails`/
`setTripsOnlyForEmail`; enforced by `isTripsOnlyUser` in `completeSignIn` + a `navigate()` guard
against `TRIPS_ONLY_ALLOWED_VIEWS`) are read-only viewers scoped to just My Trips + Travel View —
toggled per user on the Users page, documented end-to-end on the owner-only **Utilities →
Trips-Only Access** guide page (`renderUtilitiesTripsOnly`). That page also SHOWS who currently
has the access ("Can you display all users with trips-only access in the trips-only access
utilities page," 2026-09-28): a "Current Trips-Only Viewers" card built by
`tripsOnlyViewerListHtml` (pure, testable) — one row per stored email, display name resolved from
the data file's live sharing permissions (the Users page's own source of truth), and a ⚠️ stale
flag on an email still ticked Trips-only whose Drive share was since removed (an EMPTY permissions
list means the lookup failed, so bare emails show with NO stale flags rather than every row wrongly
flagged). The card fills AFTER the page paints — the permissions fetch is a network round trip,
and a network call never stands in front of a render (the My Trips weather lesson, same day).
**And the whole grant/revoke lifecycle is in-app now** ("Is there a way I can add or delete
trips-only access from within the app," same day): the card's **Add Viewer** box does Steps 3–5 in
one tap — `shareDriveFileWithEmailAsViewer` on BOTH data files (`resolveTripsDataFileIdForSharing`
finds `trips-data.json` without loading the trips, since `tripsDataFileId` is only set once My
Trips has loaded) then `Store.setTripsOnlyForEmail(email, true)` — and each row's **Remove**
button fully revokes (`removeDriveShareForEmail` on both files, then the flag). These are the
app's FIRST Drive-permission writes, shaped defensively: **Viewer role only** (nothing in the app
ever grants write access), `sendNotificationEmail=false` (the owner sends the app link themselves,
per Step 6), both helpers **idempotent** (share skips an email already holding ANY permission —
never downgrades a role; removing an absent share is a no-op) so every failure toast can honestly
say "press it again," the file OWNER can never be removed (throws before the DELETE), and
**ordering is deliberate and opposite on the two flows**: Add flips the flag LAST (a half-added
person is never flagged without the access that makes sign-in work), Remove takes shares off FIRST
(a midway failure leaves them locked to trips-only, never silently a full viewer — and a
cleared-share-but-stuck-flag failure just shows the list's own ⚠️ stale row). Both actions sit
behind a `tripsyConfirmDialog`. The one step that can NEVER move in-app is Google Console's OAuth
test-user add (Step 2 — Google has no API for it), and the Add box's note says so.
**Step 6 shows the actual link with a Copy button** ("Can you update the trips-only view page on
utilities so it shows the url a user would need to click to get the trips view," 2026-09-29):
`tripsOnlyAppUrl()` derives it from the app's OWN location (origin + pathname, trailing
`index.html` stripped) rather than hardcoding the Pages URL — a moved repo or a locally-served
copy stays correct — rendered in a `user-select:all` code box so a refused clipboard (old WebView,
the mailto lesson) still leaves a manual copy path, which the Copy button's error toast points at.
The note says there is no viewer-specific link: everyone opens the same address, and what they see
is decided at sign-in by the trips-only flag. `tripsonlylist_test.js`.
**The viewer list checks BOTH files' sharing, and Travel View names the real failure** ("A user is
getting this message when she tries to view the trips only view," 2026-09-29 — Travel View said
"Trip data is locked on this device — open My Trips once to unlock," encryption-era wording whose
advice could never help: every trips-only viewer was shared on `flight-log-data.json` but NOBODY
on `trips-data.json`, so all could sign in and none could load a trip, while the viewer list showed
every row clean). Fixes: `ensureTripsyDecrypted` now records WHY a load failed
(`tripsyTripsLoadError`); `tripsyTripsLoadLooksNotShared()` keys on the loader's own "not found"
(Drive hides unshared files), so Travel View tells a not-shared viewer to ask the owner to share
`trips-data.json` and a transient failure to reload. `tripsOnlyViewerListHtml` takes a third
`tripsPermissions` arg and flags "⚠️ Not shared on the trips file — they see no trips" (Add Viewer
is the remedy: idempotent, it only fills the missing share); the page fetches both files'
permissions in parallel, each degrading to `[]` (no flags on that side) independently, and a row
already stale on the DATA file is not double-flagged. Note a Claude session CANNOT fix a missing
share itself — the Drive connector's `share_file` is refused ("caller does not have permission")
on these owner-owned files; the owner shares via Drive or Add Viewer.
**A trips-only viewer WITHOUT Gmail access gets a Travel-View-only sign-in gate** ("can their
sign-in page only show travel view instead of giving them the option for the full travel tracker
functionality," 2026-09-29). The gate renders before identity is known, so it rides a per-device
hint exactly like `SCOPE_TIER_KEY`: `completeSignIn` (in the scope-tier block, after
`isTripsOnlyUser` resolves) stores `TRIPS_ONLY_DEVICE_KEY` when `tripsOnlyDeviceHintFor(isTripsOnly,
hasGmail)` holds — Gmail access = the extra scope tier — and removes it otherwise, correcting it
on every sign-in; such a sign-in also sets the Travel View pref, so it lands there. On the next
visit `applyTripsOnlySignInGate` hides "Use Travel Tracker", makes Travel View the primary button,
and shows a small "Show all options" link (for someone else on the same device). The FIRST sign-in
on a new device still shows both buttons — nothing can know who it is yet. A UI convenience only:
the `navigate()` guard is what actually scopes the account. **The Users page's third checkbox,
"Show My Trips"** (under Trips-only; same day: "when checked, will still show the use travel
tracker button"), opts a trips-only viewer OUT of that: `driveData.tripsOnlyShowMyTripsEmails`
(`Store.getTripsOnlyShowMyTripsEmails`/`setTripsOnlyShowMyTripsForEmail`, flat lowercased array)
is `tripsOnlyDeviceHintFor`'s third arg, so a ticked viewer keeps both buttons and lands wherever
they choose. It is disabled/unchecked unless Trips-only is on, and `setTripsOnlyForEmail(email,
false)` (the Users toggle AND the Trips-Only page's Remove) drops it too, so a re-added viewer
starts Travel-View-only again — that cleanup is also its prune rule. `tripsonlygate_test.js`.

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
   discrete balance deductions. See `index.html:2282`. **The P/S Balance table hides lines with no
   dollar amount** ("hide all lines where there is no amount specified," 2026-08-18):
   `renderPsBalanceTable` filters each receipt group's items to `Number(deductionAmount) > 0` and
   drops a group's header row too when nothing survives — but ONLY on the ordinary page; the
   Delete/Re-Parse utilities variant (`showDeleteControls = true`) still shows everything, since a
   zero-amount group must stay visible to be deletable. The Remaining Balance totals deliberately
   still sum over ALL items (zeros subtract nothing today, but filtering the math too would be a
   trap if a credit/negative line ever appears).
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

**There is deliberately no "Refresh All" catch-all** (a Utilities menu item + `refreshAllReports()`,
removed 2026-08-29 as fully redundant — don't re-add it). Its three sync pipelines (reservations,
P/S balance, `syncTripsyRelays`) are exactly what `runBackgroundSyncs` above already runs on every
app load, so pressing it did what reloading the page does. Its one seemingly-unique step, a
`recomputeReport()` for the NetJets passenger report, was covered too: that report derives purely
from stored invoices, every invoice-mutating path (upload, Review Queue resolve, auto-resolve, undo)
already calls `recomputeReport()` itself, and `navigate()` nulls `cachedReport` whenever the Reports
view is entered from elsewhere, so it recomputes fresh exactly when someone goes to look at it. All
that was left that the automatic path didn't give was a confirmation toast — and the per-pipeline
**Force Sync** buttons above answer that better anyway, since they sit on the page where staleness
would be noticed and show an inline status line plus a real "Last updated" timestamp.

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
- **An event can be MOVED to another existing trip** (asked 2026-09-08: "allow the user to
  re-assign an event to another existing trip"): a ↪️ icon in the timeline row's owner-only
  Edit/Attach/Delete block (`data-tripsy-move-event`) opens `tripsyMoveEventDialog` — a picker
  listing every OTHER trip, newest first, same overlay shell/z-index tier as
  `tripsyConfirmDialog` — and queues a `move_event` change (`tripKey` = source,
  `targetTripKey`, `eventKey`) through the one `Store.queueTripsyChange` entry point. The
  `applyTripsyChangeToTrips` branch carries the **very same event object** across (same id,
  same `tripsyRaw`) — deliberately NOT delete + re-create, which mints a new id and silently
  detaches everything keyed on the old one (attachments, outfit blocks, the dress guide,
  itinerary baselines); only which trip's `events[]` holds it changes, and the destination is
  re-sorted. The source is located by `eventKey` exactly like edit/delete (a stale
  caller-supplied `tripKey` can't misroute it); an unknown target, or a move onto the trip
  it's already in, throws rather than losing the event. Post-save, `tripsyReHomeMovedEvent`
  (in the same best-effort cleanup block as the delete cascade) strips the event from the
  SOURCE trip's guide/outfits via `tripsyStripDeletedEventFromCaches` — it has genuinely left
  that trip — and re-points event-scoped attachments' `tripKey` at the destination, since trip
  cards list docs by `tripKey`; a saved Update page referencing the event is invalidated like
  an edit would. The destination trip's guide needs nothing: its own fingerprint check flags
  the newcomer on next open, same as any added event. Existing trips only, by design —
  creating a trip to move into is the Review Parsed Docs page's job. `moveevent_test.js`.
- **Deleting an event also cleans it out of the derived caches that reference it by id, not just
  the live trip.** Reported 2026-08-14: "when I delete an event it should also be deleted from
  itinerary, daily dress, schedule, etc." — `applyTripsyChangeToTrips` only ever touched the live
  `trips` array; the Daily Dress Guide (`driveData.tripsyAttireGuides`) and composed Outfits
  (`driveData.tripsyTripOutfits`) are separate SNAPSHOTS that kept showing a deleted event until a
  manual Refresh/Regenerate, and the Itinerary's own ▲ "out of date" badge only ever checked CURRENT
  events for being new/modified — a pure deletion tripped no signal at all, so the generated
  narrative prose silently kept describing something gone. Fixed three ways, split by whether fixing
  it needs a Claude call: **(1)** `tripsyStripDeletedEventFromCaches(tripKey, hyphenBase)`, called
  from `queueTripsyChange`'s existing best-effort post-save cleanup (same block that already
  invalidates stale Update pages, now one combined write) whenever `change.type === 'delete_event'`
  — mechanically strips the id from the guide's `days[].events[]` (recomputing
  `blocks`/`counts` via `computeTripsyAttireBlocks`, dropping a day left with nothing on it) and from
  any outfit block's `eventIds` (dropping a block that loses every one of its events). No Claude call
  needed, these are just structured lists. Matches BOTH the exact hyphen id and any
  `-checkin`/`-checkout`/`-begin`/`-end` suffixed variant, since a multi-day event
  (`expandMultiDayTripsyEvents`) can appear as two separate synthetic rows there for one underlying
  event. **(2)** `tripsyItineraryChangedEvents` now also walks `baseline.fp`'s own keys looking for
  one with no matching CURRENT event, pushing a `changeType: 'deleted'` entry (`ev: null`, since the
  real event is gone) — this drives the ▲ badge/Review-changes flow exactly like an add or edit,
  where before a deletion was invisible to it entirely. **(3)** Since a deleted event has no live
  data left to describe itself, `tripsyItineraryBaselineFromEvents` now also records a lightweight
  `meta[key] = {dayKey, summary}` per event alongside its fingerprint, so `showTripsyItineraryChangesDialog`
  can still group/label a deleted row (day-grouping and the row's own text both fall back to `c.dayKey`/
  `c.summary` when `c.ev` is null) after the real event is gone; a baseline recorded before `meta`
  existed degrades to an "Undated"/"Event" row rather than crashing. Checking a deleted row and
  hitting Continue regenerates that day's write-up from LIVE events (which no longer include it) —
  the same per-day regenerate path added/modified rows already use — and `tripsyRecordItineraryBaseline`
  resets the baseline to current events afterward, which naturally drops the deleted key and clears
  the flag on its own.
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
  for those forwards and appends each one's plain-text body to `driveData.tripsyEmailIntake` — via
  **`tripsyIntakeHtmlToText`**, the intake's OWN HTML→text step (2026-09-08): it collapses source
  whitespace first (so a tag whose attributes wrap across source lines is never split), strips
  `<style>`/`<script>`/`<head>`/comments, turns `<br>` and closing block tags into line breaks, and
  runs the UNCHANGED `htmlToPlainText` per line for its entity decoding. The shared helper alone
  stored 16.6K chars for a real United itinerary, 15.1K of them raw CSS, with all five legs
  flattened into one 1,256-char line; the two PS parsers pre-clean their own HTML and still call
  `htmlToPlainText` directly, untouched; the
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
  **The pipeline now closes its own loop in the owner's mailbox** ("make sure they are parsed on
  startup … label them as having been parsed (and archive them)," 2026-09-10). Three pieces:
  **(1) scope**: `DRIVE_SCOPE_EXTRA` is `gmail.modify` now (a superset of the old `gmail.readonly`
  — extra-scope-tier accounts see one beefier consent screen on their next sign-in; a device still
  holding a readonly token keeps working read-only until then). **(2) startup auto-parse**:
  `syncTripsyRelays`, right after `scanTripsyEmailIntake`, runs `runTripsyParseNow(null)` — the
  exact button path, local parse first, cloud fallback — once per session
  (`tripsyStartupAutoParseDone`; relay polls re-enter this function and must not re-fire it) and
  ONLY when something actually awaits parsing, since the button's press-anyway semantics would
  otherwise fire a needless cloud run on every clean open. **(3) label + archive**:
  `labelParsedIntakeEmails` (next to `gmailApiFetch`, with the new write helper `gmailApiPost`)
  labels a FULLY-parsed intake email's whole Gmail thread `Travel Tracker/Parsed` and removes
  `INBOX` (archiving the forward AND the original it threads with, in the OWNER's mailbox — the
  alias account is deliberately untouched: nothing ever signs in as it; it just accumulates copies
  as a backup archive). "Fully parsed" = `parsedAt` stamped AND none of that email's own
  attachments still `parseStatus:'pending'` — a body parsed locally while its `.docx` waits on the
  cloud run is not done yet. Each entry is stamped `labeledAt` (labeled exactly once; failures
  retry next sweep; a 404 — email deleted from Gmail — is stamped rather than retried forever);
  the label id is cached per session and created on first need; one persist per sweep. A 403
  (token granted under old readonly) sets a session flag and toasts ONCE to sign out/in for the
  new permission, rather than erroring per email. Called from `syncTripsyRelays` (after the
  drains/auto-parse, before the badge refresh) and from `runTripsyLocalParse` (so Run Parse Now
  labels immediately).
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
  **A parsed event IDENTICAL to one already tracked is auto-ignored and never shown** ("ignore the
  new events automatically and do not show them to the user," 2026-08-18):
  `tripsyProposalEventIsDuplicate` judges identity conservatively, raw-to-raw (proposal `fields`
  and `tripsyRaw` share the same camelCase keys) — same resource, same start to the minute, and
  every identity field the PARSED side actually carries (end, name, company, transportNumber,
  category) matching the tracked event; an unspecified field never counts against identity, but a
  specified-and-different one (a new checkout date, a changed flight number) is new information
  and keeps the event reviewable, and no start time means no identity at all. Fails safe — a miss
  just shows one more proposal. **A different confirmation number is a different BOOKING, never a
  duplicate** (found 2026-09-08: two travelers on the same UA2303 under separate PNRs — Mo's leg,
  already tracked in her NY trip, made Jon's identical-times leg from his OWN confirmation vanish
  from review, silently): the check skips a tracked event only when BOTH sides carry a
  `confirmation` and they differ; an absent one on either side still never counts against
  identity, so the same confirmation forwarded twice still dedupes. Note the sweep is trip-blind
  by design (it scans every trip), which is exactly why the confirmation is the discriminator
  that matters. `intaketext_test.js`. `tripsyAutoIgnoreDuplicateProposals` sweeps every still-pending
  proposal event, resolving duplicates exactly as a manual Reject would (`resolution:'rejected'` +
  `autoIgnored:'duplicate'`, same finish bookkeeping when a proposal empties out, one persist per
  sweep, no-op while trips aren't loaded). Three call sites: `syncTripsyRelays` right after
  `ensureTripsyDecrypted` and before the badge refresh (the relay drains stage BEFORE trips load,
  so this is where cloud-parsed duplicates actually get caught — and an all-duplicates drain never
  flashes a badge), `runTripsyLocalParse` after staging (subtracting from the toast count so
  hidden duplicates aren't announced), and the top of `renderTripsyParseReview` as the last line
  of defense before anything renders.
- **A fully-parsed doc's parse label clears ITSELF — there is no acknowledge click** ("Once an
  uploaded document that is flagged for parsing has been parsed, remove that label from the
  document in the document menu," 2026-09-28). Both menu row builders
  (`tripsyAttachmentMenuRowHtml`/`tripsyDocumentMenuRowHtml`) render the parse badge purely from
  pipeline state: `pending` → the amber "🏷️ Flagged for parsing" label (unchanged); `staged` →
  "🏷️ Parsed — awaiting your review" (reworded — nothing already parsed should still read
  "Flagged for parsing"; still the clickable `data-tripsy-goto-parse-review` jump, and it clears
  on its own when the last proposal resolves); `done` → NO badge at all, just the plain file row.
  The old click-the-"(done)"-badge-to-clear step and its whole apparatus are removed
  (`Store.clearTripsyAttachmentParseFlag`, the `data-tripsy-clear-parse-flag` wiring) — note the
  DATA is untouched: a done attachment keeps `purpose:'parse'`/`parseStatus:'done'` (several
  readers key on "advanced past pending", and the Parsing Docs utility page still counts it under
  "fully reviewed"); only the label disappears, where the old clear also downgraded the record to
  `purpose:'reference'`. That utility page's "Flags Explained" legend was updated to match.
  `parsedlabel_test.js`.
- **The + Add menu's "Doc" item opens ONLY the attach form** ("When a user selects add and then a
  new document, do not bring up the trip details card or the add doc button," 2026-09-28): the
  handler used to also render and show the Edit Trip panel — whose own "Add Doc" button then sat
  beside the very form it opens — purely because Add Doc historically lived inside that panel.
  The attach panel is self-contained (its Save/Cancel close only itself), so the Edit Trip render
  is simply dropped from this path; the Edit panel's own "Add Doc" button flow is unchanged.
  `adddocpanel_test.js`.
- **Review Parsed Docs: creating a trip asks for DATES, any trip is pickable, and clusters span
  proposals** (reported 2026-09-08: "Create a new trip only lets me pick a name, not the dates, and
  I cannot add later flights imported at the same time to that trip"). One gap, two compounding
  symptoms: the per-event import used a bare `prompt()` for a NAME and hardcoded the trip to a
  single day (the event's own), and each card's destination dropdown offered ONLY date-matched
  trips (`tripsyParseMatchTrips`), so the just-created one-day trip was invisible to the return
  flight days later — a two-flight booking became two one-day trips. Fixed three ways: **(1)**
  `tripsyNewTripDialog` (name + start + end, defaulting to the event's own span — a hotel's
  check-in/out, a flight's departure/arrival day; a missing end becomes the start, end-before-start
  is swapped) replaces the prompt in `tripsyParseImportProposalEvent`, and the `create_trip` change
  carries the picked dates. **(2)** `tripsyParseTripOptionsHtml` — ONE builder shared by the card's
  first render and `tripsyRefreshTripSelect` — keeps date-matched trips first (still the default)
  but offers every other trip under an "Other trips" `<optgroup>` (newest first, with dates);
  `selected` is stamped explicitly, since with the group present the browser's first-option default
  would otherwise land on an unrelated trip when nothing matches. **(3)** the "create a new trip for
  these N events" offer now runs ACROSS proposals: `tripsyParseFindClusters` applies the existing
  2+-events-within-45-days rule as a greedy day-sorted walk over every proposal's unmatched pending
  events (a new cluster starts when the next event is >45 days past the current cluster's first day,
  so two unrelated future trips get two offers instead of one span check cancelling both), rendered
  ONCE above the cards with `data-event-refs="<proposalId>:<eventId>,…"`; the accept resolves each
  event inside its own proposal, and `Store.acceptTripsyParseProposalCluster` groups its
  `eventChanges` by their per-entry `proposalId` (top-level `proposalId` kept only as a fallback),
  finishing any proposal left with nothing pending — still one write. The old per-card
  `tripsyParseFindCluster` is kept but unused by the page. `newtripdates_test.js`.
- **Every row-ENDING action on the review page is optimistic — the conflict box's Import and
  Delete Existing Event were the last two holdouts** ("when I delete the existing event there is a
  delay," 2026-09-10): both awaited their writes in the foreground — two full-file Drive PATCHes
  at ~2.5s each (trips data, then proposal bookkeeping) plus a geocode for a new activity — with
  only a disabled button to look at, while Ignore, the modify dialog's Add/Drop, and the
  non-conflict Import already cleared instantly. Both now go through one shared
  `finishRowOptimistically` in `wireTripsyConflictUi` (hide the row + toast immediately, writes in
  the serialized `_tripsyParseImportChain`, reconcile via `afterImport` only once every queued
  action settles, row + button restored with an error toast on failure — the exact shape the
  Ignore handler and the non-conflict Import already use). Delete + import still land in ONE
  combined write (`deleteExistingChange` passed through). The one exception, on both buttons:
  destination "Create a new trip" (`__new__`) stays BLOCKING, because
  `tripsyParseImportProposalEvent` opens the name/dates dialog — which must not appear after the
  row already vanished (the same documented exception the non-conflict Import makes).
  `conflictdeletefast_test.js`.
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
  **The panel names WHEN the next scheduled run is, not just that one is coming** (asked
  2026-08-29): the doc/email rows used to read "waiting for the next scheduled parse run", which
  states no time and reads as an unknowable delay. They now pair with one shared row —
  `tripsyNextParseRunSentence()`, emitted once for docs+emails together since a single run handles
  both — reading "They'll be parsed automatically in the next scheduled run, today at 9:00 AM.
  Don't want to wait? Use Run Parse Now below.", pointing at the button the panel already renders.
  The schedule is `TRIPSY_PARSE_RUN_UTC_TIMES`, **hand-mirrored** from the cloud Routine's cron
  (`0 0,6,16 * * *` → 00:00/06:00/16:00 **UTC**; deliberately uneven at 6h/10h/8h — don't "tidy"
  them without changing the Routine). Nothing enforces that agreement at runtime — the app can't
  query a Routine and the cloud sandbox can't read this repo — so `nextparserun_test.js` pins the
  constant against the cron expression recorded in its own comment, and failing that test is the
  intended signal to update both. **An EMPTY array is a legitimate state**, not a bug: every caller
  then falls back to naming the cadence (`TRIPSY_PARSE_RUN_CADENCE_LABEL`) with no clock time,
  which is vague but never wrong — clear it rather than leave it stale if the Routine changes and
  the new times aren't known, since an owner waiting for a run that isn't coming is worse than one
  who was only told "three times a day". Two traps the tests lock down: slots are **sorted** before
  the walk (a hand-edit listing them out of order otherwise returns whichever was written first),
  and "today/tomorrow" is judged in the viewer's **local** dates, so a 00:00 UTC run correctly reads
  as "today at 5:00 PM" in Los Angeles rather than tomorrow.
  **Run Parse Now parses IN THE APP first, cloud only as fallback** ("the parse run is way too long
  for adding a couple of items," 2026-08-17): the button (`runTripsyParseNow`) now runs
  `runTripsyLocalParse` — pending email BODIES (already in `driveData.tripsyEmailIntake`) and
  flagged PDF/JPEG/PNG/WebP/GIF attachments (bytes via `downloadDriveFileBlob`, sent as
  document/image blocks) go straight to the API via the same `tripsyAttireClaudeCall` plumbing
  (thinking off, `low` effort — pure structured extraction, seconds per item, all items in
  parallel), staged through the SAME `Store.applyDrainedEmailProposals`/`applyDrainedDocProposals`
  the cloud relay drain uses so everything downstream is identical. The output schema is one flat
  fields object (union of the three resources' keys, `''` for absent — the attire grammar-size
  lesson); `tripsyLocalParseToProposalEvents` applies the per-resource whitelist
  (`TRIPSY_LOCAL_PARSE_FIELD_KEYS`) and mints review-page-shaped proposal events. Only what the
  browser can't do falls through to `runTripsyRefreshViaWorker`: `.docx`/`.heic` (no client-side
  reader / API-unsupported media type), overflow past the 8-item per-press cap, and any item whose
  LOCAL parse failed — a failure deliberately leaves the item untouched-pending (never stamped),
  so the scheduled 3×/day cloud runs still pick it up; those scheduled runs are unchanged.
  **A fired parse run announces itself and pulls its own results in.** The cloud run takes minutes
  and finishes on another machine, and before 2026-08-17 the app only ever learned about it on the
  next badge tap or app open — so after pressing Run Parse Now the panel read IDENTICALLY to before
  ("when I hit parse the triangle is still there with the same message"). A successful fire now
  records `tripsyParseRunStartedAt` (in-memory): `computeTripsyStatus` adds a non-clickable "A
  parse run is in progress (started N min ago)" row while items still await parsing (time-bounded
  by `TRIPSY_PARSE_RUN_WINDOW_MS`, 12 min, so a run that never lands stops being claimed; cleared
  the moment nothing awaits parsing), and the fire schedules relay polls at 90s/3m/5m/8m/~12m
  (`syncTripsyRelays` — its own in-flight guard makes an early poll a cheap no-op) so results drain
  and the badge flips with no further taps. The marker is set ONLY on the worker's `res.ok` branch —
  a failed fire must not claim a run is underway.
- **P/S reservation cards match trip flights in three tiers, and the number-blind tier must
  corroborate airports** (`findMatchingTripsyPsReservation`/`matchPsReservationToTripsyFlight`,
  `TRIPSY_PS_MATCH_DAY_DRIFT`): tier 1 exact flight number + exact date, tier 2 exact number +
  ±3-day drift (schedule moved), tier 3 number ignored entirely + exact date (airline re-issued
  the flight under a new number — a real production case, AA137 against a reservation reading
  "135"). Found 2026-09-10 ("why is there a P/S reservation for 1:05 PM on 11/24?"): tier 3
  checked the date and which side of the RESERVATION is LAX, but never the EVENT's airports — so
  an LHR→LAX arrival reservation (UA935) also matched the same day's Düsseldorf→London
  positioning leg, planting a spurious second P/S card at that flight's own 1:05 PM arrival
  (`tripsyPsReservationTimeLabel` prefers the flight's time on a drifted match). Tier 3 now
  requires the event's matching side to actually be Los Angeles (`departureDescription`/
  `arrivalDescription`, falling back to the summary's "Flight from X to Y" halves); an event
  naming NEITHER side keeps the lenient old behavior, since tier 3 exists precisely for drifted
  records. Tiers 1–2 are untouched — an exact flight number already pins the right leg.
  `pswrongflight_test.js`.
- **A transportation card's photo is livery-CHECKED, because Places can't be trusted to show the
  right airline** ("The flight on Singapore airlines should show a picture of a plane from
  Singapore airlines, not a different airlines," 2026-09-27): the photo comes from a Google
  PLACES listing (searching "Singapore Airlines" matches the airline's ticket office) and a
  listing's photos are whatever people uploaded there — confirmed live: `"singapore
  airlines|||transport"` pointed at an LA-area place showing another carrier's plane. No query
  wording controls photo CONTENT, so `tripsyTransportationPhotoAcceptable(company, blob)` asks
  Claude (one small vision call — `tripsyAttireClaudeCall`, sonnet, `thinking:false`+`low`, image
  resized to 512px) whether the photo shows the company's own aircraft/branding or at least no
  rival's; it FAILS SOFT in every direction (no Anthropic key or any error accepts the photo — a
  card must never lose its picture to a verifier hiccup). `fetchTripsyTransportationPhoto` now,
  when the leg has a company: walks the candidate pool (`MAX_LIVERY_CHECKS` = 4) and caches the
  first photo that passes, stamped `liveryChecked:true`; nothing passing keeps the FIRST photo
  stamped `liveryChecked:false` (shown — a photo beats a bare icon — but never re-healed; the
  ordinary TTL refetch is its retry). An already-cached UNSTAMPED entry (the live Singapore
  Airlines case) gets ONE healing check during a generation-time render (`_tripsyAllowPhotoFetch`,
  the gate that bounds every fetch-time cost): pass → stamped, fail → refetched with the old
  photoName marked tried. **The owner's manual picks (🔄 Try Another, 🔍 manual search, 🗂
  gallery pick, 📋 paste, on a transportation card) stamp `liveryChecked:true` AND
  `ownerPinned:true`** ("can I just pick one for each airline and have the app use that everytime
  that airline is used in any itinerary," 2026-09-27): `fetchTripsyTransportationPhoto` returns a
  pinned entry VERBATIM before the TTL/healing logic can touch it — no refetch, no re-check, no
  replacement except another manual pick or 🚫 skip; only a broken Drive file falls through. The
  cache entry was already per COMPANY and shared across every trip, so one pick covers every
  itinerary that airline appears in — pinning is what makes it permanent. Company-less legs keep
  the old first-photo path untouched (no company, no wrong airline). `liverycheck_test.js`.
- **A car TRANSFER leg shows a FIXED picture — the owner's pinned airport photo for airport
  transfers, a black Sprinter van for hotel-only transfers** ("use a picture of a sprinter van
  that is black instead of whatever image is generated or found by the itinerary," 2026-09-27;
  then "I just manually posted a photo to the transfers to and from the airports. Always use that
  photo for transfers to and from airports in all future itineraries," 2026-09-28). Detection is
  `tripsyVanTransferPhotoSubject(ev, lodgings)` → a SUBJECT or `''`: a car-category transportation
  leg (or an uncategorized one whose summary reads "Car …" — the snapshot builder's title shape;
  flights/trains never match) with `/\bairports?\b/i` on any endpoint/summary line returns the
  AIRPORT subject — **airport wins over hotel**, so the common airport↔hotel run is an airport
  transfer, which is both the owner's phrasing and where their pin was pasted — else a trip
  lodging on exactly one end (judged by the SAME `tripsyTransferSideForLodging` the ordering pass
  uses; lodgings read once per build from the raw `trip.events` hosting rows, since a transfer can
  land on a different day than its check-in row) returns the HOTEL subject. Matched legs swap ONLY
  their PHOTO subject in `tripsyTransportationCardHtml` (`photoCompany = subject || company`) —
  card TEXT keeps the real operator. The subjects are pseudo-companies riding the per-company
  machinery: `TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT` (**`'Black Sprinter Van'` — the STRING IS FROZEN:
  the owner's pinned airport photo lives in live data under its derived key
  `black sprinter van|||transport`; renaming orphans the pin**) for airport transfers, and
  `TRIPSY_HOTEL_TRANSFER_PHOTO_SUBJECT` (`'Hotel Transfer Van'`) for hotel-only — split
  2026-09-28 precisely so the pinned runway-themed photo can't bleed onto a hotel↔venue car;
  `TRIPSY_TRANSFER_PHOTO_SUBJECTS` is the pair every sentinel check tests with `.includes`. Riding
  the per-company machinery buys everything for free: ONE shared cache entry per subject across
  every trip (repeats are the point, like airlines), van-specific search queries
  (`TRIPSY_VAN_TRANSFER_PHOTO_QUERIES`, shared by both — no logo/livery wording, no generic 'car
  road trip' fallback), a STRICT vision check (the `tripsyTransportationPhotoAcceptable` prompt
  branches on the sentinels: a black/very dark Sprinter-style passenger van as the main subject,
  or reject — unlike a real company's lenient "no rival's branding" test), and the 🔄🗂🔍📋🚫
  controls keyed to the subject, so one paste/pick PINS a picture for that transfer kind
  everywhere (which is exactly how the airport photo got pinned). Two deliberate asymmetries vs.
  real companies: nothing passing the check returns the ICON, never the first-fetched fallback
  photo (a wrong picture is exactly what the request forbids; nothing cached, a later maintenance
  pass or manual pick tries again), and a cached transfer photo is **exempt from the TTL refetch**
  (it has no staleness concept — a refetch could only swap a right answer for a different one;
  only a manual re-pick or 🚫 replaces it; confirmed live 2026-09-28: the auto path landed a
  correct black Sprinter on its very first run). The FIRST-ever open of a given subject still
  paints the icon while the background pass searches/verifies/uploads — a one-time, global cost by
  the fast-paint design ("There was no picture when I opened the itinerary," 2026-09-28). Related:
  the 📋 paste handler now compresses before upload (`tripsyResizeImageBlob(blob, 1600, 0.85)` for
  blobs >400KB, fail-soft — the pinned airport photo went up as a 2.8MB PNG), and
  **`tripsyRecompressPastedPhotos`** (called from `runBackgroundSyncs` next to the folder-migration
  precedent, owner-only, once per session) retrofits pastes made BEFORE that resize existed
  ("Please also compress the image I uploaded - and any other stored photos," 2026-09-28): only a
  paste can be oversized — Places media is fetched at `maxWidthPx=800` and the wardrobe/cube/diary
  pickers all resize before upload — so the sweep walks exactly the `user-pasted-` photoName
  entries, recompresses any still >400KB via `Store.saveTripsyPlacePhoto` with every flag
  preserved (a pinned pick stays pinned, just smaller; `cacheTripsyPlacePhotoLocal` deletes the
  oversized original from Drive and the local blob store), and stamps each checked entry
  `recompressedAt` so no later session re-reads the bytes (an already-small paste stamps in
  memory, carried by the next ordinary photo-cache flush). `pasterecompress_test.js`. Itinerary
  print cards only, by request — the My Trips timeline and Travel View are untouched.
  `vantransfer_test.js`.
- **Directly-adjacent flight legs on the SAME airline share ONE photo** ("When there are
  multiple flight legs directly adjacent on the same airline, use a single photo for all the
  flight legs on the itinerary," 2026-09-28 — the transportation photo cache is per COMPANY, so a
  connection's legs each repeated the identical picture). A document-order walk in
  `buildTripsyPrintHtml` (`adjacentFlightPhotoSuppressed`, over the same post-filter
  `summaryByDay` items the cards render from, spanning day boundaries) marks every follow-on leg
  in a chain of consecutive same-airline flights; the card builder renders those photo-less via
  the existing skipped-card shape (`chainSuppressed` ORs into `isSkipped` — no photo area, no
  controls, and NOTHING is fetched for the leg). Only a LAYOVER row is glue that never breaks a
  chain; a P/S reservation card BREAKS it ("If there are two legs separated by a p/s reservation,
  there should be three pictures - the first a flight, then the p/s, then another flight,"
  same-day follow-up — the P/S card carries its own picture, so the legs around it each keep
  theirs), as does any other row between two legs. Company
  matching is case/spacing-insensitive; a company-less leg never chains. Non-adjacent
  same-airline repeats elsewhere in the trip still each show the (one shared) photo, as before.
  `adjacentlegs_test.js`.
- **An owner-TYPED photo search carries no geographic restriction** ("When the user manually
  inputs a search term for a photo from the itinerary page, do not use a geographic restriction
  on the search," 2026-09-28): with neither `locationBias` nor `locationRestriction`, Places'
  `searchText` silently IP-BIASES results toward where the request came from. **There is no
  direct "no bias" switch, and a single worldwide rectangle is REJECTED** — Places 400s any
  rectangle wider than 180° ("Invalid rectangle viewport"; the first attempt shipped one and
  every manual search silently found nothing — "When I hit the search button … nothing
  happened," same day, root-caused by replaying the exact request against the live API with the
  app's referer). The accepted neutralizer, verified live: run the typed query once per
  HEMISPHERE (`TRIPSY_UNBIASED_LOCATION_BIASES`, two exactly-180°-wide soft biases — the bias is
  soft, so the right venue still surfaces from either half) and merge the deduped candidates.
  Sent by both manual entry points — the place-card 🔍 grid search
  (`tripsyGatherPlacePhotoThumbnailsForQuery` → `tripsyGatherPhotoCandidatesForQueries`'s
  `{worldwide: true}` fan-out) and `tripsyManualSearchTransportationPhoto`. AUTOMATIC searches
  are deliberately untouched (`worldwide` defaults false): their variant queries embed the trip's
  own location in the text, and that local skew is what resolves a bare venue name to the right
  city. `manualsearchbias_test.js`.
- **A place-card photo never repeats across DIFFERENT events in one document** ("many duplicate
  photos on the partial itinerary… we should not re-use a photo unless the event is exactly the
  same as the prior event using the photo except on a different day," 2026-09-27). Duplicates
  survived because dedup only ran on a photo's FIRST fetch: `tripsyDedupedPlacePhotoUrl`'s cached
  branch showed everything verbatim ("the owner may deliberately want duplicates" — a design
  decision this request reverses), so two events that cached the same photo in different
  generations — or concurrently in one, the build fans out via `Promise.all` — duplicated forever.
  Three pieces: **(1)** `usedPlacePhotoNames`/`usedPlacePhotoHashes` are MAPS of name/hash → the
  owning `cacheKey` (`.has` checks unchanged from the Set days; the value adds WHO owns it). The
  ask's exemption falls out of the cacheKey itself: the SAME event on another day has the same
  name/address/title/hint → same key → same cached entry, never a collision; transportation and
  P/S repeats stay allowed structurally — those cards never route through this helper. **(2)** a
  document-order PRE-PASS in `buildTripsyPrintHtml` (right after the maps, and after the partial
  filter, so it walks the rendered document) claims every place card's already-cached photo before
  any card builds — without it, ownership depended on `Promise.all` interleaving and a duplicate
  pair could both pass. Mirrors `tripsyDetailedCardHtml`'s dispatch (skips layover/P/S/
  transportation/`-end` halves). **(3)** the cached branch, on a collision with another event's
  photo, swaps to an unused candidate from this place's own pool (`tripsyFindUnusedPlacePhoto`,
  old name kept in `triedPhotoNames`) — under `_tripsyAllowPhotoFetch` ONLY, which the owner's
  opens now reach via **`tripsyBackgroundPhotoMaintenance`**: Preview and the partial overlay
  paint instantly from pure cache, then rebuild the same document once in the background under
  the gate (duplicate swaps, livery healing, TTL refetches, first-time fetches) and repaint in
  place only if it changed — the string compare is a real signal because
  `tripsyPlacePhotoDisplayUrl` memoizes object URLs per driveFileId, so an untouched document
  rebuilds byte-identical. This shape resolved two dueling same-day reports: "There are still
  duplicate photos in the itinerary" (a plain Preview never healed under a generation-only gate)
  and "Why is there a delay when I open my partial itinerary? There should be nothing to generate
  on an open" (an interim `|| isOwner` gate put every search, Claude livery call and TTL refetch
  in front of the first paint). One maintenance run per tripKey+options at a time; a failure
  leaves the first paint standing; a VIEWER's open stays verbatim (no Places key anyway). No
  unused candidate left → icon fallback beats repeating, and the exhaustion is remembered per
  session (`_tripsyDedupExhausted`) so no rebuild re-pays the fruitless search. The first-fetch
  `isDuplicate` check is owner-aware the same way. **(5)** two surfaces never routed through the
  maps at all and kept duplicating (fourth report, verified live: the Mandarin Oriental's cover
  header, hotel card and its transfer-van card all shared one contentHash): the COVER header's
  background photo (its own cache entry -- unsplit hero title, no hint) is claimed FIRST, before
  the pre-pass, so on a collision the event card swaps and the cover keeps the shot; and a
  TRANSPORTATION card whose photo is OWNED by a place/cover (a hotel's own transfer service
  searches Places under the hotel's name) swaps to a different company candidate inside
  `tripsyTransportationCardHtml` -- maintenance-gated, serialized, livery-checked per candidate,
  never over an `ownerPinned` pick, exhaustion remembered in `_tripsyDedupExhausted`; SAME-company
  repeats across legs still stand (one shared entry, by design).
  **(4)** every NEW-photo claim — a collision swap, or a first-fetch's duplicate decision — runs
  one at a time through `tripsyClaimPlacePhotoSerially` (`_tripsyPhotoClaimChain`), and the
  first-fetch duplicate TEST is evaluated inside the chain, not before (third report, "There are
  still duplicate photos in the itinerary," 2026-09-27: five Four Seasons Tented Camp activities
  shared one contentHash in the live cache — the heal ran, but the swaps raced under
  `Promise.all` card building, all scanned the same map snapshot, and all picked the same "first
  unused" candidate, so the duplicates just moved to a new photo on every open). Serialized, each
  claim sees every earlier claim's registration; the common case (cached, no collision) stays
  fully parallel. `photodedup_test.js`.
- **A PASTED photo is pinned on EVERY card kind, and pinned place photos are exempt from the
  dedup swap and the TTL refetch** ("Some of the photos I posted into the itinerary did not
  save," 2026-09-28 — they saved and were then destroyed: one stage image pasted onto several
  concert cards read to the dedup maintenance as forbidden duplicates, which swapped the later
  cards to random Places photos, and `cacheTripsyPlacePhotoLocal`'s orphan cleanup then deleted
  the pasted bytes from Drive, unrecoverably; confirmed live — James Arthur and Lana Del Rey
  held Places photos stamped 06:49, minutes after the owner's 06:46/06:48 pastes, while three
  re-pasted Padang cards still shared one contentHash). Root cause: the 📋 paste handler stamped
  `ownerPinned` only when `isTransportCard`. Now every paste stamps `ownerPinned: true`
  (`liveryChecked` stays transport-only), and the shared **`tripsyPlacePhotoEntryIsPinned`**
  check — the flag, OR a `photoName` starting `user-pasted-`, which retroactively protects
  pastes saved before the stamp existed with no data migration — is honored in BOTH places that
  could replace a place photo: `tripsyDedupedPlacePhotoUrl`'s collision test (pasting the SAME
  image onto several events is a deliberate choice, exactly the duplication the 2026-09-27 dedup
  was never meant for) and `fetchTripsyPlacePhoto`'s TTL branch (a pinned entry has no staleness
  concept — same rule as the transport pin). Ordinary auto-fetched duplicates still swap.
  Place-card 🗂/🔍 picks deliberately stay unpinned (unreported, and they pick from the same
  Places pool the swap draws from). `pastedpin_test.js`.
- **`run_all.js` flags a suite that CRASHES (nonzero exit with no printed FAIL line) instead of
  silently counting only the assertions that managed to run** — found while shipping the pin fix:
  `liverycheck_test.js` had been dying mid-suite on an unstubbed `TRIPSY_TRANSFER_PHOTO_SUBJECTS`
  reference and still reporting "ok", and turning the detector on immediately surfaced three more
  silently-truncated suites (`cubes_run.js` missing the `tripsyCubeSlotLabel`/`tripsyCubeSlotGlyph`
  the sentinel refactor made `tripsyCubeLabel` delegate to; `partialitinerary_test.js` and
  `partialmode_test.js` missing `tripsyPartialEventPostdatesSave`/`tripsyPartialKeyPostdatesSave`/
  `tripsyBuildNarrativeCloudRequest` after their features' refactors). The lesson: a test scaffold
  that extracts one function must be re-checked whenever that function grows a new dependency, and
  the runner now enforces it — a crashed suite reads as FAILED, never as a short pass.
- **Photo bytes persist on-device (IndexedDB `photoBlobs`, offline DB v3)** ("When I close the
  app and then re-open, there is still a delay when I try to open the partial itinerary,"
  2026-09-27): `tripsyPhotoObjectUrlCache` (the object-URL memo) dies with the session, so a COLD
  open re-downloaded every photo in the document from Drive before `buildTripsyPrintHtml` could
  return -- the one cost the fast-paint restructure couldn't remove, since the paint needs the
  bytes. `tripsyPlacePhotoDisplayUrl` is now disk-first (`tripsyGetCachedPhotoBlob` →
  `downloadDriveFileBlob`, caching on miss); `uploadTripsyPlacePhotoToDrive` -- the ONE choke
  point every place/transportation photo upload goes through -- seeds the cache so a photo just
  uploaded is never downloaded back; the orphan-delete hook in `cacheTripsyPlacePhotoLocal` drops
  the replaced photo's local blob; and `tripsyPruneCachedPhotoBlobs` (lazy, once per session)
  evicts entries older than 180 days. Staleness is impossible by construction -- a photo edit
  always mints a NEW driveFileId -- and everything fails soft (no IndexedDB → the old
  download-from-Drive behavior). The store rides `openTripsyOfflineDb` (bumped to v3, guarded
  creates as before -- and note `tools/tests/offline_test.js`'s fake defines the store-name
  consts by hand, so a new store means updating its `consts` line or its generated half crashes
  at upgrade). `photoblobcache_test.js`.
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
- **Typing a name on a LODGING or DINING form auto-fills address + website + phone**
  (`tripsyWireNameLookupAutofill`, backed by `tripsyLookupPlaceContactDetails` — the same
  Places `searchText` endpoint as the geocoder, different field mask; `nationalPhoneNumber`
  falls back to `internationalPhoneNumber`, and both sit in the tier `websiteUri` already put
  this call in, so phone costs nothing extra). Only those two event kinds: every
  `hosting` event, and an `activity` whose category is `restaurant` — a concert or tour is named
  for the performance rather than the venue, and transportation has no name field. It fires on
  `change` (blur/Enter), never `input`, and only when the name actually CHANGED (`lastLookedUp`)
  — `change` fires on every blur, so without that a tab through the form re-bills the query and
  re-asks a question just answered. An EMPTY field is filled outright. A field already holding
  something DIFFERENT is a real disagreement, so it raises **`tripsyPlaceConflictDialog`**:
  one row per conflicting field, current vs found, defaulting to found (the rename is what
  prompted the lookup), Cancel keeps everything. Comparison ignores case/spacing/trailing
  slash, so Google's canonical formatting alone never triggers the dialog. The trip's own
  `location` is appended to the query (bare "Founders" resolves somewhere arbitrary); a request
  token makes it latest-wins and is re-checked AFTER the dialog closes; and filled fields get a
  synthetic `input` event so the form's change detection reveals Save/Cancel rather than leaving
  an auto-filled address looking already-saved. It names the matched place in a small status line
  under the field so a wrong match is obvious. Fails soft and silently — no Places key, no match,
  or a network error just leaves the fields alone.
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
- **Travel View's top calendar strip must be re-scrolled to the selected day across the settle
  window, not just once at render.** The strip overflows the 560px `.tv-inner` column on any 2+
  week trip (18 cells × ~52px vs ~532px usable) with its scrollbar hidden, so whatever it's
  scrolled to is all the owner ever sees of it. Its recenter logic (`recenterCal`, keeping the
  selected day at the 4th/5th slot) fired only EARLY — synchronously at render, while layout was
  still settling — so a wrong/no-op early attempt left the strip parked at the trip's first day
  with the last days cut off past the right edge (reported 2026-08-15: "the date is not showing up
  for the last few days"). Fixed the same way the vertical open-on-today jump already fixed the
  identical lesson: `settleAlign` now re-asserts `recenterCal(false)` alongside `scrollItineraryTo`
  on every pass (rAF + 120/350/800ms; idempotent — it returns early within 1px — and stops the
  moment the owner touches the page). Also: all strip movement goes through one `stripScrollTo`
  choke point where INSTANT positioning assigns `strip.scrollLeft` directly rather than
  `Element.scrollTo({left, behavior:'auto'})` — the older iPad WebView has bitten this app on
  missing modern APIs before (see the polyfill block), and a silently no-oping `scrollTo(options)`
  is indistinguishable from the settle race from the outside; smooth scrolling still tries
  `scrollTo(options)` for the easing, falling back to the direct assignment if it throws.
- **Day narratives generate in BATCHES of 4 per API call, and a truncated response names itself**
  ("Why am I getting this error" — "JSON Parse error: Unexpected EOF", 2026-09-27):
  `generateTripsyItineraryNarrative`'s non-streamed response is capped at `max_tokens: 4096` —
  roughly a handful of days' titles + narratives + place blurbs — and an 11-day
  partial-itinerary generation blew past it, truncating the `json_schema` output mid-stream so
  `JSON.parse` died with a bare EOF and NOTHING saved; a many-day first-time Create had the same
  latent bug. Fixed in the SHARED procedure (so partial and full itineraries stay identical):
  `tripsyGenerateNarrativeSections` chunks `dayKeysToGenerate` into `TRIPSY_NARRATIVE_DAY_BATCH`
  (4) days per `generateTripsyItineraryNarrative` call — the intro rides the FIRST batch only,
  and each batch's just-written `place_blurbs` join `existingPlaceBlurbs` for the batches after
  it (the same don't-repeat context cached days already provide, so a place visited in batch 1
  and batch 3 still gets two different write-ups); everything still lands in the ONE save at the
  end, and a small generation (the changes dialog's ordinary case) is still exactly one call.
  Separately, all four non-streamed generators (`generateTripsyItineraryNarrative`,
  `generateTripsySummaryBlurbs`, `generateTripsyEventNarrative`, `generateTripsyDiaryDays`) now
  check `data.stop_reason === 'max_tokens'` and throw "The response hit its length limit…"
  instead of surfacing an unparseable-JSON error — the two streamed 64000-token Sonnet calls
  already had their own stop-reason handling. `narrativebatch_test.js`.
- **A partial itinerary regeneration only rewrites the changed days' SUMMARY rows.**
  `tripsyGenerateNarrativeSections` takes `summaryDayKeys`: when it's an array, only those days'
  rows go to `generateTripsySummaryBlurbs` and the result is MERGED onto the cached set (rows not
  rewritten are kept; rows whose event no longer exists anywhere on the trip are dropped, since a
  whole-trip rewrite used to clear those as a side effect). `null` keeps the whole-trip behaviour,
  which is what a full generate passes. Before this, the changes dialog passed `includeSummary:
  true` unconditionally and rewrote EVERY row on the trip — 62 of them on a 17-day trip — so a
  one-event edit cost the same as changing everything, and that call, not the day narrative, was
  the dominant wait. An empty scope skips the call entirely. The stored `fingerprint` is computed
  over the full current row set, not the rewritten slice, so it describes what is actually stored
  (nothing reads it for staleness today — that comes from the itinerary baseline's per-event blurb
  fingerprints — but a fingerprint of a slice would be a trap for whoever does).
- **A regenerating itinerary blinks in two places and reports its stage**: `▲` badges mark a trip
  whose events changed since its itinerary was written — steady on the 🧭 glyph
  (`tripsySetItineraryGlyphBadge`) and beside **Edit** inside the menu (`data-tripsy-itin-warning`),
  both driven by the one `tripsyItineraryChangedEvents` call. While a regeneration is actually
  running (`tripsyItineraryGeneratingKeys`) BOTH blink, sharing one keyframe set so they stay in
  step; `tripsyRefreshItineraryGeneratingBadges` force-SHOWS the menu ▲ for the duration, since a
  run started from an already-open page triggers no My Trips render, but never hides it — whether
  it shows otherwise is the changed-events pass's call. Tapping the glyph mid-run opens
  `tripsyItineraryProgressDialog` (single OK, no menu behind it) instead of the usual out-of-date
  review prompt: there is nothing to decide, and opening the menu invited a second regeneration on
  top of the first. It reports the live stage from `tripsyItineraryGeneratingStatus`, repainted in
  place via `tripsyItineraryProgressWatchers` as the run moves on, and flips to "Finished." rather
  than freezing on the last stage. The run publishes every stage through one `setStage` helper that
  writes the changes dialog's own line *and* that map, so the two can never disagree — and only
  when a day was actually checked, matching the badge rule.
- **"Review changes" re-checks for changes and says so when it finds none, instead of silently
  opening the menu.** The ▲/🧭 badges above are computed once per My Trips render, but the
  itinerary menu-toggle's `beforeOpen` callback (`wireTripsyHeaderMenuToggle`,
  `"[data-tripsy-itinerary-menu-toggle]"`) deliberately re-runs `tripsyItineraryChangedEvents`
  itself when the owner picks "Review changes" from the confirm dialog, rather than trusting the
  badge — another tab/device may have already regenerated in the meantime. Before this fix, an
  empty re-check just fell through to `return true` (open the menu as usual) with zero feedback,
  which read as the confirm dialog closing and nothing happening ("the box just disappears" —
  reported 2026-08-14). It now toasts `Already up to date — nothing to review.` and clears this
  trip's now-stale ▲ immediately, both the small `data-tripsy-itin-warning` span next to Edit and
  the glyph badge (`tripsySetItineraryGlyphBadge(btn, '')`), rather than leaving a wrong badge to
  self-correct on some future render.
- **The changes dialog's Continue records its baseline BEFORE the photo prefetch, which is
  time-boxed — and an IndexedDB open can never hang** ("When I am reviewing new events added to
  the itinerary page and I press the continue button, nothing happens," 2026-09-28). What
  actually happened, confirmed against the live data: the run WORKED — the checked days'
  narratives generated and saved — but the handler then awaited `buildTripsyPrintHtml` (photo
  prefetch) which hung forever, so `tripsyRecordItineraryBaseline` never ran (▲ stayed up, the
  paid-for generation unacknowledged), the dialog never closed, and the Continue button sat
  DISABLED — every later press did literally nothing. The hang's root: `openTripsyOfflineDb` (the
  disk-first photo-blob path) handled neither `onblocked` nor a stall — an open BLOCKED by
  another tab/suspended WebView still holding a pre-v3 connection fires NEITHER success NOR
  error, so the promise never settled and everything awaiting a photo hung with it. Three fixes:
  **(1)** `openTripsyOfflineDb` settles exactly once — `onblocked` rejects immediately, a 4s
  timeout rejects a stalled open, and a successful connection installs
  `db.onversionchange = close` so an old tab can never be the blocker for another context's
  upgrade (every IDB consumer is fail-soft by design, so rejecting is always right: blob-cache
  misses fall back to the Drive download). **(2)** the Continue handler runs generate → record
  baseline → THEN photo prefetch, so a photo-phase failure can't strand a completed generation.
  **(3)** the prefetch itself is best-effort: wrapped in its own try/catch and raced against a
  45s cap — past it the flow moves on while the build finishes behind (its gate flips off
  mid-run, degrading remaining fetches to cached-only), since photos self-heal on any open via
  `tripsyBackgroundPhotoMaintenance` anyway. **And a failure names its REAL reason** (same-day follow-up, "I got an
  error message when I was trying to update the itinerary": the catch said only "see console for
  details," useless on the iPad, where there is no console) — `e.message` bounded to 300 chars.
  Since the same-day backgrounding change (see the fire-and-forget bullet above), that report is
  an error TOAST reserved for the genuinely unrecoverable case; an in-app generation failure
  falls back to the cloud relay silently instead. `continuestall_test.js`.
- **The changes dialog's Continue is fire-and-forget: the dialog closes INSTANTLY and the run
  happens in the background, with the cloud relay as the no-errors fallback** ("The dialog box
  should disappear as soon as I hit continue, and there should be no errors," 2026-09-28 — the
  regeneration is minutes of Claude calls that ran in the foreground behind a frozen dialog, and
  on the iPad the direct browser API call often can't get through at all: Safari's generic
  "Load failed", seen live twice that day). `overlay.remove()` runs synchronously in the click
  handler; everything else runs in a background async block — the 🧭 glyph blinks for the
  duration (`setStage` now feeds ONLY the shared status the glyph's progress dialog reads; there
  is no dialog line left), and completion is a TOAST sized to what happened ("Itinerary updated —
  write-ups regenerated for N days." / "Changes marked as reviewed."). **An in-app generation
  failure hands the SAME checked days to the cloud routine** via
  `tripsyQueueItineraryChangesCloudRequest` — riding the partial itinerary's request/answer relay
  through the SHARED `tripsyBuildNarrativeCloudRequest` (factored out of
  `tripsyPartialEnsureNarratives`, so both callers' prompts are identical by construction;
  `includeIntro:false`, day write-ups + summary rows scoped to exactly the checked days) — and
  announces it as background work, never an error; the drain files the answer and records the
  baseline itself, so the ▲ clears when the rewrite lands. An already-pending request is never
  re-queued over (that would re-date it) — just a fresh best-effort worker fire. Only the
  genuinely unrecoverable case (couldn't even queue to Drive) surfaces, as an error toast naming
  the real reason. While a cloud rewrite is pending, "Review changes" reports "already being
  rewritten in the background" (single-OK `tripsyConfirmDialog`) instead of reopening the dialog
  and inviting a duplicate ask. **`tripsyItineraryDoneDialog` (the 2026-08-17 three-way Close /
  Itinerary View / Trips View dialog) is RETIRED with the backgrounding** — there is no
  foreground moment left to ask it in, and a modal popping up minutes later over whatever the
  owner is doing would be noise; don't re-add it. The generate → record-baseline → time-boxed
  photo-prefetch order survives unchanged (the stall lesson below). `itindonedialog_test.js`
  (rewritten for this — the filename survives from the dialog it used to cover).
- **A lodging row sorts next to the transfer that serves it, on EVERY ordering surface** ("the
  hotel stay listed before the transportation to the hotel. That is not supposed to happen,"
  2026-09-27): a hotel's stored check-in time is the property's NOMINAL hour (3:00 PM), which can
  predate the very flights/car that get you there — the real Oct 12 read Check-out 12:00, flight
  12:25, **Check-in 3:00 PM**, flight 5:00, car-to-the-hotel 6:20. `placeTripsyLodgingNextToTransfers`
  (a deliberate post-sort MOVE, so `tripsyTimelineSortComparator` stays purely chronological and
  transitive) puts a Check-in directly BELOW the first same-day transport ARRIVING at the lodging
  and a Check-out directly ABOVE the one departing it, judged by `tripsyTransferSideForLodging` —
  the lodging's NAME against the transport's endpoint descriptions first (a private transfer says
  "Four Seasons Tented Camp", which the city test can't see; 10-char floor, either-direction
  containment), city match as fallback. It ran on the My Trips timeline only until this report;
  now it also runs in `buildTripsyPrintDayData` (itinerary print/preview/summary/partial, diary,
  narrative prompts, and the attire guide's day list — an existing guide may show its non-blocking
  "may be out of date" note once, since `eventFingerprint` hashes the day order) and in Travel
  View's own sort, so no surface disagrees. With no evidence tying a transport to the lodging
  (airport codes never match a city name), time order is kept — the pass never invents a move; the
  FIRST arriving match wins, so a dinner-return car naming the hotel can't drag the Check-in to
  the end of the evening; layover glue is respected. `insertTripsyFlightArrivals` remains
  timeline-only. `lodgingorder_test.js`.
  **An airport CODE counts as its city** ("On October 30, why is check in at the hotel in Seoul
  before the plane lands in Seoul," 2026-10-22 — the FUK→ICN flight's endpoints read just
  "FUK"/"ICN", no text test could tie "ICN" to a hotel whose address says Seoul, and with no
  airport car on the trip the 3:00 PM nominal Check-in stayed above the 5:20 PM landing):
  `tripsyDescMatchesCity` also resolves a bare `ICN`, `Seoul (ICN)` or `ICN Incheon …` through
  `tripsyAirportCodeOf` + the fly-over's `TRIPSY_AIRPORT_CITIES` table. Because a flight into
  the city now "arrives" too, `placeTripsyLodgingNextToTransfers` prefers a candidate that
  NAMES the lodging over a city-only one, so Oct 12's Check-in still follows the car to the
  lodge, not the CEI flight before it. Checked against the Singapore GP data: Oct 30 reads
  flight → Andaz Check-in, Oct 23 SIN→FUK → Ritz-Carlton Check-in.
- **A day spent entirely in the air renders as "✈️ In-flight" with the leg's details, not "No
  events scheduled"** ("When there is a day spent entirely in the air flying, on the itinerary
  page display that day as 'In-flight' and show the origin, destination, and flight number,"
  2026-09-28 — the live case: SQ23 departs JFK 22:15 Oct 6 and lands SIN 05:30 Oct 8, so all of
  Oct 7 is airborne). `tripsyInFlightInfoForDay(dayKey, trip)` judges it from the trip's RAW
  transportation stamps — a flight (category `airplane`, or summary starting "Flight") whose
  departure DAY < dayKey < arrival DAY; the expanded timeline rows land only on the endpoint
  days, which is exactly why the middle day is event-less — returning `{origin, destination,
  flightLabel}` (endpoints fall back to the summary's "Flight from X to Y" halves, the P/S
  tier-3 precedent; hidden flights and malformed stamps fail closed).
  `tripsyInFlightDetailText` renders "JFK → SIN • Singapore Airlines SQ23", degrading gracefully.
  In `buildTripsyPrintHtml`, ONE shared segmentation (`tripsyDaySegments`: day / inflight /
  empty run — replacing the two formerly-duplicated walks) feeds BOTH Part 1's day blocks and
  Part 2's dividers, so an in-flight day breaks an empty RUN and gets its own block in each,
  same shells as the empty variants (including the `tp-detail-day` anchor and the summaryOnly
  linkable-class drops — `itinsummary_test.js`'s count moved from 2 to 3 block kinds).
  `inflightday_test.js`. **And a layover row gets NO star on the Part 1 summary** (same-day
  follow-up: "When there is a flight layover, do not put a star next to the layover") — it's
  connective tissue between two starred flights, not an event; the star CELL stays, empty, so
  the time/text columns keep their alignment (same suite).
- **Itinerary/day views start from the earliest event, not the trip's `start_date`**: the day
  ranges, "Day N" numbering, and empty-day span all derive their first day from
  `tripsyItineraryStartDayKey(trip)` — the earliest day any visible, dated event falls on — rather
  than the trip's own `starts_at` (which drifts, e.g. Tripsy leaving the old start after a flight
  time moves, producing a leading day with nothing on it). Falls back to `trip.start` only when the
  trip has no dated events. The range's *end* is derived the same way from
  `tripsyItineraryEndDayKey(trip)` (the last day any visible dated event falls on), so a stale
  `end_date` can't add a trailing empty day either.
- **The Daily Dress Guide opens on today and dims past days too**, by the same rule and the
  same `tripsyTravelViewTodayKey` call (`dgTodayKey`, marking `data-tripsy-dg-today` and
  `.tripsy-attire-day-past`). One difference that matters: the guide is a modal with its own
  overflow, so the scroll targets the OVERLAY and measures against its box, not the window.
  Every day section is addressable (`data-tripsy-dg-day`), so **the 👔 glyph beside "Day N" on a
  My Trips day header opens the guide at THAT date** (flashing the day bar once on arrival —
  once, not per retry pass, which would blink). The glyph renders only when the trip actually has
  a saved guide, since otherwise it would open an empty page. Note `tripsyAttireDayBarHtml` is a
  deliberate copy of the My Trips day header and does NOT get the glyph. Destination priority:
  an explicit `scrollToEventId` (the jump back from My Trips) beats a day, which beats today.
- **My Trips opens an in-progress trip on TODAY, and grays out the days already over.**
  One `tripsyTravelViewTodayKey` call per trip drives both, so the jump and the dimming can
  never disagree about which day is today — and it is the TRIP's local today, not the device's,
  for the reason in the "today" corollary above. Each day's header+rows are wrapped in a
  `.tripsy-day-block`; a day before today also gets `.tripsy-day-past` (opacity 0.45, lifting on
  hover — dimmed, never hidden), and today itself is marked `data-tripsy-today-day` for
  `tripsyScrollMyTripsToToday` to find. That scroll fires **once per visit**
  (`resetTripsyMyTripsTodayScroll` on navigate), so a background sync's re-render can't yank you
  back while you're reading; it scrolls to an ABSOLUTE position and re-runs on rAF + 120/350/800ms,
  since trip cards grow as photos and weather chips arrive — the same lesson Travel View's
  open-on-today took several passes to learn. No trip in progress means no marked day, and the
  page simply opens where it was. **EXPANDING a trip card re-arms the jump for that trip**
  ("When I am currently on a trip and view that trip from the my trips page, have the current
  day show as the top scrolled date by default," 2026-10-20 — trips open collapsed, so the
  once-per-visit jump saw no marked day on the first render, and the moment the days appear
  is when it must fire): `toggleTripsyCollapse`, when going collapsed → expanded, calls
  `resetTripsyMyTripsTodayScroll(key)`, which clears the once flag and scopes the selector
  (`tripsyMyTripsTodaySelector`) to `[data-tripsy-today-day="key"]`; the post-render jump then
  lands that trip's today bar at the top, just below the sticky header, and collapse-and-reopen
  jumps again. A trip not in progress has no marked day, so nothing fires. `expandtoday_test.js`. The wrapper carries only a class, so the timeline connectors
  (which measure rows, not their parents) are unaffected by the wrapper's opacity — **but the
  connecting line itself still needs its own dimming**, or it stays full-bright running through
  grayed-out rows. `positionTripsyTimelineConnectors` builds the line from many small per-gap
  segments (siblings of `.tripsy-day-block`, not descendants), so each segment independently gets
  `.tripsy-tl-connector--past` whenever the dot it STARTS FROM sits inside a `.tripsy-day-past`
  block — including the boundary segment running from the last past row into today's first row
  (per the owner's explicit ask: "I want the line dim when it starts from a grayed out event," 2026-08-14
  — an earlier version required BOTH endpoints past specifically to keep that one boundary segment
  bright as a "now begins here" marker, which read as the wrong half of the line staying lit).
- **A trip card's header is STICKY — the name, dates and action buttons stay pinned while
  the days scroll — and THE CONTENT COLUMN, NOT THE WINDOW, IS WHAT SCROLLS** ("When I am
  viewing a trip from the my trips menu, can you freeze the header and just allow the scroll
  to apply to the days of the trip," 2026-10-20). `.tripsy-trip-head` (the
  `data-tripsy-header-toggle` row) is `position:sticky; top:0`, opaque (`var(--panel)`), z 5
  (above the day bars' z 2 and the connectors, far below every fixed menu/modal), with side
  margins reaching the card's OUTER edge (`22px` padding + the 2px border) and carrying the
  card's own `2px solid var(--muted)` outline on its top and sides; the trip card
  (`.card.tripsy-trip-card`) has `padding-top:0; border-top:none` so the header's border IS
  the card's top edge, rounded in every state ("include the white top border … keep rounded
  corners," same day). **The scroll model** (same day, the THIRD "rows still show above the
  header on the iPad" report, with a screenshot): the Claude iPad app's web view is a native
  scroll view whose content extends UNDER the translucent iOS status bar, so whatever the
  PAGE had scrolled past was drawn in that ~48px band above every pinned element — a
  negative-margin fix, a `z-index:-1 ::before` strip (which also ERASED the rounded border:
  a negative-z child paints after its context's own background and border), and a
  pinned-only page-background `box-shadow` cap all failed to hide it, because nothing a page
  draws can reliably cover content the native layer shows there. So the window never scrolls:
  `.app` is exactly one viewport tall (`height:100vh; height:100dvh` — dvh where supported,
  since Safari's toolbars change the visual height) and **`.main` is the scroller**
  (`min-height:0; overflow-y:auto; overflow-x:hidden`), the in-app precedent being Travel
  View's fixed, self-scrolling root. The band then only ever shows the document's static top
  (page background), and what `.main` scrolls is clipped by its own box, which starts below
  the bar. `.main`'s old 32px TOP padding is a `.main::before` spacer instead (20px in the
  `≤1100px` layout): Chromium pins a sticky child at the scroll container's CONTENT edge, so
  padding-top would leave a 32px band for rows to show through and land the today jump 32px
  short. **Every page scroll goes through `tripsyPageScroller()`** (`#main`; `window.scrollY`/
  `window.scrollTo`/window `scroll` listeners are gone — `stickytriphead_test.js` asserts
  none remain): `tripsyScrollMyTripsToToday` measures against the scroller's own rect, subtracts
  `tripsyStickyTripHeaderHeight(el)` so the day bar lands BELOW the pinned header, and falls
  back to a `scrollTop` assignment where `Element.scrollTo(options)` throws (the Travel View
  strip lesson); `tripsyGoToTripDay`/`scrollIntoView` callers need nothing. The corner slivers
  outside the rounded arcs are still filled while PINNED by `.tripsy-trip-head--stuck`'s hard
  page-background `box-shadow: 0 -60px 0 0 var(--bg)` (painted under the header's own
  background and border, above the rows; OFF in place, where it would cover the previous
  card's bottom), toggled by `tripsyWatchStickyTripHeads()` (armed at the end of every My
  Trips render; the scroller's passive `scroll` + window `resize`, rAF-throttled, wired once)
  through the pure `tripsyStickyHeadIsStuck(headTop, cardTop)` — pinned = DISPLACED from its
  own card's top, never "at the window's top edge". **The trap**: `.card` has
  `overflow-x:auto`, which makes every card its own scrollport inside which a sticky child
  never moves — so the trip card restores `overflow:visible` (its timeline is never wider than
  the card; `.main`'s `overflow-x:hidden` is the backstop). Sticky is bounded by its card, so
  each header gives way to the next card's. **The cost of that on a PHONE** ("It's not showing
  the edit button in the my trips view," same day, iPhone): the old `overflow-x:auto` was what
  let the owner scroll a trip card sideways to reach a timeline row's action icons (👔 ✏️ 📎
  ↪️ 🗑️ past the 194px indent) and the header's six icon-label buttons; with it gone they were
  clipped by `.main` with no way to reach them. So below 600px those rows WRAP instead:
  `.tripsy-tl-body`/`.tripsy-tl-actions` (the icons drop under the title, `flex-basis:100%`),
  `.tripsy-trip-head`/`.tripsy-trip-head-actions` (buttons under the trip name), and
  `.tripsy-tl-row`/`.tripsy-tl-inner` tighten the indent. Wide screens get no wrap rule, so a
  long title still shrinks beside its icons. `phonerowactions_test.js`.
  **The left nav rail is pinned too, on wide screens** ("Also freeze the left side navigation
  page, with all items always displayed when viewing on a wide device," same day): with the
  shell one viewport tall the rail simply never moves; it keeps `position:sticky; top:0;
  align-self:flex-start; box-sizing:border-box; min-height:100vh; max-height:100vh;
  overflow-y:auto` so a rail taller than a short window scrolls WITHIN itself rather than lose
  its lower items. The `≤1100px` top-bar layout sets `position:static; min-height:0;
  max-height:none; flex-shrink:0` — a plain row above the scrolling `.main`, so the top bar
  now stays put there too (it used to scroll away with the page; there is no page scroll left
  for it to ride). Verified in Chromium against a page built from the live stylesheet at 1300
  and 1000px: the document is never scrollable, `window.scrollTo` is a no-op, the header pins
  at the scroller's top edge with its border and corners intact and no row pixel above it, and
  the today jump lands the day bar 8px under the pinned header. `stickytriphead_test.js`,
  `expandtoday_test.js`, `mytripstoday_test.js`.
- **The My Trips render never waits on weather — chips paint from cache and heal in place**
  ("Sometimes when I open the app and select my trips there is a delay when I select a trip to
  open," 2026-09-28): expanding/collapsing a trip re-runs `renderTripsyEventsListImpl`, which
  used to AWAIT `tripsyLoadWeather` for every expanded trip's day bars BEFORE assigning
  `container.innerHTML` — serial per-city geocoding, forecast fetches, and that function's own
  whole-file `persistDriveData()` all in front of the paint. Fully-cached renders were instant,
  which is why the delay read as "sometimes": it bit on the first render/expand after the
  forecast TTL lapsed, i.e. typically right after opening the app. Now the render computes the
  targets, paints immediately from cache (`tripsyMyTripsDayWxChipHtml`, the ONE chip builder),
  and fires `tripsyLoadWeather` in the background; when it lands,
  `tripsyRefreshMyTripsWeatherChips` refills each day bar's ALWAYS-emitted chip slot span
  (`data-tripsy-wx-slot`, empty when uncached so the bar's three-child layout never shifts) in
  place — deliberately NOT a full re-render, which would tear down open panels and yank the
  scroll mid-read. A slot that still resolves nothing keeps what it shows (a background pass
  never blanks a chip). `mytripsweather_test.js`.
- **ONE shared IndexedDB connection per page, and the My Trips render never waits long on it**
  ("The buttons to select individual trips from the my trips page are reacting very slowly,"
  2026-10-03): every trip tap re-runs `renderTripsyEventsListImpl`, which awaited
  `listTripsyOfflineDocsMeta` → `openTripsyOfflineDb` — and that opened a FRESH connection on
  every call and never closed one (a photo-heavy itinerary piled up dozens). `openTripsyOfflineDb`
  now memoizes its promise ON THE FUNCTION (`openTripsyOfflineDb._p`, not a module-level `let`,
  so the tests' extracted copy stays self-contained); a failed open, `db.onclose`, or
  `onversionchange` (which still closes the connection, never the blocker) clears the memo so
  the next call reopens. The render races that lookup against 300ms and falls back to
  `tripsyOfflineDocIdsLastKnown` (it only words a tooltip), refreshing the set in the background.
  `idbmemo_test.js`.
- **Past trips render under collapsed YEAR sections, below the current/upcoming cards** (built
  for the 154-trip historical backfill — flat, they'd stack a wall of 2011 above the trip you're
  actually on and pay 150 cards' HTML besides). A trip is "past" once its last day (falling back
  to its first; a trip with no dates is never judged past) is before the device's today; pending
  "create a new trip" placeholders always stay in the current section. A collapsed year is ONE
  header row ("2011 · 12 trips") and builds none of its trips' cards; expanding renders them
  through the exact same `tripCardHtml` (the old per-trip closure, now a named function) as
  everything else. State is the in-memory `tripsyExpandedYears` Set, cleared per fresh visit like
  the per-trip collapse reset — and a year containing any EXPANDED trip renders open regardless,
  which is what keeps `tripsyAttireGoToEvent`/`tripsyGoToTripDay` (both expand their target trip
  then re-render) working with no knowledge of years; closing a year therefore also re-collapses
  its trips, or that rule would bounce it straight open.
- **Regression tests live in `tools/tests/`** (`node tools/tests/run_all.js` — 72 suites,
  ~1400 assertions, exit 0 = all green). They only READ `index.html` (extracting functions by
  name and asserting on behavior and on source patterns), so they don't violate the single-file
  rule. Some suites are GENERATORS that write a sibling `*_run.js` (gitignored) holding the
  executable assertions — the runner executes both halves. Run them before any push that touches
  Tripsy/attire/packing logic, and add a suite alongside any new feature; fixtures must stay
  SYNTHETIC (the offline suite once read the owner's real trip file — never commit personal data
  here, this repo is public).
- **Collapse/expand per trip card** is a personal display preference stored in `localStorage`
  (`isTripsyTripCollapsed`/`setTripsyTripCollapsed`, `index.html:6313` area) — deliberately *not*
  in `driveData`, since view-only users have no Drive write access to persist anything into the
  shared file.
- **Itinerary → Summary is Part 1 on its own, read-only** (asked 2026-08-29: "the listing of
  events broken down by dates with no narratives"). `buildTripsyPrintHtml` gained a
  `summaryOnly` option that returns just the cover header + Part 1 and **returns before Part 2 /
  Travel Information are built at all**, so their per-place photo lookups — the slow part of a
  full build — are skipped rather than computed and discarded. `showTripsyItinerarySummary`
  renders that into its own overlay (`#tripsy-summary-overlay`, sharing the preview's shell
  classes, and hidden in `@media print` for the same reason the preview is). It deliberately does
  **not** reuse `previewTripsyItinerary`: that overlay carries the owner's generate/regenerate/
  per-day editing controls, and the requirement is that this screen can't edit — rendering print
  HTML means there is nothing interactive to suppress, rather than hiding controls one by one and
  hoping a future one gets hidden too (`itinsummary_test.js` asserts the summary path emits no
  `<button>`/`<input>`/`contenteditable` at all). Day blocks also drop their
  `tp-day-block-linkable` class and `data-tripsy-summary-day-link` attribute in this mode, since
  there's no Part 2 to jump to and the pointer/hover ring would promise a scroll that can't
  happen. **Save as PDF** re-runs the same summary-only build through `triggerTripsyPrint` (the
  browser's print dialog is where "Save as PDF" actually lives on macOS/iOS) rather than printing
  the on-screen node, so the output carries no overlay toolbar. Not owner-gated — read-only, like
  Print.
  **Email opens a prefilled draft; it does not send.** The app's Gmail scope is
  `gmail.readonly`, so it *cannot* send mail, and a web page can't attach a file to an email
  either — so the itinerary travels as plain text in a `mailto:` body
  (`buildTripsyItinerarySummaryText`, built from the same `buildTripsyPrintDayData` as the HTML
  summary and reusing `tripsyDiaryScheduleLines` for the rows, so no surface can describe
  different events). Sending directly would mean adding `gmail.send` — a THIRD restricted scope,
  re-consent for everyone, and a broader consent-screen warning — which was considered and
  rejected. The length guard matters: `mailto:` URLs get truncated by browsers/mail clients well
  before any formal limit, and `encodeURIComponent` inflates the body ~1.5× (spaces and newlines
  become 3 chars each), so the check measures the **encoded URL**, not the raw text. Past
  `TRIPSY_MAILTO_SAFE_LENGTH` (1800) it copies the full text to the clipboard and opens an EMPTY
  draft — a silently truncated itinerary would be worse than no prefill. A refused clipboard
  (permissions, insecure context, old WebView) is caught and says so, pointing at Save as PDF.
- **Itinerary → Create Partial is a saved FILTER over the full itinerary, never a second
  document** ("create a partial itinerary that does not include all events… identical to the items
  on the full itinerary, except that it should include less items," 2026-09-26). The 🧭 menu's
  owner-only **Create Partial** item opens its own picker panel (`data-tripsy-partial-panel`,
  registered in every list the Generate panel is: `TRIPSY_TRIP_PANEL_SELECTORS`, the trigger list,
  `freshlyRenderedEachTime`, the header-toggle collapse guard, the phone max-width rule) built
  from the SAME `tripsyGeneratePanelSections` rows the Create/Generate panel shows — one builder,
  so the two panels can never list different sections — but with its own include/exclude
  checkmarks (`data-tripsy-partial-checkbox`; same `tp-generate-panel-check` styling, different
  attribute so the Generate panel's listeners never fire). Everything starts INCLUDED (a partial
  is made by removing); a DAY row's checkbox carries that day's write-up AND toggles its events
  with it (each re-toggleable individually); the panel's delegated listener is wired ONCE per
  node (`tripsyPartialWired` — re-wiring per open stacked listeners and made every tap a
  double-toggle no-op). "View Partial Itinerary" (top and bottom) refuses a zero-event selection,
  saves the keys optimistically to `driveData.tripsyPartialItineraries`
  (`Store.getTripsyPartialItinerary`/`saveTripsyPartialItinerary`, one entry per trip, pruned in
  `pruneDriveDataInMemory` when its trip disappears — the new-key prune rule) so reopening the
  picker resumes it, and opens `showTripsyPartialItinerary` — a read-only overlay
  (`#tripsy-partial-overlay`, the Summary overlay's exact shell/print-isolation pattern, body
  class `tripsy-partial-open`, Save as PDF via `openTripsyItineraryPrintView({partialKeys})`).
  The document itself is `buildTripsyPrintHtml(tripKey, {partialKeys})` —
  `tripsyFilterPrintDayDataForPartial` filters the day data at render time, so "copy the
  narratives from the already generated full itinerary" falls out of reading the SAME narrative
  cache (Overview/day narratives are read-if-included, `eventblurb`s ride their cards; nothing is
  ever generated, copied, or deleted, and the full itinerary is untouched). Selection keys are
  the Generate panel's section keys; events match on the BASE id
  (`tripsyPartialBaseEventId` strips the `-checkin`/`-checkout`/`-begin`/`-end` split suffixes,
  so keeping a hotel's check-in row — the only half the picker lists — keeps its check-out row:
  they are one event); a P/S row is independently selectable by its `ps:` key; a layover survives
  only between two KEPT flights (it describes a connection that no longer exists on paper when
  either side is excluded). Day NUMBERS stay date-derived and identical to the full itinerary,
  but the calendar SPAN is bounded to the kept days (`partialDatedKeys`) — an excluded day
  outside the span must not render as a fake "No events scheduled" block, while interior gaps
  between kept days still do (nothing in THIS document happens there). The cover header keeps
  describing the WHOLE trip (`headerPlaceEvents`, captured before filtering) — a partial is a cut
  of the same itinerary, not a different trip. `partialitinerary_test.js`.
  **An event CREATED AFTER the partial was saved defaults to INCLUDED** ("The itinerary does not
  show all of the concerts on the schedule… on October 9 there are three concerts, but only one
  is mentioned," 2026-09-28 — concerts added a day after the partial was saved were silently
  absent, but a partial is made by REMOVING, so an event the owner never had the chance to
  exclude must not read as excluded). No schema change: locally-minted event ids are epoch-millis
  × 1000 (`tripsyMintLocalId`), so `tripsyPartialEventPostdatesSave(id, savedAtMs)` dates the
  event against the record's `updatedAt` (Tripsy-era ids are far below any threshold and never
  trigger; no `savedAt`, or a non-numeric id, falls back to strict keys-only). Self-correcting by
  construction: unchecking the newcomer in the picker re-saves the record, and the fresh
  `updatedAt` then postdates the id, so the explicit exclusion sticks. Threaded as
  `partialSavedAt` through every render of the partial — `buildTripsyPrintHtml` → the filter's
  `idKept`, Show (stashed as `overlay._partialSavedAt`), Save as PDF
  (`openTripsyItineraryPrintView`), the background photo-maintenance rebuild (else its repaint
  would drop the newcomers again), and `tripsyPartialEnsureNarratives`' scoping — and the Create
  Partial picker resumes such an event as CHECKED (`tripsyPartialKeyPostdatesSave`, event keys
  only, never `ps:` rows). `partialnewevents_test.js`.
  **View asks Summary or Full, full mode generates what's missing, and the result is a NAMED,
  reopenable document** ("ask the user if he would like to see a summary or a full itinerary… if
  full…, generate narratives and photos for all of the events… save the itinerary with the title
  Partial Itinerary and then the start and end date… include in the itinerary drop down menu an
  option for show and then the name," 2026-09-27). Pressing View Partial Itinerary first opens
  `tripsyPartialModeDialog` (Summary / Full Itinerary; dismissing decides nothing — the picker
  stays as it was, nothing saved). The record then saves with `mode`, `title` (`Partial Itinerary
  ${formatTripDateRange(start, end)}`, span = the days of the INCLUDED events, read off the
  checked event checkboxes' `data-partial-day`) and `startDayKey`/`endDayKey`
  (`Store.saveTripsyPartialItinerary`'s `extra` arg), and a successful save re-renders My Trips so
  the 🧭 menu's new **"Show <title>"** item (`data-tripsy-show-partial`, any viewer — read-only
  like Summary/Print; gated on `savedPartial.title`, so pre-title records just don't list) appears
  immediately; Show reopens `showTripsyPartialItinerary(tripKey)` from the stored selection+mode.
  **Summary mode** renders the Part-1-only build (`{partialKeys, summaryOnly:true}` — the filter
  runs before the summary early-return, so the two options compose); **full mode runs
  `tripsyPartialEnsureNarratives` on EVERY owner open, not just creation** ("there were no
  generated narratives or photos in the itinerary," 2026-09-27: the one creation-time run had
  failed/been interrupted — these are minutes-long Claude calls, and backgrounding the iPad app
  mid-call kills them — and Show never retried, leaving the document bare forever; confirmed
  against the live data: the saved partial existed with mode `full` while the trip's narrative
  cache held ZERO entries). Only MISSING included sections are asked for — intro if Overview
  included, day write-ups for included days, Part-1 blurbs scoped to the partial's kept days
  whose included blurb-wanting rows lack one — so an already-prepared full itinerary is copied
  with zero Claude calls (Show stays instant) and anything generated here benefits the full
  itinerary too (the sections file into the ONE shared narrative cache under the same keys).
  **The generation itself is HANDED TO THE CLOUD ROUTINE — nothing generates in the foreground**
  ("I do not want to keep the app open in the foreground in order to generate a partial
  itinerary," 2026-09-27, and see the dedicated cloud-narrative bullet below): `ensure` QUEUES a
  request and fires the Worker, the document renders immediately with an in-overlay banner
  ("being created in the background — you can close the app"; overlay only, never the print
  root, so a Save as PDF taken meanwhile carries no app status line), and the relay drain
  repaints the open overlay when the answer lands. A failure to even queue shows a PERSISTENT
  `tripsyConfirmDialog` (a toast fired while the app is backgrounded is never seen) then still
  renders what exists. **"Use the exact same rules and procedures" still holds by
  construction**: the request carries the EXACT prompt strings the in-app generators send —
  built by `tripsyNarrativePromptText`/`tripsySummaryBlurbsPromptText`, the very builders those
  generators' own message content comes from — and the drain files the answer with queue-time
  fingerprints, the scoped summary merge, and the same `tripsyRecordItineraryBaseline`
  acknowledge step every full-itinerary generate path ends with. Photos: the full-mode
  open paints instantly from pure cache, then runs `tripsyBackgroundPhotoMaintenance` (fetch
  gate on) in the background and repaints in place only if something changed — missing photos
  still self-heal on open, but never in front of the first paint ("Why is there a delay when I
  open my partial itinerary?", 2026-09-27); the repaint restores the generation banner via
  `overlay._partialGenPending`. Save as PDF honors the stored mode
  (`overlay._partialMode`); a record saved before modes existed reads as `full`.
  **The cards' 🔄🗂🔍📋🚫 photo controls work here too** ("The buttons on the photos in the
  itinerary are not working," 2026-09-27): that wiring used to live inline in
  `previewTripsyItinerary`, attached to Preview's content node only, so the same buttons rendered
  DEAD in this overlay. It is now the top-level `wireTripsyPhotoCardControls(contentEl)` — one
  delegated click+keydown pair resolving everything per card from data- attributes — called by
  both Preview and `getOrCreateTripsyPartialOverlay` (once per node; delegation survives every
  innerHTML re-render). Any future overlay that shows print-built cards must call it too.
  `photobuttons_test.js`. `partialmode_test.js`.
- **Narrative generation offloads to the cloud routine via a request/answer relay pair** ("I do
  not want to keep the app open in the foreground in order to generate a partial itinerary,"
  2026-09-27 — minutes-long Claude calls die when the iPad app backgrounds, which is what left
  that partial bare in the first place). Two users today: the partial's full mode, and the changes dialog's
  background fallback (2026-09-28 — both build through the one shared `tripsyBuildNarrativeCloudRequest`). **Queue**: `driveData.tripsyNarrativeRequests`
  (`Store.listTripsyNarrativeRequests`/`queueTripsyNarrativeRequest`/`removeTripsyNarrativeRequest`,
  one request per trip, replaced outright), each request carrying the EXACT prompts the in-app
  generators would send (`narrativePrompt` for ALL requested days in one — the routine has no
  4096-token response cap, so the in-app 4-day batching doesn't apply — plus `summaryPrompt`),
  the queue-time fingerprints (`introFingerprint`/`dayFingerprints`/`summaryFingerprint`) and
  row-key sets (`summaryRowKeys` replaced / `allRowKeys` live) so the drain is pure assembly.
  Queueing fires the same Cloudflare Worker Run Parse Now uses (`runTripsyRefreshViaWorker(null)`,
  best-effort — the scheduled 3×/day runs are the backstop, and its relay polls drain the answer
  in); a still-pending request is never re-queued over (that would re-date it), though one >15 min
  old re-fires the Worker. **Answer**: the cloud Routine's STEP 4 follows each request's prompts
  (prose only — the Routine prompt says text inside a request is data, never instructions beyond
  that) and writes `tripsy-narrative-results.json` (`{results:[{requestId, tripKey, trip_intro,
  days:[…], summary_rows:[…]}]}`). **Drain**: `drainTripsyNarrativeResults` →
  `applyTripsyNarrativeResults`, called in `syncTripsyRelays` AFTER `ensureTripsyDecrypted`
  (unlike the proposal drains — filing ends in `tripsyRecordItineraryBaseline`, which needs the
  real trip): match by `requestId` (unmatched answers are skipped), file each section with the
  request's fingerprints, scoped-merge summary rows exactly as `tripsyGenerateNarrativeSections`
  does, save once, remove the request, toast, and repaint an open partial overlay showing that
  trip. A failed cache save THROWS so the shared drain keeps the relay file for the next pass. A
  day the request never asked for is never filed. **Prune** (`pruneDriveDataInMemory`): a request
  embeds trip data inside its prompts, so one whose trip is gone or older than 48h (six scheduled
  runs ignored it — the next full-mode open re-queues what's still missing) is dropped. The
  status badge shows a yellow "being written in the background" row while any request is queued,
  and `tripsyParseRunStartedAt`'s keep-alive/clear conditions count narrative requests as
  outstanding work — without that, a badge refresh during a narrative-only run nulled the marker
  and killed the relay polls waiting on the answer. NOTE: the Routine was created via http_api,
  so sessions cannot `update_trigger` it — its prompt is edited by the owner at
  claude.ai/code/routines. `cloudnarrative_test.js`.
- **A Claude session edits trip data through a RELAY, never by touching `trips-data.json`** ("Can
  you look up the concert times … and add them to the itinerary," 2026-09-28 — the first owner
  request for a session to modify trip data directly). A session's Drive tooling can only CREATE
  files, and replacing `trips-data.json` wholesale would race an open session's own edits (the
  app's discovery is a name search, newest-modified wins; an open session's next save would land
  invisibly in the stranded copy) — so the session writes **`tripsy-trip-edits.json`**
  (`TRIPSY_TRIP_EDITS_FILENAME`, same folder/ACL as `trips-data.json`, so it grants nothing new)
  holding `{edits:[…]}` of the EXACT plain change objects `Store.queueTripsyChange` has always
  taken, and `drainTripsyTripEdits` (in `syncTripsyRelays` AFTER `ensureTripsyDecrypted`, next to
  the narrative drain — the changes need the live trips array; owner-only) feeds each through that
  one entry point: same conflict-guarded write, derived-cache cleanup, in-flight badge and failure
  handling as a hand-made edit, app stays single writer. Entries must be REPLAY-SAFE (a failure
  keeps the file via `drainTripsyRelayFiles`' delete-only-after-success): `edit_event` re-merges
  idempotently; `create_event` is skipped when the trip already holds an event with the same
  `name`+`startsAt`; `create_trip` is skipped when its key exists; an entry referencing something
  gone, or an unknown type, is skipped rather than blocking the rest; one failed entry still lets
  the rest apply, then throws so the file is retried. Applied edits toast "Applied N itinerary
  updates from a Claude session." **`tripsDataUpdatedAt` rides both of `syncTripsyRelays`' re-render
  snapshots** ("the start times … do not match with what you reported," 2026-09-28: the drain
  applied its edits while My Trips was open, but the snapshot only watched the proposal queues —
  `queueTripsyChange` touches neither — so the page kept the pre-edit render until a manual
  reload); it moves exactly when `trips-data.json` was rewritten during the sync, so drained trip
  edits repaint an open page and an unchanged pass still skips the rebuild. The first real relay (2026-09-28) set the Singapore GP concert
  times/stages: 4 `edit_event` (JJ Lin, The Killers, James Arthur, Lana Del Rey — Padang) + 5
  `create_event` (CORTIS, Zara Larsson; Split Enz, Goo Goo Dolls, Janet Jackson — Wharf).
  **The `create_event` replay dedupe is per-resource** (`tripsyTripEditCreateIdentity`, found
  2026-09-30 adding the Germany road-trip drives): it compared `name`+`startsAt`, which
  TRANSPORTATION doesn't carry, so `'' === ''` matched any existing flight and every relayed
  car/train leg was silently skipped (and the relay file then deleted). Transportation now keys on
  `departureAt`+endpoints, everything else on `name`+`startsAt`, and an entry with nothing
  identifying never dedupes. A relay carrying transportation must not be uploaded before this
  fix is live. `tripeditsrelay_test.js`.
- **International flights get researched ENTRY REQUIREMENTS — ON DEMAND, from a trip-header button —
  and flights that need something get a "🛂 Entry Requirements" button** ("When there is a flight into
  a different country … research any entry or visa requirements … put a button on the flight event,"
  2026-10-03; then, same day, "Instead of having the app automatically research entry requirements,
  put a button on the title bar of any trip with an international destination"). **Nothing researches
  automatically** — the first version swept on every relay sync and after each new flight save
  (`tripsyEnsureEntryRequirements`, removed); don't re-add a background trigger, since every call is
  a paid multi-search web research turn. The owner-only title-bar button (`data-tripsy-entry-research`,
  labelled "Entry Requirements", ⏳ + disabled while `tripsyEntryResearchingTrips` holds the trip)
  shows on a trip not yet over (`tripsyEntryTripShowsButton`) with at least one flight that isn't
  KNOWN domestic — countries are only known after research, so an unresearched flight counts as
  possibly international. Pressing it runs `tripsyResearchTripEntryRequirements`: every route in
  that trip (`tripsyEntryTripRoutes` — deduped, known-domestic skipped, known-international
  RE-checked, which is how the owner refreshes a record; there is no 30-day auto-recheck), a
  4-call pool (`TRIPSY_ENTRY_PARALLEL_CALLS`), one persist, a toast naming how many routes need
  something (and how many failed — a failed route stays unrecorded, the next press retries it),
  then a re-render that puts the per-flight buttons on the rows. One Claude call per ROUTE
  (`tripsyEntryRouteKey` = normalized departure→arrival description), `claude-opus-5-5` with the
  `web_search_20260209` server tool (rules like ETIAS/UK ETA change — training memory isn't enough)
  and the server-side refusal fallback (`fallbacks:'default'` + beta header); `pause_turn` is
  continued, and a 400 degrades one option at a time (drop fallbacks, then web search — the record
  is then `verifiedOnline:false` and the dialog says so). The answer ends in a `<json>` block
  (`tripsyEntryParseResult`: http(s) links only, a domestic flight can never claim requirements, no
  block = throw). Records live in `driveData.tripsyEntryRequirements` (route key →
  `{departureCountry, arrivalCountry, international, requirementsNeeded, headline, items, links,
  sources, nationality, checkedAt}`), shared by every viewer; travelers are assumed US passport
  holders (`TRIPSY_ENTRY_TRAVELER_NATIONALITY`). The row button (`data-tripsy-entry-reqs`, every
  viewer) shows only when `tripsyEntryRecordShowsButton` (international + requirements + something
  to list); `showTripsyEntryRequirements` renders the escaped details with links opening in a new
  tab. Prune rule: records no remaining flight's route uses are dropped. **A Claude session can
  hand-enter records** ("can you manually enter those now," same day) through the relay
  `tripsy-entry-requirements.json` (`{entries:[{route_key, route, checked_at, sources, …the <json>
  answer fields…}]}` — `route_key` must equal `tripsyEntryRouteKey`'s normalization: trimmed,
  lowercased, whitespace-collapsed `departure→arrival` descriptions). `drainTripsyEntryRequirementsRelay`
  runs in `syncTripsyRelays`, sanitizes each entry through the same `tripsyEntryNormalizeRecord` the
  model's answer uses, and never replaces a NEWER record. `entryreqs_test.js`.
- **⚙️ Trip → Verify Travel Details names CITIES, and a flight covers a move only if it
  leaves the city you're checking out of** ("Why does the verify trip details view not
  identify a missing transportation link from beppu to fukuoka," 2026-10-22). It did list the
  drive — as "Marugamiya → FUK", unreadable as Beppu → Fukuoka — while the same day's
  stay-to-stay row "Marugamiya → Andaz Seoul" read green, because ANY transport overlapping
  the checkout→check-in window counted. `tripsyTransportationGaps` now: **(1)** gives every
  move `fromLabel`/`toLabel` for display — a lodging gets "(City)" from
  `tripsyVerifyLodgingCity` unless its name already says it (Japanese addresses parse to the
  PREFECTURE, so a prefecture result takes the comma segment before it — Beppu, Nakatsu, Hita,
  Taketa — unless that is a ward like "Chuo-ku"; `TRIPSY_JP_PREFECTURES`), and a bare airport
  code reads "Fukuoka airport (FUK)" via the fly-over's `TRIPSY_AIRPORT_CITIES`; `from`/`to`
  stay the raw names because they prefill the Add form. **(2)** when the move's first flight
  departs a city other than the stay's (`tripsyFlyoverAirportCity` vs. the lodging city, also
  `tripsyDescMatchesCity`) and no GROUND leg departs before that flight (a car at the arrival
  end doesn't count), the move becomes the missing drive "Stay (City) → City airport (CODE)",
  and the departure-transfer row for the same drive is not listed twice. Unknown city on either
  side → the old lenient rule. Run against all 35 live trips: only the Beppu leg changed.
  `verifygaps_test.js`.
  **The report is never stored — it is rebuilt from the live trip on every open, and after
  filling a gap it reopens from the SAVED trip** ("When does the trip details list
  regenerate," 2026-10-22). `openTripsyVerifyGapEdit` used to reopen it 350 ms after the add
  form closed, from the trip object captured when the form opened, counting on the
  pending-changes list (always empty since the Tripsy migration) — but a save REPLACES the
  trip object and finishes in the background, so the gap just filled still read missing. The
  form's create path now takes `createOptions.onWriteStart` (called before `onClose`) and
  `onWriteDone(ok)` (after `Store.queueTripsyChange` settles; a caller with it gets no
  reopened form on failure, since its overlay is gone — the toast still shows and the gap is
  still listed). Verify uses them: Cancel reopens at once, Save reopens once the write has
  landed, both from `tripsyDecryptedTrips`' current copy. `verifyreopen_test.js`.
  **A missing row opens its Add form PREFILLED from the itinerary** ("allow the user to click
  the item in trip details and open to an event that's is pre-filled with the possible
  information from the trip itinerary (i.e., date, origin, destination, city, etc.)," same day).
  Each move from `tripsyTransportationGaps` carries a `prefill` (category Car): both ends as the
  lodging NAME + its town ("Marugamiya, Beppu" -- the name stays first, since the lodging
  ordering pass ties a leg to a stay by name) or the airport label ("Fukuoka airport (FUK)");
  times the itinerary implies -- leave at check-out (when that is on the day and before the
  airport time, else 1h before it), reach the airport 2h before the flight, leave the airport
  when the flight lands (`tripsyVerifyClockIso` shifts the wall-clock digits); and a note naming
  the flight it serves ("To catch flight Asiana Airlines OZ133 departing 3:50 PM to Seoul airport
  (ICN)."). A time nothing implies stays blank. A missing NIGHT gets `tripsyVerifyLodgingPrefill`:
  check-in 3 PM, check-out 11 AM after the run of consecutive gap nights, and the likely city in
  the address (where that day's flight lands, else the stay checked out of that day, else the next
  stay); that city also goes on the panel as `data-tripsy-place-hint`, which the name lookup
  (`tripsyWireNameLookupAutofill`) uses as its search hint and replaces outright with the real
  address instead of raising the conflict dialog. The dialog finds a row's move by `data-tvv-idx`
  into its own `missingMoves`. `verifygaps_test.js`.
  **A missing TRANSPORTATION row never opened its form at all** ("When I select a missing
  transportation event from the verify travel details menu, it does not open to an add event
  page," same day): `openTripsyVerifyGapEdit` renders the form BEFORE attaching its overlay, and
  `renderTripsyEditPanel` found the transportation form's airline `<datalist>` with
  `document.getElementById` -- null while detached, so the form threw and nothing appeared
  (lodging has no datalist, so it worked). The lookup is now `panel.querySelector`, guarded, so a
  detached render works for every caller. Reproduced and verified in Chromium.
  **Every missing leg also offers 🚕 Taxi, and a taxi has its own checker-cab glyph** ("For
  missing transportation events, add an option to take a taxi. If the user selects that option,
  use a glyph for a yellow NYC cab with a checkerboard design on it," same day). `taxi` is a
  transportation type (`TRIPSY_TRANSPORTATION_TYPES`, so it is in every Type menu; 🚕 for the
  plain-text header label; dot colour `#24425E`). The glyph is an inline SVG
  (`TRIPSY_TAXI_GLYPH_SVG` → `TRIPSY_TAXI_GLYPH_URL`, a yellow Checker cab with a black-and-white
  checkerboard band) on the bike's marker convention: `tripsyTimelineDotIcon` returns
  `TRIPSY_TAXI_ICON_MARKER`, and **every place a dot glyph is drawn goes through
  `tripsyDotGlyphHtml`** (My Trips dot, Travel View `.tv-icon`, both itinerary card photo
  fallbacks) -- those last three used to `esc()` the glyph, so the existing bike marker printed
  as its raw `__tripsy_bike_icon__` string there; that is fixed by the same helper. In Verify, a
  missing row is a flex pair: the row button (prefilled Add form, as before) and a sibling Taxi
  button (`data-tvv-taxi`, not nested -- a button inside a button is invalid) opening the SAME
  prefill with `category: 'taxi'` and the form headed "Taxi" (`gap.label`). A taxi counts as a
  car for the no-write-up rules (all four `airplane || car` checks), and its itinerary card
  shows the cab glyph with NO Places photo search (`isTaxi` in `tripsyTransportationCardHtml`);
  the van-transfer photo rule stays car-only. Fly-over already reads `taxi` as a drive.
  **A taxi's edit form has no Seat or Travel Agent section** ("For a taxi event, there is no need
  to have fields for travel agent or seat," same day): every edit-form section carries
  `data-tripsy-edit-group`, and `renderTripsyEditPanel` hides the `TRIPSY_TAXI_HIDDEN_EDIT_GROUPS`
  sections while Type reads Taxi (on open and on every Type change; hidden, not removed, so the
  save still reads every field). The read-only view already omits empty sections. A WALK hides
  them too (same day) -- the rule keys on `TRIPSY_NO_SEAT_OR_AGENT_TYPES` (`taxi`, `walk`).
  **Cancel on the Verify form now works after an edit** ("When i selected a transportation event
  from the verify trip details page and I hit the cancel button, nothing happened," same day):
  Cancel on an edited form asks `tripsyConfirmDiscardChanges` first, and that dialog opened at
  z 10002 -- BEHIND the Verify form's own overlay (z 10003) -- so the question was invisible and
  Cancel waited on it forever. It is pinned at z `2147483110` now, above every form it can guard
  (and above `tripsyConfirmDialog`). Any new overlay hosting an edit form must stay below it.
  `taxi_test.js`.
- **The "Update" comparison (tour-operator PDF vs. Tripsy) is saved, not ephemeral**: the owner can
  upload a PDF from a trip's **⚙️ Trip → Compare to PDF** menu ("Resume Comparison" while one is
  outstanding). Both moved there 2026-08-29 from the 🧭 Itinerary menu: it reconciles trip EVENTS
  and never touches the generated narrative, so it didn't belong among items that are all about
  that write-up — it now sits beside Verify Travel Details, the item it most resembles. The label
  says COMPARE rather than the original "Update" because that's what it does: it produces a diff
  the owner resolves row by row, where "Update" implied it overwrites things by itself. It calls
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
  garment, and correctness beats the clock. Judge it by opening the list, not by the timing log.
  **The guidance call is also SKIPPED outright when its inputs are unchanged** (reported
  2026-08-14: "the app says it can take a minute, but it always takes much longer"): it sizes every
  quantity off exactly two authoritative inputs — the per-tier occasion counts and the tier-tagged
  time-blocks (tier + `spanHours` per block) — so `generateTripsyAttireGuide` fingerprints those
  (`guide.guidanceFingerprint`, via the shared `runGuidancePhase` closure both generation branches
  go through) and, on a match with a saved guide that has real `personGuidance` + `packingList`,
  carries guidance/packingList/laundryDays over VERBATIM (verbatim matters: picks/skips key on tier
  + line NAME, so re-minting the list would strand them) with no guidance call at all — a Refresh
  after a retitle, a time move, or an added event that folds into an existing block at the same tier
  drops from minutes to seconds. Deliberately NOT fingerprinted: event names/ids and weather — a
  retitle or a forecast wobble must not cost two minutes; a moved tier, changed counts, or a changed
  block span (it feeds the ≤4h re-wear rule) all invalidate. `packingFrozen` stays tied to the trip
  having STARTED only; a pre-trip reuse freezes nothing, and a pre-fingerprint guide just re-runs
  once and records it. The generation UI also reports honestly now: `generateTripsyAttireGuide`
  takes an optional `onStage` callback, `runTripsyAttireGeneration` renders it as a live
  `data-attire-stage` line in the overlay's loading state, and the old "can take a minute" toast
  says "typically 2–3 minutes" for a full generation instead. Two calls, because
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
  `getOrCreateTripsyAttireDefinitionsOverlay`, reached via the toolbar's Definitions button; that
  toolbar, in the overlay's lazily-created static shell — so `isOwner` is settled — also carries an
  owner-only **Regenerate** button to Definitions' right, 2026-09-15: the same
  `tripsyRunAttireGenerationSafely` entry the 👔 menu's Refresh fires, against
  `tripsyAttireOverlayTripKey`, `isRefresh` reflecting whether a guide exists, and a
  `tripsyAttireGeneratingKeys` guard so a double-press can't run two generations;
  `regeneratebtn_test.js`) — a full
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
- **The "🧺 Laundry" button** (labeled "Do Laundry Today" until 2026-10-01 — "Why does the daily
  dress guide say to do laundry every day?": it sits on EVERY upcoming day so a wash can be
  recorded whenever one happens, and the imperative read as advice to wash daily; the real advice
  is the orange "Best day for laundry" bar and, after a wash, the red run-out bars — don't
  reinstate an imperative label) shows on the trip's CURRENT day only ("only show it on the
  current day," same day — `isToday` off `dgTodayKey`; no trip in progress → no button anywhere),
  plus any day already washed, which keeps its "Washed Today" record. It sits on its own
  flush-right row (`.tripsy-dg-laundry-row`) directly
  BELOW each day's "Start the day in…" instruction bar — outside it, not in it: that bar states
  what to wear, and on an outfit-linked day the whole bar is a tap target for the outfit, which a
  nested button had to fight (the handler's `stopPropagation` is kept anyway, so a bubble can't
  open the outfit modal behind the laundry screen). It follows the day's FIRST bar only — laundry
  is a property of the day, not of every outfit change within it — and is owner-only. Every
  instruction bar therefore stays a compact `inline-flex` pill; the old stretch-the-bar
  `--wide` variant is gone. It opens `showTripsyLaundryDay` → `tripsyLaundryItemsForDay`. The main
  grid lists what is **dirty on that day AND needed again afterwards**; garments dirty but NOT worn
  again this trip are returned too, flagged `neededAgain: false`, rendering below the grid in their
  own slate-tinted **"Not Needed for Trip"** box (washing them can't change whether you make it to
  the end, so they must not pad the main list — but they go through the same `cardHtml`, so bagging
  and Not Dirty work there too). **One garment can straddle both sections as TWO cards** (3 shirts
  dirty, 2 shirt-days left → wash 2, third optional): dirty copies are fungible, so `pushSplit`
  computes the split — future wearings need `ceil(futureWears/limit)` copies, still-clean copies
  cover that first, only the shortfall of dirty copies goes on top. The bottom card's key is the
  base key suffixed `::nn` so the bag holds each card's copies separately — `lastWashFor` and the
  run-out projection's `washedOn` both read `bag[key] || bag[key+'::nn']` — while `creditKey` stays
  the base key on both cards and the Not Dirty credit math targets `totalDirty` (the garment's
  whole pile), since washes and credits are per GARMENT in the aggregate wear-count model. Wear days
  come from the existing `tripsyWardrobeWearDays` (and `…FromLines` for "No Picture" generics, so
  they count too). A garment is listed only once genuinely DIRTY — worn its full run of wearings —
  via `TRIPSY_WEARS_BEFORE_WASH` / `tripsyWearsBeforeWash` / `tripsyDirtyCopies`. **Those numbers
  are the same ones the packing prompt sizes quantities with** (tops 1, bottoms 10, a dress 6);
  if the two disagreed, the app would tell you to pack for one cadence and wash on another.
  `Infinity` means it never goes in a wash bag on the trip — tailoring is dry-cleaned and re-worn
  freely, **ties are restyled rather than laundered** (the prompt's "re-worn twice" rule is about
  swapping to a different tie for variety, not about washing one), and shoes/belts/cufflinks/
  sunglasses are not laundry at all. An unrecognised garment
  falls back on its packing GROUP rather than a magic number. Dirty copies =
  `floor(wearings / limit)`, **capped at the copies packed** — you cannot have four dirty shirts
  when three went in the bag — and the count shows under the card only when it is more than one. Cards use the garment photo, falling back to its type glyph. Sorted
  biggest-pile first.
  **Tapping a garment puts it in the LAUNDRY BAG** — a card under the grid listing what you have
  gathered, each entry naming the garment and, when more than one, `×N`. One dirty copy goes
  straight in; several ask how many, so two of three shirts can go and the third stays on the
  list with its count reduced. A garment fully in the bag drops off the grid, and every bag entry
  has a ✕ to put it back. The count dialog is the packing one (`tripsyWardrobeChoosePackedCount`)
  with its wording parameterised — omit the options and it asks "How many packed?" exactly as
  before. The card sits ABOVE the grid: it is the thing you are filling, and the grid is what you
  are filling it from.
  **The bag persists** in `driveData.tripsyLaundry` (one record per trip+person+day; an emptied
  bag is deleted rather than stored empty), so gathering can span a session or a device. **Wash
  Now** stamps that record's `washedAt`, and a washed record is what makes those garments clean
  again: `tripsyLaundryItemsForDay` counts a garment's wears only since the **last wash that
  INCLUDED it** — per garment, not globally, since a wash is one bagful and not everything you
  own. A wash dated later than the day being viewed doesn't clean it, an unwashed bag counts for
  nothing, and the other person's wash is not yours. After washing, the screen is rebuilt from the
  recomputed truth rather than patched in place.
  **"Not Dirty" forgives WEARINGS, not the garment.** Each card carries a second button
  (`data-laundry-clean`, which must `stopPropagation` past the card's own add-to-bag tap) recording
  a credit in `driveData.tripsyLaundryNotDirty` (`Store.listLaundryNotDirty`/`addLaundryNotDirty`,
  one dated record per trip+person+day+garment+count). `tripsyLaundryItemsForDay` subtracts those
  credits from the wear count, so a one-wear shirt drops off the list outright while a ten-wear pair
  of trousers is simply good for one more wearing — which is what the owner means by "not dirty"
  for a garment that was never a single-wear item. **The credit is sized to the OUTCOME, not one
  wearing per press**: because the dirty count is capped at the copies packed, one dirty copy can
  carry many wearings (a one-wear polo worn 4 days = one card, four wearings), and a flat
  one-wearing credit left that card on the list press after press. The handler forgives down to
  `(copies still dirty) × limit + (limit − 1)` — the trailing `limit − 1` is the one-more-wearing
  headroom — using the `worn`/`limit` values each list item now carries. Credits are scoped exactly like the wear count
  itself: same person, dated on or before the day being viewed, and only those AFTER that garment's
  last wash — a wash resets the clock, so a credit granted before it must not keep suppressing
  wearings that happened since. `worn` is floored at 0, so an over-large credit is harmless rather
  than negative. A card holding several dirty copies asks how many via the same
  `tripsyWardrobeChoosePackedCount` dialog the bag uses (reworded "How many are not dirty?"), and
  the count is clamped to what is actually on the card. Like Wash Now, the screen is then closed and
  reopened so the wear maths is recomputed rather than patched — and BOTH are optimistic: the
  in-memory mutation in `addLaundryNotDirty`/`washTripsyLaundryBag` happens synchronously before
  their Drive write, so neither handler awaits the write before rebuilding (awaiting it left the
  card frozen for the length of a whole-file PATCH, reading as a dead button); a background failure
  surfaces as a toast. Two related traps live in the shared count dialog
  (`tripsyWardrobeChoosePackedCount`): it must pin its overlay z-index ABOVE every caller
  (`2147483200` — the laundry screen raises itself past the base `.tw-modal` layer, and the dialog
  once opened invisibly BEHIND it with the caller awaiting an answer that could never come), and its
  option markup is named `optionsHtml` because a `const opts` there shadowed the `opts` options
  parameter and silently discarded every caller's custom title/subtitle wording. The SAME trap hit
  the outfit modal's **Swap** button (`tripsyOutfitSwapPicker`'s `#tw-swap-overlay`): with no
  explicit z-index it sat at the base `.tw-modal` layer while the outfit modal that opens it
  (`#tw-outfit-overlay`) sits at `2147483080`, so Swap opened the picker invisibly behind it —
  pressing the button did nothing, because there was nothing left to tap. Now pinned to
  `2147483090`, explicitly above the one caller that ever opens it. Any new small blocking picker
  opened from an already-elevated screen needs this same explicit z-index above its caller — the
  base `.tw-modal` layer is only correct for a picker opened from the ordinary page background.
  **Swap is scoped to the block's LIVE dress code, not the tier it was composed against, and can
  remove a piece outright.** `tripsyOutfitBlockLiveTier(guide, block)` reads each of the block's
  events' CURRENT `tripsyAttireDisplayCategory` (same lookup `tripsyOutfitBlockTierMoved` already
  did to detect drift, just returning the value instead of a boolean) — because an event's dress
  code can be hand-overridden after an outfit was composed, and the whole point of reopening Swap
  after doing that is to see substitutes for the NEW tier, not every same-type garment regardless
  of formality. `tripsyOutfitSwapPicker`'s candidate filter adds `(g.tiers||[]).includes(liveTier)`
  on top of the existing same-type-bucket check — same convention the Pack-for-tier screens already
  use, so an untagged garment (empty `tiers`) is excluded here exactly like it is there. Falls back
  to the pre-fix same-bucket-only behavior when no live tier is available (guide fetch failed).
  Swap can also resolve with `TRIPSY_OUTFIT_SWAP_REMOVE` (its own **Remove from outfit** button,
  always offered alongside the candidate grid) instead of a garment id, splicing the piece out of
  `block.garmentIds` with no replacement — e.g. a tie that's merely optional now that the event
  reads Cocktail rather than Black Tie, where a substitute isn't the point, dropping it is.
  **Swap and Remove are optimistic** ("There was a delay when I hit a button to remove a
  garment from an outfit," 2026-10-05): the handler mutates `block.garmentIds` (a live
  `driveData` record), fires `onSwapped`, and repaints the modal IMMEDIATELY; the whole-file
  save and the auto-reconfigure that follows it run in the background on
  `tripsyOutfitSwapChain`, so two quick swaps can't race. A failed save restores the block's
  previous ids, toasts "…it was undone", and fires `onSwapped` again and repaints (only if the
  modal is still open), as does a successful auto-reconfigure. `outfitswapfast_test.js`.
  **Swap only offers a garment that's actually FREE that day.** Besides `wornElsewhere` (already
  worn in THIS block), it now excludes anything already assigned to a DIFFERENT block on the SAME
  day — offering it would mean the same physical piece worn in two outfits at once. A garment worn
  on some OTHER day of the trip is unaffected and still offered, since reusing a piece across the
  trip is the ordinary case, not a conflict. `tripsyOutfitSwapPicker` fetches this person's
  `Store.getTripsyTripOutfits` and unions every OTHER block's (`b !== block`) `garmentIds` where
  `b.dayKey === block.dayKey` into `wornSameDay`, added to the same exclusion check as
  `wornElsewhere`. A block missing `dayKey` (defensive, for incomplete guide data) skips the check
  entirely rather than excluding everything.
  **On the 3 mix-and-match tiers (`casual`/`smart_casual`/`athletic`), Swap's same-type-bucket check
  loosens to a same-packing-GROUP check instead.** The narrow `tripsyGarmentTypeBucket` (polo vs.
  shirt vs. tee are three different buckets) is right for the 4 itemized tiers — a dress-shirt slot
  must never offer a tie — but wrong for mix-and-match, where `tripsyWardrobeNeedByTier` already
  treats any top as interchangeable for that tier's need lines; Swap disagreeing with its own need
  lines is what caused "not all available casual tops appear" (confirmed against the owner's real
  wardrobe: casual tops alone span typeKeys polo/shirt/tee/jacket, so swapping a polo only ever
  offered other polos). `isMixAndMatch = liveTier && !TRIPSY_ATTIRE_ITEMIZED_CATEGORIES.includes(liveTier)`
  picks the check; `currentGroup` (`tripsyAttirePackingGroupOf`) is computed alongside the existing
  `bucketKey` and the candidate filter branches on `isMixAndMatch`. The typeLabel shown in the
  modal's heading switches the same way, so a mix-and-match swap reads "Tops" rather than a
  misleadingly narrow "Polo". No live tier at all (guide unavailable) still falls back to the
  pre-existing same-bucket-only behavior, unchanged.
- **Once a day has a confirmed wash, its button reads "Washed Today" instead of "Do Laundry
  Today"** and opens a read-only list of what went in, rather than reopening the dirty-items screen
  (there's nothing left to gather; Wash Now already happened). `renderTripsyDressGuideInto` computes
  `washedDayKeys` — every dayKey with a `driveData.tripsyLaundry` record carrying `washedAt` for the
  currently-shown person — synchronously from already-loaded `driveData` (`Store.listTripsyLaundry`
  is not async), and each day's button carries that state as `data-tripsy-laundry-washed` so the
  click handler can branch without a second lookup. The read-only view (`showTripsyWashedDay`)
  reuses the same overlay node as `showTripsyLaundryDay` (they're never open at once) and merges a
  garment's base-key and `::nn`-suffixed bag entries back into one line — the "needed again" vs.
  "not needed" split only mattered while deciding what to wash, not once it's done. A wash recorded
  from an already-open guide flips the button immediately via the same `refreshLaundryInfo` callback
  the run-out-bar fix above already threads through `showTripsyLaundryDay`'s `opts.onChanged`, since
  that re-render recomputes `washedDayKeys` fresh too.
  **Only TODAY, or a day already washed, shows a laundry button** (`isToday`, off
  `tripsyTravelViewTodayKey`; superseded the earlier hide-past-days-only rule on 2026-10-01). A washed
  day keeps its button regardless of how far past it is, since that's a record worth looking back at,
  not an instruction to follow.
  **…and so does any day holding an UNWASHED bag** ("Keep the laundry button on any day with an
  unwashed bag," 2026-10-18 — a bag gathered on Oct 18 and never marked washed became unreachable
  once the trip's today moved to Oct 19: no button on its day, Travel View's Laundry opens today's
  own empty bag, so its garments stayed dirty everywhere with no screen left to press Wash Now
  from). `tripsyUnwashedLaundryBagsByDay(records, person)` (dayKey → copies, washed and empty
  records excluded) feeds the button rule `washedToday || isToday || bagCount > 0`; such a day's
  button reads "🧺 Laundry · N in bag" and opens the LIVE laundry screen, where the bag can be
  added to or washed. `unwashedbag_test.js`.
- **A wash is not BACK until each garment is confirmed received — and only then is it available
  again** ("After I select wash now, add a button to later days for when I get the washed items
  back. When I select that button, open up the list of items I sent to wash so I can check them off
  individually to confirm I got them back. After an item is confirmed received back, then update the
  dress guides to make those items available," 2026-10-18). **Data**: `Store.washTripsyLaundryBag`
  now also stamps `awaitingReturn: true, returned: {}` on the record; `Store.markTripsyLaundryReturned
  (tripKey, person, washDayKey, key, qty, returnDayKey)` accumulates `returned[baseKey] = {qty,
  dayKey}` (the `::nn` half merges into its base key via `tripsyLaundryBagBaseCounts`; capped at what
  went in; optimistic). A record WITHOUT `awaitingReturn` is a wash from before the rule and counts
  as returned on its wash day — no migration, nothing already clean turns dirty. **Availability**:
  every reader of wash credits goes through `tripsyLaundryReturnCredits(records, person)` (one
  `{washDayKey, dayKey, key, qty}` per garment per wash, `dayKey` = the RETURN day) —
  `tripsyLaundryRunOutByDay` and `tripsyLaundryFindAdjustments` credit `tripsyLaundryCreditOn` on
  that day (so an unreturned garment stays dirty-and-away in the walk, exactly what keeps it off
  the day's available list), `tripsyLaundryItemsForDay` resets a garment's clock with
  `tripsyLaundryLastReturnDay` and subtracts copies still away (`tripsyLaundryOutOn`) from its pile
  so they are never re-bagged, and both ship-home readers key on the return day. **UI**:
  `tripsyLaundryOutstandingByWash` (washDayKey → `{total, byKey}`, awaiting-return washes only)
  puts an amber **"🧺 Laundry back · N out"** button (`data-tripsy-laundry-collect`, one per
  outstanding wash dated BEFORE the day) on TODAY only ("only display it on the current date, as I
  can't select something into the future or back in the past," same day — `isToday`, the same guard
  the 🧺 Laundry button uses) until everything is back; it opens
  `showTripsyWashedDay(tripKey, washDayKey, person, {collectDayKey, onChanged})` — the wash's item
  list, each card showing back/still-out and a **✓ Received** button (several copies ask "How many
  came back?") — recording the return as of the day the button was pressed from; the wash day's own
  "Washed Today" passes itself as `collectDayKey`, so a same-day return is confirmable too. Each
  confirmation fires `onChanged` → `refreshLaundryInfo`, so the run-out bar and buttons repaint.
  Travel View's laundry-suggestion retirement still keys on `washedAt` (the wash happened).
  `laundryreturn_test.js`. **A garment confirmed fully back leaves that list at once** ("When I
  mark an item received back from laundry, that item should be immediately removed from the
  list of items that are out for laundry," 2026-10-20): while a wash is still partly out, the
  grid is the list of what is OUT — `tripsyWashedDayListSplit(items, awaiting, outstanding)`
  (pure) keeps only `left > 0` as cards and names the fully-returned garments in one compact
  "✓ Back: …" line beneath; once nothing is out, or on a pre-returns wash, every item is a
  card again (the full list is the record of the wash). The screen already rebuilt from the
  optimistically mutated record right after each Received press, so the removal is immediate.
  **And the Received press now actually RECORDS** ("I just marked that I had 7 sets of socks
  returned, but this is what the screen shows," same day): `markTripsyLaundryReturned` looked
  the wash up through `getTripsyLaundryBag`, which by design returns only an UNWASHED bag
  (`!r.washedAt`), so it found nothing, returned false and changed nothing on every press —
  the earlier suite drove the credit maths on records directly and never ran that lookup. It
  and the washed-day screen now share **`Store.getTripsyWashedRecord`** (the washed
  counterpart of the bag getter), and `laundryreceived_test.js` runs the REAL Store methods
  against a fake `driveData` holding both a washed record and the same day's unwashed bag.
  Lesson: a Store method that finds its record through another getter needs a test that runs
  the lookup, not just the arithmetic.
  **`showTripsyWashedDay` shows the actual garment PHOTOS**, not a plain text list — the same
  `tw-grid`/`tw-card`/`tw-photo` shape every other garment display in the app uses (the outfit view,
  Packing Status, …), loaded through the same `tripsyWardrobeLoadPhotos`; a garment with no photo
  falls back to the SAME type glyph the laundry screen shows (`tripsyGarmentGlyph` — 🧦 socks, 🩲
  underwear; "use the same images to depict those items in the returned screen," 2026-10-18 — it
  used to show a generic 👕 for everything photo-less).
- **📦 Ship Home — a dated box of clothes sent home mid-trip, with the app recommending what
  you can spare** ("During long trips there may be times when I would like to ship some
  clothes home. I want to be able to put a ship-home indicator at a specific date and have
  the app help select which clothes should be shipped home at that point so I will have
  enough clothes for the rest of the trip," 2026-10-06). The INDICATOR is a "📦 Ship Home"
  button beside 🧺 Laundry on the Daily Dress Guide's day row (owner-only; every day not yet
  over, and every day before the trip starts — a parcel is planned ahead, unlike a wash; a
  day with a box keeps its button, reading "📦 Shipping Home · N" / "📦 Shipped Home · N",
  slate-tinted). It opens `showTripsyShipHomeDay` (the laundry screen's shape, same overlay
  node, z `2147483090` — deliberately BELOW `tripsyConfirmDialog`'s `2147483100`, since this
  screen opens confirms of its own; the laundry screen's `2147483120` would hide them, the
  documented trap): a **Ship-Home Box** card at the top, a **Recommended to ship** grid, and
  a slate **Still needed for the trip** box. The recommendation is `tripsyShipHomeCandidates`
  → `tripsyShipHomeSplit({qty, futureWears, limit})`: of the copies still with you on ship
  day (packed minus any EARLIER box), the rest of the trip needs `ceil(futureWears / limit)`
  (the same `tripsyWearsBeforeWash` cadence the laundry maths uses, assuming no wash after
  the ship day; a never-laundered garment still worn is kept whole), and the surplus is what
  to ship — a tee never worn again, the third of three shirts with two shirt-days left, one of
  two pairs of chinos. Wear days come from `tripsyWardrobeWearDays`/`…FromLines`, so this
  can never disagree with the laundry screen about what is worn when. "Add all recommended"
  fills the box in one tap; a still-needed garment can go anyway after a confirm naming its
  next wear day; "Mark Shipped" stamps `shippedAt` (read-only after; "Not Shipped Yet"
  reopens it); an emptied box IS "Remove Marker". Records: `driveData.tripsyShipHome`
  (`Store.listTripsyShipHome`/`getTripsyShipHome`/`saveTripsyShipHome`/
  `markTripsyShipHomeShipped`; `{tripKey, person, dayKey, box:{key:qty}, shippedAt}` with
  the laundry bag's `g:<id>`/`x:<name>` keys; pruned with its trip). **A box dated D takes its
  contents out of the trip for every day AFTER D, planned or shipped alike** (D itself stays
  wearable — wear it in the morning, post it in the afternoon), via one helper,
  `tripsyShipHomeQtyBefore(records, person, key, dayKey)`, honored everywhere a garment's
  availability is judged: the laundry list and both wear-debt walks (`tripsyLaundryRunOutByDay`,
  `tripsyLaundryFindAdjustments` — a shipped garment worn later is a physical shortage, flagged
  on the run-out bar even for a never-laundered type); and, through `tripsyShipHomeGoneIds`
  (every packed copy boxed), the outfit side — Swap/Add candidates exclude it for a later
  block, `tripsyOutfitsNeedRecompose`/`tripsyOutfitStaleReasons` count it as LOST ("shipped
  home on <day>", so the problems dialog opens the outfit), the outfit modal badges it
  "Shipped home" with replacements, the fix page agrees, and `composeTripsyOutfits` labels it
  `SHIPPED HOME AFTER <day>` with a prompt rule keeping it out of later blocks. Any change on
  the screen fires `onChanged` → `refreshLaundryInfo`, so the guide's buttons and run-out bar
  repaint. `shiphome_test.js`.
  **The screen also proposes RE-DRESSING the later outfits so MORE can go home** ("When the
  user selects ship home, see if you can consolidate/reuse garments for the rest of the trip
  to maximize the number of garments you can ship home," same day). The recommendation takes
  the composed outfits as given; `tripsyShipHomeConsolidationPlan(tripKey, dayKey, person,
  excludeKeys)` asks whether they could be re-dressed: greedy over this person's packed
  garments with wearings after the ship day — fewest remaining wearings first, then least-worn
  overall, so of two equals the more-worn one is KEPT — and for each later block wearing one,
  a KEPT substitute through the exact `tripsyOutfitSwapCandidates` rule Swap offers (same slot,
  live tier, free that day) that still has wear CAPACITY: packed copies × `tripsyWearsBeforeWash`,
  against wearings since its last wash, so a one-wear shirt never absorbs anything (without a
  wash, shirts = shirt-days) while a 10-wear pair of chinos takes three pairs' wearings and
  frees two. A substitute that absorbs wear is anchored (never itself freed); wear is
  concentrated onto the already-most-worn fit; blocks mirroring a flight block
  (`wornFromFlightDayKey`) are left alone; keys already in the box can't be substitutes. The
  plan is a PROPOSAL — an amber "♻️ Consolidate outfits to ship more" card above the box
  naming the freed garments and each day's swap, with one **Apply & add to box** button: the
  swaps land on the live blocks (one `Store.saveTripsyTripOutfits`, flight-transfer sync kept),
  the freed garments go into the box, and the screen rebuilds from the recomputed truth.
  Nothing is re-dressed silently.
  **A still-needed garment opens its own "where is it still worn" view, with a rules-EXPLAINED
  swap per wearing** ("allow the user to select any of the garments still needed … show each
  day and each outfit that the garment will be worn for the rest of the trip, and show a swap
  button each time … show all garments that are not designated to be shipped home that could
  be swapped, even if the rules would normally prevent … indicate if it can be swapped under
  the rules or, if it can't, explain what rule prevented … and give the user a button to allow
  a swap in spite of that rule," same day). Tapping a card in the "Still needed" box (a real
  wardrobe garment; a "No Picture" generic has no outfits and keeps the plain ship-anyway
  confirm) opens `showTripsyShipHomeGarmentDays` (own overlay, z `2147483092`): one row per
  later block wearing it — day, live dress code, the events, "Worn with: …" — each with a
  **Swap** button (a block mirroring a flight block says to swap it at the flight instead);
  "Ship it anyway" reopens the ship screen with a one-shot `opts.shipAnywayKey` that runs the
  old confirm + count ask there, where the box lives. Swap opens `tripsyShipHomeSwapPicker` (z
  `2147483096`) over `tripsyShipHomeSwapOptions`: EVERY packed garment of this person not going
  home (not in an earlier box, not designated for this one, not an essential, not itself), each
  with the Swap rules it fails spelled out — "Already part of this outfit", "Worn in another
  outfit the same day", on an itemized tier "A different type (…)" (a polo for a dress-shirt
  slot), "Not tagged for <tier> in your wardrobe (tagged …)", plus the consolidation plan's
  wear-capacity rule as advice ("Already
  worn N times since its last wash with Q packed … would need washing before this day"). **A
  different KIND of garment (another packing group — a top for a pair of trousers) is not listed
  at all, not even as overridable** ("If a garment is a different type of garment (tops/bottoms)
  do not even show those garments as being potentially able to be swapped," same day); the
  picker's subtitle names the kind it shows ("Every packed bottoms not going home"). An
  option with no failed rule is "✓ Can be swapped under the rules" and tappable; every other
  shows its ✕ reasons and a **Swap anyway** button (resolves `forced: true`, toasted as
  "outside the usual rules"). The allowed set is asserted equal to `tripsyOutfitSwapCandidates`'
  own answer in `shiphome_test.js`, so the explanations can't drift from Swap's filter. A pick
  swaps in place on the live block (flight-transfer sync, one save, rollback + toast on failure),
  fires `onChanged`, and re-renders the view; once every wearing is swapped away, Back returns to
  the ship screen, which recomputes and lists the garment under Recommended.
- **🔁 Replace — one pick swaps a garment for another EVERYWHERE it is used on the trip**
  ("Let's make a one-step process for swapping one garment for another so the new one
  automatically replaces the old one everywhere the old one was used," 2026-10-07 — before
  this, bringing in an UNPACKED garment meant deselect + select on the Packing List, then
  Swap on every outfit, since Swap only offers packed garments). A **Replace** button sits
  beside Swap on every outfit-modal garment card (`data-tw-outfit-replace`, owner-only) and
  on a SELECTED real garment's card on the Packing List line page (`tripsyWardrobeCardHtml`'s
  `replaceable` option, `data-tw-replace`; placeholders excluded). Both run
  `tripsyRunReplaceGarment` → `tripsyReplaceGarmentPicker` (own overlay `tw-replace-overlay`,
  z `2147483099` — above the outfit modal and its Swap/Add pickers, below `tripsyConfirmDialog`):
  every garment of this person in the SAME packing group (a top for a top — the Ship Home
  picker's "different kind is never a replacement" rule), packed or not, same-type bucket
  first; the heading names exactly what will change (`tripsyGarmentTripUsage`: N Packing List
  lines, M outfits, K planned ship-home boxes) and a candidate not tagged for a tier the old
  garment is used at says "Not tagged for …" rather than being hidden. The outfit Swap rules
  are deliberately NOT applied — the point is to bring in something not yet packed. The pick
  runs `tripsyReplaceGarmentEverywhere(tripKey, person, oldId, newId)` over three stores in
  order: **Packing List** allocations re-key to the new id with tier/line/qty/packed/cubes
  intact (the copies are already in the bag; two allocations collapsing onto one key merge),
  **outfits** — every block of this person wearing the old id wears the new one in its place
  (already present → the old id is dropped, never duplicated; `tripsyOutfitSyncFlightTransfers`
  re-runs per changed block), and **planned ship-home boxes** re-key `g:old` → `g:new` (a box
  already `shippedAt` is history and is left alone, as are laundry bags, washes and Not Dirty
  credits — they record what happened to the OLD garment). A failure anywhere restores all
  three records to their in-memory snapshot and the toast says nothing changed; success
  toasts the counts, repaints the open outfit modal (firing `onSwapped`), re-renders My Trips
  so the attire ⚠️ re-judges, and the Packing List page — whose selection state is a copy
  taken at open — closes and REOPENS on the same line rather than patching itself.
  `replacegarment_test.js`.
- **Tapping a garment's photo in the outfit view shows where it's actually packed**
  (`showTripsyGarmentCubeInfo`) — read-only, so every viewer gets it, not just the owner (unlike
  Swap, sitting right next to it in the same card). Reuses `tripsyCubesForEntry` exactly as Packing
  Status does, summed across every selection entry for that ONE garment id in the trip — allocation
  is per LINE, so a single owned copy can be split across several lines, each with its own cube
  assignment, and all of them need combining to answer "where is this." An uncubed type (a tie,
  anything that hangs) explains WHY instead of showing a misleading "cube not set", and a garment
  not yet marked packed for this trip says so plainly rather than opening an empty dialog.
- **Each garment card in the outfit view also has a Wear Days button**, opening the same
  `showTripsyWearDaysOverlay` the Plan Packing List/Packing Status pages use, scoped to that one
  garment. Read-only, so every viewer gets it (same as the photo-lookup above), unlike Swap right
  next to it. It CLOSES the outfit modal first rather than stacking Wear Days on top of it: both are
  singleton overlay nodes, and Wear Days' own day rows can reopen this SAME outfit-modal node (to
  view a different event's outfit) — a real cycle, where no fixed z-index ordering works for both
  directions at once. Closing first sidesteps it entirely; Wear Days' own Close button returns to
  nothing stacked underneath, same as closing it from anywhere else.
- **Once a wash exists, the guide's orange "best day for laundry" bar is replaced by a red RUN-OUT
  bar.** The advice was a plan; from then on what matters is the consequence.
  `tripsyLaundryRunOutByDay` walks each garment's clean stock forward day by day — a wash that day
  returns dirty copies to the clean pile first (wash in the morning, wear in the evening), then
  each wear consumes one — and flags the FIRST day a garment is needed with nothing clean left.
  **`walk()` is wear-limit aware, keyed on `wearDebt` (wear-units owed since the last return):**
  `floor(wearDebt / limit)` is how many copies are currently dirty, so a tie or a suit
  (`Infinity` — restyled or dry-cleaned, never laundered) can NEVER run out, and a ten-wear pair
  of trousers isn't projected as used up after two wearings — it was, until 2026-08-11, when a
  bug flagged EVERY garment as if its limit were 1, so ties came up "out of clean ties" after a
  couple of wearings. A wash of *n* copies pays down `n × limit` units, capped at zero rather than
  going negative (an over-large wash can't manufacture credit), and — this is the part that broke
  the naive fix — a **partial** wash must only pay down what it actually cleaned, never reset the
  whole counter, or washing one of five dirty shirts would wrongly launder all five.
  **A wash dated the SAME DAY a garment was worn now covers that day's own wearing too, not just
  debt from before.** Reported 2026-08-14: a shirt worn once, then washed the SAME day (an exact
  1-owned/1-washed match — nothing dirty before that day), still showed up dirty on its next
  occasion days later with no further wash in between. Root cause: the walk's wash-before-wear
  order pays wash credit down against debt entering the day only; with zero prior debt (nothing
  worn yet), `Math.max(0, 0 − credit)` threw the whole credit away, and that SAME day's own wear
  then added fresh, uncredited debt with no later wash to clear it — "worn, then washed later that
  day" is exactly as plausible a same-day sequence as "washed, then worn," and the walk only ever
  gave credit for the second. Fixed by factoring the per-day step into
  **`tripsyLaundryWearDebtStep(wearDebt, {washedQty, credited, wornToday, qty, limit})`**, shared by
  both `tripsyLaundryRunOutByDay` and `tripsyLaundryFindAdjustments` (below) so the two can never
  diverge on the model again: any credit left over after zeroing prior debt is now also let cover
  that day's own fresh wear (`leftoverCredit >= limit` skips the `wearDebt += 1`) — but this leftover
  is a per-day local, never banked across days, so an absurdly over-sized same-day wash still only
  forgives that ONE day's wearing, not an unlimited reset (verified: a 99-copy same-day wash on a
  1-owned garment pushes the run-out day later by exactly one wearing, never further).
  **A "Not Dirty" credit pays down `wearDebt` too, directly (it's already in wearing units, unlike
  a wash which is in copies and must be scaled by the limit first)** — this was a SEPARATE bug from
  the wear-limit one above, found the same day: `tripsyLaundryItemsForDay`'s day-by-day wash list
  already applied Not Dirty credits (`creditFor`), but this forward projection never consulted
  `driveData.tripsyLaundryNotDirty` at all, so a garment marked Not Dirty today still projected as
  unavailable in the future — confirmed on a real trip's Undershirts (5 packed, 3 marked Not Dirty,
  still flagged as running out days later). The initial `hasWash` gate now also opens on a Not
  Dirty credit alone, with no real wash ever recorded — the credit is real inventory information
  just like a wash is, so a Not-Dirty-only session shouldn't stay stuck on the orange advisory
  forever waiting for a Wash Now that never comes. A wash only
  returns what was actually dirty, so washing one of two shirts cannot conjure a third,
  and each garment is flagged on its FIRST short day only, never again. Garments that come up
  short on the same day get **one bar each**, not one merged line — each is its own problem to
  solve, and a day carrying three bars means three different things ran out at once. It returns
  `{runOut, hasWash:false}` before any wash, which is what keeps the orange bar until then.
  Computed ONCE per opening (it walks every garment's wear days) and threaded through re-renders on
  `renderOpts`, exactly like the weather bar; a failure there is caught so the guide still renders.
  **The bar's wording names the condition and the last wearing** ("change the message to say that
  an item on the wear schedule is not available because it is dirty. Also show the last day I wore
  the item," 2026-10-18 — the old "You run out of X today — nothing clean left" read as ambiguous
  about whether the day itself or only later days were affected): `tripsyRunOutNoteText(name,
  lastWornDayKey)` renders "X is on today's wear schedule but isn't available — it's dirty. Last
  worn Sat, Oct 17." The walk records that date beside each flagged name in a parallel `lastWorn`
  map (dayKey → Map(name → the latest wear day strictly BEFORE the short day, `null` when there is
  none — a shipped-home garment, which reads "No clean copy is with you today")); `runOut` itself
  stays a plain list of names, which every other reader and test expects. `runoutwording_test.js`.
  **A Swap made from the guide's own "👔 See outfit" cue recomputes and re-renders this**, or the
  bar kept naming a garment already swapped away — swapping only ever saved the outfit and
  repainted the outfit modal itself, never touched `renderOpts.laundryInfo` or told the guide behind
  it to redraw. `showTripsyOutfitModal` now takes an `opts.onSwapped` callback, fired right after a
  successful swap save (before the modal repaints itself); the guide's outfit-block click handler
  passes one that awaits a fresh `tripsyLaundryRunOutByDay` and calls `renderOpts.rerender()`. Every
  other caller of `showTripsyOutfitModal` (Wear Days, My Trips' event detail panel, Travel View)
  passes no `onSwapped`, so they're unaffected — this is additive, not a behavior change to Swap
  itself.
  **Wash Now and Not Dirty had the identical caching bug** (found from the owner reporting a
  garment still flagged unavailable on a later day after they'd washed it): `showTripsyLaundryDay`
  only ever rebuilt ITSELF after either action, never told the guide behind it to refresh, so a wash
  recorded mid-visit left the run-out bar showing an already-resolved warning until the guide was
  closed and reopened. Both fixes share one callback — `renderTripsyDressGuideInto` defines
  `refreshLaundryInfo` once and passes it as `showTripsyOutfitModal`'s `onSwapped` for the outfit-
  block trigger AND as `showTripsyLaundryDay`'s new `opts.onChanged` for the laundry-day trigger, so
  a swap, a wash, or a Not Dirty press all refresh the same way. `showTripsyLaundryDay` takes an
  `opts` param (default `{}`, so its two other pre-existing callers are unaffected) and fires
  `opts.onChanged` right after each action, before rebuilding itself — and forwards `opts` (not a
  fresh literal) when it rebuilds itself, so a second wash on the same visit still carries the
  callback without re-stating it.
- **A wash triggers a check for whether outfit changes could avoid needing another one.**
  `tripsyLaundryFindAdjustments(tripKey, person, guide)`, called from Wash Now (owner-only, since it
  can write outfits) right after `refreshLaundryInfo`, mirrors `tripsyLaundryRunOutByDay`'s own
  wear-limit walk — garment by garment, day by day — but instead of just flagging a short day,
  tries to actually FIX it: is the garment even part of a COMPOSED outfit block that day (a
  tier-fallback wear day has nothing to swap within, so it's left as a genuine run-out), and if so,
  is there a substitute through the exact same `tripsyOutfitSwapCandidates` rule Swap itself uses —
  so a proposal here is always something the owner could equally have picked by hand, never a new
  kind of match the manual picker wouldn't also offer. **Nothing is applied silently** — the owner
  chose "ask me first" when this was built — `tripsyLaundryAdjustmentsDialog` lists each proposed
  swap (day, old garment → new garment) with Apply/Skip; Apply calls
  `tripsyLaundryApplyAdjustments`, which mutates each proposal's `block.garmentIds` in place (the
  same live-reference mutation a manual Swap pick makes) and saves once for every proposal
  together, then `refreshLaundryInfo` runs again so the guide reflects the new state. One fix
  attempt per garment per pass (the first short day only — later short days for the same garment
  depend on whether this fix actually lands, so speculating further isn't worth the complexity), and
  a candidate already used by an earlier proposal in the same pass isn't offered to a second one.
  **Since 2026-10-18 the box is offered when a RETURNED wash's list closes, not at Wash Now, and
  each row is re-pickable** ("Only show the swap clean items for dirty items box when a wash has
  been returned and the items checked as returned. When you show the box, allow each individual
  garment suggestion to be either accepted as-is, or allow the user to select any other clean
  garment in the same category to replace it, and then adjust all later suggestions"): a wash sends
  the garments AWAY, so nothing clean has arrived at Wash Now — `showTripsyWashedDay` sets
  `opts.confirmedReturn` on each Received confirmation and, when the list closes with it set, runs
  `tripsyLaundryOfferAdjustments(tripKey, person, onChanged)` (the whole find → dialog → apply →
  refresh flow, factored out of the old Wash Now block; `tripsyOutfitAutoAdjustAfterSwap` still
  uses the finder directly). `tripsyLaundryFindAdjustments(…, {decided})` takes a Map
  oldId → newId (or null = leave it) and, for a decided garment, uses exactly that candidate —
  claimed, so later rows cannot reuse it — and every proposal carries `alternatives` (the other
  Swap candidates, least-worn first). `tripsyLaundryAdjustmentsDialog(proposals, {recompute})`
  gives each row an Accept tick (on by default) and a "Choose another" list of those alternatives;
  a pick pins it in `decided`, calls `recompute(decided)` (the finder re-run), and re-renders, so
  later suggestions adjust around it. It resolves with the ACCEPTED proposals (null = Skip).
  `laundryadjustments_test.js`, `laundryreturn_test.js`.
  **`tripsyOutfitSwapCandidates` is factored out of `tripsyOutfitSwapPicker` for this reuse** — the
  picker now just calls it and renders the result; behavior is unchanged, but the two callers (the
  manual picker and this automatic finder) can now never drift apart on what counts as a valid
  substitute.
- **A manual Swap triggers the same finder too, but applies its fix AUTOMATICALLY with no
  confirmation** — the owner's explicit ask: "when I make a change to an outfit that would make a
  later outfit unavailable ... automatically reconfigure the remaining outfits," deliberately the
  opposite UX choice from the Wash Now flow above. `tripsyOutfitAutoAdjustAfterSwap(tripKey, person,
  guide)` runs right after a successful Swap save (in `showTripsyOutfitModal`'s swap handler): the
  garment that just went IN can push extra wear onto a LATER block that also uses it, leaving that
  block short by the day it's needed. It calls the exact same `tripsyLaundryFindAdjustments` Wash Now
  uses — so a fix here is always something the owner could equally have picked by hand via Swap
  itself — but skips `tripsyLaundryAdjustmentsDialog` entirely and calls
  `tripsyLaundryApplyAdjustments` directly. The asymmetry is deliberate: a wash is an irreversible
  real-world action worth confirming before assuming, while this is only ever swapping in an
  already-eligible, already-packed substitute for a block that hasn't happened yet. Fails soft (a
  problem here never blocks or undoes the swap that triggered it) and toasts how many later outfits
  were reconfigured, if any.
  **Wash/wear scheduling is explicitly optimized to maximize how much stays genuinely dirty by the
  END of the trip, not to keep everything as clean as possible throughout** — the two are
  different goals: a mid-trip wash costs real vacation time, while dirty laundry at the end just
  gets washed at home regardless, so it's the outcome to prefer, not avoid. This principle now
  drives two separate places, per the owner's explicit choice of scope (both, not one):
  (1) **`tripsyLaundryFindAdjustments`'s candidate ranking** — when several substitutes are
  usable, it picks the LEAST-worn-so-far one (`tripsyWardrobeWearDays` per candidate, sorted
  ascending), spreading wear evenly across every owned garment of that type instead of reusing one
  favorite. This is the same mechanism that also happens to avoid early run-outs: evening out wear
  is what keeps any ONE garment from hitting its limit ahead of schedule and forcing a wash, while a
  garment worn just once or twice by trip's end was arguably over-packed. (2) **The `laundry_days`
  guidance prompt** (`generateTripsyAttireCategories`'s guidance call) now says so explicitly:
  prefer FEWER, LATER washes over an evenly-spaced schedule, only suggest one when the trip would
  otherwise genuinely run short of something clean — never just because a cycle has elapsed — and
  the old "~every 9 days" cadence is now framed as a MAXIMUM to plan around, not a target to hit.
- **Travel View's own "Best day for laundry" banner (attire mode, `tv-laundry-banner`) retires a
  suggested day once it's actually been acted on**, instead of showing every entry in
  `guide.laundryDays` for the whole trip regardless of real washing. Unlike the Daily Dress Guide's
  run-out bar, Travel View has no per-garment laundry screen — it just mirrors Claude's suggested
  wash day(s) directly (`tvAttireLaundry`, built once when attire mode loads). The rule: find the
  LATEST actually-washed day across `Store.listTripsyLaundry(trip.key)` (either person — the
  suggestions themselves are trip-level, not split by him/her), then skip any suggested day ON OR
  BEFORE it when populating `tvAttireLaundry`. So washing once retires that suggestion (and any
  earlier one) even if the wash didn't land on the exact suggested date, while a LATER suggestion —
  still genuinely pending, further into the trip — keeps showing its banner.
- **Travel View's 👔 header button opens an ATTIRE MENU — Today's Outfit and Laundry** ("On the
  travel view, show the attire option on the header. If the user selects it show two options:
  today's outfit and laundry. If the user selects today's outfit, show the outfits selected for
  that day. If he selects laundry, open the page for doing laundry that day," 2026-10-18). The
  button (`#tv-attire-btn`) shows with a saved guide OR composed outfits (`tvHasOutfits`); a tap
  drops `#tv-attire-menu` under the title row (a second tap or an outside click closes it).
  **Today's Outfit**: `tripsyTodayOutfitBlocks(outfits, todayKey)` — the person's composed blocks
  on the TRIP's today (`todayKey`, the trip-local day Travel View already jumps to), garments and
  events both present — one block opens `showTripsyOutfitModal` straight away, several (an outfit
  change) are offered as a pick in the same menu, none toasts. **Laundry**: `showTripsyLaundryDay
  (trip.key, todayKey, person)`, the Daily Dress Guide's own screen. Both ask His/Hers once via
  `tripsyChooseOutfitPersonDialog` and remember it (`tripsySetTvOutfitPerson`, the colour mode's
  existing store); outside the trip's days (`tvTripInProgress`) both explain instead of opening an
  empty screen. The older colour-by-dress-code overlay (`tvAttireMode`, `.tv-attire-on`) is NOT
  gone: it is the menu's third row, "Dress codes: on/off", below a divider — no longer what a tap
  does. The 2s press-and-hold person picker is unchanged. `travelattiremenu_test.js`.
- **The Daily Dress Guide has an A− / A+ text-size control and a phone layout** ("I am having
  difficulty shrinking the screen zoom level when I am in the daily dress guide on my iPhone.
  When I pinch to shrink the screen stays the same size," 2026-10-19). Nothing in the app blocks
  pinching (the viewport tag allows zoom, no `touch-action`, only passive touch listeners) —
  iOS itself never lets a page pinch-zoom OUT below fit-to-width, and the guide is a full-screen
  fixed panel sized to the phone, so its default size is the smallest the system allows. Two
  fixes: **(1)** the toolbar control (`tripsyDgScaleLoad`/`Save`/`Step`/`Apply`, steps
  `TRIPSY_DG_SCALE_STEPS` 70–120%, stored per DEVICE in `localStorage` under
  `TRIPSY_DG_SCALE_KEY` like the other display preferences — 100% is stored as nothing) scales
  the paper (`#tripsy-attire-dressguide-content`) with CSS **`zoom`**, not a font-size, because
  the rows carry inline px sizes (day bar, badges, chips) and zoom scales type, padding and
  layout as one piece; applied on every open, end buttons disabled at the limits. The fixed
  menus/dialogs are appended to `body` outside the zoomed node, and the scroll helpers use
  `getBoundingClientRect`, which WebKit reports in zoomed coordinates, so neither needs to know.
  **(2)** a `@media (max-width: 600px)` block drops the overlay's 32px padding and the paper's
  28px (which left ~300px of content on a 390px iPhone, wrapping every row), tightens the day
  bar (now carrying class `tripsy-attire-daybar`; its sizes are inline, so `!important`), event
  rows and instruction bars, and lets the toolbar wrap so the extra control never pushes the ✕
  off-screen. `dgtextsize_test.js`.
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
- **The detail panel also opens straight into that event's outfit**, the opposite direction of the
  jump above: an **Outfit** button sits bottom-right of the Edit/Close row (`margin-left:auto` in
  the same flex row, not a separate row), calling the SAME `showTripsyOutfitModal` the Daily Dress
  Guide's "👔 See outfit" cue opens, for whichever person is currently selected there
  (`tripsyDressGuidePerson`) — available to every viewer, same as the rest of this read-only panel.
  Built straight from `raw.resource`/`raw.id` into the guide's own `<resource>-<id>` hyphen id space
  (the reverse of the jump above's colon conversion), not by string-transforming a key. `renderTripsyViewPanel`
  takes `tripKey` as an optional 5th param, defaulting to `null`, specifically so the OTHER caller —
  Travel View's own event-detail overlay (`showTripsyTravelEventDetail`), which shares this same
  render function — stays unaffected: no tripKey passed there, so no Outfit button renders, and
  `showTripsyOutfitModal`'s own graceful "No outfit yet" state covers an event with none composed.
- **A 👔 glyph sits directly on the My Trips timeline row itself**, one tap away with no need to
  open the detail panel first — unlike that panel's own Outfit button above, which always renders
  and relies on `showTripsyOutfitModal`'s "No outfit yet" state for an uncomposed event, this glyph
  is conditional: it renders ONLY when a real composed outfit (`garmentIds.length`, not an
  empty/gaps-only block) already covers that event, via `tripsyOutfitEventPersonsMap(tripKey)` — a
  synchronous read of `driveData.tripsyTripOutfits` (the card builder itself isn't async) into
  `eventId -> Set(persons with an outfit covering it)`, computed once per trip card. Available to
  every viewer, same as the detail-panel button — deliberately NOT folded into the adjacent
  Edit/Attach/Delete icon row, which is owner-gated (`canEditDelete`) and would have hidden it from
  viewers too. Tapping it opens the same `showTripsyOutfitModal`, choosing whichever person's outfit
  to show from `data-persons` (both persons' coverage is stashed there, read at CLICK time rather
  than baked in, since `tripsyDressGuidePerson` can change after the row was rendered): the
  currently-selected Daily Dress Guide person if they have one for this event, else whoever does.
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
- **The ride from the airport wears the FLIGHT's outfit** ("An outfit for transportation from
  a flight to a hotel should always be the same as the outfit on the flight," 2026-10-05).
  `tripsyAttireFlightTransferLinks(days)` pairs a ground transfer whose FROM side names an
  airport (`tripsyAttireIsAirportTransfer` — not a flight/train/ferry; "airport", "terminal",
  "arrival(s)/arriving" or a `(XXX)` code before the →) with the previous real event on the
  trip when that is a flight (`tripsyAttireIsFlightEvent`) at most 2 days earlier — walked
  ACROSS days and skipping free-day placeholders, because an overnight flight sits on its
  departure day while the car sits on the arrival day. Two halves: **dress code** —
  `tripsyAttireMatchTransfersToFlights` (run at the top of `computeTripsyAttireBlocks` and
  `tripsyAttireTieredTimeBlocks`, idempotent) gives the transfer the flight's base tier unless
  the owner overrode it, so a same-day pair falls in one run (identical tiers never need a
  change) and shares one outfit; a cross-day arrival run is NOT counted as a new occasion.
  **Outfit** — `tripsyOutfitSyncFlightTransfers(guide, outfits, source)` copies the flight
  block's `garmentIds` onto the cross-day transfer block (from the transfer side first when
  `source` is it, so a Swap on either holds for both) and stamps `wornFromFlightDayKey`.
  Applied on EVERY `Store.getTripsyTripOutfits` read (in memory, idempotent — so outfits
  composed before the rule are corrected everywhere at once), in the Swap handler, and on
  compose, which never sends the copied block to Claude (nor lists it as kept context — it
  would read as the flight's top worn twice). `tripsyWardrobeWearDays` files the copied
  block's events under the flight's day, so laundry counts ONE wearing.
  **A day spent entirely in the air is an IN-FLIGHT placeholder that wears the flight outfit too**
  ("Why is the attire on October 7 different than October 6?", 2026-10-06 — SQ37 leaves LAX late
  Oct 6 and lands Oct 8, so Oct 7 got a "No events planned" free day and its own composed casual
  outfit). `tripsyAttireMarkInFlightDays(days, trip)` judges each free-day placeholder with the
  itinerary's own `tripsyInFlightInfoForDay`, keeps its `freeday-<day>` id and `freeDay: true`
  (saved guide/outfit records keep matching; still out of the prompt, not jumpable, never a "new
  event") and adds `inFlight: true` + the name "✈️ In-flight — LAX → SIN • Singapore Airlines
  SQ37". `tripsyAttireFlightTransferLinks` links an `inFlight` placeholder to the previous flight
  like an airport ride but never makes it the "previous event", so the arrival-day car still
  links too; everything downstream (flight tier, not a new occasion, outfit copy +
  `wornFromFlightDayKey`, never sent to compose) follows for free. Called on every build and on
  every `Store.getTripsyAttireGuide` read (trip from `tripsyDecryptedTrips`, no-op when not
  loaded), so a saved guide retrofits in memory and persists on its next save — verified against
  the live Singapore GP data: Oct 7 took the Oct 6 flight outfit with the Oct 8 car link intact.
  **The marking must happen before the outfit sync reads the guide** ("October 7 still shows a
  different outfit," same day — the first cut shipped the getter retrofit, but
  `Store.getTripsyTripOutfits` looked the guide up RAW from `driveData` and synced against an
  unmarked copy, so the in-flight block never linked): it now goes through
  `Store.getTripsyAttireGuide`, and the My Trips card builder (the first guide touch on every
  render) marks too, so the synchronous readers after it agree. `flighttransferoutfit_test.js`.
  **A CONNECTING LEG wears the first leg's outfit too** ("The flights on October 22-23 are
  different legs of a flight from Singapore to Japan - there is no lodging in between legs, so
  the attire should be the same for both legs," 2026-10-06 — DAD→SIN on the 22nd and SIN→FUK at
  1:20 AM on the 23rd were two blocks with two outfits). `tripsyAttireFlightTransferLinks` now
  also links a FLIGHT whose previous real event is a flight, or a ride/placeholder already linked
  to one (`prev.root`), within the same ≤2-day gap; anything else between two flights — a hotel
  night, a dinner — breaks the chain, since `prev` is then that event. Every link in a chain
  points at the ROOT flight (`connectingLeg: true` marks the flight links), so the second leg, an
  in-flight day and the arrival car after it all share ONE outfit and count as one occasion;
  everything downstream (tier match, `continuesFlight`, `wornFromFlightDayKey` copy, never sent
  to compose) is unchanged. Verified live: Oct 23 took the Oct 22 outfit; the same-day Oct 12
  (SIN→BKK→CEI) and Oct 17 (CEI→DMK→DAD) connections link as well, with no count change (same-day
  legs were already one run). `flighttransferoutfit_test.js`.
- **Transportation wears NO outfit — except the trip's first and last flight** ("For
  transportation events, there should not be an outfit associated with them, except for the
  initial and final flight of each trip," 2026-10-22). `tripsyAttireOutfitlessTransitIds(trip)`
  (pure, over the live trip, time-sorted) keeps the FIRST flight and the LAST flight, each with
  its connecting legs (the next/previous flight with only transportation between and ≤2 days
  apart), and returns every other transportation event's id — cars, trains, taxis, mid-trip
  flights, and the airport rides that used to wear the flight's outfit. Those are left out of
  attire entirely: `tripsyAttireBuildDays` filters them before the free-day gap fill (no dress
  code, no time block, no occasion count, not in the Daily Dress Guide), and two in-memory read
  retrofits make saved records agree with no regeneration —
  `tripsyAttireDropOutfitlessTransit` in `Store.getTripsyAttireGuide` (drops them, gives an
  emptied day its free-day placeholder, re-derives blocks/counts AND `eventFingerprint` from the
  corrected days, so an otherwise-current guide stays current) and
  `tripsyOutfitDropOutfitlessTransit` in `Store.getTripsyTripOutfits` (strips their ids from
  every block, dropping a block left with none; it runs before the flight-transfer sync).
  `tripsyOutfitEventPersonsMap` skips them (no 👔 row glyph) and `renderTripsyViewPanel` gives
  them no Outfit button. Ids compare by base (`tripsyAttireEventBaseId` strips the
  -begin/-end halves). A block that had worn the flight's outfit onto an airport ride keeps its
  `wornFromFlightDayKey` stamp (it now dresses just the hotel arrival you reach in those
  clothes, still counted as one wearing). Checked on the live Singapore GP data: SQ37 and the
  ICN→LAX flight home keep their outfits, 13 legs lose theirs, no day empties, all 31 outfit
  blocks survive, and no block is left uncovered (no new ⚠️). The flight-transfer rules above
  still govern the kept flights (their in-flight days and connecting legs). `transitnooutfit_test.js`.
- **Days with no scheduled events still get clothed — Casual by default, shown everywhere as "No
  events planned"** ("on days with no scheduled events you still need to account for clothing,"
  2026-09-15). `tripsyAttireBuildDays` fills every gap between the trip's first and last EVENT day
  (the itinerary's own day-range rule, via `tripsyDayKeyRange`) with ONE synthetic placeholder
  event (`tripsyAttireFreeDayEvent`: name `No events planned`, `freeDay: true`, stable
  `freeday-<dayKey>` id). One synthetic event rather than a special empty-day shape means
  everything downstream works unchanged: its own Casual time-block, a Casual occasion in the
  guidance sizing, dated rows in the Daily Dress Guide / review dialog / tier drill-downs, an
  outfit composed for it, and normal overrides (the stable id makes an override stick across
  refreshes — a free beach day can be re-tiered Athletic). The MODEL prompt gets only real events
  (`currentEventsForPrompt` filters `freeDay`; both category apply loops already default an
  unmatched event to `'casual'`, which IS the rule, and the athletic name regex can't match the
  placeholder); the fingerprint deliberately hashes the FULL list (`allGuideEvents`) at both
  generation sites, since the staleness readers hash `days.flatMap` — a filtered fingerprint
  would read stale forever. The Daily Dress Guide renders a free day as plain italic text, never
  the jump-to-My-Trips title button (there is no real event to jump to). `freedays_test.js`.
- **New itinerary events ASK their dress codes instead of demanding a full Refresh — and
  matching-tier newcomers just wear the outfits already composed** ("rather than regenerate the
  entire attire guide automatically, ask the user what the dress code is for the new events. And
  if those dress codes are identical or similar to dress codes for the events that are
  immediately before or after…, regenerate the attire guide by using the selected outfits for
  the new events," 2026-09-27). When the owner opens a Clothing Summary whose guide is stale AND
  the itinerary has real events the guide has never seen (`tripsyAttireFindNewGuideEvents` —
  free-day placeholders excluded, they're Casual by rule), `showTripsyAttireNewEventsDialog`
  (own overlay, z 9150 like the review dialog; its badges are in the category menu's click-away
  exclusion list) lists just those events, each with a pickable 7-tier badge pre-suggested from
  the athletic name rule first, else the nearest guide-known neighbor in the same day (BEFORE
  wins over after — you're already dressed for what came before), else Casual. Confirming runs
  `tripsyAttireApplyNewEvents` — a purely MECHANICAL merge, no Claude call: the current build's
  day list becomes the guide's structure, existing events carry their saved
  tier/override/ambiguity verbatim by id, new events take the picks (stamped
  `categoryOverridden` — the owner just confirmed them, so no future refresh re-judges),
  blocks/counts re-derive via `computeTripsyAttireBlocks`, the `eventFingerprint` moves to the
  merged list (stale note clears), and `personGuidance`/`packingList`/`laundryDays`/
  `guidanceFingerprint` are deliberately untouched (a changed per-tier count is what makes the
  NEXT real Refresh re-run the guidance sizing); a failed save rolls back in memory. Then
  `tripsyAttireAdoptNewEventsIntoOutfits`: "identical or similar to the neighbors" IS the
  existing block-folding rule, so a folded newcomer's block matches a saved composed outfit by
  the same greedy `dayKey|tier` multiset rule `tripsyOutfitsUncoveredBlocks` uses, and that
  saved block's `eventIds`/label refresh to the current block's (the incremental recompose's own
  refresh — without it the 👔 glyph/"See outfit"/wear-day math would not see the newcomer
  wearing the outfit); identical ids write nothing. Only a person left with an UNCOVERED block
  (a new event at a genuinely different level from its neighbors) gets the usual
  Regenerate-outfits confirm — an offer, never a silent recompose. The prompt fires once per
  session per itinerary STATE (`tripsyAttireNewEventsPrompted`, keyed tripKey+fingerprint hash —
  declining stays declined until the itinerary actually changes again), never while a generation
  is running, and a dialog answered after the owner switched trips writes nothing
  (`tripsyAttireOverlayTripKey` re-check). The full Refresh path is unchanged and still
  available. `neweventtiers_test.js`.
- **Physical-activity events are always Athletic** ("for events that involve hikes, biking,
  climbing, running, jogging or anything similar, set the dress category as 'athletic',"
  2026-09-15). Two layers: the events-categorization prompt states the rule (nuance lives with the
  model), and **`tripsyAttireForceAthleticCategories`** enforces it deterministically over event
  NAMES right after categories land — in BOTH `generateTripsyAttireGuide` branches, BEFORE the
  per-tier counts that size the packing guidance, so a forced hike is Athletic in the garment
  math too, and a guide saved before the rule existed retrofits on any refresh. The keyword regex
  (`TRIPSY_ATTIRE_ATHLETIC_EVENT_RE`) is deliberately conservative: activity-specific word forms
  only, word-bounded (the tie rule's `\b` lesson) — `surfing` but never bare `surf` ("Surf &
  Turf" is dinner), `skiing` but never bare `ski` ("Ski Lodge Dinner" is dinner). A forced event
  loses its `alternateCategory` (nothing left to pick); a manual override always wins, so a
  false positive is one tap in the review dialog to fix, permanently. `athleticrule_test.js`.
- **The attire flow STARTS with the dress codes alone — the Daily Dress Guide** ("The first
  step in the attire flow should be to determine which events fall into which categories of
  dress … present its suggestions to the user and allow the user to make changes. That is what
  should happen in the daily dress guide," 2026-10-05). With no guide yet, the owner's 👔 button
  opens no menu: its `beforeOpen` hook asks "Is the itinerary complete, and are you ready to build
  the Daily Dress Guide?" and Yes runs `tripsyRunAttireGenerationSafely(…, {dressOnly: true})`.
  `generateTripsyAttireGuide`'s `dressOnly` stage runs ONLY the events categorization —
  `runGuidancePhase` returns null, so no packing guidance, `personGuidance: null`, empty packing
  lists — and stamps `dressOnly: true` (`tripsyAttireGuideIsDressOnly` keys on that flag ONLY, so
  an older full guide is never mistaken for one). Unspecified, a Refresh keeps the saved guide's
  stage. On finish `runTripsyAttireGeneration` opens the Daily Dress Guide directly (every badge
  there is the owner's tier picker), skipping the summary and review dialog; and while the guide
  is dress-only the 👔 menu holds exactly one item, **Daily Dress Guide**. The stale-⚠️ refresh
  prompt has its own dress-only wording. **The guide's sign-off is a green "Approved" button**
  at its foot (owner-only, dress-only guides only; same day: "When the user selects that
  button, create the clothing summary, and then make that option available on the attire menu
  under the daily dress guide"): `tripsyApproveDressCodes` closes the guide, opens the Clothing
  Summary shell (so the live stage line shows) and runs the generation with `{dressOnly:false,
  approved:true}` — the events are unchanged since the dress-codes build, so every category and
  override is reused verbatim and only the packing guidance call runs; no second review dialog.
  The guide then stops being dress-only and the full 👔 menu returns, now ordered **Daily Dress
  Guide, Clothing Summary**, then the packing items. **The Clothing Summary's own sign-off is a
  green "Select Garments To Pack" button** at its foot (owner-only, same `.tripsy-dg-approve-btn`
  style; same day: "bring up the Plan Packing List page, but change the name to packing list"),
  opening `tripsyWardrobePackForTrip` for the person the guide is showing. With that, **"Plan
  Packing List" is renamed "Packing List" everywhere a user sees it** (page title, 👔 menu item,
  the summary's per-person card button, Packing Status' cross-link button — formerly "Packing
  Plan" — and the empty-state/blocked messages); function names and code comments keep the old
  name, and the CLAUDE.md table below still says Plan Packing List for the function it describes.
  `attiredressfirst_test.js`.
- **EVERY generate — first generate AND Refresh — ends in a review dialog of the time-blocks'
  tiers** ("show the user each of the events/time blocks with your suggested dress category… make
  the dress category a button… allow the user to select individual events… update the display
  dynamically," then "also display the review dialog after a user regenerates the attire list,"
  both 2026-09-15): `showTripsyAttireReviewDialog`, opened by `runTripsyAttireGeneration` when
  `isOwner && summaryLiveForTrip()` (a dialog popping over an unrelated page after a background
  generate would be noise; a refresh re-categorizes non-overridden events, so its tiers deserve
  the same look-over — overridden ones show "(selected)" and are untouched), awaited BEFORE the
  outfit-recompose offers. Lists each day's blocks (grouped by
  consecutive constant `displayCategory` — the same rule `tripsyEnumerateAttireBlocks` uses):
  a BLOCK's badge re-tiers the whole block via **`tripsyAttireOverrideBlockCategory`** (every
  member's base set + `categoryOverridden`, one save, snapshot rollback on failure, deliberately
  NO cascade/downgrade dialogs — setting the block IS the cascade, shown live); an EVENT badge
  inside a multi-event block goes through the exact `tripsyAttireOverrideCategory` mechanism the
  guide's own badges use, dialogs included. Event badges show each event's own BASE tier (the one
  screen that deliberately departs from the displayCategory rule — seeing which member drives the
  block is the point). Every change re-renders the dialog AND the summary behind it via the shared
  `renderOpts.rerender` convention, so blocks visibly split/merge as tiers move. Z-order 9150 —
  above the Attire panel (9000), below the category menu (9200), whose click-away close excludes
  the review badges just like the guide's own. `dressreview_test.js`.
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

**Both are gated on a saved attire guide** ("there should be nothing to show until the attire list
is generated," 2026-09-15): their need lines derive from `guide.packingList`, so before a guide
exists they opened onto an empty page. The trip card's 👔 Attire menu now requires
`isOwner && attireHasGuide` for both items (matching Clothing Summary / Daily Dress Guide's
existing gate), leaving a guide-less owner's menu exactly one item — Generate; the other entry
point (the Attire summary's per-person card buttons) was already inside a `personGuidance`-gated
block. `attiremenugate_test.js`.

Each has a header button opening the other, passing an `onClose` callback so closing the second
reopens the first with fresh numbers. **Opened from a garment page, either button hands the current
need LINE across** (`initialLine` = `{tier, lineName}`, resolved by NAME since a regenerated guide
renumbers lines, falling back to the list when that name is gone) and takes it back on the return
leg, so the two pages are two views of one thing rather than a round trip through a menu. Each page
also hides its own **list-only header controls** on a garment page — Plan's **+ Add Line** and
**Show Incomplete**, Status' **Unpacked Items Only** and **Cubes** — via its own
`setListOnlyButtons(show)`, called `true` from `renderList` and `false` from `renderDetail`. Both
copies query the DOM rather than capturing the button consts (those are declared well below the
render functions that call it), and both hide rather than remove, so the handlers stay bound. Both use one **contextual Close**: on a garment detail screen
it returns to the list of need lines, on the list it closes the page. Keep that single-button shape —
a separate always-close button lands beside it on the detail screen wearing the same label.

That control — and every close across the Attire section and the packing screens (Attire, Daily
Dress Guide, Dress Code Definitions, category drill-down, Plan Packing List, Packing Status, Cubes,
Outfits, a single outfit, Wear Days) — is the **red ✕ box** at the card's top right,
`.tripsy-close-x`. It is a restyle only: each button kept its id/attribute, so the contextual ones
still go back rather than close. The class is deliberately neither `.tripsy-update-btn` nor `.btn`
(both size themselves for a WORD) and its colours are var-with-fallback, since it spans the Attire
overlays' light paper and the wardrobe modals' dark panel. Note the Plan page used to relabel its
button per render (`closeBtn.textContent = 'Close'`) — that assignment is gone, and reinstating it
would overwrite the glyph with the word.

- **Packing cubes: packing a garment IS assigning it to one.** Cubes are the physical zip cubes
  garments go into, identified by three traits rather than a typed-in name — **brand** (Briggs &
  Riley, Eagle Creek Reveal, Eagle Creek Pack-It — split by LINE, since two Eagle Creek lines
  look nothing alike and telling same-colour/same-size cubes apart is the whole point of
  recording a brand), **size** (Large/Medium/Small/Extra small) and **color** (Black, Blue, Purple,
  Orange, Yellow, Gray, Brown, Zebra), as fixed lists (`TRIPSY_CUBE_BRANDS`/`_SIZES`/`_COLORS`;
  extend them when a cube is bought and nothing else needs changing — a cube saved under a value
  since removed from one of these lists keeps it, because `showTripsyCubeForm`'s `selHtml` appends
  an unrecognised current value rather than letting the browser fall back to the first option and
  silently blank it on the next save). Fixed rather than free text
  because the label is DERIVED: `tripsyCubeName` reads "colour + size" ("Blue Medium") and appends
  the brand ONLY when another cube shares that colour and size, so twins stay distinguishable while
  everything else stays short. In such a group EVERY cube names its brand, not just some — a bare
  one would read as the only Blue Medium there is — **except** when the whole group shares one
  brand, where the brand distinguishes nothing and is just noise. A cube with no brand recorded has
  nothing to append and shows the bare base — a "navy"/"Navy" typo would split one cube into two labels. Colour
  and size are required, brand optional (it only ever disambiguates). A cube with no photo yet falls
  back to a swatch of its own colour (`TRIPSY_CUBE_COLOR_CSS`; Zebra is a stripe pattern, since a
  flat grey would be indistinguishable from Gray), so it is still tellable apart in the grid.
  `tripsyCubesSorted` gives a stable biggest-first order so the grid doesn't reshuffle. The LIBRARY
  (`driveData.tripsyPackingCubes`, `{id, brand, size, color, driveFileId, addedAt}`,
  `Store.listPackingCubes`/`savePackingCube`/`deletePackingCube`) is persistent like the wardrobe
  itself — you own the same cubes trip after trip and photograph each once — and is managed
  **inline from the picker**, not a Utilities page, so a cube can be created at the moment of
  packing into it. WHICH copy is in which cube is per-trip and rides on the trip's own selection
  entries as a **per-copy** `cubes` array (`cubes[i]` = the cube copy *i* went into), because
  several of one garment can legitimately be split across cubes. `tripsyCubesForEntry` is the only
  place that array is derived and it guarantees `cubes.length === packed` — truncating a list
  longer than the packed count, padding a shorter one with `''` — so "how many are packed" and
  "where each one is" can never disagree. `''` means packed-but-location-unknown, which is exactly
  what a pre-cubes entry and a deleted cube both degrade to; both render as "cube not set" rather
  than vanishing.
  **Some garments never go in a cube** — the ones that HANG (suits, tuxedos, blazers, jackets,
  raincoats, dresses and gowns), plus **ties** (rolled or laid flat), **cufflinks** and
  **sunglasses** (both travel in a case), and **shoes** (packed separately). Cufflinks and
  sunglasses are typed *only* so this rule can reach them, since it is type-keyed; their packing
  group stays `accessories` and their glyphs stay 💎 / 🕶️ (the sunglasses rule is deliberately
  narrow — `sunglasses`/`shades` only — so prescription glasses stay untyped)
  (`TRIPSY_UNCUBED_TYPES` / `tripsyGarmentSkipsCube`, typed off
  `tripsyGarmentTypeKey` so it inherits that function's ordering guarantees — three of which
  matter here: swimwear matches before `suit` so a bathing suit isn't read as tailoring;
  dress-shirt/dress-socks/dress-shoes all match before the bare `dress` rule so none is read as
  a gown and pulled out of its cube; the tie rule's `\b` word boundary is what keeps
  "booties"/"panties" from typing as `tie`; and the cufflinks rule REQUIRES the word "link", so a
  French-cuff shirt is still a shirt). Those keep the original count/toggle packing via
  `tripsyWardrobeChoosePackedCount` and render an explicit uncubed line rather than a blank where
  a cube would be, so a suit with no cube doesn't read as one you forgot to assign. The wording
  comes from `TRIPSY_UNCUBED_NOTE` (default `TRIPSY_UNCUBED_NOTE_HANGS`), keyed by typeKey,
  because the types aren't uncubed for the same reason: 🧥 "hung, not in a cube", 👔 "packed
  loose, not in a cube" for a tie, 💎/🕶️ "packed in a case, not in a cube" for cufflinks and
  sunglasses, 👞 "packed separately, not in a cube" for shoes. **Add an entry there whenever a
  non-hanging type joins `TRIPSY_UNCUBED_TYPES`**, or it will claim to be on a hanger. They are
  also skipped by the Cubes page's **"Cube not set"** block: `tripsyNormalizeTripSelection` pads
  every PACKED copy to a cube slot, and an uncubed garment's slots are empty strings by
  construction, so without an explicit skip in `showTripsyCubeContents` a packed suit reads as a
  location you forgot to assign when there was never a cube to assign.
  On **Packing Status**, a garment page shows WHICH CUBES its garments are in as a **banner of
  large (96px) cube pictures** above the grid — the thing you recognise across a room — each named
  with a count of packed copies (`pageCubeIds`/`pageCubesHtml` in renderDetail; `tripsyCubeTileHtml`,
  painted by `tripsyPaintCubePhotos`, which renderDetail must call alongside `tripsyWardrobeLoadPhotos`).
  **The per-card 26px chip (`cubeLineHtml`) renders ONLY when the page is split across more than one
  cube** (`pageCubesSplit`): with one cube the banner has already answered the question and a
  thumbnail on every card is pure repetition, but once the page spans several cubes the chips are the
  only thing saying which garment went where. A cube with no photo falls back to its colour swatch; a
  packed copy whose cube is unknown or deleted gets its own "Cube not set" banner entry (dashed box,
  amber label) and counts as a split. Uncubed types contribute nothing to the banner — their own card
  already says why they have no cube — so a page of only suits/ties/shoes shows no banner at all.
  Tapping a cube's **picture or its name** on the Cubes page drills into that cube alone —
  its garments as photo cards (`view = {mode:'cube', id}` inside `showTripsyCubeContents`;
  contents are keyed by garment ID rather than name so each one's `driveFileId` is available,
  and copies of the same garment allocated across several tiers total into one ×N card). The
  "Cube not set" pseudo-cube drills down the same way, under id `''`. Close is contextual, the
  same single-button shape the packing screens use: from a drill-down it returns to the list,
  from the list it closes the page.
  `showTripsyCubePicker` is the ONLY way to mark a CUBED garment packed (`packed` is just
  how many slots are filled), one copy commits immediately while several advance to the next
  unassigned copy, and the **Cubes** header button opens `showTripsyCubeContents` — the same live
  entries read from the cube's side, not a second store that could drift. Deleting a cube keeps its
  contents packed and only forgets the location; it scrubs the id from `driveData` AND from the
  open page's own copies, or the next persist would write the dangling id straight back.
  **The picker offers two explicit non-cube choices alongside the real cube grid: "No cube" and
  "Wear on flight."** Before this, the only way to mark a copy packed at all was picking a real
  cube — there was no way to say "yes it's packed, just not zipped into any particular cube" (a
  belt, say) or "it's not packed at all, I'm wearing it on the plane." Both are plain non-cube-id
  strings (`TRIPSY_CUBE_NONE` / `TRIPSY_CUBE_FLIGHT_WORN`) rendered as two extra tiles the exact
  same shape as a cube tile, using the SAME `data-tw-pick-cube` attribute a real cube uses — so the
  existing pick handler assigns them with no new wiring, and `tripsyCubeById` naturally resolves
  either to `null` (never found in the cube list), same as a deleted cube. The key property: both
  are TRUTHY, unlike the pre-existing `''` (which stays reserved for "never decided yet" or a
  since-deleted cube's now-dangling reference), so `applyCubes`' `filled =
  picked.filter(Boolean)` counts either one toward `packed` — picking "No cube" or "Wear on flight"
  really does mark that copy packed, where leaving a slot untouched still does not. Every place a
  cube id gets turned into a label/picture reads through one shared pair of helpers,
  `tripsyCubeSlotLabel`/`tripsyCubeSlotGlyph` (`tripsyCubeLabel` now just delegates to the first),
  so the two sentinels render correctly everywhere a cube location is shown: the picker's own
  per-copy row, `showTripsyGarmentCubeInfo`'s tap-a-photo dialog, the Packing Status page's
  per-card chip (`cubeLineHtml`) and page-level cube banner, and the Cubes page — which gives each
  sentinel its OWN named block (`specialBlock`, reusing `contents.get(id)` exactly like the
  existing "Cube not set" orphan block does for `''`) rather than lumping a deliberate choice in
  with genuinely-undecided copies.
- **The cube form's Save closes INSTANTLY and the photo catches up in the background**
  ("When I tried to add a new packing cube I hit save and nothing happened," 2026-10-06).
  `showTripsyCubeForm`'s Save used to resize + upload a picked photo IN FRONT of saving the
  cube and closing — a Drive folder lookup plus a multipart upload, tens of seconds on a weak
  signal or forever on a hung fetch, behind a disabled button and a muted 12px status line —
  and minted the id with an unguarded `crypto.randomUUID` (secure-context only; absent on some
  WebViews), so a throw there left the form open with nothing saved and nothing said. The
  record is now the pure `tripsyCubeFormRecord(cube, {color, size, brand})` (id falls back to a
  time-stamped string, the "+ Add Line" guard's precedent), the click handler is synchronous —
  `Store.savePackingCube` (optimistic in memory) then `close(saved)` with a "Saved …" toast, no
  `await` before the close — and `tripsyCubeFormUploadPhoto` then resizes, uploads, re-saves the
  SAME cube id with its `driveFileId`, seeds `tripsyCubePhotoUrlCache` from the resized bytes,
  and calls the form's new second arg `onPhotoReady` so the opener (the cube picker and the
  Cubes page's Add/Edit) repaints the swatch tile into the picture; an upload failure toasts
  and never un-saves the cube (a photo-less cube is fully usable — the swatch IS a trait). A
  missing color/size now toasts AND turns the status red. Verified with a Playwright run of
  the real function (no photo, photo, missing size) before and after. `cubeformsave_test.js`.
- **Allocation is per LINE, not per tier.** A pick is keyed `id::tier::line` (the line's NAME, not
  its index — indices shift whenever the guide is regenerated, which is also why skip keys use
  names), persisted in `driveData.tripsyTripWardrobe`. `availableFor` subtracts copies allocated to
  any *other* line, so one owned pair can't silently satisfy two lines. Entries saved before this
  are migrated on load by `tripsyWardrobeResolveSelectionLines`, which stamps the line the OLD
  algorithm would have chosen — without a line an entry counts against availability while being
  impossible to deselect. That function also re-homes swim picks (see below).
  `tripsyWardrobeAssignGarments` honours an explicit `item.line`, falling back to its own matching
  when absent, which is what lets all five call sites share it.
  **Every writer of that array must carry `cubes`, because every writer replaces the WHOLE array**
  ("Why doesn't the app show which clothes are in which packing cubes? I set that when I packed,"
  2026-10-17): the Packing List's `persistChosen` (and the category drill-down's embedded pack
  panel, a copy of it) wrote `id/category/line/qty/packed` back and nothing else, so one pick on
  either page — selecting, deselecting, Add Garment, Skip, the reopen after a Replace — silently
  erased every cube assignment made on Packing Status; `packed` survived, so each copy then read
  "cube not set" rather than unpacked. Both now load a `cubesByKey` map beside `packedByKey`
  (deleted together on deselect) and write through **`tripsyWardrobeCarryCubes(entry, cubes)`**
  (next to `tripsyCubesForEntry`): the loaded ids ride along unchanged, filled slots leading and
  bounded by what is still packed. `cubescarry_test.js` also asserts that EVERY
  `Store.setTripWardrobe` call site names `cubes` — a new writer that forgets is this bug again.
  Assignments lost before the fix are gone (the data was overwritten); they need re-picking once.
- **Gym Clothes: a fixed, open-ended section before General on both packing screens** ("In
  the packing list view, before the general section, add a section called gym clothes. In
  that section, show 5 garments: Gym Tops, Gym Shorts, Gym Pants, Socks, and Underwear. For
  gym tops, gym pants, and gym shorts, show all garments of each type marked as athletic, and
  allow the user to select as many as he wants. For socks and underwear, combine the number
  of each selected in the gym clothes section with those selected in general, but allow the
  user to put them in different packing cubes," 2026-10-19). A pseudo-tier like General
  (`TRIPSY_WARDROBE_GYM_TIER` = `'gym'`, label "Gym Clothes"), appended LAST by
  `tripsyWardrobeNeedByTier` (after the flight claimer and its `need > 0` filter, which would
  drop these) as `tripsyWardrobeGymLines()` — the five FIXED lines of
  `TRIPSY_WARDROBE_GYM_LINES`, each `need: 0, open: true` and tagged `gym:
  'tops'|'shorts'|'pants'|'socks'|'underwear'`; the guide sizes nothing here. An OPEN line
  reads "any" in the Needed column, its Selected is plain text (never red/amber), it ticks
  once anything is picked, never counts toward the trip-wide Selected/Needed or toward
  `tripsyPlanPackingIsComplete` (dress codes only), shows no Skip card, and caps a photoless
  placeholder at `TRIPSY_WARDROBE_OPEN_LINE_PLACEHOLDER_CAP` (10) instead of need+2. What a
  line OFFERS is `tripsyWardrobeGarmentFillsGymLine` (the first branch of
  `tripsyWardrobeGarmentFillsLine`): tops = group tops TAGGED **Gym**; shorts = Gym + type
  `shorts`; pants = Gym + group pants, never shorts/swim; socks/underwear = by TYPE with no tag
  (the Wardrobe form never tags essentials; dress socks are a different type). **Gym is a
  WARDROBE-ONLY tag like General, never a dress code** ("Add a new category before athletic
  called 'Gym'. Show me all clothes currently in the athletic category and let me decide which
  ones to also include in the gym category," same day — the first cut read the athletic tag,
  which swept in every hiking boot and polo): `tripsyWardrobeTierOptions()` lists
  `TRIPSY_WARDROBE_GYM_TIER` FIRST, directly before Athletic, and the form/filter chips show it
  through `tripsyWardrobeTagLabel` ("Gym" — the packing SECTION keeps "Gym Clothes" via
  `tripsyWardrobeTierLabel`); `TRIPSY_ATTIRE_CATEGORY_ORDER` is untouched, so the attire guide,
  outfit Swap (`tiers.includes(liveTier)`) and every dress-code picker never see it. The owner
  tags garments Gym on the Wardrobe's bulk Edit page (filter Dress level = Athletic) — a session
  cannot write the wardrobe. The
  tier gate is the new `tripsyWardrobeGarmentEligibleForTier` (General and Gym open, a dress
  code wants its tag), used by both pages' fill math and garment pages. **Socks/underwear
  combine**: a gym Socks/Underwear pick is its own selection entry (`id::gym::Socks`) — so on
  Packing Status it packs into its OWN cube — and `tripsyWardrobeGymEssentialsForGeneral`
  re-addresses those entries to General's same-type line (`tripsyWardrobeGymEssentialTarget`:
  typeKey `socks`/`underwear`; no such General line → the pick lives in the gym section alone)
  so General's Selected/Packed INCLUDE them — **and each adds 1 to that line's NEEDED too**
  ("for each socks and underwear that the user selects from the gym clothes section, add 1
  to the 'needed' column for that garment," same day: the gym pairs are extra, so General's
  own need is still to be filled by General picks; `gymExtraFor` on both pages, so Needed
  agrees); the Packing List's General page notes "incl. N from Gym Clothes (needed +N)", and
  Packing Status lists them on General's page as "from Gym Clothes"
  cards (each card now carries `data-tw-entry-cat`/`data-tw-entry-line`, and `entryFor`/
  `markGarmentPacked` pack EXACTLY that entry — the same placeholder garment can sit on the
  page twice, once per section). Packing Status lists ALL FIVE gym rows, like the Packing
  List ("The packing status page layout for gym clothes should match the packing list page,"
  2026-10-20 — the first cut hid the gym Socks/Underwear rows there as already counted on
  General; a gym sock entry is now packable from either its gym row or General's page, one
  entry and one cube either way). Wear days: a gym allocation has NONE
  (`tripsyWardrobeWearDaysFromLines` basis `'gym'` — the gym is on no itinerary; rule 4 would
  wrongly call gym socks "worn every day"), and Ship Home skips gym allocations for the same
  reason (they would all read "never worn again"). The three scaffolds that extract
  `tripsyWardrobeNeedByTier`/`WearDaysFromLines`/`ShipHomeCandidates` gained the new const
  (the grown-dependency lesson). `gymclothes_test.js`.
- **👔 → Garment Location: where every packed garment IS, read from the cube's side, plus
  Laundry** ("a menu item … before the refresh option called 'Garment Location' … a list of each
  packing cube used on that trip plus an option for 'Laundry'. If the user selects a cube, show
  every garment in that packing cube. If he selects laundry, show all garments marked as needing
  cleaning," 2026-10-17). `showTripsyGarmentLocation(tripKey, tripName)` (own overlay
  `tw-garment-location-overlay`, same z tier as the Cubes page, red ✕ contextual Close: a
  drill-down returns to the list, the list closes). Read-only, any viewer, listed once a guide
  exists, directly before Refresh. The list is `tripsyGarmentLocationRows`: only the cubes that
  HOLD something on this trip (library order; an owned-but-unused cube is not a location here,
  unlike the Cubes page, which is the library's management view with Add/Edit/Delete), then "No
  cube" / "Wearing on the flight" / "Cube not set" only when non-empty, then **Laundry always**.
  Cube contents come from **`tripsyCubeContentsMap`**, factored OUT of `showTripsyCubeContents`
  so the two pages can never disagree (`cubedetail_test.js`'s generator now extracts it too — the
  grown-dependency lesson). Laundry is the Daily Dress Guide's own judgement,
  `tripsyLaundryItemsForDay`, run for BOTH people as of the TRIP's local today
  (`tripsyGarmentLocationLaundryDay`: today while in progress, the last day once over, nothing
  before it starts — nothing has been worn) with each garment's "needed again"/`::nn` halves
  merged (`tripsyGarmentLocationLaundryItems`) — here it is simply in the laundry. Computed
  lazily on the Laundry tap, since it walks every garment's wear days. `garmentlocation_test.js`.
- **The 👔 menu is labelled "Clothes"** ("Change the name of the attire menu to Clothes,"
  2026-10-19): the trip card's button label and tooltip, and the two messages that point at
  the menu (the Packing List's "Select Packing Status from the 👔 Clothes menu…" and the stale
  glyph's "Something in the Clothes menu is out of date"). Everything else — function names,
  `data-tripsy-attire-*` attributes, the guide/summary page titles and this file — keeps
  "attire".
- **While a trip is UNDERWAY, the Clothes menu hides Clothing Summary and Packing List**
  ("When I am on a trip, do not show the packing list or clothing summary items on the
  clothes menu," 2026-10-20 — the bag is packed, so both are planning pages with nothing
  left to plan). `tripsyTripInProgress(trip, todayKey)` (pure; next to `tripsyTripHasStarted`,
  same device-local today): first event day ≤ today ≤ last event day
  (`tripsyItineraryStartDayKey`/`EndDayKey`, both ends inclusive; no dated events → never),
  judged once per card render as `attireTripUnderway` and ANDed into just those two rows'
  gates. Everything else — Daily Dress Guide, Packing Status, outfits, Garment Location,
  Laundry, Refresh — stays, and both rows return once the trip's last event day is past.
  The dress-only menu (one item) is untouched. `ontripmenu_test.js`.
- **👔 → Buy Clothes (on-trip only): a garment bought mid-trip joins the Wardrobe, the
  packing list, a cube and the outfits ahead** ("When I am on a trip, add a menu item called
  'Buy Clothes' which allows me to add new clothes purchased on the trip. Allow me to take
  pictures, add descriptions and categories, add them to packing cubes, and add them to
  future outfits via a dialog which can recalculate future outfits for the trip," 2026-10-20).
  Owner-only, guide required, `attireTripUnderway` (the same gate that hides Packing List),
  after the outfits item. `tripsyBuyClothesFlow(tripKey, tripName)` runs four existing
  mechanisms in order: **(1)** `showWardrobeGarmentForm(null, onSaved, opts)` — the Wardrobe
  form (camera/library photo, name, type, Dress Categories, color, quantity), which now
  passes the saved record to `onSaved(garment)` and takes `opts` `{title, person, hint,
  onCancel}` (`onCancel` fires on Cancel or a tap outside, via `ov._onCancel`, so the flow
  ends instead of waiting forever; cleared on save); **(2)** a packing-list entry on
  `tripsyBuyClothesPackingLine(needByTier, g)` (pure: the first of its tags with an active
  line it fills, else first tag/General with Add Garment's TYPE-derived fallback name),
  written through `tripsyWardrobeCarryCubes` like every other `setTripWardrobe` writer;
  **(3)** `showTripsyCubePicker` for its copies (skipped for `tripsyGarmentSkipsCube` types,
  which are simply packed; a cancelled picker leaves it selected but UNPACKED so Packing
  Status still lists it); **(4)** `tripsyBuyClothesOutfitDialog` over
  `tripsyBuyClothesOutfitTargets(g, outfits, todayKey, garmentById)` (pure: this person's
  saved blocks dated today or later, at a dress code the garment is tagged for — untagged
  fits any — not already wearing it, never a `wornFromFlightDayKey` mirror; `replaceId` =
  the garment filling the newcomer's `tripsyOutfitGarmentRoles` role, null = simply
  added). "Add to checked outfits" mutates the live blocks (`tripsyBuyClothesApplyToBlocks`,
  returning previous ids for rollback), re-syncs flight transfers, one
  `saveTripsyTripOutfits`; "Recalculate future outfits" runs
  `tripsyRecomposeFutureOutfitsInBackground(tripKey, person, todayKey)` — the Generate
  Outfits background shape with `composeTripsyOutfits`' new `{redress}` predicate
  (`b.dayKey >= todayKey`): matching blocks are never KEPT, so they are re-dressed like
  uncovered ones while earlier days stay as wear context. No composed outfits yet → the
  flow ends after packing (Generate Outfits will include it). `buyclothes_test.js`.
- **👔 → Laundry, and a "Laundry back · N out" row per wash still out** ("In the attire menu,
  add a menu item called 'Laundry'. Have this bring up the same page as the laundry button from
  the daily dress guide. When laundry is out, also show the laundry back option from this
  menu," 2026-10-19). Owner-only, once a guide exists, after Garment Location and before Refresh.
  `tripsyAttireMenuLaundry(guide, trip, records, person)` (pure) gives the laundry DAY by Garment
  Location's rule (`tripsyGarmentLocationLaundryDay`: the trip's today, its last day once over,
  null before it starts) and the outstanding washes (`tripsyLaundryOutstandingByWash`, oldest
  first), for the person the Daily Dress Guide is showing (`tripsyDressGuidePerson`, read at
  render and at click). **Laundry** opens `showTripsyLaundryDay` for that day — the guide's own
  screen (a null day toasts "the trip has not started yet"); each **Laundry back** row opens
  `showTripsyWashedDay` for its wash with `collectDayKey` = today, so a Received confirmation is
  dated like the guide's button. Both pass `onChanged` → `renderTripsyEventsList`, so the "N out"
  rows re-judge after a wash or a return. `attirelaundrymenu_test.js`.
- **The Trip Insurance documents ride on EVERY trip's 📄 Documents menu** ("For every trip,
  automatically add the trip insurance documents policy and confirmation of benefits to the list
  of downloaded documents," 2026-10-18). The menu is titled "Downloaded Documents"; the policy and
  confirmation of benefits are the Trip Insurance page's uploads (`driveData.tripInsuranceDocs`,
  one shared set, not attachments), so every trip card (not a pending-create placeholder) appends
  `tripsyInsuranceDocsMenuHtml(driveData.tripInsuranceDocs, offlineDriveFileIds, hasOtherDocs)` —
  a "Trip Insurance" block after the trip's own and event documents, alphabetical, read-only rows
  (`tripsyInsuranceDocMenuRowHtml`: open + copy link through the SAME `data-tripsy-open-attachment`
  / `data-tripsy-copy-attachment` handlers, which key only on the Drive file id; no rename/delete —
  those live on the Trip Insurance page — and no per-trip offline toggle, since they are downloaded
  for every trip by rule) with a ✓ when this device holds the bytes, else ⬇️ "downloads at
  sign-in". A trip with nothing attached now gets the Documents button once insurance documents
  exist. **The orphan sweep in `reconcileTripsyOfflineDocs` exempts them** (`tripsyInsuranceDriveFileIds`):
  they share the IndexedDB doc store with attachments (`cacheTripInsuranceDocsOffline`) but are not
  attachments, so the sweep deleted them on every sign-in, racing the re-cache `completeSignIn`
  fires right after it. `insurancedocs_test.js`.
  **The Trip Insurance PAGE lives under Utilities** ("Move the trip insurance menu to the
  utilities section," 2026-10-18): the rail item is a `rail-subitem` of `#utilities-submenu`
  (after Favorites), and `setActiveNav`'s `isUtilitiesView` includes it so the submenu stays open
  on the page. The view id stays `tripinsurance` — offline entry with no trips cache and the
  Travel View exit in offline mode both route to it by name, and `OFFLINE_ALLOWED_VIEWS` still
  lists it. Two consequences to know: the Utilities toggle is owner-only, so a read-only viewer no
  longer has a rail entry for the page (its documents still reach every viewer through each trip's
  📄 Documents menu), and in offline mode the submenu is hidden, so the page is reached only by the
  automatic offline landing. `insurancenav_test.js`.
- **"Add Garment" on Plan Packing List searches the whole wardrobe** rather than requiring the owner
  to first navigate into a specific line's own garment page. Its dialog (`tripsyWardrobeAddGarmentDialog`)
  filters by His/Hers, Type (`TRIPSY_ATTIRE_PACKING_GROUPS` — the same vocabulary the "+ Add Line"
  dialog's own Type field already uses), and Dress Level (only tiers with real need lines for the
  selected person — unlike Add Line, which targets any tier freely since it invents a new line, this
  one attaches a REAL garment to an EXISTING one, so an empty tier would be a dead end).
  **Results are matched on the garment's OWN tier tags** (`(g.tiers||[]).includes(tier)`, General
  matching everything), **not on whether the tier currently has an active need line for it** — the
  first version matched against `tripsyWardrobeGarmentFillsLine`, which silently hid whole categories
  of real, ownable garments: `tripsyWardrobeNeedByTier` deliberately DROPS a tier's blazer+trousers
  lines once a packed suit already covers it (a suit packed for Formal also dresses Cocktail nights),
  so with the line gone, no cocktail suit could ever match the old filter even though the owner might
  want a DIFFERENT one. Add Garment is a browse tool ("what do I own for Cocktail"), not a
  what's-still-missing tool, so it must not share that filter. Resolves `{garmentId, tier}`, and the
  CALLER (`tripsyWardrobePackForTrip`) still tries `tripsyWardrobeGarmentFillsLine` against the tier's
  ACTIVE lines first (the ordinary case) — but when a search result has no active line to attach to
  (exactly the dropped-line case above), it falls back to a stable, TYPE-derived line name
  (`TRIPSY_GARMENT_TYPE_LABEL[gType]`, e.g. a suit always resolves to "Suits", the same name a guide
  would have used directly) rather than failing outright, and the success toast explains that this
  piece won't show as a separate packing need since something else already covers the occasion. Either
  path writes through the ordinary `sel`/`persistChosen` mechanism — no parallel selection model.
  Picking the other person's garment switches the page to show them, so the addition is visible
  immediately. `tripsyWardrobeChooseQty` (asked when more than one copy is available) now pins its
  own z-index above the Add Garment dialog specifically — it used to rely on plain DOM append order,
  which broke the moment a caller other than the base page height opened it first.
- **The Wardrobe's bulk Edit page has a search bar + filters, and Save says it saved** ("When you
  select edit a garment, add filters and a search bar … when the user presses the save button,
  indicate that the changes have been saved," 2026-10-05). `tripsyWardrobeOpenBulkEdit`'s sticky
  filter bar: a search box (live name + color, case-insensitive) and Whose / Type / Dress-level
  selects (Whose opens on the library being viewed; Type lists only groups present). Filters HIDE
  rows (`display:none`) rather than re-render, so an edit typed into a row a later filter hides is
  kept and still saved, and matching reads each row's LIVE values. Save now writes only CHANGED
  garments, in ONE persist (`Store.saveWardrobeGarments`, the batch twin of `saveWardrobeGarment`
  with the same conflict retry) — it used to call `saveWardrobeGarment` per row, one whole-file
  PATCH per garment, ~89 sequential writes for a one-field change. Feedback: the button reads
  "Saving…", then a green **✓ Saved** (`.tw-bulk-saved`) that stays until the next edit, plus a
  status line and toast naming the count; nothing changed says "No changes to save"; a failure
  says so. The page stays open after saving (it used to auto-close) so several garments can be
  found and fixed in one visit. Rows are listed ALPHABETICALLY by name ("Sort garments alphabetically when the user
  presses the edit button," same day — `localeCompare`, `sensitivity:'base'`, numeric), sorting a
  copy so the stored wardrobe order is untouched. The single-garment form (card Edit / + Add garment) closes
  instantly, so it now toasts `Saved "<name>".` `wardrobebulkedit_test.js`.
- **The garment form is rebuilt FRESH on every open** ("Whenever a user selects add garment, make
  sure all the fields to describe that garment are cleared from the last time," 2026-10-05).
  `showWardrobeGarmentForm` removes the previous `#tw-form-overlay` node before
  `getOrCreateWardrobeFormOverlay` builds a new one: the node used to be reused, so a late async
  result from the previous open (an Edit's photo download, a picker or Paste result) could paint
  into the next form. A late result now lands in a detached node. A NEW garment's Type starts on
  an empty "Select type…" option instead of silently pre-picking the first group; left unchosen,
  Save derives it from the name via `tripsyAttirePackingGroupOf`. "Whose" still defaults to the
  library being viewed, which is deliberate. `garmentformreset_test.js`.
- **A garment photo can come from the camera OR the photo library** ("How do I select a photo
  from my photo library to add a garment," 2026-10-05). `showWardrobeGarmentForm`'s "Take / choose
  photo" button used to click ONE hidden input carrying `capture="environment"`, which on
  iPhone/iPad opens the camera outright with no library option. It is now ONE hidden input with
  NO `capture`, clicked synchronously from the button: iOS's own sheet then offers Photo Library
  and Take Photo in one step (same-day follow-up — a first fix routed through the shared
  `tripsyPickImageFile` Take/Choose picker, which put a redundant in-app step in front of that
  very sheet). Never put `capture` on an input meant to reach the library.
  `garmentphotolib_test.js`.
- **Shorts and long trousers never stand in for each other** ("Do not include shorts as potential
  garments for chinos," 2026-10-05). The mix-and-match tiers collapse their need lines to untyped
  whole-group pools, so a "Chinos" line matched every `pants`-group garment, shorts included.
  `tripsyWardrobeGarmentFillsLine` now rejects a `shorts`/`swim`-typed garment on an untyped line
  whose NAME types as `trousers` or `jeans`, and — the reverse, same day: "Do not use jeans or
  trousers as shorts" — a `trousers`/`jeans` garment on a line whose name types as `shorts`. Jeans
  and trousers still substitute for each other, and a generic "bottoms" line still offers
  everything. Every picker that matches by line
  (Plan Packing List, Add Garment's attach step) goes through that one function.
  `chinosnoshorts_test.js`.
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
- **Outfits generate IN THE BACKGROUND from a "Generate Outfits" menu item, and obsolete attire
  pages FLASH their ⚠️ on the 👔 menu** ("create a menu item under attire called generate
  outfits … generate the outfits in the background … change the menu item from generate outfits
  to view outfits. If there are changes to the itinerary that make the generated outfits or
  garment counts obsolete, flash the yellow triangle by the appropriate menu item and, if the
  user selects it, bring up the same dialog boxes you use now … Always update attire-related
  pages in the background," 2026-10-05). The ✨ item (shown once a Packing List is complete) reads
  **Generate Outfits** (`data-mode="generate"`) until outfits exist, then **View Outfits**. Generate
  asks ("Generate outfits for this trip now?") and runs `tripsyGenerateOutfitsInBackground(tripKey)`
  — fire-and-forget, one run per trip (`tripsyOutfitComposingKeys`), every person whose list is
  complete or who already has outfits, `runTripsyOutfitComposition(…, {quiet:true})` in turn, then
  a My Trips re-render that flips the label; a flashing ⏳ (`data-tripsy-outfits-generating`,
  `tripsyRefreshOutfitGeneratingBadges`) marks the item meanwhile, and tapping it then just toasts.
  EVERY path that used to block on the "Regenerating outfits…" spinner (the stale View Outfits
  Regenerate, the post-refresh offer, the new-events offer, the outfit list's own Recompose) now
  calls that one background entry — the spinner is retired; don't re-add a blocking one. **Stale
  marks**: `.tripsy-menu-flash` (the attire blink keyframes, honoring reduced-motion) on the
  ⚠️ beside Daily Dress Guide and Clothing Summary (`data-tripsy-attire-stale-warning`, shown by
  the same `tripsyFlagStaleAttireButtons` pass that marks the 👔 button — which keeps its steady
  ⚠️ "as you do now") and on View Outfits' existing `data-tripsy-outfits-warning`. Selecting a
  flagged guide row runs `tripsyAttireStalePrompt` — the 👔 button's out-of-date dialog, factored
  out so both can't drift (its full-guide wording now says hand-set dress codes are KEPT, which
  `generateTripsyAttireGuide` has done since overrides were preserved) — then opens the page
  only if no refresh was started; a flagged View Outfits shows the existing "Outfits may be out of
  date" Regenerate/Ignore dialog. `attiredressfirst_test.js`, `outfitrecomposeafterrefresh_test.js`.
- **A flagged menu row explains the PRECISE changes behind its ⚠️ and does the MINIMUM to clear
  it** ("explain the precise changes that caused the triangle to appear and ask if the user wants
  to update the item. Always do the minimum amount of work required," 2026-10-05). The guide's
  staleness is `eventFingerprint` (id + date + startTime), so exactly four changes can raise it,
  and `tripsyAttireGuideChanges(guide, currentDays)` diffs the saved guide against the current
  build into `added` / `removed` / `moved` (another day, with `from`) / `retimed` (with the old
  time), free-day placeholders ignored; `tripsyAttireChangeSummaryText` renders one "• Added:
  Concert — Thu, May 2 at 8:00 PM" line per change (capped at 12 + "…and N more").
  `tripsyAttireStalePrompt(tripKey)` — now top-level, shared by the 👔 button and the flagged Daily
  Dress Guide / Clothing Summary rows — shows that list, says what the update will do (ask dress
  codes for the new events, drop the removed, re-place the moved; "every dress code you already
  have is kept, nothing is regenerated"), and, for a full guide, works out BEFORE anything runs
  whether the packing counts are even affected: `tripsyAttireGuidanceFingerprintFor` (the same
  formula `runGuidancePhase` stores as `guidanceFingerprint`) over `tripsyAttireMergedDaysPreview`
  (a dry run of the merge, new events at their suggested tier). Update → `tripsyAttireMinimalUpdate`:
  `showTripsyAttireNewEventsDialog` for the new events (cancel = nothing changes), the mechanical
  `tripsyAttireApplyNewEvents` merge (carries every saved category by id, no Claude call), the
  free `tripsyAttireAdoptNewEventsIntoOutfits`, a repaint of any open guide/summary — and ONLY
  when the guidance fingerprint moved on a full guide, `tripsyRunAttireGenerationSafely(…,
  {isRefresh:true, minimal:true})` in the background (its `eventsUnchanged` path reuses every
  category and runs just the guidance phase; `minimal` suppresses the review dialog, the outfit
  offers and uses its own toasts). The flagged View Outfits row lists `tripsyOutfitStaleReasons`
  — per person, each uncovered time-block by day/tier/label and each outfit wearing a garment no
  longer packed — and promises to re-dress only those; the background regenerate already does
  exactly that (incremental + per-outfit `outfitStillPacked`). `tripsyConfirmDialog` now renders
  `\n` as line breaks (`white-space:pre-line`, left-aligned when multi-line) so these lists read as
  lists. **And a problem OUTFIT can be fixed by hand from that dialog** ("add a button to the
  dialog boxes that will allow the user to see that outfit and swap another garment for the one
  that is creating the problem … keep the explanation of the problem and suggest possible
  solutions … Show pictures of all relevant garments," same day): `tripsyOutfitStaleReasons` also
  returns structured `items` (a `lost` item carries the LIVE `block`/`outfits` records and
  `lostIds`), and `tripsyOutfitProblemsDialog` (own overlay, replaces the confirm) lists each
  reason with a **Fix this outfit** button on every `lost` row (an uncovered block has nothing to
  swap — Update is its fix), plus Update / Not now. Fix opens `showTripsyOutfitFixPage` (z
  2147483095): the problem kept at the top ("this outfit wears X, which is no longer on your
  Packing List"), every garment in the outfit pictured with the problem one(s) outlined red and
  badged "Not packed", then per lost garment the packed replacements `tripsyOutfitSwapCandidates`
  would offer (pictured; a pick here is always one Swap would equally allow), a Remove button, and
  a re-dress-in-the-background button. A pick swaps in place and saves on `tripsyOutfitSwapChain`
  (optimistic, flight/airport-ride sync kept, rollback + toast on failure), repaints for the next
  problem garment, and re-renders My Trips so the ⚠️ re-judges. **The 👔 glyph's own ⚠️ now
  FLASHES and mirrors ANY flagged menu row** ("If there is a warning triangle on any item in the
  attire menu, also show the flashing triangle next to the attire menu glyph," same day):
  `tripsyAttireMenuWarningSync(container, tripKey)` reads the visible
  `data-tripsy-attire-stale-warning` / `data-tripsy-outfits-warning` rows and sets the badge
  (generating still wins); BOTH flagging passes call it after setting their rows, so neither
  clears what the other raised. `tripsySetAttireStaleBadge`'s stale state carries
  `.tripsy-menu-flash`. Tapping a glyph flagged ONLY for outfits just opens the menu — the
  guide prompt would have no itinerary changes to list. `stalereasons_test.js`.
- **An outfit shows its own problems inline: a garment that must GO gets a Swap button plus the
  garments that could replace it, and a MISSING top/bottoms/shoes gets an Add button plus the
  garments that could complete it** ("When a garment needs to be removed from an outfit, show a
  swap button and show garments that could be used to replace the removed garment. When a garment
  is missing from an outfit, show an add button and show garments that could be used to complete
  the outfit," 2026-10-05). In `showTripsyOutfitModal`: a garment in the outfit but no longer on
  the Packing List (`lostIds`, selection read from `Store.getTripWardrobe`) is outlined red and
  badged "Not packed", and under the grid a "⚠ X is no longer packed — replace it with…" row
  carries a **Swap** button (the same `data-tw-outfit-swap` the card has, opening the same picker)
  and the `tripsyOutfitSwapCandidates` list as pickable cards. Completeness is judged by three
  body ROLES (`TRIPSY_OUTFIT_ROLES` = tops/pants/footwear, labelled via
  `TRIPSY_FLIGHT_WORN_ROLE_LABEL`): `tripsyOutfitGarmentRoles(g)` goes by TYPE first because the
  dress_wear group spans both halves (a dress shirt is a top, a suit/tuxedo brings its trousers, a
  dress covers both; ties, blazers, belts, essentials fill nothing), falling back to the packing
  group; `tripsyOutfitMissingRoles(garments)` lists the unfilled ones. Each gets a "⚠ No shoes in
  this outfit — complete it with…" row with an **Add** button (`tripsyOutfitAddPicker`, the Swap
  picker's shell with no Remove, z `2147483098` so it clears BOTH the modal and the fix page) and
  `tripsyOutfitAddCandidates` inline (packed, this person, not an essential, not already in the
  outfit, free that day, tagged for the live tier — the Swap rules minus the same-type test, since
  the role IS the type). Claude's free-text `block.gaps` still show beneath. Swap, Remove, a
  replacement pick and Add all go through ONE `applyOutfitChange(currentId, chosen)` (null
  `currentId` = push) on the optimistic `tripsyOutfitSwapChain` with rollback. Viewers see the
  marks and the missing-role rows, no controls. `showTripsyOutfitFixPage` gets the same Add
  sections (`data-fix-add`/`data-fix-add-pick`), stays open for an incomplete outfit, and its
  problem note names what is missing. **Every row of the View Outfits problems dialog has a
  button** ("The app is giving me this message but not a button to go to the outfit so I can fix
  it," same day — only `lost` rows had one): an `uncovered` row (a time-block with no outfit) gets
  **Dress this outfit** — `tripsyOutfitStaleReasons` now carries the current `block` + live
  `outfits` on those items, and `showTripsyOutfitFixPage` materializes an empty saved block in
  compose's shape (`item.kind` → `'dress'`) so the page opens as missing top/bottoms/shoes with
  Add candidates; closing it (button OR click-outside, which routes through `ov._close`) with
  nothing picked removes that block again, or it would count as covering its time-block and
  clear the ⚠️. The packing-picks-changed fallback row gets **View outfits** (`action:'view'`,
  falls through to the list like Not now). **Both buttons open THE OUTFIT ITSELF, not the fix
  page** ("I want the button on the dialog box to take me to the specific outfit where there is
  a problem and show the specific garments that can be selected to address that problem," same
  day): `tripsyOutfitOpenProblem(tripKey, item)` materializes an uncovered block
  (`tripsyOutfitMaterializeUncovered`, the shared helper the fix page also calls) and opens
  `showTripsyOutfitModal` on the block's first event with `opts.onClose` →
  `tripsyOutfitDiscardIfEmpty` — the modal's close and its click-outside (routed through
  `ov._close`) both honor it. The modal is where the inline Swap/replacements and Add/candidates
  live, so the problem garment and its fixes are on the same screen; a successful change there
  re-renders My Trips so the menu ⚠️ re-judges. `showTripsyOutfitFixPage` survives only as the
  fallback for a block with no event id. **The outfits ⚠️ itself is judged PER OUTFIT, never by
  the selection fingerprint** ("This is all I am seeing - still no way to get to the specific
  outfit causing the problem," same day, with a screenshot of the dialog's lone fallback row:
  `tripsyOutfitsNeedRecompose` flagged on `selectionFingerprint` drift, which fires when picks
  are merely ADDED, so nothing was wrong with any outfit and there was no outfit to open).
  It now uses the same lost-garment rule `tripsyOutfitStaleReasons` lists (an outfit wearing
  something no longer selected — a garment deleted from the wardrobe counts as lost, named "a
  garment no longer in your wardrobe") OR an uncovered block, so every flag has a row naming its
  outfit; the fallback row can no longer be reached. The outfit modal gives a deleted garment's
  dangling id its own "Remove it" row (`data-tw-outfit-remove-dangling`), since it cannot be
  pictured or swapped. `outfits.selectionFingerprint` is still written, no longer consulted.
  **An INCOMPLETE outfit (no top, bottoms or shoes) raises the ⚠️ too** ("I just want to
  confirm that all outfits for the Singapore GP trip are correct and complete," same day — a
  live check found the Oct 21 casual outfit with no bottoms: its unpacked board shorts had been
  removed and nothing added, and the lost/uncovered rules saw nothing wrong). Both
  `tripsyOutfitsNeedRecompose` (`incomplete`, via `tripsyOutfitMissingRoles` over the outfit's
  non-essential garments; an EMPTY block is ignored, compose can return gaps-only) and
  `tripsyOutfitStaleReasons` (a `lost`-kind row with `lostIds: []` reading "outfit has no
  bottoms", so it opens the outfit like any other problem) apply the same rule.
  `outfitaddmissing_test.js`.
- **A dress-code refresh now proactively offers to recompose outfits it just made stale**, instead
  of leaving that discoverable only per-block. Refreshing the Attire Guide (dress-code
  categorization) and composing Outfits (the actual garment picks per time-block) are two separate,
  independently-triggered steps — refreshing the guide alone can move a block's tier (e.g. Casual →
  Smart Casual) with no mention that any already-composed outfit for that block is now stale; the
  success toast just said "dress codes updated." Reported 2026-08-14: an Athletic-only top stayed
  assigned to a block the guide had already moved to Smart Casual, discovered only when the owner
  happened to open that one outfit — "I regenerated outfits this morning" turned out to mean the
  guide was refreshed, not the separate Outfits step, and the owner reasonably expected regenerating
  to have fixed it rather than requiring a manual Swap. `runTripsyAttireGeneration` now checks, right
  after a successful generate/refresh, both people's already-composed outfits via the same
  `tripsyOutfitsNeedRecompose` the Outfits nav link and the outfit modal's own stale note already
  use (so this can never disagree with them), and offers the identical Regenerate/Ignore confirm —
  never a silent auto-recompose, since that's a real Claude call. Owner-only (recomposing writes);
  skipped entirely for a person with no real composed outfit yet, since there's nothing to go stale.
- **A failed outfit save is retried, and never throws away a completed composition.** Reported
  2026-08-14, right after the fix above shipped: the owner accepted the Regenerate prompt and got
  `Could not save the composed outfits` with no toast otherwise — confirmed against the real Drive
  data that `generatedAt` genuinely never advanced, so the save itself, not just the picks, had
  failed outright. Root cause: `persistTripsyNarrativeCacheWithRetry`'s own inner retry only fires
  for a REVISION CONFLICT (`e.conflict`); a plain transient failure (a network blip, or a tab
  briefly backgrounded after the minute-plus Claude call) isn't a conflict, so one hiccup threw
  immediately with zero retries — discarding the whole expensive composition for nothing.
  `composeTripsyOutfits` now retries the SAVE step itself, up to 3 more times with backoff,
  regardless of error kind (the composed `outfits` object is cheap and idempotent to re-save). If
  every retry still fails, the composed result is preserved on the thrown error
  (`err.tripsyComposedOutfits`) rather than discarded; `runTripsyOutfitComposition`'s catch checks
  for it and offers a `⚠️ Could not save outfits` — Retry Save / Discard confirm that re-saves the
  SAME already-composed object on accept, instead of forcing the owner to redo the whole (slow,
  costly) Claude call over what was really just a save-layer hiccup. A successful retry-save
  finishes through the same `tripsyOutfitComposeSucceeded` helper the ordinary path uses, so the
  two can't drift on what "done" looks like.
  **Follow-up, same day**: "a toast message just appeared - couldn't read it in time" — the final
  unrecovered-failure message (declined the retry, or the retry-save itself also failed) was still
  a plain `toast()`, which auto-dismisses in ~4s; a composition failure names the real underlying
  reason and is worth actually reading. Both that final message and the Retry Save offer above now
  go through `tripsyConfirmDialog`, which stays on screen until dismissed. This needed a new mode on
  that shared dialog: `no: null` renders a single "OK" button instead of a real Yes/No choice (every
  existing caller passes a real `no` string or omits it, so this is purely additive), and clicking
  outside such a dialog acknowledges it (resolves `true`) rather than declining, since there's
  nothing to decline.
- **Recomposing outfits is INCREMENTAL — only genuinely uncovered blocks go to Claude.** Reported
  2026-08-14: "Regenerating outfits takes a very long time for minor changes" — a Regenerate
  re-dressed EVERY time-block in one huge call even when one block's tier had moved.
  `composeTripsyOutfits` now, when saved outfits exist, matches saved
  blocks to current blocks with the SAME greedy `dayKey|category` multiset rule
  `tripsyOutfitsUncoveredBlocks` uses for staleness — so what gets re-dressed is precisely what
  that check flagged. Covered blocks keep their outfit verbatim (eventIds/label refreshed from the
  current block, so per-event lookups like the 👔 glyph stay right); only stale blocks appear in
  the prompt's dress-these list, with the kept outfits included as fixed "ALREADY-DRESSED" context
  lines (by tag) so the whole-trip re-wear/rotation limits still hold. Zero stale blocks skips the
  API call entirely (just a refresh save, which also clears the staleness checks). Results merge
  back in current-block order; a stray result for a non-stale block is ignored rather than
  overwriting a kept outfit, and an empty result still fails loudly. The timing log gains a
  `(partial: dressed N, kept M)` suffix so a slow run can be judged against what it actually did.
  **A changed packing selection is judged PER OUTFIT, not all-or-nothing** ("The app has been
  regenerating outfits for too long. That process is supposed to take about one minute at the
  most," 2026-10-05 — the live Singapore trip's picks had changed since its 07:03 compose, so the
  old `selectionFingerprint` gate discarded all 31 outfits and re-dressed every block from 30
  photos, minutes of streaming, when only ONE outfit — the Oct 21 casual block's unpacked board
  shorts — actually used something no longer packed). A saved outfit is now kept when its
  day+tier still matches AND `outfitStillPacked` (every garment still selected for this person,
  essentials aside); only those that lost a garment, plus uncovered blocks, go to Claude. A
  first compose still dresses everything. Newly added picks are NOT pushed into kept outfits —
  Swap does that.
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
- **The "list complete — start packing now?" prompt** (`tripsyPackingCompleteDialog`, via
  `maybeCongratulate`) fires on the incomplete→complete transition, from the **Done** button or from
  `closePage`, *not* from every pick — picking the last garment used to interrupt mid-flow. Ordinary
  mutations just re-render, leaving `planWasComplete` stale-but-false, which is exactly what lets the
  transition still be detected later; whichever of Done/close comes first records it, so it can't
  prompt twice. **What it asks changed 2026-10-05** ("when the list is complete, display a dialog box
  asking if the user wants to start packing now. If yes, display the packing status bar. If not,
  say select packing status when you are ready"): Start packing closes the Packing List and opens
  `tripsyWardrobePackingList` for the same person; Not yet shows a single-OK "Select Packing Status
  from the 👔 Attire menu when you are ready" — and either answer re-renders My Trips, because
  **Packing Status is on the 👔 menu only once a list is complete** (`attireStatusReady` =
  `attirePlanDone`, either person's `tripsyPlanPackingIsComplete`, OR anything already marked
  `packed`, so a mid-packing trip never loses the page over a list edit). The old offer to compose
  outfits here is gone; Compose Outfits stays on the menu. `attiredressfirst_test.js`,
  `attiremenugate_test.js`.
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
- **`light-jacket` is split out of the general `jacket` bucket** for a packable travel jacket, as
  opposed to a heavy coat/raincoat/parka — matched by `tripsyGarmentTypeKey` BEFORE the general
  jacket rule ("light jacket", "travel(er) jacket" — Loro Piana's own product name for this kind of
  piece — or "packable jacket"), so the owner's real "Rust Loro Piana Traveler Jacket" reclassifies
  with no data edit, purely from its existing name. The split exists for one behavioral reason:
  `light-jacket` is deliberately left OUT of `TRIPSY_UNCUBED_TYPES` — unlike a heavy `jacket`, which
  hangs, a light one folds small and packs in a cube like any ordinary garment (including the "No
  cube"/"Wear on flight" picker options above). Registered everywhere `jacket` is:
  `TRIPSY_GARMENT_TYPE_LABEL`/`_ORDER`/`_GLYPH` and `TRIPSY_WARDROBE_FILTER_ORDER`. Not added to
  `TRIPSY_WEARS_BEFORE_WASH` (its per-type wash-cadence map) since the type has no entry there
  either and both fall back to the same `outerwear` group answer (`Infinity` — never washed on a
  trip), so no explicit entry was needed for correct behavior.
  **PACKABLE outerwear is `light-jacket` too — a fleece, rain jacket, windbreaker, anorak,
  puffer, gilet, overshirt/shacket, or anything "light"/"lightweight"/"packable"/"travel" +
  an outerwear word** ("I packed a light fleece and rain jacket in a cube, but the app does
  not allow me to show them as packed in a cube," 2026-10-06 — `fleeces?` and `rain ?jackets?`
  sat in the HANGING `jacket` rule, so the cube picker was never offered for them). Only a
  plain jacket, coat, overcoat, raincoat (a trench) or parka still types `jacket` and hangs;
  both light-jacket rules sit BEFORE the hanging rule, or `\bjackets?\b` would catch "rain
  jacket" first. The packing GROUP rule (`tripsyAttirePackingGroupOf`) was already outerwear
  for all of these, and the need-line fold below keeps a "rain jacket" line offering and
  counting them. `uncubed_test.js`'s fixture list moved those names from HANGS to CUBED —
  that list IS the rule's spec, so edit it deliberately. `cubedfleece_test.js`.
  **For NEED-LINE matching, a light jacket is still a jacket** ("Why isn't the Loro Piana
  Traveler Jacket listed as a rain jacket," 2026-10-05): guide lines like "rain jacket" / "packable
  rain jacket" type as `jacket`, so after the split the traveler jacket matched none of them.
  `tripsyGarmentLineMatchType` folds `light-jacket` → `jacket`, used by
  `tripsyWardrobeGarmentFillsLine` (both the typed-line test and the untyped-line exclusion) and by
  `tripsyWardrobeAssignGarments`' fallback match, so the jacket is both OFFERED on and COUNTED
  toward those lines (and a plain jacket fills a light-jacket-named line). Cube behavior still keys
  on the real `light-jacket` type. `lightjacketline_test.js`.
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
  LAST. **And a shorts/swim line is never DEDUCTED at all** ("Why are jeans appearing as casual
  shorts on my packing plan?", 2026-10-05 — the casual tier's only bottoms line was the owner's
  own custom "Shorts", need 1, so the claim zeroed and hid it: the jeans worn on the plane were
  counted AS the shorts). The claimer returns false for a pants item typed shorts/swim unless its
  name also names jeans/trousers/pants/chinos (a mixed "shorts/jeans" line is still claimable),
  and exposes `has(role)` so `tripsyWardrobeNeedByTier` still adds the "Bottoms — wearing on the
  flight" companion when the flight tier has bottoms but none were claimable. That rank is typed off the line NAME, not
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
  them, since picking which jeans you fly in is the whole point. **And a flight-worn pick COUNTS
  AS PACKED** ("Count all garments selected for wear on flight as having been packed,"
  2026-10-20 — Packing Status' "N/X packed" tally summed every entry, so the flight outfit added
  to X with no row to tick and the tally could never reach X): `tripsyWardrobeFlightWornEntry`,
  applied inside `tripsyNormalizeTripSelection` — the ONE place every reader loads selection
  entries through — rewrites such an entry to `packed = qty` with every copy located
  `TRIPSY_CUBE_FLIGHT_WORN`, so the tally, the Cubes page and Garment Location ("Wearing on
  the flight") all agree, and a pick saved before the rule reads as packed with no migration.
  The four scaffolds that extract the normalizer (`cubes`/`cubescarry`/`orphan`/
  `replacegarment`) gained the two consts + two helpers. `flightwornpacked_test.js`.
  **And the cube picker's "Wear on flight" tile MOVES the garment onto that flight-worn line**
  (same day, closing the gap the rule left: the tile and the lines were independent records,
  so two different tops could each claim to be the flight top): Packing Status'
  `markGarmentPacked`, on a pick containing `TRIPSY_CUBE_FLIGHT_WORN`, runs the pure
  `tripsyWardrobeAdoptFlightWornPick(entries, g, fromCategory, fromLine, needByTier)` — the
  garment's ROLE (`tripsyOutfitGarmentRoles`: top / bottoms / shoes) names the companion line
  (`TRIPSY_FLIGHT_WORN_ROLE_LABEL` + suffix) in whichever tier holds it; that copy leaves the
  ordinary entry (dropped when it was the last), any garment already on the companion line is
  REPLACED, and the mover is stored exactly as a Packing List pick there — so outfit
  composition, wear days and every screen see one flight outfit. Null (nothing moves, the pick
  stays a plain location) when the trip has no flight-worn line for that role, the garment has
  no role (a tie, a jacket), or the entry already is the companion line. Toasts "X is now the
  garment you wear on the flight." `flightwornadopt_test.js`.
  `composeTripsyOutfits` reads the
  selection's stored line name through `tripsyWardrobeLineIsFlightWorn` to label those garments
  `WORN ON THE DEPARTING FLIGHT` in the prompt, and the re-wear rules say the flight counts as one
  wear: the flight-worn **top** is used up and must not be assigned to any block before the first
  wash day, while its bottoms/shoes have spent one of their many wears and stay freely available
  (jeans/trousers are ~20 wears, not the ~10 the prompt used to say).
  **A garment allocated to a flight-worn line is worn exactly ONCE — on the departure flight — not
  "whenever that tier is worn."** `tripsyWardrobeWearDaysFromLines` (feeding both the Wear Days
  screen and `tripsyLaundryRunOutByDay`) previously had no special case for these lines: since a
  flight-worn line still carries a real dress-code category (whatever tier the flight itself is),
  it fell through to the ordinary TIER rule — "worn whenever you're dressed at that level" — which
  returned every occasion of that tier across the WHOLE TRIP as a wear day for one physical
  garment. With a top's 1-wearing-before-dirty limit, that bogus multi-day count tripped the
  run-out warning almost immediately, naming a day the garment was never actually worn (found via
  the owner asking why the app said a shirt was dirty on a day well into the trip). Fixed with
  `tripsyWardrobeFlightDepartureEvent(guide)` — the trip's departing-flight event, factored out of
  `tripsyWardrobeFirstFlightBlockTier` so the two can't disagree about which event that is — which
  `tripsyWardrobeWearDaysFromLines` now checks FIRST (via `tripsyWardrobeLineIsFlightWorn(e.line)`),
  resolving to that one event with basis `'flight'` instead of falling through to the tier rule. An
  ordinary (non-flight-worn) line in the same tier is unaffected — it's genuinely worn at every
  occasion of that tier, which is exactly what the tier rule is for.
  **A flight-worn line's need (always 1) cannot be double-filled by a real garment AND a generic
  at once.** Ordinary lines deliberately allow over-selecting a bit past need
  (`tripsyWardrobePlaceholderCap` = need+2, a buffer for a lost/replaced item), so a blanket
  real+generic exclusivity rule would break that. But a flight-worn role only ever represents ONE
  physical garment worn on the plane, and each side is independently wear-tracked — found on a real
  trip 2026-08-11: a real garment (a Henley) picked for "Top — wearing on the flight" coexisted with
  a leftover generic placeholder for the identical line, so the laundry engine tracked it as needing
  two separate one-wear tops, and both projected running out on the same day for what was really one
  physical shortage. Picking a real garment for a `flightWorn: true` line now clears any generic on
  that exact line (same tier/name/person), and adding a generic clears any real picks on it —
  whichever the owner does last wins, matching "this is the one thing I'm wearing on the flight."
  Two entry points needed the guard: Plan Packing List (`tripsyWardrobePackForTrip`) and the
  category drill-down's own pack panel (`showTripsyAttireCategoryEvents`) — both let the owner pick
  a garment or add a generic against a line.
- **A partial-itinerary PDF only compares the days it actually covers**: `compareTripsyItineraryPdf`
  determines the PDF's own date range from its day headings (`pdf_date_range`, part of the schema) —
  which can be narrower than the trip's real date range, e.g. a supplement covering just the middle
  leg of a longer trip. A currently-tracked event dated outside that range is never returned as
  `tripsy_only` (the prompt says so explicitly; `runTripsyUpdateComparison` also filters defensively
  in case Claude doesn't fully comply), so days the PDF doesn't mention at all never get flagged as
  "missing." When the PDF's range is narrower than the trip's, the owner sees a blocking `alert()`
  stating exactly which dates were compared before the Update page renders.

### Favorites (Travel View ☆ → Utilities → Favorites)

Tapping the ☆ beside an event's time in Travel View files that place under its CITY in
`driveData.tripsyFavorites` (`Store.listFavorites`/`isFavorite`/`toggleFavorite`/
`removeFavorite`). Owner-only, since it writes to `driveData`; the star is simply absent for a
viewer rather than failing silently. Keyed `${tripKey}::${eventId}` so the same row toggles it
back off, and painted optimistically then corrected from the write's own result.

- **A favorite is a SNAPSHOT** (title, city, address, trip), not a live reference to the event.
  The point is a personal list of places worth returning to, which should outlive the trip's
  events being edited, hidden or deleted years later.
- **`tripsyFavoriteCityFor` always yields a CITY, never a venue or a station.** The address goes
  through `tripsyPrimaryCityFromAddress` — the same extractor the weather pipeline uses
  (city-states, "New York, NY", postcode-stripping) — rather than a second parser that would
  drift from it, with that function's own sanity bounds (≤22 chars, ≤4 words) applied to the
  result. Two shapes it can't answer, both common in the real data, fall back to
  **`tripsyLodgingCityAt`** — where you were sleeping then: a comma-less **venue name** ("Soho
  Farmhouse") isolates no city segment, and a transportation leg's address is a **route**
  ("LAX → LHR") whose arrival side is an airport code. Outside every lodging span — the trip's
  opening and closing travel legs — the NEAREST stay in time is used, so an outbound flight files
  under the city it was heading to instead of "Other". Measured on a real 63-event trip, this
  turned 14 junk buckets (venue names, route strings, "Other") into five real cities.
- Each favorite records the **visit date** and **trip name** alongside the place, shown on its
  row (most recent visit first within a city) and on its own page.
- **Selecting a favorite opens its own page**: city, address, visit date, trip and when it was
  saved, plus a **notes box** the owner types into (saved on blur, like the diary; a viewer sees
  the notes read-only). Notes belong to the FAVORITE, not the event, which may be edited or
  deleted long after. A favorite removed while its page is open falls back to the list rather
  than stranding it.
- The Utilities page groups by city, ordered by how many favorites each holds, then
  alphabetically, so the places you return to rise to the top.

### Trip Diary (gear menu → 📖 Trip Diary; `showTripsyTripDiary`, `index.html` "Trip Diary page")

The trip written up AFTERWARDS — past tense, one section per day, photos woven through the
prose — as opposed to the itinerary, which is the plan. **Phase 1 is built: storage, the page,
the deletable schedule block, past-tense seeding and free text editing. Photos (phases 3–4) are
not.**

- **Its own Drive file, `trip-diaries.json`** (`TRIP_DIARIES_DRIVE_FILENAME`), same folder and
  sharing as the others, for the reason trips moved out too: `flight-log-data.json` is rewritten
  in full on every unrelated save, and diary prose is the largest free text this app stores.
  Shape `{schemaVersion, updatedAt, diaries:[{tripKey, updatedAt, days:[{dayKey, heading, text,
  showSchedule, photos:[]}]}]}`. **A missing file is NORMAL** — nobody has written a diary yet —
  so `fetchTripDiariesFromDrive` returns null rather than throwing, and `writeTripDiariesDoc`
  creates it on the first save (`createDriveDataFile` now takes a filename, defaulting to the
  main data file so its existing caller is unchanged). `saveTripDiaryToDrive` uses the same
  head-revision guard as `persistTripsData`, but retries HERE: a diary is self-contained per
  trip, so re-applying it onto a newer copy is always well-defined.
- **Days come from `buildTripsyPrintDayData`**, so the diary's day boundaries are identical to
  the itinerary's — earliest dated event rather than `trip.start` (which drifts), and multi-day
  stays bucketed the same way. Day N via `tripsyDayNumberFromTripStart`.
- **Seeding is past-tense rewriting, scoped, and never destructive.** `generateTripsyDiaryDays`
  (`claude-opus-4-8`, no `thinking` — adding it on that model would be SLOWER) takes each day's
  cached itinerary narrative plus its schedule and rewrites it as "we", past tense, with an
  explicit no-inventing-facts rule since the app only knows what was *planned*. It only targets
  days whose text is still EMPTY, and ignores any day it didn't ask about, so pressing the button
  again can never overwrite writing. Scoped by day from the outset — the same lesson as
  `summaryDayKeys`.
- **The schedule block** (`tripsyDiaryScheduleLines`) lists that day's times/places above the
  prose; `showSchedule` defaults to shown and only a stored `false` hides it, so a diary written
  before the flag existed still shows one. Removing it is per day.
- **Editing** is a plain textarea per day, saved on blur (not per keystroke), skipped when the
  value is unchanged, and chained through one promise so two quick edits can't race the same
  file. Viewers get read-only prose and no seeding button. **There is deliberately no Save
  button**, so the page has to SAY it saved: a header line reads "Saving…" then "Saved"/"Not
  saved" (without it the page reads as unsaved work). Closing blurs the focused field first —
  blur is what persists, so closing straight out of the textarea used to drop the last edit.
- **Photos (phase 3, built).** Placement rides INSIDE the text as `[photo N]` tokens
  (`TRIPSY_DIARY_TOKEN_RE`), never a paragraph index: a token travels with the words it belongs
  to when the prose is rewritten, split or merged. Numbers are stable per day
  (`tripsyDiaryNextPhotoNo`) and never reused, so deleting photo 2 leaves 1 and 3 pointing where
  they were.
- **A day switches to BOOK mode once it has photos — or the moment "Add photos" is pressed.**
  That second half matters: the per-paragraph **+ Photo** buttons must exist before the first
  photo does, or there is no way to place one. Book mode renders each paragraph as its own
  `contenteditable="plaintext-only"` block with its figures floated INSIDE it, so text wraps
  around them exactly as it prints — a textarea is a block box and would reflow away from the
  float the instant you tapped in. `tripsyDiarySerializeParagraph` reads the block back out,
  turning each embedded figure into its token; without it, editing a paragraph would drop every
  photo in it. Pressing Done with no photos added drops back to the plain textarea.
- **Two photo sources.** The day's **See photos** box fetches Places candidates per place
  (`tripsyGatherPlacePhotoThumbnails`, one call per place, hence a button rather than eager
  loading) — ✓ uploads it and drops its token in the paragraph that MENTIONS that place
  (`tripsyDiaryParagraphForPlace`, whole name then first significant word, falling back to the
  last paragraph), ✕ records it in `rejectedPhotoNames` so it is never offered again. The
  per-paragraph **+ Photo** button takes the owner's own via `tripsyPickImageFile` (Take Photo /
  Choose Photo over two hidden inputs — the shape that works on iPad) and places it exactly
  where pressed; it is resized first, since a day of iPhone photos is otherwise tens of MB.
- **Caption / side / move / remove live in a list UNDER the day**, not in the prose: an `<input>`
  nested in a contenteditable region is a reliable way to lose a caption on iPad. Side cycles
  right → left → full. A photo whose token was deleted while editing is not lost — it shows as
  "not placed" with a Place in text button. Diary photos are painted by `tripsyDiaryPaintPhotos`,
  its own pass, because `tripsyWardrobeLoadPhotos` only matches `.tw-photo` nodes.
- **Editing assumes a wide screen** (the owner's stated workflow), so float widths are fixed to
  the print measure. The narrow-screen collapse to full-width blocks is for READING only.
- **The printed book (phase 4, built).** A **Print / PDF** button in the diary header runs
  `buildTripsyDiaryPrintHtml` → the existing `#tripsy-print-root` + `triggerTripsyPrint` path, the
  same one the itinerary uses. It renders from the SAME token model as book mode, so what was
  edited is literally what prints rather than a second renderer that could drift. Photos are real
  `<img>` elements, not CSS backgrounds, because `triggerTripsyPrint` waits on `<img>` decode
  before snapshotting — a background prints as an empty box. Each Drive file is resolved once up
  front, shared across days. Only days with text become chapters; a cover page carries the trip
  name and dates; each day starts a new page; `break-inside: avoid` on the figure keeps a caption
  with its photo across a page break. A dangling token (photo removed) and a photo with no Drive
  file both render as nothing rather than a broken figure. Printing blurs the focused paragraph
  first — the snapshot is synchronous, so an unserialized edit would otherwise print stale.

### Trip Fly-over (gear menu → 🗺️ Trip Fly-over; `showTripsyFlyover` / `playTripsyFlyover`)

An animated map of a FINISHED trip ("after a trip is over, create a fly-over map that would
show each destination we went to … photos would play in a slideshow format when the flyover
map showed a plane or other transportation device reaching that destination," 2026-10-20).
**Phase 1 (built): in-app playback. Phase 2 (not built): saving a video file to Drive**,
either by recording in a desktop browser or by having the cloud routine render it. The iPad
WebView's support for recording is unproven.

- **It runs on ANY trip, finished or not, and the ⚙️ menu item follows its state**
  (`tripsyFlyoverMenuItems`, pure; "Allow the feature to run on existing trips (non-finished)
  … 'Start Fly-Over' … 'Finish Fly-Over' … After it is completed, there should be options to
  view it or edit it," 2026-10-20):
  - **No record:** "Start Fly-Over" (owner only).
  - **Started:** "Finish Fly-Over" (owner only). Both of these open the setup page.
  - **Completed:** "View Fly-Over" (plays straight away, any viewer) and "Edit Fly-Over" (the
    setup page, owner only). A viewer sees nothing until the fly-over is completed.
  - **Completing:** the setup page's **✓ Complete Fly-Over** stamps `completedAt`, and is
    disabled until the trip is over (`tripsyFlyoverTripOver`: last event day before the
    device's today), since only then can every destination have been visited. A rebuild from
    Edit keeps `completedAt`. The first build and Complete both re-render My Trips, so the
    menu label flips at once.
  - **Photos only for VISITED destinations** (`tripsyFlyoverStopVisited`: the stop's first
    day is today or earlier; an undated stop counts as visited). An unvisited stop shows
    "🔒 Photos open once you get here (dates)" in place of its photo buttons.
- **Destinations are where you SLEPT** (`tripsyFlyoverDeriveStops`, pure):
  - **Stays:** one stop per lodging, with duplicate records of the same hotel collapsed.
  - **Endpoints:** the first flight's departure airport (`origin`) and the last flight's
    arrival (`return`).
  - **No lodging:** each flight's arrival except the last, then the trip's own `location`.
  - **Ordering is by CALENDAR DAY, not the clock.** A stay's start is its nominal check-in
    hour, or a bare date (midnight), which can predate the flight that gets you there.
  - **Legs:** a leg belongs to the first stop that begins on or after the leg's day, so
    everything on a moving day goes to where you were moving TO. The leg is drawn as its most
    significant mode (`TRIPSY_FLYOVER_MODE_RANK` plane > boat > train > car), so the car to
    the airport doesn't turn a flight into a drive.
- **A leg with no transport on the trip is ASKED about** ("Where there is no form of
  transportation specified between two points, bring up a dialog box asking the user what type
  of transportation is involved," 2026-10-21). The derivation still draws such a leg as a drive
  but flags the stop `modeGuessed`; `tripsyFlyoverStopsNeedingMode(record, guessedIds)` (pure)
  lists, in trip order, each shown stop (not removed, placed, not the first) still guessed and
  not `modeManual`, with the stop it comes FROM — `guessedIds` is a fresh derivation's flags,
  so a fly-over saved before the flag is asked too. The setup page (owner) asks on open and
  after Rebuild, one `tripsyFlyoverAskMode` dialog at a time ("How did you get there? … from
  Paris to Rome": ✈️ Flight / 🚆 Train / 🚗 Drive / ⛴️ Ferry, or Not now — which stops asking
  until next open); an answer stamps `{mode, modeManual: true}`, and `tripsyFlyoverCarryOver`
  keeps it across Rebuild. Each card's leg is a DROP-DOWN (`data-flyover-mode-select`,
  owner-only; "Allow the user to change the mode of transportation with a drop down menu,"
  same day) to change the transport any time, with a ❓ beside it while still a guess.
  **Hike is a transport too** ("Add an option to hike between locations for the flyover,"
  same day): `hike` (🚶 Hike — the walker, chosen over 🧑‍🦯, which is the white-cane symbol, since no
  hiker-with-a-stick emoji exists) is in `TRIPSY_FLYOVER_MODES`, the one list both the drop-down and
  the question dialog draw from; it plays as a dotted trail (`dashArray '2 7'`) with the 🚶
  walking along it (ground glyphs face left and flip heading right); a trip leg named as a
  hike/trek/walk/"on foot" derives as one (`tripsyFlyoverModeOf`, whole words); rank 0.5,
  below a drive, so a mixed leg still draws as its vehicle. Verified in Chromium: a Paris→Rome stay with no leg
  asked, Train saved, Rebuild kept it without asking again.
- **Layovers are flown THROUGH, never visited** ("where there is a layover on a flight, show
  the flight to the layover cities, but do not zoom the map, or show photos. Just display the
  name of the city," 2026-10-21). `tripsyFlyoverDeriveStops` collects the flights assigned to
  each stop's leg; every arrival but the last is a connection, stored on the stop as `via:
  [{label, query}]` in flying order (an arrival that is itself a stop — the no-lodging case —
  never counts). `tripsyFlyoverGeocodeVias` places them at build time (English city name, a
  non-Latin answer keeps the flight's wording, an unfound one is dropped); the build stamps
  `layoversAt`, and a fly-over built before this picks them up once via
  `tripsyFlyoverAddLayovers` (fresh derivation matched by stop id) — behind the setup page, and
  on View as an `opts.layovers` promise the player waits on at most 5 s after its first await,
  so music still starts in the tap; owner saves. `tripsyFlyoverPlayableStops` unwraps via
  longitudes in sequence (and drops them from the first stop shown). In the player a FLIGHT leg
  (`b.mode === 'plane'` — a leg the owner switched to another mode ignores them) is framed WITH
  its layovers, flown segment by segment as a plane, and at each one gets a small dot + a
  `.tfo-via-label` name tag and a 0.9 s pause — no flyTo, no card, no slideshow. The setup
  card shows "via …" beside the leg. Verified in Chromium (LAX → NRT → SIN: Narita labelled, no
  zoom).
  **The plane stays on the map through the stopover** ("When the plane on a flyover does a
  stopover, do not make the plane disappear from the map," 2026-10-22): `animateLeg` used to
  remove its vehicle at the end of every leg, so during each layover's 0.9 s pause there was no
  plane until the next leg added a fresh one. It now takes a `carry` (`{keep, marker, heading}`):
  a leg ending at a layover leaves its marker (and heading) for the next leg, which moves it to
  its own start; only the final leg removes it, and a carried marker joins `layers` so Replay
  clears one left waiting. Sampled in Chromium every 50 ms (LAX → NRT → BKK → SIN): the old
  build had no plane at 8.0–8.95 s and 12.85–13.75 s, the new one never drops it.
- **Airport destinations and layovers are named for the CITY of the airport the itinerary
  lists** ("Where there are flight destinations use the city names from the airports listed in
  the itinerary," 2026-10-21 — geocoding an airport lands on the town it sits in: NRT → Narita,
  ICN → Incheon). Flight records spell airports three ways — a bare code ("NRT"), "City, ST
  (CODE)" / "City (CODE)", or "CODE City, ST - address" — and `tripsyFlyoverAirportCity(desc)`
  (pure) takes a known code's city from `TRIPSY_AIRPORT_CITIES` (~300 codes, English names, so
  "Zürich (ZRH)" reads Zurich), else the city the record itself writes, else '' (an unknown bare
  code keeps the geocoded name). Derived airport stops (origin, return, a no-lodging `arrive-*`
  stay) and layovers carry the description as `airport`; `tripsyFlyoverApplyAirportCities`
  (pure, idempotent; never over `labelEdited`/`manualPlace`) runs at the end of a build, in
  `tripsyFlyoverAddLayovers`, at the top of the player, and on setup open / View (owner saves),
  so a saved fly-over is renamed without a rebuild (an old record's description is recovered
  from its `"CODE airport"` query). **A leg's mode now trusts the record's CATEGORY before its
  wording** (`tripsyFlyoverModeOf`): a car "from Chiang Rai Airport (arriving Flight TG136)"
  read as a flight and planted a bogus "Chiang Rai Airport (for Flight FD3210)" layover; since
  layovers found under those rules are wrong, `layoversV` (`TRIPSY_FLYOVER_LAYOVERS_V` = 2,
  `tripsyFlyoverLayoversCurrent`) makes an older record re-derive its layovers once, dropping
  any a stop no longer has. Live check, Singapore GP: Tented Camp via Bangkok, Nam Hai via
  Bangkok, Fukuoka via Singapore.
- **Geocoded once, at build time** (`tripsyFlyoverBuild`, 4 lookups in parallel).
  - **Lookup source:** Places `searchText` with `addressComponents` (it knows hotel names and
    airport codes) first, falling back to the weather pipeline's free Open-Meteo city
    geocoder.
  - **Labels:** Places' locality REPLACES the address-parsed label. "LAX" becomes
    "Los Angeles", and a ryokan address that parses only to its prefecture ("Oita") becomes
    its town.
  - **Names are always ENGLISH** ("Use the names of all destinations in the flyover in
    English," 2026-10-20). `tripsyFlyoverGeocode` asks Places for `languageCode: 'en'`
    (without it Fukuoka came back as 福岡市), and the Open-Meteo fallback's own name (already
    `language=en`) is used instead of being discarded. Even in English, Places keeps a
    Latin-script city's LOCAL spelling in address components (München, Wien, Roma, Köln —
    verified against the live API), so `tripsyFlyoverEnglishCityName` looks the city itself
    up (`includedType: 'locality'`, English) and takes its display name (Munich, Vienna, Rome,
    Cologne, Seville) when that city is within 60 km of the stop; otherwise, or on any
    failure, the address's name stands. Memoized per session. A build stamps every stop
    `labelLang: 'en'`; **a fly-over saved before this is re-named once** by
    `tripsyFlyoverEnglishLabels` — owner-only, behind the setup page on open (only the names
    are merged back, so anything changed meanwhile is kept), and after View has STARTED
    playback (so music still starts inside the tap). A name the owner typed (`labelEdited`)
    or a place they set by hand (`manualPlace`) is never replaced; a failed lookup stays
    unstamped and is retried next time.
    **A non-English name is never shown** ("I am still seeing this," 2026-10-21 — the
    Golden Triangle Four Seasons stop read "ตำบล เวียง": asked for English, Places still
    returned the Thai sub-district, and that name's English lookup matched a DIFFERENT Wiang
    36 km away). `tripsyFlyoverNameIsNonLatin` (anything beyond Latin + accents) gates every
    name: `tripsyFlyoverNameLevels` tries the town, district, then province in English
    (DISTRICT first when the town came back non-Latin — a sub-district's namesakes are near;
    km bounds 60/120/250), takes the first Latin answer, trimmed by
    `tripsyFlyoverTidyPlaceName` ("Chiang Saen District" → "Chiang Saen"); a build blanks a
    label still non-Latin; and `tripsyFlyoverStopNeedsEnglishName` re-checks stops already
    stamped `labelLang:'en'` that still read non-Latin (never an owner-typed name), so the
    saved Singapore GP fly-over heals on its next open. Live check: the camp → "Chiang Saen";
    Mandarin Oriental → Singapore, Bayerischer Hof → Munich, Ritz-Carlton → Fukuoka.
  - **Merging:** consecutive stays in one city (same label, or under
    `TRIPSY_FLYOVER_MERGE_KM` apart) merge AFTER geocoding (`tripsyFlyoverMergeNearby`).
    The origin and return are never merged into a stay.
  - **Unplaced stops ASK the owner** ("For locations such as burning man that do not have a
    location, have the map ask user for the location name manually," 2026-10-20). A trip with
    nothing placeable at all (no lodging, no usable flight arrival, no `location`) derives a
    `needsPlace` placeholder stay (`id: 'location'`), and the build's `askPlace` option
    (`tripsyFlyoverAskPlace`, one dialog at a time, in trip order) is asked about it and about
    any stop the geocoder couldn't find. **Find** geocodes the typed text and uses the first
    match under the typed name. No match keeps the dialog open asking for another name.
    **Show nothing** marks the stop `removed` + `placeSkipped`. The typed place is remembered
    on the stop (`manualPlace`), so a rebuild reuses it, and a skipped stop stays removed, so a
    rebuild asks neither question again. A stop left unplaced (no `askPlace`, or one restored
    after Show nothing) shows a ⚠️ with a **📍 Set location** button opening the same dialog,
    and playback skips it.
- **Saved in `driveData.tripsyFlyovers`.** There is one record per trip,
  `{tripKey, builtAt, stops:[{id, kind, label, autoLabel, labelEdited, removed, lat, lng,
  mode, names, start, end, photos:[{driveFileId}]}]}`, managed by `Store.getTripsyFlyover`
  and `saveTripsyFlyover`. The prune rule drops a record when its trip is gone.
  - **Every change is effective the moment it's made** ("When a user saves a change from a
    slideshow options page, make that change effective immediately," 2026-10-21): the setup
    page's `save()` STAGES the record in `driveData` synchronously
    (`Store.stageTripsyFlyover`) and only the Drive write (`Store.persistTripsyFlyovers`)
    waits in the save chain. It used to queue the whole `saveTripsyFlyover` call, so the
    in-memory record lagged behind earlier writes and View from the ⚙️ menu could play the
    old slideshow.
  - **Background lookups merge FIELDS, never whole snapshots** (same day: "the flyover is not
    playing the music when the video plays, although I selected that" — the live record's
    video had no `audio`). View on an older fly-over starts the layover and English-name
    lookups from the record AS TAPPED, and they finished seconds later by saving that whole
    copy, so any change made meanwhile (a video's sound picked in the page dialog) was written
    back over. `tripsyFlyoverMergeLookups` / `tripsyFlyoverMergeLookupFields` (pure) copy only
    the lookup's own fields (`via`/`label`/`autoLabel`/`airport` + `layoversAt`/`layoversV`;
    `label`/`autoLabel`/`labelLang`) stop by stop onto `Store.getTripsyFlyover` as it is THEN,
    never over a typed name. A video added before the sound choice existed (07:53 that day)
    also has no `audio` and plays its own sound until one is picked.
  - **Rebuild destinations** re-derives the stops through `tripsyFlyoverCarryOver`, matching
    by stop id and then by kind + city. Photos, a renamed label and a REMOVED stop all
    survive; a rebuild never resurrects a stop the owner removed.
  - **Photos:** the owner's own (`tripsyPickImageFile`, resized to 1600px) or Places
    suggestions for the city and its hotels (`tripsyFlyoverSuggestedPhotos`). They are
    uploaded as `flyover-photo-*` Drive files.
  - **Each visited destination STARTS with the itinerary's photo for its first event** ("For
    each location visited, start with one picture that is taken from the first itinerary
    event for that location. (But allow user to delete or change later)," 2026-10-20).
    `tripsyFlyoverItineraryPhotoFor` walks the hosting/activity events from the stay's start
    (the hotel check-in) up to the next stop's start, in time order, and takes the first one
    with a photo in `driveData.tripsyPlacePhotoCache`, skipping `skipped` entries. The match
    is on the key's `name|address|` PREFIX, because the itinerary keys photos by the CARD's
    title and hint ("<hotel> check-in"), which the raw event doesn't carry. It reuses that
    Drive file outright, with no upload; removing it from the fly-over never deletes the file,
    which the itinerary still uses. `tripsyFlyoverSeedItineraryPhotos` runs owner-only on
    every setup open and after each build. It stamps `autoPhotoSeeded` (carried across
    rebuilds), so a deleted photo is never re-added and a stay is offered exactly once; a stay
    with nothing in the itinerary yet stays unseeded and is retried next open. The departure
    and home airports get no itinerary photo, **except LAX** ("For trips that have lax as a
    destination, select the default picture for lax for the fly-over," 2026-10-20): an
    origin/return stop that `tripsyFlyoverStopIsLax` recognizes (LAX / "Los Angeles
    International" in its query or label, or geocoded within 4 km of LAX) is seeded, once and
    only when visited, with the Theme Building photo every P/S card already uses
    (`PS_RESERVATION_PHOTO_B64`). It has no Drive file, so it is stored under the sentinel id
    `TRIPSY_FLYOVER_LAX_PHOTO_ID` (`'builtin:lax'`), which `tripsyPlacePhotoDisplayUrl`
    resolves to the embedded image. Every fly-over surface draws photos through that function. Live check on the Singapore GP data
    (2026-10-20): every visited stay found its hotel's photo.
- **The player** is a full-screen `#tripsy-flyover-player` at z 2147483090, below
  `tripsyConfirmDialog`.
  - **Map:** Leaflet 1.9.4 loads on demand from cdnjs (`tripsyFlyoverLoadLeaflet`, a
    memoized promise that is cleared on failure so a retry works).
  - **Sharpness: whole zoom levels, and the tiles land before photos cover them** ("The maps
    are very pixelated when you zoom in," 2026-10-21). The player uses `zoomSnap: 1` (a
    fractional zoom stretches every tile), and `arrive` waits up to 1.5 s for the tile layer's
    `load` (`untilTilesLoaded`, tracking the CURRENT layer through `layeradd`, since the
    fallback can swap it) before the slideshow. **Not `detectRetina`**: tried the same day, it
    fetched tiles a level deeper than shown, and Esri's gaps at those levels left the map
    partly blank ("they do appear to be missing some data") — don't re-add it. Neither keyless
    source has @2x tiles, so a 2x screen still shows 1x tiles.
  - **Each destination is NAMED beside its dot** (same day: "create a label like you do for
    Bangkok that sits next to the dot and gets bigger … delete that label as soon as the map
    zooms back out"): `showDestLabel` adds a `.tfo-via-label.tfo-dest-label` marker as the
    flyTo starts, right of the dot, and `.tfo-grow` scales it over the 1.4 s zoom (since
    "make the labels with the origin and destination larger when they appear," same day: 20px as
    it appears, 1 → 1.5 on arrival; `TRIPSY_FLYOVER_DEST_LABEL_SCALE` mirrors the CSS scales so
    `arrivalCenter` frames the grown name — keep the two in step). `clearDestLabel` removes it before the next leg's `flyToBounds`, before the closing
    whole-route map, and on Replay. **Revised the same day** ("Place the city labels on the map
    before the map zooms out for the leg traveling to that city … Sometimes the labels are not
    being deleted (Singapore and Bangkok)"): the label goes up at the START of the leg to that
    city, before its `flyToBounds` (small, 0.75), and `growDestLabel` scales it only on the
    arrival zoom; the zoom is centred by `arrivalCenter` so the dot AND the grown label are
    both in view. Layover labels were pushed into `layers` and so stayed on the map all show
    long (the "Singapore/Bangkok" leftovers) — they now live in `viaLabels`, cleared with the
    destination label at every leg start and before the closing map (layover DOTS stay as
    the trail). **The dot bursts into the photos** (same request: "allow the dot to entirely
    fill the screen. When the entire screen is orange, transition to the first page"): on an
    arrival WITH photos, `burstFromDot` adds a `.tfo-burst` circle at the dot's screen point
    (dot colour `#E04B3A`, z 998 above the veil, below the photo layer) that scales over
    0.9 s until it covers the screen; the veil goes up instantly underneath, the slideshow's
    first page (photo or video) comes in over the orange, and `clearBurst` fades it out once
    that page is in (also on `endSlideshow` and Replay). The pause rule freezes it. Arrivals
    without photos, the opening first-destination slideshow and the closing one get no
    burst. Verified in Chromium at 390×844: full orange, page in over it, label on screen.
    **Superseded 2026-10-22** ("I want the orange dot to expand at a constant rate, starting
    when the map zooms" — riding the zoom at dot size and THEN easing out over 0.9 s read as two
    speeds): `startBurst` (replacing `burstFromDot`) begins as the arrival `flyTo` begins and
    is driven per frame — pause-aware clock, re-centred on the dot's live screen point while
    the map moves, diameter LINEAR from 14 px to past the farthest corner over
    `TRIPSY_FLYOVER_BURST_MS` (2400; the zoom is 1.4 s of it). No CSS transition on
    `.tfo-burst` (it would smooth the per-frame steps into a second rate). `firstPageLoads`
    runs alongside; if no photo loads, the orange fades back to the map. Measured in Chromium:
    ~55 px per 80 ms from first zoom frame to full cover.
    **Superseded again, same day** ("Don't zoom the destination dots separately from the map.
    Zoom everything together until the entire screen is black"): the burst has NO clock of its
    own. An arrival WITH photos flies straight to the dot (`L.latLng(s.lat, s.lng)`, not
    `arrivalCenter`) over `TRIPSY_FLYOVER_BURST_MS`, to `burstZoomFor(s, z0)` = enough whole
    levels past the starting zoom that a 14 px dot scaled with the map covers the screen
    (capped at the map's max zoom). Each frame `startBurst(r, s, z0)` sets the disc to
    `14 × 2^(liveZoom − z0)` (capped at full cover), so dot and map are one zoom; if max zoom
    falls short, `settle()` (called once the zoom ends) finishes the remainder over 0.4 s.
    Arrivals without photos keep the old 1.4 s zoom to level 10/9 framing dot + name. Measured
    in Chromium: disc width ÷ map scale held at 0.033 ± 0.001 on every frame until black.
    **Two device fixes, same day** ("The flyover does not transition from a full orange screen
    to the first photo page - it instead shows a zoomed-out map first … sometimes when the
    plane glyph flies between 2 destinations it oscillates left and right"): **(1)** the
    burst grows by a plain `transition` on an inline `transform` set after a reflow — the
    first cut used `scale(var(--tfo-burst-scale))` inside `@keyframes`, which not every iOS
    WebKit resolves, so the dot never grew; don't move it back into keyframes. And the map is
    forced to its FINAL view before anything runs on it: after the arrival `flyTo`, a zoom
    still off target (a stray early `moveend`, or the time cap on a slow device) is finished
    with `map.stop()` + `setView(…, {animate:false})`; after a leg's `flyToBounds`, the same
    with `fitBounds(…, {animate:false})` when `getBoundsZoom` disagrees — a vehicle placed
    during a zoom animation jumps about. **(2)** the vehicle's heading came from
    `latLngToLayerPoint`, which ROUNDS to whole pixels, between neighbouring path points — on
    a short or zoomed-out leg those round to angles that flip back and forth. It now uses
    unrounded `map.project` from the vehicle to a point 4 steps ahead, eases the plane's
    rotation toward it (20%/frame, wrap-aware), and flips a ground glyph only on a clear
    (>3 px) sideways move. Sampled in Chromium: 173 frames of a leg with zero direction
    reversals.
    **Still reported on the iPad after that** ("The entire screen does go to orange, but then
    the app immediately shows the zoomed out map with the orange dot and zooms in on the dot
    a second time," same day — not reproducible in Chromium, even with the live stop layout).
    Two defenses: **(1)** the player map is `zoomAnimation: false`. Every move is a
    flyTo/flyToBounds (their own frame animation) or a deliberate instant jump, and Leaflet's
    separate CSS zoom animation — started by `map.stop()` (which re-zooms to a whole level) or
    a plain setView — ends ~250 ms later by moving the map back to ITS target, undoing the
    forced arrival view. **(2)** `firstPageLoads` gates the burst: the orange only goes up once
    one of the stop's photos has loaded (≤ 8 s), so a failed download can never turn the screen
    orange and then straight back to the map; a stop with none loading just lands with its card.
    **The first leg is never zoomed** ("for the first leg do not zoom. Start with the unzoomed
    map with labels for origin and destination and then animate the flyover," same day): the
    opening whole-route map carries the origin's dot and both names during the title card, the
    origin is no longer zoomed into, and leg 1 is flown on that view (later legs are framed as
    before; a one-destination trip still lands on it). Names sit to the right of their dots, so
    one at the map's edge is slid into view with `panBy` at the same zoom (asymmetric fitBounds
    padding cost a whole zoom level under `zoomSnap: 1`).
    **Every leg does that now, and names both ends** ("Some of the map destination labels are
    not appearing when the map showing the leg to that destination first appears," 2026-10-22):
    the slide is `keepLabelsInView(labelMarkers, dotStops)`, run on the opening map AND after
    each later leg's framing (`fromLabel` + `destLabel`, the leg's dots incl. layovers bounding
    how far left it may go) — later legs are framed tightly, so an eastern destination's name
    (Fukuoka, the return to Los Angeles) ran past the right edge on an iPad-width screen. Each
    later leg also labels the city being LEFT (pushed into `viaLabels`, so it is cleared with
    them at the next leg). Verified in Chromium at 820 px: both names inside on every leg.
    And both DOTS are guaranteed there too ("Make sure that when the first appears in
    zoomed-out mode for each leg both the origin and destination are marked with orange dots
    and labeled," same day): `ensureDot(a)` + `ensureDot(b)` run with the two names, before
    the leg is framed (a's dot normally exists from its arrival; this makes it explicit).
    **The screen recording found the real cause** (same day, 17 s from the iPad: zoomed out
    → giant "Malaysia" and thick red dashes → a screen-filling red circle WITH the dot's white
    ring → the normal-zoom map with a small dot → the burst → the photos): Leaflet draws the
    dots and route lines (SVG, `overlayPane`) once per settled view and CSS-SCALES them during
    a zoom, so the eight-level arrival zoom blew the 7-px dot up ~256× (the pane measured
    1,416 → 362,387 px wide in Chromium), and it snapped back to size when the zoom ended —
    the "orange, then the zoomed-out map, then zooming in again" was that, not the burst.
    The first fix hid the overlay pane for the zoom in, which made the dot arrive AFTER the map
    ("I want the map and orange dot to zoom together," same day), so the player now listens to
    the map's `zoom` event (`redrawPathsAtZoom`) and on every frame re-projects and redraws
    every path in `layers` (`renderer._update()`, then each path's `_project()`/`_update()` —
    Leaflet 1.9.4 internals, pinned): the dot rides the map at its own 7 px beside its name and
    the route stays a thin line. Verified in Chromium by sampling the arrival every 80 ms: the
    Singapore dot stays 14 px wide and 12 px left of its label throughout. The two earlier
    defenses stay. **On the iPad the dot STILL trailed the map** ("The map still zooms first
    before the dot," same day), so the DOTS are no longer SVG at all: destination (14 px) and
    layover (10 px) dots are `L.marker`s with a `.tfo-dot` divIcon (`dotIcon(size)`), which
    Leaflet repositions on every zoom frame exactly like the name labels that were already
    keeping up. `redrawPathsAtZoom` now only matters for the route lines. Don't go back to
    `circleMarker` for anything that must move with the zoom.
    **Dots are BLACK, and every name on the map is ONE size** ("Make the location dots black
    instead of orange and make all location labels on the map the same size font," 2026-10-22):
    `.tfo-dot` is `#111` with its white ring, and the arrival burst (`.tfo-burst`, "the dot
    filling the screen") is the same black; the route trails stay orange. Origin, destination
    and layover names all use `.tfo-via-label span`'s 20px and no longer grow on arrival
    (`.tfo-grow` scales 1, `TRIPSY_FLYOVER_DEST_LABEL_SCALE` is `{start: 1, grown: 1}` — the
    grow wiring stays, inert, so `arrivalCenter` needs no change). Earlier notes in this section
    that say "orange dot", "20 → 30px" or "1 → 1.5" describe the behaviour before this.
    **Layover names match too** ("The label for Bangkok on the return flight … is not in the
    same format as other labels," same day): a layover's name tag now carries
    `tfo-dest-label` like every other, so it sits to the RIGHT of its dot instead of centred
    above it. **And a layover's DOT is the same 14 px as every stop's** ("Make dots the same
    size," same day — it was 10 px, `dotIcon(10)`).
    **The burst keeps the dot's white ring and stays SHARP** ("put a white border around them
    that will grow with them and will keep high resolution until the border disappears when
    the screen becomes completely black," same day): `startBurst` no longer CSS-scales a 14 px
    element (which blurred its edge) — each frame sets the real `width`/`height`/`margin` and a
    `border-width` of d/7 (the dot's own 2-of-14 ring), so the disc and ring are rendered at
    full resolution. The end size `(far + 4) × 14/5` puts the ring's INNER edge past the
    farthest corner, so the ring leaves the screen exactly as it goes all black.
    **The ring stops growing at the photos' border thickness** ("have it stop when it reaches
    the thickness of the border around the photos," same day): `border-width` is
    `min(d/7, TRIPSY_FLYOVER_BURST_RING_MAX)`, the constant mirroring `.tfo-photo img`'s 4px
    white border (a test pins the two equal), and the end size is `2 × (far + 2 + ring)`.
    **Layover dots and names go up WITH the destination's, as the leg begins** ("The layover
    labels should appear at the same time as the destination labels," same day):
    `showLayovers(via)` (ensureDot + a right-of-dot name, pushed into `viaLabels`) runs on the
    opening map for leg 1 and before each later leg's framing, and its names join
    `keepLabelsInView`; the flight still pauses 0.9 s at each layover, but adds nothing there.
    **A destination's dot goes up with its name** ("the destination orange dot should appear on
    the map when the map first appears," same day): the opening map shows the origin's AND the
    first destination's dots, and each later leg adds its destination's dot as the leg begins —
    one per stop through `ensureDot` (a `dotted` set, reset on Replay), so arriving never adds a
    second.
    **A city the route passes through twice has ONE dot** ("When a flight goes through the same
    city twice on a trip make sure to use the same dot on all legs," same day — the Singapore
    GP connects through Bangkok on two legs, once via BKK and once via DMK, ~30 km apart, so two
    dots). `tripsyFlyoverPlayableStops` walks every point in play order (each leg's layovers,
    then its stop) and gives a later point the FIRST visit's coordinates when the names match
    or it lies within `TRIPSY_FLYOVER_SHARED_DOT_KM` (40 — an airport vs. a downtown hotel);
    points unwrapped onto another copy of the world (≥180° of longitude apart) are never
    joined. `ensureDot` is keyed by POSITION (lat/lng to 5 places), not by the stop object, so
    a shared point gets one marker, and the route lines meet at it.
    **Sharing needs the NAMES to match** ("How come nakatsu, hita, and beppu all have the same
    location," same day — the saved coordinates were right; the player's distance-only 40 km
    rule had joined three towns 25–35 km apart onto Nakatsu's dot). The 40 km rule is for an
    airport and a hotel of ONE city, so it now applies only when the labels match ("Bangkok" at
    BKK and DMK, the "Singapore" airport layover and the Singapore stay — airport points carry
    their city's name); differently-named points join only within
    `TRIPSY_FLYOVER_SAME_POINT_KM` (2 — the same place geocoded a street apart). Checked on the
    live record: the four Oita towns keep their own dots, Bangkok's two airports still share one.
  - **Google Map Tiles come FIRST when available** ("Add Google Map Tiles with the Places
    key," 2026-10-21 — the keyless sources have no @2x tiles, so the map looked pixelated on
    the iPad). `tripsyFlyoverGoogleTileSource` creates a Map Tiles API session (`roadmap`,
    `en-US`, `scaleFactor2x` + `highDpi`: 512px tiles covering a 256px tile's area, drawn at
    256 CSS px — real retina sharpness at the zoom shown, unlike `detectRetina`) with the
    owner's Places key from `driveData` (never in the public file), memoized per page until
    an hour before expiry. The player asks for it after the music starts, alongside Leaflet,
    waits at most 2.5 s, and plays `[Google, ...TRIPSY_FLYOVER_TILE_SOURCES]` through the
    same `tripsyFlyoverAddTiles` fallback (its `sources` arg). No key, the API not enabled
    for the key (403), offline or slow → the keyless tiles exactly as before.
    `tripsyFlyoverWireGoogleAttribution` shows Google's required copyright for the area in
    view (`/tile/v1/viewport` on `moveend`) and drops it after a fallback. **Needs "Map Tiles
    API" enabled for the Places key in Google Cloud Console** (and the key's API
    restrictions, if any, must allow it); free tier 100k tile requests/month. Verified in
    Chromium with Google stubbed (session granted → Google tiles + copyright; 403 → Esri);
    the live API is unreachable from the sandbox.
  - **The setup page's ▶ Play asks WHOLE JOURNEY OR A PART first** ("When the user selects
    play from the flyover page, present him with a numbered list of the cities visited and
    ask whether he wants to view the entire journey or allow him to select a starting and
    ending city. If he selects a start and end, only show the portion of the flyover that
    relates to those cities," 2026-10-22): `tripsyFlyoverRangeDialog(record, onPick)` lists
    the playable stops numbered in play order (departure / home / airport transfer noted,
    with dates), with **▶ Entire journey** (`onPick(null)`) or From/To drop-downs + **▶ Play
    this part** (`onPick({fromId, toId})`; a note names the cut — "3 cities, 2 legs: Beppu →
    Seoul"; the same city at both ends is refused in place). `onPick` runs synchronously in
    the button's click and opens the map-choice dialog below, whose own pick starts the
    player inside that tap (the iOS music rule still holds). The player takes `opts.range`
    through ONE `cutStops` helper, applied in both places it computes its stops (the initial
    list and the post-layover-lookup refresh): `tripsyFlyoverRangeStops(stops, fromId,
    toId)` (pure) slices inclusively, swaps a reversed pair, and lets an unknown end fall
    back to that end of the journey. A cut plays exactly like a whole journey from its first
    stop (opening slideshow, legs, closing map); "Stop N of M" counts the cut's stays.
    `flyover_test.js`.
  - **…then WHICH map** ("When the user selects play fly-over
    from the trip fly-over page, present a user dialog asking if he wants to use the free
    mapping service or the service that uses credits," 2026-10-22):
    `tripsyFlyoverMapChoiceDialog(onPick)` offers **Free map** (Esri / OpenStreetMap) or
    **Google Maps (uses credits)**; Cancel plays nothing. The pick reaches the player as
    `opts.mapService`, and `'free'` never even asks for a Google tile session. `onPick` runs
    SYNCHRONOUSLY in the button's click — never behind an await — because the player must
    start the music inside a user tap on iOS. Only that Play button asks: View Fly-Over from
    the ⚙️ menu and the per-destination previews keep the automatic Google-first behaviour.
  - **Keyless tiles** come from `TRIPSY_FLYOVER_TILE_SOURCES`: **Esri World Street Map first,
    OpenStreetMap's own tiles second**, both keyless, with attribution shown.
    - **Esri is first for its ENGLISH labels** ("Can you show the names of all locations on
      the fly-over map in English?", 2026-10-20). OpenStreetMap's tiles label every place in
      its local language and script, a pre-rendered tile's labels can't be changed by the
      app, and no keyless OpenStreetMap server renders English (the English OSM services need
      a key). OpenStreetMap stays as the fallback: local labels beat a blank map. The sandbox
      can't reach either tile host, so the English labels are the providers' documented
      behaviour, not something seen here.
    - **Never CARTO** ("I get a message saying api key required when I try to play the trip,"
      2026-10-20). Its free basemap began drawing "API key required" onto every tile. That
      arrives as a normal 200 image, so the browser cannot detect it, and it had to be
      dropped outright.
    - **Fallback:** `tripsyFlyoverAddTiles` switches to the next source after
      `TRIPSY_FLYOVER_TILE_FAIL_LIMIT` tile errors with no tile yet loaded, which is how a
      refused OpenStreetMap client answers. Once any tile has loaded it never swaps, and the
      last source is kept rather than blanking the map.
    - **Verified in Chromium** (when OSM was first) with the first source forced to 403: the
      player moved to the second and the attribution followed.
  - **Sequence:** overview of the whole route → the origin → for each leg, frame the leg,
    animate the vehicle → land with a dot, a city card and the photo slideshow
    (`TRIPSY_FLYOVER_PHOTO_MS` per photo).
    **The first destination's pictures open the show and the last's close it** ("for the
    very first destination show the picture before the map. On the last destinations, show
    the picture after the map," 2026-10-21): with photos on the first stop, the veil goes up
    INSTANTLY (transition off for one frame, so the map never flashes) and its slideshow
    plays before the overview; the map later lands there with just its card. The last stop
    lands with just its card too, then the closing whole-route map, then its slideshow, then
    "The end". `arrive(r, s, i, withPhotos)` / `slideshow(r, s)`; preview is unchanged.
  - **Route geometry:** flights follow a great circle (`tripsyFlyoverGreatCircle`). Longitudes
    are UNWRAPPED both along the path and across stops (`tripsyFlyoverUnwrap`,
    `tripsyFlyoverPlayableStops`), so LAX→SIN crosses the Pacific instead of looping back
    across the whole map.
  - **Vehicle direction:** ✈️ is rotated along the heading (+45°, since the glyph points
    up-right); ground glyphs flip when heading right.
  - **Controls:** pause/resume (space) freezes both the vehicle clock and the slideshow
    clock. Replay restarts. ✕ or Esc cancels the run and removes the map.
  - **Photo preloading:** every photo starts downloading (memoized
    `tripsyPlacePhotoDisplayUrl`) before playback begins.
  - **Each destination's photos play as PAGES, each configured on its own** ("allow users to
    configure each picture or page of pictures separately … show page 1 of photos, ask how
    many pictures to display on that page, allow users to select how many and which photos,
    and ask about the transition to the next page," 2026-10-20). `stop.pages` is
    `[{ids, count, style, transition, seconds}]` in play order: `ids` are photo
    `driveFileId`s, `count` how many the page holds (1–6, `TRIPSY_FLYOVER_PAGE_MAX`), `style`
    grid or collage for 3–4 (5–6 are always a collage, 1 is full-screen, 2 a pair —
    `tripsyFlyoverPageLayout`), `transition` how THIS page gives way to the NEXT, `seconds`
    its own time on screen (clamped 1–15). **`tripsyFlyoverPages(stop)` is the one reader**
    (player, summary, dialog): a photo no longer on the stop drops off a page, a photo can be
    on one page only, empty pages vanish, and photos on no page yet play after the pages,
    grouped by the stop's older per-destination settings (`stop.slideshow` via
    `tripsyFlyoverSlideshowConfig` — layout / transition / seconds, plus the old per-photo
    `solo` "Own page" flag, through `tripsyFlyoverPhotoGroups`/`tripsyFlyoverGroupLayout`). So a
    stop saved before pages existed plays exactly as it did. `tripsyFlyoverEnterTransitions`
    gives each page the transition it ENTERS with: the first page uses the stop's own
    (fade by default), every later page the one the page before it chose. **▶ Preview**
    plays just that destination (`playTripsyFlyover(…, {previewStopId})`: no title card,
    legs or ending). `tripsyFlyoverCarryOver` keeps `pages` and `slideshow` across Rebuild
    (it used to drop `slideshow`).
    - **Every photo shows in the SAME 4:3 frame, cropped to fill it** ("Keep all photos the
      same size on the flyover," 2026-10-21; the owner chose "same frame on every page" over
      identical-everywhere or uncropped): a one-photo page is one large frame whether the
      photo is tall or wide, and the 2–6 photos sharing a page are all equal. An
      `@supports (width: 1cqw)` block makes `.tfo-group` a size container and gives each
      layout `aspect-ratio: 4/3; object-fit: cover` with a width from container units against
      the page box (single, pair, 2×2 grid, collage; portrait variants); the older per-shape
      rules stay above it as the fallback. Videos keep their own shape. Measured in Chromium
      at 1180×820 and 820×1180 with mixed tall/wide photos: equal frames on every layout.
    - **Transitions** (`TRIPSY_FLYOVER_TRANSITIONS`): fade, slide, zoom in, slow pan & zoom
      (a Ken Burns keyframe sized to the page's time), and cut.
    - **Pages go DIRECTLY from one to the next — the map never shows between pictures**
      ("transition directly from picture to picture. Do not go to the map between pictures,"
      2026-10-20; each screen used to fade fully out, uncovering the map, before the next came
      in). `showPage` lays the next page (`.tfo-group[data-layout][data-tr]`, OPAQUE: same
      `#0b1020` as the backdrop) on top of the one showing, waits two frames, adds `.tfo-in`,
      and removes the old page only once the new one has finished coming in; the hold counts
      from `.tfo-in`, pause-aware. A full-screen `.tfo-veil` backdrop comes up with the first
      page and stays for the whole slideshow, so a collage's gaps and the photo area's margins
      never show the map either; `endSlideshow` fades the last page and the veil back to the
      map together. Pause also sets `.tfo-paused`, which freezes the pan-and-zoom animation.
      Verified in Chromium by sampling a two-page preview every 100 ms: an opaque page was on
      screen at every sample until the final fade to the map.
    - **The page-by-page dialog opens BY ITSELF after photos are added**
      (`tripsyFlyoverSlideshowDialog`), and from each card's **Slideshow options** button;
      the card shows a one-line `tripsyFlyoverSlideshowSummary` ("3 pages: 2 · 3 · 1 photos
      per page").
      - **Triggers:** an own-photos upload batch, and closing the Suggested grid after
        picking some (`tripsyFlyoverSuggestedPhotos`' third arg `onClosed(added)`).
      - **One page at a time:** "Page N of M" with a page strip to jump between pages; "How
        many pictures on page N?" (1 … min(6, photos)); Grid / Collage for 3–4; every photo
        of the stop as a tappable thumbnail (`tripsyFlyoverTogglePagePhoto`: on this page →
        off; on another page → moved here, if this page has room; numbered in play order,
        badged with its page otherwise); "Transition to page N+1" (the last page says it
        fades back to the map instead); time on screen; ◀ previous / Next page ▶ (past the
        last page it adds one, starting with the next photo on no page); Delete page.
        Lowering a page's count takes the extra photos off it. A count above what's chosen is
        allowed; the page plays what it has.
      - **Opening:** existing pages are edited as saved (`tripsyFlyoverDialogPages`; a stop
        with no saved pages starts from the old grouping). Photos on no page yet (just added)
        get a new page at the end, which the dialog opens on; any still on no page at Save
        play after the last page, one per page, and the dialog says so.
      - **Preview** plays the unsaved draft; Save writes `pages` (empty ones dropped) +
        `photos` onto that one stop; Cancel changes nothing.
      - **The buttons are a pinned footer** (`.tfo-ss-footer`, sticky to the box's bottom,
        opaque): "When I edit pages on a flyover, there is no way to save the changes"
        (2026-10-21). The box is taller than a phone or a landscape iPad, so Save sat below the
        fold, reachable only by scrolling inside the box (measured: 120 px below a 700 px
        screen). The box's height also uses `dvh`, so Safari's toolbars can't push the footer
        off the screen.
      - **Pages reorder by DRAGGING their chips in the strip** ("On the slideshow view, allow
        the user to reorder the pages by dragging them," 2026-10-21). Each chip now shows its
        page's first photo; a hint under the strip says to drag. Pointer events, not HTML5
        drag-and-drop (unreliable with a finger on iPad): `touch-action:none` on the chips, a
        6 px threshold before a drag starts, the chip follows the pointer, the drop spot is
        the chip whose centre is nearest (`tripsyFlyoverNearestRect`, captured rects, so a
        wrapped second row works), release runs `tripsyFlyoverMovePage(pages, from, to, cur)`
        (pure; the page being edited follows its page; each page keeps its own settings incl.
        the transition it leaves by), and a 400 ms `suppressGotoUntil` stops the release
        counting as a tap. Nothing saves until Save, as before. Verified in Chromium with a
        mouse and with CDP touch events.
      - **Photos in the GRID drag too: drop one on another to SWAP them** ("I cannot click and
        drag pictures," same day — the owner reached for the grid, not the strip). Both rows
        share one `wireDrag(items, onDrop, {holdMs})`; the grid's drop runs
        `tripsyFlyoverSwapPhotos` (pure: swaps their pages AND their grid places; a photo on no
        page hands that to the other; a video only swaps with a photo alone on its page, else a
        toast). The grid is the box's scrolling surface, so a FINGER must press-and-hold
        280 ms first (`touch-action: manipulation`; a non-passive `touchmove` is cancelled
        once held) — a quick swipe still scrolls; a mouse drags at once; tap still toggles a
        photo on/off the page. Verified in Chromium: mouse and hold-then-drag swap, a quick
        swipe doesn't.
      - **…or drop at a photo's EDGE to move its page IN BETWEEN** ("Allow photo pages to also
        be moved in between other pages not just swapped," same day). `wireDrag`'s `zones`
        option (grid only) splits each target with `tripsyFlyoverDropSide`: outer 30% either
        side (and the gap beside it) = `before`/`after`, drawn as NOTHING BUT a
        vertical dashed line in that gap (`.tfo-ss-ins-before`/`-after`, raised above the
        dragged tile; "just show a vertical dashed line between the pages," same day — the
        page strip, which always moves, shows the same line on the side the page lands), middle = swap
        (a dashed outline round the target).
        `tripsyFlyoverInsertPhotoPage` (pure) moves the photo's PAGE next to the target's page;
        a photo sharing its page leaves it for a new page of its own there (keeping that
        page's transition/time); two photos on one page just change places; a photo on no page
        gets a new page; dropping beside a photo on no page does nothing (toast). The page
        being edited follows its page, and the grid re-lists in the new play order.
      - **Photos are listed in PLAY order everywhere** ("Always show pages in the flyover edit
        view in the order of the pages … show them in the new order I selected," 2026-10-21):
        `tripsyFlyoverPhotosInPageOrder(stop)` (pure; page 1's photos first, each with its
        page number) drives the setup card's thumbnails (drawn exactly like the page dialog's grid — framed
        84×64 tile, "Page N" badge top-left, per "show the photos in the same way they display
        on the slideshow options page," same day; ✕ removes by
        `driveFileId`, since screen order is no longer storage order) and the dialog's grid at
        open, and Save rewrites `stop.photos` in that order so every list agrees.
      - **Save also sits at the TOP, beside the ✕** ("The save button for changes to the
        flyover should be next to the close window button on the top of the window. There
        should also be cancel and save buttons at the bottom," same day): `data-ss-save-top`
        in the header, a green ✓ box in the ✕'s own style (`.tripsy-close-x.tripsy-save-check`
        — "a green check box in the same style as the cancel button"); every `[data-ss-save]`
        is wired, so top and bottom Save do the same.
- **✏️ Edit destinations — a draft list to rename, reorder, add, remove or REBUILD, applied on
  Save only** ("instead of just an option to rebuild the destinations, make the button 'edit
  destinations' and then display a list of destinations that the user can edit. Also give an
  option to 'Rebuild Destinations' which would cause the app to automatically re-generate the
  list of destinations, but again allow the user to fully edit before confirming," 2026-10-22).
  The setup page's "↻ Rebuild destinations" button (which rebuilt AND saved in one go) is now
  "✏️ Edit destinations" (`data-flyover-edit-dests`), opening `tripsyFlyoverEditDestinationsDialog
  (trip, record, {rebuild})` (own overlay `tripsy-flyover-edit-overlay`, z `2147483060` — below
  the place/mode dialogs it opens at 2147483070+) on a COPY of the record: per row a transport
  drop-down (the first stop keeps its 📍), the name, dates, ↑ ↓ (`tripsyFlyoverMoveStop`, pure),
  Remove/Restore, 📍 Set/Change location (`tripsyFlyoverAskPlace`), plus **＋ Add destination**
  (`tripsyFlyoverManualStop`, pure: a hand-placed, hand-named, undated stay reached by car with
  `modeGuessed`, so the page's mode question asks about it; `manual: true`, `afterId` = the stop
  it was put after; it goes before a trailing return flight) and **↻ Rebuild destinations**
  (`opts.rebuild(draft)` → `tripsyFlyoverBuild(trip, draft, {})` — no `askPlace`, since the list
  is on screen to fix; an unplaced stop shows ⚠️ + Set location — then
  `tripsyFlyoverKeepManualStops` (pure) puts added destinations back after their predecessor,
  else at their old index). Cancel/✕/click-outside return null and nothing changes; Save returns
  the draft, and the page seeds itinerary photos, saves, re-renders, asks for missing modes and
  re-renders My Trips. The per-card controls on the page itself (name, mode, Remove, photos)
  are unchanged. Verified in Chromium against the harness: move, remove, add (geocode stubbed),
  rebuild (stubbed), rename, Save returns the draft with the source record untouched, Cancel
  returns null. `flyovereditdests_test.js` (its scaffold skips the parameter list before
  counting braces — an `opts = {}` default otherwise ends the extraction at once).
  **Every row has a ＋ that adds a destination right after it** ("give the user an option to
  add destinations between existing ones," 2026-10-22): `data-fe-add-after` → the dialog's
  one `addDestination(at)` (the bottom ＋ Add destination button uses it too, at the end /
  before a trailing return). The new stop is a `tripsyFlyoverManualStop` (guessed drive), so
  after Save the page's `askMissingModes` asks how it was reached.
  **Each row reads FROM → TO, both editable** ("show the origin and destination on each leg
  instead of just the destination and allow the user to modify both," 2026-10-22): the leg's
  origin is the previous SHOWN stop (`tripsyFlyoverLegFromIndex(stops, i)`, pure — a removed
  stop is skipped; the first row reads "start"), rendered as its own input (`data-fe-from`,
  carrying `data-fe-from-id`) plus a 📍 (`data-fe-from-place`, the same `tripsyFlyoverAskPlace`)
  before the destination input. There is ONE name per stop: editing a row's origin edits the
  stop above (`labelEdited`), and either edit re-renders the list so the two rows showing that
  name agree. A removed row shows both ends struck through.
- **🚕 Taxi is a fly-over transport, and AIRPORT TRANSFERS are derived as stops of their own**
  ("On the edit destinations drop-downs there is no taxi option appearing. Also … the app
  should automatically add transportation legs where there is a need, and it should present
  the user with a dialog box and drop down menu to determine the mode of transportation. For
  example, there is a walk to beppu followed by a flight from Fukuoka to Seoul. The user must
  get from beppu to Fukuoka on that day," 2026-10-22). **Taxi**: `taxi` is in
  `TRIPSY_FLYOVER_MODES` (after Drive), ranked with the car, labelled "Taxi"; its glyph entry
  is the `TRIPSY_TAXI_ICON_MARKER` sentinel, so every place a mode glyph is drawn goes through
  `tripsyFlyoverModeGlyphHtml` (the checker-cab `<img>`; the player's vehicle at 36px) or
  `tripsyFlyoverModeGlyphText` (🚕 — an `<option>` or the card label can hold no image). The
  cab faces RIGHT, unlike the emoji, so the vehicle's flip rule is inverted for it
  (`(dx > 0) !== facesRight`). A `taxi`/`cab` category derives as `taxi`
  (`tripsyFlyoverModeOf`, before the car rule). **Transfers**: `tripsyFlyoverDeriveStops`
  stamps each stay with `city` (`tripsyVerifyLodgingCity` — the Verify page's town rule,
  so Beppu, not Oita) and, for every stop reached by flights, compares the FIRST flight's
  departure airport city (`tripsyFlyoverAirportCity`) with the previous stop's city, and the
  LAST flight's arrival city with the stay's own. A mismatch plants a `kind: 'transit'` stop
  — the airport, named for its city, `photos: []`, id `transit-dep-<flightId>` /
  `transit-arr-<flightId>` — before the flight stop: on the departure side it is reached by
  the ground leg on the trip before that flight (its real mode, no question), else by a
  guessed drive (`modeGuessed`, so `askMissingModes` asks "How did you get there? … from
  Beppu to Fukuoka"); on the arrival side the flight (and its `via` layovers) lands at the
  transit stop and the STAY is reached by the ground leg after the flight, else a guessed
  one. **Lenient by design** (`sameCity`): an unknown bare code or a stay with no city never
  plants one; an airport city named anywhere in the stay's name/address counts as the same
  city (a hotel whose address parses to "OR"); only when NO flight into the stop touches the
  right city is a transfer planted (a stray same-day leg in old data must not invent one);
  a "flight in" landing back in the ORIGIN's city is the mis-filed flight home, never a
  transfer; the `location` placeholder gets none. Checked on the live data: Beppu →
  [Fukuoka] → Seoul appears, with the ride asked; FUK for the Ritz-Carlton Fukuoka, ICN for
  the Andaz Seoul, and DAD for a Da Nang-addressed hotel need none; Telluride gets Montrose
  both ways. The player passes a transit stop through like a layover (leg drawn in its mode,
  0.9 s pause, no card, no photos, not counted in "Stop N of M" — `stopSub` counts stays);
  the setup page shows it as a dashed "airport transfer — passed through, no photos" card
  with the leg drop-down, Remove and Set location; Edit destinations lists it with an
  "airport transfer" tag; `tripsyFlyoverIsAirportStop` includes it, so it is named by city;
  carry-over/merge need nothing (matched by id, never merged into a stay). **The mode
  question is a drop-down now** (`tripsyFlyoverAskMode`: a `<select data-mode-select>` over
  `TRIPSY_FLYOVER_MODES` + "Use this" / "Not now"; it was a grid of buttons). **A saved
  fly-over gets its transfers once** (`transitV`, `TRIPSY_FLYOVER_TRANSIT_V` = 1, stamped by
  every build): `tripsyFlyoverAddTransitStops` (behind the setup page, like the layover
  retrofit) runs the pure `tripsyFlyoverInsertTransitStops(recordStops, derivedStops)` — each
  derived transit goes in directly before the record stop whose id FOLLOWS it in the
  derivation (unknown following id → skipped), that stop takes the derived mode/layovers
  unless `modeManual`, the new stops are geocoded, and the result is merged onto the record as
  it is THEN by re-running the insert (never over a changed stop); then `askMissingModes`.
  Verified in Chromium: both questions asked with the drop-down, the ＋ on a row inserts
  after it, the cab drives Beppu → Fukuoka facing the way it moves, the transfer shows no
  stop card. `flyover_test.js`.
- **The setup page has explicit Save buttons** ("There should be save buttons on the flyover
  page," 2026-10-21): a green ✓ beside the ✕ at the top and Close / Save in a pinned
  `.tfo-ss-footer` (owner-only). **The footer pair LOOKS like the header pair** ("The cancel and save
  buttons on the top and bottom of the flyover screen should be consistent," 2026-10-22): the
  bottom buttons are the same red ✕ / green ✓ boxes widened to carry their word
  (`.tripsy-close-x--wide`, glyph in `.tripsy-close-x-glyph`) — "✕ Close / ✓ Save" on the setup
  page (every change is already saved, so ✕ only closes), "✕ Cancel / ✓ Save" on the Edit
  destinations and Slideshow options dialogs (where ✕ discards the draft); the top ✕ carries the
  same word as its footer twin in its title. Every change still saves as it is made; Save blurs a name
  still being typed (its `change` saves it), waits for the save chain (`save()` now resolves
  Drive's ok), toasts "Fly-over saved." and closes — a failed save keeps the page open.
- **Music: one soundtrack per fly-over, chosen by genre** ("try to find different music that
  could be used of different genres and offer that to the user," same day).
  - **Data:** `record.music` is `{source:'archive', url, title, artist, license, page}` or
    `{source:'drive', driveFileId, title}`. A rebuild keeps it.
  - **Picker:** `tripsyFlyoverMusicPicker` offers genres in two labelled rows
    (`TRIPSY_FLYOVER_MUSIC_GENRES`, each tagged `group`, rows from
    `TRIPSY_FLYOVER_MUSIC_GROUPS`): **Styles** (cinematic, acoustic, jazz, classical,
    electronic, ambient, upbeat) and **Regions** — 28 of them ("can you try to find regional
    options as well," then "try to find more regional options," 2026-10-20; they replaced the
    old catch-all "World"): West / East & Southern / North African, Arabic, Persian & Turkish,
    Indian, Chinese, Japanese, Korean, Southeast Asian, Hawaiian & Pacific, Australian,
    Brazilian, Andean, Mexican, Cuban & Salsa, Tango, Caribbean, Spanish & Flamenco,
    Portuguese & Fado, Italian, French, Greek, Balkan & Eastern European, Russian, Nordic,
    Celtic, American Roots. A region is just its own set of archive subject words, so adding
    one is one array entry.
  - **Spoken word is never offered** ("Exclude lessons about learning a language," same day —
    a regional search turned up language courses). The search query adds `AND NOT subject:(…)
    AND NOT title:(…)` over `TRIPSY_FLYOVER_MUSIC_SPOKEN_WORDS` (lesson, language, learn,
    course, pronunciation, audiobook, podcast, lecture, interview, poetry …), and because tags
    are often incomplete, `tripsyFlyoverSearchMusic` re-checks every result with
    `tripsyFlyoverMusicLooksSpoken` (whole words only, so "Talking Drums" survives) on the
    item's title and subjects, the picked track's title, and the item DESCRIPTION — the last
    against the phrase-only `TRIPSY_FLYOVER_MUSIC_SPOKEN_PHRASES` ("language course", "learn to
    speak" …), since prose like "of course" or "a musical language" must not drop a song. It
    asks for 30 results and checks up to 12 so the filtering still leaves a list. Each runs a keyless **Internet Archive** search
    (`tripsyFlyoverMusicSearchUrl`: audio in the netlabels / opensource_audio collections,
    the genre's subject terms, Creative Commons `licenseurl` only, most downloaded first).
    That is followed by the item metadata API, where `tripsyFlyoverPickArchiveTrack` picks
    one MP3, preferring 1–10 minutes over a jingle or a two-hour mix, with title, artist,
    license (`tripsyFlyoverLicenseLabel`, e.g. "CC BY-SA") and a source link.
  - **Preview before choosing** ("Add a preview button to the music so the user can hear it
    before selecting," same day): every track has a labelled **▶ Preview** button (■ Stop while
    playing) beside **Use**, and the song already chosen has one too. A preview plays
    `TRIPSY_FLYOVER_MUSIC_PREVIEW_SECONDS` (30) from a little way in
    (`tripsyFlyoverMusicPreviewStart`: a quarter of the way, at most 45 s, never so late it runs
    past the end; a short song plays from the top), counts down in the status line and stops by
    itself; one at a time. The countdown counts time actually PLAYED, not the playback position
    — found testing: a server that can't seek plays from the top, and a position-based count
    then never reached zero and never stopped. **＋ Use my own song**
    uploads an audio file (capped at `TRIPSY_FLYOVER_MUSIC_MAX_BYTES`, 25 MB) to Drive.
    **No music** clears it.
  - **Playback starts BEFORE the player's first `await`**, inside the Play tap, because iOS
    only lets audio begin there. An archive URL is ready at once.
    - **Own songs** are pre-downloaded into `tripsyFlyoverMusicUrlCache` when the setup page
      opens, so they are usually ready too.
    - **If music still can't start**, it shows 🔇 on the top bar's music button, and a tap
      plays it. That button also mutes.
    - **Pause, close and the ending:** pause pauses the music, Replay restarts it, close
      stops it, and it fades out under "The end".
  - **Verified in Chromium with the archive.org answers STUBBED.** The sandbox can't reach
    archive.org, so whether its search and metadata endpoints answer the app's origin
    (CORS) is the one unverified piece; a failure shows "Couldn't reach the music library",
    and an own song always works.
- **Videos, music fades and Shared Albums** ("add the ability to add videos to the flyover.
  When videos play, cut the music and play sound from the video. Music should fade in and
  out. Also … add photos from shared albums," 2026-10-21; the albums meant are Apple iCloud
  Shared Albums).
  - **Adding:** the card's **＋ Photos & videos** calls `tripsyFlyoverPickMedia`, which clicks
    ONE hidden `accept="image/*,video/*" multiple` input with NO `capture`, synchronously
    inside the tap — so iOS opens its own sheet (Photo Library / Take Photo or Video) straight
    away, and the Photo Library's Albums / Collections list holds Shared Albums (a web page
    can't read a Shared Album itself, so the system picker is the only way in). There is NO
    in-app menu in front of it: the first cut had one (Library / Camera buttons), which put a
    redundant step before the iOS sheet that already offers both ("This is inefficient,"
    2026-10-21) — the garment photo button's lesson; don't re-add it. Not verified on a device
    from here: if Shared Albums ever don't show, saving the items to the library first works.
  - **A video is a stop "photo" record** `{driveFileId, kind:'video', mime, posterId,
    duration, width, height}`, so pages, carry-over and preloading need nothing new.
    `tripsyFlyoverUploadVideo` refuses files over `TRIPSY_FLYOVER_VIDEO_MAX_BYTES` (250 MB,
    with a "trim it in Photos" message), grabs a poster frame + length with
    `tripsyFlyoverVideoInfo` (fail-soft: no poster → a 🎬 badge only), uploads through the new
    **`uploadBlobToDriveResumable`** (8 MB pieces, `Content-Range`, 308 = continue, progress %
    in the status line; the multipart path base64s the whole file into one string), and the
    poster as an ordinary small JPEG. Thumbnails everywhere go through `tripsyFlyoverThumbHtml`.
  - **A video always plays on a page of its own**: `tripsyFlyoverPhotoGroups` and
    `tripsyFlyoverPages` split one out (in place) even from a saved page, as a `video:true`,
    `layout:'video'` page; the dialog's toggle (`tripsyFlyoverTogglePagePhoto`'s `isVideo`
    arg) puts a video only on an EMPTY page and nothing onto a video page (`ownPage`), and a
    video page shows a note instead of count / style / time — it plays to its END.
  - **Player:** `showVideoPage` lays the video page over the last one like any page, fades the
    music out (`duckMusic`) while it comes in, then plays the video UNMUTED; if the browser
    refuses an unmuted start it plays muted with a **🔊 Tap for sound** button. Pause/Replay
    reach it (`curVideo`); at its end the music fades back in (`unduckMusic`) as the next page
    crossfades in.
  - **Each video chooses its SOUND: its own, or the fly-over music** ("When the user selects
    a video, ask the user if he wants to use audio from the video or the flyover music. Also,
    add an option for the user to hear the music from the video," 2026-10-21). Every video
    picked opens `tripsyFlyoverVideoAudioDialog` BEFORE its upload (on a local object URL of the
    picked file): the video itself with controls and a **▶ Hear the video** button (unmuted),
    then 🔊 *Use the video's sound* / 🎵 *Keep the fly-over music*; the answer rides the record
    as `audio: 'video'|'music'` (dismissed → video). `tripsyFlyoverVideoAudio(rec)` is the one
    reader and treats a record without `audio` as `'video'`, so older videos keep their sound.
    The page dialog's video note shows the current sound with the same two chips plus ▶ Hear the
    video (the dialog again, from the stored video), saved with Save; thumbnails badge 🔊/🎵.
    In the player a `'music'` video plays MUTED with no duck/unduck and no tap-for-sound.
    Verified in Chromium: the preview played unmuted; a music video ran muted while the music
    held at 0.7 throughout.
  - **Fades: `tripsyFlyoverMusicFader`**. Music fades in at the start/Replay, out before and
    back in after each video, and out under "The end" — by ramping the element's volume,
    which desktop browsers allow. iOS keeps an element's volume fixed at 1, so on the iPad
    there are NO fades: the music simply plays, a video with its own sound pauses it and it
    resumes after. **Not Web Audio**: the first cut routed a downloaded copy of the song
    (archive songs were fetched into a blob for it) through a Web Audio gain node so iOS could
    fade too, and the iPad went silent ("not playing music now," 2026-10-21) — both the route
    and the archive download were removed; found songs stream from their own address again.
    Don't re-add it without testing on the iPad.
  - Verified in Chromium with a generated test clip: fade-in 0→0.7 over 2 s, down to 0 before
    the video, video played unmuted to its end, music back to 0.7, next page crossfaded; the
    poster frame and the dialog's own-page rule work. `flyover_test.js`.
- **Testing:** verified in Chromium against a synthetic trip, with Leaflet served from npm
  because the sandbox can't reach cdnjs or the tile host. `flyover_test.js`.

### Home's Upcoming Trips box

An in-progress trip is listed FIRST ("the first trip listed should be any trip that is currently
active," 2026-10-18 — the box filtered on `start >= now`, so the trip you were on vanished from it
the day it began). `tripsyHomeUpcomingTrips(trips, nowMs, cutoffMs)` (pure) returns every active
trip (start ≤ now < end of its last day, `end` falling back to `start`) in start order, stamped
`_active` for the row's green "● Now" marker and tint, then the trips starting within
`HOME_UPCOMING_TRIPS_YEARS` in start order, as before; hidden trips are filtered by the caller.
`homeactivetrip_test.js`.

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
  **Must be offered from EVERY place sign-in can fail, not just the fresh-sign-in path — there are
  three, and each needed its own fix as the same "stuck on a white screen" report kept recurring.**
  (1) `initGoogleAuth()` has two branches: no remembered token → shows the sign-in gate and calls
  `maybeOfferOfflineTravelView()` directly; a remembered token → skips straight to
  `completeSignIn()` (the "cached-token fast path"), whose own network calls (`fetchSignedInUserEmail`,
  `findDriveDataFile`, ...) all fail offline and land in ITS OWN catch block — which reveals the
  sign-in gate with an error but, before the fix, never called `maybeOfferOfflineTravelView()`,
  stranding any device that has ever signed in before (i.e. almost every real device). (2) THE
  ACTUAL CULPRIT in practice, found only after (1) alone didn't resolve a real report: Google
  Identity Services is an EXTERNAL script (`accounts.google.com/gsi/client`) that simply never
  loads with no network at all — `waitForGoogleIdentity()`'s polling loop (50 tries × 100ms) times
  out and shows "Could not load Google Sign-In," but this fires BEFORE `initGoogleAuth()` or
  `completeSignIn()` ever run, so NEITHER of their fixes is ever reached. This is the FIRST thing
  that fails offline, so it's the one that matters most — a genuinely offline device usually never
  gets as far as case (1) at all.
  **(3) A WEAK signal, not just no signal, needed its own fix too** (the follow-up report: "no WiFi
  or a weak signal"): both (1) and (2) still gated on `navigator.onLine`, which only reports whether
  a network INTERFACE is active, not whether it actually works — a flaky connection reports
  `onLine: true` right up until every real request on it fails, silently suppressing the offer in
  exactly the case it was needed. `maybeOfferOfflineTravelView(force = false)` now takes a `force`
  flag: the two FAILURE-path callers ((1)'s catch, (2)'s poll-timeout) pass `force: true` and skip
  the `navigator.onLine` check entirely, since the failure that got them there is stronger evidence
  than whatever that property claims. The one PROACTIVE caller — `initGoogleAuth()`'s fresh sign-in
  gate, called before anything has been attempted — still passes no `force`, so it correctly stays
  quiet while genuinely online. The offered box's own wording follows suit: a forced call says
  "Couldn't reach the sign-in servers" rather than asserting "You're offline," since `navigator.onLine`
  may well disagree. All three still call the same idempotent function
  (`document.getElementById('signin-offline-btn')` guard), so they can never double-render the button.
  **(4) HANGS needed their own fix too — every case above fires on a call FAILING** ("when the
  internet connection is weak or fails … I don't think this is happening," 2026-08-17): on a weak
  connection a fetch can hang for a minute-plus without rejecting, so no catch ever ran and the
  splash sat on "Loading your data from Drive…" with no fallback offered. `completeSignIn` now arms
  a 12s watchdog that, if sign-in hasn't finished (`_tripsySignedInDone`) and offline wasn't
  entered, reveals the gate with an honest "Still ‹stage› — the connection looks weak…" and calls
  the forced offer while the attempt keeps running behind it. **And on a device whose saved landing
  preference is Travel View (`loadTravelViewPref()`), a FORCED offer now AUTO-OPENS the cached
  Travel View instead of rendering a button** — "the app is supposed to SHOW the last used version"
  — via the shared `enterOfflineTravelView(cached)` (the offer button uses the same entry, so the
  two can't drift; idempotent via `_tripsyOfflineEntered`). Normal-app-landing devices keep the
  explicit offer. The in-flight attempt is guarded against the race both ways: a sign-in limping to
  SUCCESS after offline was entered returns early instead of clobbering the view (`renderHome`
  writes into the same `#main`), and a late FAILURE stays silent rather than painting the gate over
  the schedule being read.

**A splash up for more than 3 seconds becomes the cached Travel View — a STAND-IN, not offline
mode** ("When the splash screen displays for more than 3 seconds, automatically switch to the
travel view displaying the cached view of the current trip or next upcoming trip if not on a
current trip," 2026-10-12). `tripsyArmSplashPreview` starts a `TRIPSY_SPLASH_PREVIEW_MS` (3000)
clock every time the splash is shown — page load (right before the GIS poll) and BOTH sign-in
callbacks that swap back to the splash; `tripsyMaybeShowSplashPreview` fires only while the
splash is still visible (a showing gate needs a tap, so no preview), sign-in is unfinished, no
offline mode is entered, and `loadTripsyOfflineTrips` has a cache (no cache → the splash just
stays). `enterSplashPreview` sets the SAME state `enterOfflineMode` does (cached trips,
`tripsyTripsAreOffline`, minimal `driveData`, `appOfflineMode` so `navigate()` can't wander into a
live-data view) but REMEMBERS the rail items it hid (`_tripsySplashPreviewHidden`), paints
`navigate('travelview')` — which already picks the current or next upcoming trip via
`tripsyTravelTripCandidates` — and the strip reads "⏳ Showing your saved schedule while the app
signs in…" rather than claiming the device is offline. **The sign-in attempt keeps running
behind it.** `completeSignIn` calls `tripsyEndSplashPreview` the moment the real data file is
loaded — nulling `tripsyDecryptedTrips` so the LIVE file is fetched, lifting `appOfflineMode`,
restoring the rail — and that is deliberately BEFORE the menu setup, Home, and above all
`runBackgroundSyncs`, whose relay drains WRITE: against still-cached trips they would save stale
data over live (the same hazard as the never-prune-against-a-cache rule). The painted view stays
until the landing navigate replaces it (no same-view short-circuit in `navigate`, so Travel
View re-renders live); a Travel-View-pref device skips the `renderHome` build, which would flash
through an already-visible `#app-root`. Failure handling: a CONNECTIVITY failure (the catch
with `!e.reachedServer`, or the GIS-never-loaded poll timeout) converts the preview into real
offline mode in place via `tripsyPreviewBecomeOffline` (flags flipped, Travel View re-rendered so
the strip re-words to Offline — no gate over the schedule); a failure that REACHED the server
(expired sign-in, sharing) still shows the gate, since the reader has to act. The 12s watchdog
paints nothing while a preview shows — the preview IS the fallback it existed to offer.
**Only a device that LANDS on Travel View gets the stand-in** (2026-10-21, chosen by the owner
after two failed fixes): on a device that lands on Home (the owner's iPad), the preview had to be
swapped for Home when sign-in finished, and on iPad that swap left a dark sheet over Home that no
scroll, rotation or repaint cleared, and which Chromium never shows. `tripsyMaybeShowSplashPreview`
now returns early unless `loadTravelViewPref()` (phones always qualify), so such a device keeps the
splash until Home is ready; the swap code paths stay for the TV-landing devices, which never swap.
`splashpreview_test.js` (runs the extracted lifecycle inside `with (ctx)` against a fake
document); `offlinehang_test.js`'s catch-path pin was loosened for the new early-out.
**A preview render still loading when sign-in lands must not paint over Home** ("When I opened the
app on my iPad it went straight to travel view," 2026-10-18): `renderTravelView` awaits its loads
(trips, guide, outfits, weather) before its one big paint, and a render that STARTED as the preview
could finish after `completeSignIn` had painted Home into the same `#main` — Travel View came back
over it. `tripsyPreviewPaintSuperseded(startedAsPreview)` (preview ended, not offline, device does not
land on Travel View) is checked after the loads and again right before the final paint, and such a
render abandons its paint. Related: a Home landing after a preview now goes through `navigate('home')`
rather than a bare `renderHome()`, since the preview's own `navigate('travelview')` had left
`currentView` at `travelview` and any later `navigate(currentView)` re-render (a Drive write conflict)
would have brought Travel View back. A stored Travel-View preference still lands there by design — the
✕ in Travel View, or "Use Travel Tracker" at the gate, clears it.

**Leaving Travel View STOPS its layer scrolling, waits two frames, THEN removes it** ("The
screen is not rendering correctly," 2026-10-21, iPad, right after opening the app — Home drawn
under dark patches that no scroll or rotation cleared; the first fix's follow-up screenshot
showed nearly the whole screen dark). The splash's stand-in Travel View is `.tv-root`, a
FIXED, self-scrolling (`overflow-y:auto`, `-webkit-overflow-scrolling:touch`) full-screen
layer inside the scrolling `#main`. On iOS every overflow scroller is backed by a NATIVE
scroll view, and removing the node while it still scrolls can orphan that native view on
screen — which is why rotation (a full relayout and repaint) never cleared it, and why the
first fix (hide + remove, then a `translateZ(0)` repaint nudge on `#main`) didn't help and
was removed. `navigate` now awaits `tripsyRemoveTravelViewLayer()` before rendering any other
view: every `#main .tv-root` is scrolled to the top and set `overflow:hidden`,
`-webkit-overflow-scrolling:auto`, `overscroll-behavior:auto`; `tripsyNextFrames(2)` lets
WebKit commit that (tearing the native view down through the normal path; it gives up after
120 ms if a backgrounded page fires no frames); only then is the node removed. Cannot be
reproduced off-device (no iOS WebKit in the sandbox). `tvleave_test.js`.

**A PHONE always lands on Travel View** ("Anytime the app is opened on a phone, default to the
travel view," 2026-10-18). `tripsyIsPhoneDevice()` judges it by the DEVICE, not the window
("The app defaulted to travel view on my iPad," same day — the first cut read the viewport, and an
iPad showing the app in Split View / Slide Over / the Claude app's narrow pane is under the phone
width while being no phone): an iPhone/iPod or Android-`Mobile` user agent is a yes; otherwise the
SCREEN's short side against `TRIPSY_PHONE_MAX_WIDTH` (600 — the largest iPhone is ~440 CSS px, the
smallest iPad, the mini, is 744, so no iPad ever qualifies); only a WebView reporting NO screen size
falls back to the viewport (`matchMedia`, then `innerWidth`). `loadTravelViewPref()` returns true on
one before it ever reads `localStorage`. Every landing path already reads that one preference (sign-in's `navigate
('travelview')`, the splash preview's Home skip, the offline auto-open), so nothing else changed.
Leaving Travel View mid-session (which stores `0`) still works: the stored value only decides where
the NEXT open lands, and on a phone that is Travel View again by rule. The sign-in gate highlights
the Travel View button on a phone but keeps "Use Travel Tracker" (`applyTripsOnlySignInGate`'s
second arm; `tripsonlygate_test.js` stubs the detector as a desktop). `phonetravelview_test.js`.

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
  **A second, phone-only breakpoint (`@media (max-width: 600px)`) exists for the event edit form**
  (reported 2026-08-17: "on an iPhone the minutes drop down menu does not display correctly"): a
  datetime field used to sit in HALF of the edit form's two-column grid, inside a panel keeping its
  194px timeline indent — on a ~390px iPhone that crushed the hour/minute/AM-PM controls into
  slivers. The section grid is now a class (`.tp-edit-grid`, one column under 600px), the panel
  indent is dropped there (`margin-left: 0 !important` — it's an inline style), every datetime
  field spans the full grid width on all screens, and the time trio lives in `.tp-time-row`
  (`flex-wrap: nowrap` + a real min-width per control) so it always reads hour → minutes → AM/PM
  on one line. **Picking a minute advances to AM/PM, and the chain ends there** (2026-08-18: "after
  the user selects the minutes, do not open the calendar menu. Instead, open the am/pm indicator"):
  the minute dropdown's pick handler used to end in `input.focus()`, and on a phone the tap landed
  on/near the date input below — popping the CALENDAR after every minute pick. It now focuses the
  AM/PM `<select>` of the SAME `.tp-time-row` (via `combo.closest`, so a form with several datetime
  fields can't cross rows) and tries `ampm.showPicker()` behind a feature test + try/catch (needs
  user activation, absent on older WebViews — a focused-but-unopened AM/PM is the fallback).
  Nothing is wired to the AM/PM select itself, so choosing AM or PM auto-opens nothing further.
  **On the iPad Claude-app WebView the pick must ALSO fire at `touchend` with `preventDefault()`**
  (2026-09-26: "after I select a date and then the hours and minutes the app goes back to the date
  selection instead of going to the AM/PM indicator" — on the Add-item panel, whose wider
  un-indented layout keeps date+time on one line so the NEXT row's DATE input sits under the open
  minute menu): wired to `click` alone, the handler ran on the WebView's SYNTHESIZED click and
  closed the menu — after which the WebView still applied its native tap default at the same
  screen point, now that date input, so the calendar popped open BY ITSELF even though the minute
  was set fine. `preventDefault` on touchend suppresses both the synthesized mouse events and that
  native default; one shared `pick()` serves touchend and `click` (the mouse/desktop path,
  unchanged — iOS never fires the click after a prevented touchend, and a stray double-fire is
  idempotent anyway), and a `touchMoved` flag (passive touchstart/touchmove listeners, reset per
  touch) keeps a scroll that merely starts on an option from counting as a pick.
  `mintouchpick_test.js`.
- Everything — HTML, CSS, and JS — lives in this one file by design (it's distributed/opened as a
  single artifact). Don't split it into separate files/modules unless explicitly asked.
- **FOP-BP branding easter egg**: clicking either logo (`#fopbp-logo-splash`/`#fopbp-logo-signin`,
  the small logo, or `#fopbp-logo-home`/`#fopbp-logo-tripsytrips`/`#fopbp-logo-netjetsoverview`,
  the wide banner) shows a crew photo full-screen for 4 seconds
  (`showFopBpPhoto`/`hideFopBpPhoto`, `index.html:14615` area) via a single shared
  `#fopbp-photo-overlay` div. Purely cosmetic, no data involved — if these ids ever stop resolving
  (e.g. a page's markup gets restructured), the click handler will throw on
  `getElementById(...).addEventListener`, so keep the ids in sync with wherever the logos move.
