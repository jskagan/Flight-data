# Local desktop setup for Tripsy refreshes

This file documents how to run a full **Tripsy Trips refresh** from a local
Claude Code session on the owner's Mac, instead of from a cloud/web session.

## Why this exists

The web/cloud Claude Code session talks to Google Drive through the Drive MCP
connector. Its **read** tools work, but its **write** tool (`create_file`)
currently fails every call with `MCP error -32003: requires approval`, even
with the connector's permission set to "Always allow" — the write OAuth scope
isn't actually being granted (see Claude Code issue #57211 and the related
"only 1 of 3 OAuth scopes granted" reports). Because the headless push writes
its results to Drive relay files (`tripsy-applied-changes.json`,
`tripsy-email-proposals.json`), a cloud refresh can't complete that write-back
and has to fall back to the owner hand-uploading those files.

Running the refresh **locally with Google Drive for Desktop** sidesteps the bug
entirely: the Drive folder is mounted as a normal local folder, so reading
`flight-log-data.json` and writing the relay files are plain local file
operations — no Drive connector involved. (Reading the data file locally also
avoids the connector's response-size limit that the cloud session keeps hitting.)

## Two modes — pick by where you are

- **At the desk (this file): fully automatic.** A local Claude Code session does
  the whole refresh end to end, including writing the relay files.
- **On the iPad: manual relay step.** No Drive for Desktop / local filesystem on
  iOS, so a cloud session does everything *except* the relay write; the owner
  hand-uploads the two relay files (Claude provides them, easiest as a zip so the
  hyphens in the filenames survive the download). Both modes read/write the same
  Drive files and the same `main` branch, so they interoperate freely — just
  don't run two refreshes at the same instant.

## One-time desktop setup

1. **Claude Code CLI** installed locally (`npm install -g @anthropic-ai/claude-code`,
   or the native installer — see https://code.claude.com/docs/en/quickstart),
   signed into the same Claude account used elsewhere.
2. **Google Drive for Desktop** installed, signed in as the owner, with the
   `Travel Reservation Tracking` folder set to **mirrored / "Available offline"**
   so reads and writes are immediate.
3. **This repo cloned locally**, and the local Claude Code session started from
   *inside* that clone (so it can edit `index.html` and `git push`).
4. **Tripsy MCP connector** available locally. It may auto-sync from the claude.ai
   account connector (a local `/mcp` then shows `Reconnected to claude.ai Tripsy`);
   if not, add it explicitly:
   ```
   claude mcp add --transport http tripsy https://mcp.tripsy.app --scope user
   ```
   then `/mcp` → Tripsy → complete the OAuth sign-in. Verify with
   "List my Tripsy trips" — it should return trips.
5. The Google Drive MCP connector is **not needed locally** — that's the point.

## Key locations on the desktop

- **Drive folder (holds everything the refresh touches):**
  `/Users/jskagan/Library/CloudStorage/GoogleDrive-jskagan@gmail.com/My Drive/Travel Reservation Tracking/`
  - `flight-log-data.json` — the shared app state / pending-changes queue
  - `Tripsy Trips Passphrase` — plain-text file whose contents are the snapshot
    encryption passphrase (read it from here; it is deliberately **not** stored
    in this public repo)
  - relay files the refresh writes here: `tripsy-applied-changes.json`,
    `tripsy-email-proposals.json`
- **Tripsy MCP endpoint:** `https://mcp.tripsy.app`

## How a local refresh differs from a cloud one

Follow the normal "Refresh Tripsy Trips snapshot" procedure in `CLAUDE.md`, with
these substitutions:

- **Read `flight-log-data.json`** as a local file from the Drive folder above,
  instead of via the Drive connector's download tool.
- **Read the passphrase** from the local `Tripsy Trips Passphrase` file, instead
  of the Drive connector.
- **Write the relay files** (`tripsy-applied-changes.json` and, when there are
  parsed-email proposals, `tripsy-email-proposals.json`) as local files into the
  Drive folder above, instead of via `create_file`. Google Drive for Desktop
  syncs them up automatically; the app drains and deletes them on its next open
  or "Check Now".
- Everything else is unchanged: apply queued changes via the `tripsy_*`
  connectors, pull fresh trip data, rebuild + re-encrypt the snapshot
  (AES-256-GCM, PBKDF2-SHA-256, 250000 iterations), update
  `TRIPSY_SNAPSHOT_GENERATED_AT` / `TRIPSY_ENCRYPTED` in `index.html`, and
  `git push` (the snapshot-only commit exception in `CLAUDE.md` still applies).

## When the connector bug is fixed

Once `create_file` (or the Drive write scope) works from the cloud session again,
this local path becomes optional — a normal cloud refresh will write the relay
files itself. Nothing here needs to be undone; it just stops being necessary.
