#!/usr/bin/env python3
"""
build_tripsy_snapshot.py -- the Tripsy Trips snapshot transform, as tested code.

Single source of truth for how raw Tripsy API records become the decrypted
"Tripsy Trips" snapshot plaintext that gets AES-encrypted into index.html's
TRIPSY_ENCRYPTED. The `tripsy-trips-refresh` runbook (local SKILL.md and the
cloud routine) calls this instead of re-deriving the transform from prose each
run -- which is what kept drifting (event-id shape, ""-vs-null, key order, the
U+2192 arrow, the transportation title rule) and what silently corrupted data
when raw records were hand-retyped (a curly apostrophe flattened, a U+200E mark
dropped). Reading raw JSON programmatically here makes both classes impossible.

It is deliberately a PURE function of its input: raw Tripsy JSON in, snapshot
plaintext out. No secrets, no passphrase, no encryption, no network -- those
stay in the runbook. That is why this can live in the public repo.

NOTE ON THE ONE RULE THAT STILL HAS A SECOND COPY: transportation `summary`.
The app recomputes display fields for pending (unsynced) events client-side in
`tripsyRawToDisplay` / `tripsyTransportationFallbackSummary` (index.html), which
the single-file/no-imports app can't share with this script. Keep the
transportation-summary logic here in lockstep with those two functions; a test
that diffs this script's output against a decrypted live snapshot catches drift.

INPUT (stdin or argv[1]) -- JSON:
  {"trips": [
     {"trip": {<raw trip: id,name,starts_at,ends_at,...>},
      "activities":     [<raw activity>,       ...],
      "hostings":       [<raw hosting>,         ...],
      "transportations":[<raw transportation>, ...]}
  ]}
Only trips you want in the snapshot should be present (do date-window filtering
before calling). OUTPUT (stdout) -- the snapshot plaintext: a compact JSON array
of trip objects, ready to encrypt.
"""

import json
import re
import sys
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    sys.exit("build_tripsy_snapshot: Python 3.9+ with zoneinfo required "
             "(pip install tzdata if the timezone database is missing)")

# --- category maps, mirrored verbatim from index.html ------------------------

ACTIVITY_CATEGORY_TO_TYPE = {
    "restaurant": "dining", "bar": "dining", "cafe": "dining", "bakery": "dining",
    "brewery": "dining", "winery": "dining", "foodMarket": "dining",
    "concert": "concert", "theater": "concert",
    "tour": "tour", "museum": "tour", "nationalPark": "tour", "zoo": "tour",
    "aquarium": "tour", "amusementPark": "tour",
    # The owner's custom Tripsy categories, which have no built-in type, get
    # their own display type stamped into the snapshot so already-synced
    # events render the right dot/icon (index.html's re-derive path only
    # covers pending/edited events). Keep in lockstep with index.html's
    # TRIPSY_ACTIVITY_CATEGORY_TO_TYPE.
    "7XGVGtMARwoON7rl52N1P4j36dI9gf4NDgw": "spa",
    "Y16QHWPgO5Z7T7jTBdfgdEK0ZvGDecv8jW0": "reception",
    "VuucvcPkCXTTzz6FHsSY5AMjvcmtx42pO5s": "cooking",
}
ACTIVITY_TYPES = [
    "general", "note", "event", "meeting", "relax", "fit", "kids", "shopping",
    "parking", "atm", "bank", "restaurant", "bar", "cafe", "bakery", "brewery",
    "winery", "foodMarket", "concert", "theater", "movieTheater", "nightlife",
    "tour", "museum", "nationalPark", "zoo", "aquarium", "amusementPark", "park",
    "beach", "marina", "stadium", "campground", "evCharger", "fireStation",
    "fitnessCenter", "gasStation", "hospital", "laundry", "library", "pharmacy",
    "police", "postOffice", "publicTransport", "restroom", "school", "university",
]
TRANSPORTATION_TYPES = ["airplane", "bike", "bus", "car", "roadtrip", "cruise",
                        "ferry", "motorcycle", "train", "walk"]
CUSTOM_CATEGORY_LABELS = {
    "7XGVGtMARwoON7rl52N1P4j36dI9gf4NDgw": "Spa",
    "Y16QHWPgO5Z7T7jTBdfgdEK0ZvGDecv8jW0": "Reception",
    "VuucvcPkCXTTzz6FHsSY5AMjvcmtx42pO5s": "Cooking",
}

AGENT_KEYS = ["agentName", "agency", "agentPhone", "agencyReservationNumber", "agentWebsite"]


