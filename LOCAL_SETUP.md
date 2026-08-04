# Local desktop setup — OBSOLETE

This file documented how to run a full **Tripsy Trips refresh** from a local
Claude Code session on the owner's Mac, working around a Drive-connector write
bug in cloud sessions.

**As of the 2026-08-04 migration it is obsolete**: trip data lives in a private
Drive file (`trips-data.json`) that the app reads and writes directly — there
is no snapshot to refresh, no pending-changes queue to push, and Tripsy itself
is a frozen archive. The only remaining scheduled work is the cloud **parse**
routine (flagged docs + forwarded emails → review proposals), which runs
entirely in Anthropic's cloud with nothing to set up locally.

The `~/Desktop/Refresh Tripsy Trips.command` launcher and the local
`~/.claude/scheduled-tasks/tripsy-trips-refresh/SKILL.md` runbook can be
deleted. See git history for the old contents of this file.
