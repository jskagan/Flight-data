# Persistent sign-in Worker

Ends the roughly-hourly re-login on iPad/Safari. `worker.js` in this folder holds the
Google client secret, exchanges an authorization code for a **refresh token**, keeps
that token server-side, and hands the app a fresh access token whenever it asks.

The app falls back to the old browser-only sign-in whenever this Worker is unreachable
or not yet configured, so deploying it is safe to do in stages and nothing breaks if it
is never deployed at all.

## Why the app can't do this alone

Access tokens live ~1 hour. The browser-only flow (`initTokenClient`) never issues a
refresh token, so the only silent renewal available to it is a hidden iframe against
`accounts.google.com` — which Safari/iOS ITP blocks. Getting a refresh token requires
the authorization-code flow, which requires a client secret, which must never sit in a
public HTML file. Hence a Worker.

## Setup

### 1. Google Cloud Console

Open the **existing** OAuth client (the one whose id is `DRIVE_CLIENT_ID` in
`index.html`) at <https://console.cloud.google.com/apis/credentials>.

- It must be of type **Web application**.
- Copy its **Client secret** (create one if the client has none). This is what the
  Worker needs — it never goes in `index.html`.
- Under **Authorized JavaScript origins**, make sure the app's origin is listed:
  `https://jskagan.github.io`
- No redirect URI is needed: the popup code flow exchanges against the literal
  `postmessage`, not a real redirect.

If the OAuth consent screen is still in **Testing**, refresh tokens are expired by
Google after 7 days — which would reintroduce a weekly re-login. Publish the app
(**OAuth consent screen → Publish app**) to avoid that. It stays private in practice
because access is controlled by Drive file sharing, not by who can sign in.

### 2. Cloudflare

```sh
cd tools/auth-worker
npm install -g wrangler        # if you don't have it
wrangler login

# One KV namespace to hold the refresh tokens
wrangler kv namespace create AUTH_KV
# -> copy the printed id into wrangler.toml

# DEPLOY BEFORE SETTING THE SECRET. Secrets attach to an existing Worker, so on a
# first deploy `secret put` fails with 'Worker "travel-tracker-auth" not found'.
wrangler deploy
wrangler secret put GOOGLE_CLIENT_SECRET   # paste the secret from step 1
```

**Then run `wrangler deploy` once more.** Adding a secret — via `secret put` *or* the
Cloudflare dashboard — creates a new Worker **version** but does not promote it, so the
old version keeps serving and the secret appears to have no effect. This is confusing
precisely because the two ways of checking disagree:

```
wrangler secret list   ->  GOOGLE_CLIENT_SECRET is there
POST /auth/health      ->  {"configured":false}
```

Both are telling the truth: the secret exists, and the *running* version predates it.
`wrangler deployments list` shows the active version older than the "Add secret" one. A
plain `wrangler deploy` promotes it and `/auth/health` flips to `configured:true`.

Between those two commands the Worker is live but unconfigured, which is harmless:
`/auth/health` reports `configured:false`, and the app treats anything short of
`configured:true` as "use the original browser-only sign-in", so sign-in keeps working
exactly as before throughout.

Then set `AUTH_WORKER_URL` in `index.html` to the deployed URL if it differs from the
default already there.

### 3. Verify

Sign in once in the app. You should see a normal Google consent screen (it asks again
because it now needs offline access). After that, closing the tab and reopening it —
even a day later, even on iPad — should land you straight in the app with no sign-in
screen.

## Endpoints

| Endpoint | Body | Returns |
|---|---|---|
| `POST /auth/exchange` | `{code}` | `{device_id, access_token, expires_in}` |
| `POST /auth/token` | `{device_id}` | `{access_token, expires_in}` |
| `POST /auth/revoke` | `{device_id}` | `{ok:true}` |

`401` from `/auth/token` means the device credential is dead (revoked, expired,
unknown) and the app should fall back to interactive sign-in. Other errors are
transient and worth retrying.

## Security

A `device_id` is a **session credential**: whoever holds one can mint access tokens for
that Google account (Drive, plus Gmail if the account was granted that scope) until it
is revoked. It is 32 random bytes from the platform CSPRNG, stored in that browser's
`localStorage`, and never leaves the device except to this Worker.

- The Worker rejects requests whose `Origin` isn't `ALLOWED_ORIGIN`.
- Signing out in the app calls `/auth/revoke`, which revokes the grant with Google and
  deletes the stored token.
- Everything can be revoked at once at <https://myaccount.google.com/permissions>.
- Unused device credentials expire on their own after ~13 months; the clock resets on
  every successful refresh, so a device in regular use never expires.

This is the ordinary "keep me signed in" tradeoff: real persistence means a long-lived
credential exists somewhere. The alternative is the hourly re-login this replaces.

## Watch feed (calendar + Shortcut)