def slug_to_label(slug):
    """Mirror of tripsySlugToLabel(): custom label, else raw unknown slug, else
    camelCase-split and capitalize the first letter."""
    if not slug:
        return ""
    if slug in CUSTOM_CATEGORY_LABELS:
        return CUSTOM_CATEGORY_LABELS[slug]
    if slug not in ACTIVITY_TYPES and slug not in TRANSPORTATION_TYPES:
        return slug
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", slug)
    return spaced[:1].upper() + spaced[1:]


def local_wallclock(utc_iso, tz_name):
    """Real UTC instant + IANA timezone -> fake-UTC ISO string carrying the
    LOCAL wall-clock digits (e.g. 6:30am LA -> '2026-10-07T06:30:00'), matching
    parseTripLocalParts/formatTripTime in index.html. None passes through."""
    if not utc_iso:
        return None
    dt = datetime.fromisoformat(utc_iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if tz_name:
        try:
            dt = dt.astimezone(ZoneInfo(tz_name))
        except Exception:
            sys.exit(f"build_tripsy_snapshot: unknown timezone {tz_name!r} "
                     f"(pip install tzdata?)")
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def extra(parts):
    """Join truthy parts with ' • ', or None if none -- mirrors the app's
    `parts.filter(Boolean).join(' • ') || null`."""
    kept = [p for p in parts if p]
    return " • ".join(kept) if kept else None


def seat_label(seat_class, seat_number):
    """Mirror of tripsySeatLabel()."""
    if not seat_class and not seat_number:
        return None
    if seat_class and seat_number:
        return f"Seat: {seat_class} ({seat_number})"
    return f"Seat: {seat_class or seat_number}"


def transportation_summary(raw):
    """ROUTE-FIRST transportation title. Mirror of the app's
    tripsyTransportationFallbackSummary + the summary branch of
    tripsyRawToDisplay -- keep in lockstep with index.html."""
    dep = raw.get("departure_description") or ""
    arr = raw.get("arrival_description") or ""
    cat = raw.get("transportation_type")
    is_flight = cat == "airplane"
    kind = "Flight" if is_flight else (slug_to_label(cat) or "Transportation")
    company_number = f"{raw.get('company') or ''} {raw.get('transport_number') or ''}".strip()

    def short(x):
        return x.split(",")[0].strip() if x else x

    if dep or arr:  # a real route wins over the company name
        sd, sa = short(dep), short(arr)
        if sd and sa:
            base = f"{kind} from {sd} to {sa}"
        elif sd:
            base = f"{kind} from {sd}"
        elif sa:
            base = f"{kind} to {sa}"
        else:
            base = kind
        # Flights only: company + flight number moves into the title,
        # after the origin/destination -- mirrors tripsyRawToDisplay in
        # index.html; keep the two in lockstep.
        if is_flight and company_number:
            return f"{base} • {company_number}"
        return base
    # no route at all -> company+number, then a real name, then bare kind
    name = raw.get("name")
    usable_name = name if (name and name.strip().lower() != "transportation") else None
    return company_number or usable_name or kind


def build_event(resource, raw):
    """Build one snapshot event (display fields + tripsyRaw) from one raw record.
    Key order below is load-bearing: it must match the live snapshot exactly."""
    rid = raw["id"]
    conf = raw.get("provider_reservation_code") or None

    if resource == "activity":
        starts = local_wallclock(raw.get("starts_at"), raw.get("timezone"))
        ends = local_wallclock(raw.get("ends_at"), raw.get("timezone"))
        tripsy_raw = {
            "resource": "activity", "id": rid, "name": raw.get("name") or None,
            "notes": raw.get("description") or None, "confirmation": conf,
            "category": raw.get("activity_type"), "address": raw.get("address") or None,
            "phone": raw.get("phone") or None, "website": raw.get("website") or None,
            "startsAt": starts, "endsAt": ends, "timezone": raw.get("timezone") or None,
        }
        for k in AGENT_KEYS:
            tripsy_raw[k] = None
        return {
            "id": f"activity-{rid}",
            "type": ACTIVITY_CATEGORY_TO_TYPE.get(raw.get("activity_type"), "other"),
            "summary": raw.get("name") or None,
            "start": starts, "end": ends,
            "location": raw.get("address") or None,
            "notes": raw.get("description") or None,
            "tripsyExtra": extra([f"Confirmation: {conf}" if conf else "",
                                  raw.get("phone") or "", raw.get("website") or ""]),
            "hidden": False,
            "tripsyRaw": tripsy_raw,
        }

    if resource == "hosting":
        starts = local_wallclock(raw.get("starts_at"), raw.get("timezone"))
        ends = local_wallclock(raw.get("ends_at"), raw.get("timezone"))
        tripsy_raw = {
            "resource": "hosting", "id": rid, "name": raw.get("name") or None,
            "notes": raw.get("notes") or None, "confirmation": conf,
            "address": raw.get("address") or None, "phone": raw.get("phone") or None,
            "website": raw.get("website") or None, "startsAt": starts, "endsAt": ends,
            "timezone": raw.get("timezone") or None,
        }
        for k in AGENT_KEYS:
            tripsy_raw[k] = None
        return {
            "id": f"hosting-{rid}", "type": "hotel", "summary": raw.get("name") or None,
            "start": starts, "end": ends, "location": raw.get("address") or None,
            "notes": raw.get("notes") or None,
            "tripsyExtra": extra([f"Confirmation: {conf}" if conf else "",
                                  raw.get("phone") or "", raw.get("website") or ""]),
            "hidden": False, "tripsyRaw": tripsy_raw,
        }

    # transportation
    dep_desc = raw.get("departure_description") or ""
    arr_desc = raw.get("arrival_description") or ""
    dep_at = local_wallclock(raw.get("departure_at"), raw.get("departure_timezone"))
    arr_at = local_wallclock(raw.get("arrival_at"), raw.get("arrival_timezone"))
    location = f"{dep_desc} → {arr_desc}" if (dep_desc and arr_desc) else (dep_desc or arr_desc or None)
    tripsy_raw = {
        "resource": "transportation", "id": rid, "name": raw.get("name") or None,
        "notes": raw.get("notes") or None, "confirmation": conf,
        "category": raw.get("transportation_type"), "company": raw.get("company") or None,
        "transportNumber": raw.get("transport_number") or None,
        "seatClass": raw.get("seat_class") or None, "seatNumber": raw.get("seat_number") or None,
        "vehicleDescription": raw.get("vehicle_description") or None,
        "departureDescription": raw.get("departure_description") or None,
        "departureTerminal": raw.get("departure_terminal") or None,
        "departureAt": dep_at, "departureTimezone": raw.get("departure_timezone") or None,
        "arrivalDescription": raw.get("arrival_description") or None,
        "arrivalTerminal": raw.get("arrival_terminal") or None,
        "arrivalAt": arr_at, "arrivalTimezone": raw.get("arrival_timezone") or None,
    }
    for k in AGENT_KEYS:
        tripsy_raw[k] = None
    seat = seat_label(raw.get("seat_class"), raw.get("seat_number"))
    return {
        "id": f"transportation-{rid}",
        "type": "flight" if raw.get("transportation_type") == "airplane" else "transportation",
        "summary": transportation_summary(raw),
        "start": dep_at, "end": arr_at, "location": location,
        "notes": raw.get("notes") or None,
        "tripsyExtra": extra([f"Confirmation: {conf}" if conf else "", seat or "",
                              raw.get("vehicle_description") or "",
                              f"Terminal {raw.get('departure_terminal')}" if raw.get("departure_terminal") else ""]),
        "hidden": False,
        "tripsyRaw": tripsy_raw,
    }


def dedup(rows):
    """Drop byte-identical duplicate raw rows (Tripsy occasionally returns exact
    dupes), preserving first-seen order."""
    seen, out = set(), []
    for r in rows:
        key = json.dumps(r, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def build_trip(entry):
    trip = entry["trip"]
    tstart = trip.get("starts_at")   # plain YYYY-MM-DD, passed through
    tend = trip.get("ends_at")
    events = []
    for resource, key in (("activity", "activities"), ("hosting", "hostings"),
                          ("transportation", "transportations")):
        for raw in dedup(entry.get(key) or []):
            ev = build_event(resource, raw)
            # Out-of-range dining is hidden; every other type stays visible.
            if ev["type"] == "dining" and ev["start"]:
                day = ev["start"][:10]
                if (tstart and day < tstart) or (tend and day > tend):
                    ev["hidden"] = True
            events.append(ev)
    events.sort(key=lambda e: (e["start"] or ""))
    return {
        "key": f"tripsy-{trip['id']}", "name": trip.get("name"),
        "start": tstart, "end": tend, "location": None, "events": events,
    }


def build_snapshot(data):
    trips = [build_trip(e) for e in data.get("trips", [])]
    trips.sort(key=lambda t: (t["start"] or ""))
    return trips


def main():
    src = open(sys.argv[1], encoding="utf-8") if len(sys.argv) > 1 else sys.stdin
    data = json.load(src)
    snapshot = build_snapshot(data)
    # Compact, unicode preserved (the → arrow, curly apostrophes, U+200E marks
    # must survive verbatim), no trailing newline mismatch with the old builder.
    sys.stdout.write(json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