The same Worker also serves a **read-only** feed of the trip schedule for an Apple Watch:
a calendar subscription, and three small endpoints a Shortcut calls. Everything is a
`GET` under `/feed/<FEED_TOKEN>/`, where `FEED_TOKEN` is a long random secret. A
calendar subscription can't send headers, so the secret has to be in the URL: **anyone
with one of these links can read the schedule** (never write, never anything but trips).
Change the `FEED_TOKEN` secret to cut every old link off.

To read Drive the feed borrows a sign-in this Worker already stores: the most recently
used device whose Google account is `OWNER_EMAIL`. It keeps working as long as the owner
stays signed in on at least one device; after signing out everywhere it answers `503`
until the next sign-in. Trip data is cached for five minutes.

| Endpoint | Returns |
|---|---|
| `GET /feed/<t>/calendar.ics` | iCalendar of every current and upcoming trip (and the last week) |
| `GET /feed/<t>/day?date=2026-11-12` | that day's events as readable text, across every trip |
| `GET /feed/<t>/trips?from=2026-11-08` | one line per trip not yet over on that date |
| `GET /feed/<t>/days?trip=<a line from /trips>` | one line per day of that trip, e.g. `Thu, Nov 12 2026` |

`day` also accepts a line from `/days` as its `date`. Hotels show as a check-in and a
check-out (and "Staying at …" on the nights between), flights on their departure day and
again on their arrival day. Calendar times are converted to UTC from each event's own time
zone, or the trip's nearest known zone; an event on a trip with no zone at all is a
"floating" time, which shows in whatever zone the phone is in.

### Turning it on (iPad is fine, no Mac needed)

1. Cloudflare dashboard → **Workers & Pages** → `travel-tracker-auth` → **Edit code**.
   Replace `worker.js` with this folder's file and press **Deploy**.
2. **Settings → Variables and secrets**: add a **Secret** `FEED_TOKEN` (40+ random
   letters and digits) and a **Text** variable `OWNER_EMAIL` = the owner's Google email.
3. **Deploy once more** (a new secret is not live until the next deploy — see above).
4. Check: `https://travel-tracker-auth.jskagan.workers.dev/feed/<FEED_TOKEN>/trips` lists
   your upcoming trips.

### Calendar on the watch

iPhone: **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add
Subscribed Calendar**, server
`https://travel-tracker-auth.jskagan.workers.dev/feed/<FEED_TOKEN>/calendar.ics`. The
watch's Calendar app and its complications show the events.

### The Shortcut ("Trip Day")

Build it in the Shortcuts app on the iPhone. `BASE` below means
`https://travel-tracker-auth.jskagan.workers.dev/feed/<FEED_TOKEN>`.

1. **Choose from Menu** with three items: *Today*, *Tomorrow*, *Pick a day*.
2. Under **Today**:
   - **Date** (Current Date) → **Format Date**: Custom, `yyyy-MM-dd`.
   - **Text**: `BASE/day?date=` + Formatted Date.
3. Under **Tomorrow**:
   - **Date** (Current Date) → **Adjust Date**: Add 1 day → **Format Date**: Custom, `yyyy-MM-dd`.
   - **Text**: `BASE/day?date=` + Formatted Date.
4. Under **Pick a day**:
   - **Date** → **Format Date** `yyyy-MM-dd`.
   - **Get Contents of URL**: `BASE/trips?from=` + Formatted Date.
   - **Split Text** by New Lines → **Choose from List** (prompt "Trip").
   - **URL Encode** the chosen item → **Get Contents of URL**: `BASE/days?trip=` + URL Encoded Text.
   - **Split Text** by New Lines → **Choose from List** (prompt "Day").
   - **URL Encode** the chosen item → **Text**: `BASE/day?date=` + URL Encoded Text.
5. After **End Menu**: **Get Contents of URL** with the menu's result → **Show Result**.
6. Shortcut details (ⓘ): turn on **Show on Apple Watch**.

On the watch, run it from the Shortcuts app or add it as a complication.

## Trip edits drain (voice commands in a chat → the tracker, no app open)

A Claude chat can only **create** files in Drive, so it leaves itinerary changes as a
small relay file, `tripsy-trip-edits.json`, in the Travel Tracker folder. The app has
always applied that file the next time it was opened. This Worker now does the same job
on a timer **while a trip is in progress**, so on a trip a change lands within about a
minute whether or not the app is open.

**Off a trip the timer does nothing**, and the app applies the relay the next time it is
opened, as it always has. "On a trip" means today falls between the day before a trip's
first event and the day after its last (the extra day each side covers the Worker's UTC
clock against local event days). The Worker keeps that short list of date windows in KV
(`edits:tripWindows`), rebuilds it from `trips-data.json` every six hours and after each
save, so a trip added or re-dated in the app is noticed within six hours.

On a trip, every minute it searches Drive for the relay. If there is none it stops there
(one KV read, one Drive call, no KV write). If there is one it applies each entry to
`trips-data.json` with **the app's own code**, saves, and deletes the relay. The app still
drains the file too, so nothing breaks if the timer is off.

### Turning it on (iPad is fine)

1. Cloudflare dashboard → **Workers & Pages** → `travel-tracker-auth` → **Edit code**.
   Replace `worker.js` with this folder's file and press **Deploy**.
2. **Settings → Trigger Events → Add → Cron Triggers**, schedule `* * * * *` (every
   minute). `wrangler deploy` sets this from `wrangler.toml` instead.
3. `OWNER_EMAIL` must be set (it already is if the watch feed works). The drain uses the
   same stored sign-in as the feed, so it works for as long as the owner is signed in to
   the app on at least one device.
4. Check: open `https://travel-tracker-auth.jskagan.workers.dev/feed/<FEED_TOKEN>/apply-edits`.
   It runs the drain immediately, **whether or not a trip is in progress**, and answers
   `No trip edits waiting.` or a line per edit. It can only apply a relay that is already
   in the owner's Drive folder.

Deploy the new `index.html` first, or at the same time. The app change is what stops a
duplicate when the app and the Worker pick up the same relay within the same few seconds.

### The relay a chat writes

Always a **new** file named exactly `tripsy-trip-edits.json` (plain JSON, never converted
to a Google Doc) in the same folder as `trips-data.json`:

```json
{"edits": [
  {"type": "create_event", "tripKey": "<trip key>", "tripsyResource": "activity",
   "fields": {"name": "Dinner", "category": "restaurant", "startsAt": "2030-05-03T19:30:00",
              "endsAt": "2030-05-03T21:00:00", "address": "…", "timezone": "Europe/London"}},
  {"type": "create_event", "tripKey": "<trip key>", "tripsyResource": "transportation",
   "fields": {"category": "train", "departureDescription": "Paddington", "departureAt": "2030-05-04T09:00:00",
              "arrivalDescription": "Oxford", "arrivalAt": "2030-05-04T09:55:00"}},
  {"type": "edit_event", "eventKey": "activity:1795379177485798", "changes": {"endsAt": "2030-05-03T21:30:00"}},
  {"type": "delete_event", "eventKey": "activity:1795379177485798"},
  {"type": "move_event", "eventKey": "hosting:123", "targetTripKey": "<other trip key>"}
]}
```

- `tripsyResource` is `activity`, `hosting` or `transportation`. Field names are the
  app's own (`TRIPSY_EDIT_FIELDS` in `index.html`).
- An `eventKey` is the event's `tripsyRaw.resource` + `:` + `tripsyRaw.id`.
- Times are local wall-clock with no offset.
- Also accepted: `edit_trip`, `create_trip`, `delete_trip`.

### What the Worker writes back

| File | What it is |
|---|---|
| `tripsy-trip-edits-log.json` | The last 30 runs, newest first. Each edit is `applied`, `skipped` or `failed`, with a reason. A created event's entry carries its new `eventKey`. **A chat reads this to confirm a change landed.** |
| `tripsy-applied-edits.json` | A note for the app, written after every save. On its next sync the app takes the newer trips and cleans its own caches (Dress Guide, outfits, Update pages), which live in `flight-log-data.json` and which the Worker never touches. |
| `tripsy-trip-edits.invalid-<time>.json` | A relay that could not be read (bad JSON, no `edits` list, or converted to a Google Doc), renamed so it is not retried forever. |

### Rules it follows

- **Nothing is created twice.** An `edit_event` re-merges the same fields; a
  `create_event` is skipped when the trip already holds an event with the same name and
  start (or, for transportation, the same departure time and endpoints); an entry naming
  an event or trip that is gone is skipped.
- **Two writers, one file.** Just before saving, the Worker re-reads the file's head
  revision, the same guard the app uses. If another device saved in between, it reloads
  and re-applies, with the checks above run again. The check and the save are two
  separate Drive calls, so a save from another device landing in the second between
  them can still be overwritten. The app has always had the same gap between devices.
- **A Drive failure keeps the relay** for the next minute. An entry that fails to apply
  (unknown resource, a change to an event's `id`) is logged and dropped: the same input
  would fail the same way every minute.

### Keeping the Worker's copy of the app's logic in step

`worker.js` deploys as one pasted file, so it cannot import from `index.html`. The block
between the `MIRROR` markers is copied from `index.html` by a script:

```sh
node tools/auth-worker/mirror.js          # rewrite the block
node tools/auth-worker/mirror.js --check  # exit 1 if it is out of date
```

`tools/tests/workertripedits_test.js` fails whenever the two differ. After changing any
mirrored function in `index.html` (`applyTripsyChangeToTrips`, `tripsyRawToDisplay`, the
field list, …), run the script **and redeploy the Worker**.

### Not yet measured

A run that applies edits parses and re-writes the whole of `trips-data.json`. On
Cloudflare's free plan a Worker gets 10 ms of CPU per run. The watch feed already parses
the same file on that plan, but the drain also serializes it. If the Worker's logs show
`Exceeded CPU`, the fix is the paid plan's higher limit.

