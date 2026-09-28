// "When there are multiple flight legs directly adjacent on the same
// airline, use a single photo for all the flight legs on the itinerary"
// (2026-09-28). The transportation photo cache is per COMPANY, so a
// connection's legs each repeated the identical picture. A document-order
// walk (over the same per-day items the cards render from) now marks every
// follow-on leg in a chain of directly-adjacent same-airline flights, and
// those cards render photo-less -- the first leg's card is the chain's one
// picture. Only a LAYOVER row is glue that never breaks a chain; a P/S
// reservation card BREAKS it ("If there are two legs separated by a p/s
// reservation, there should be three pictures - the first a flight, then
// the p/s, then another flight", same-day follow-up -- the P/S card carries
// its own picture), as does any other row between two legs.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- executed: the chain walk, extracted verbatim from buildTripsyPrintHtml ----
const start = html.indexOf('const adjacentFlightPhotoSuppressed = new Set();');
assert(start !== -1, 'the suppression walk exists');
const end = html.indexOf('const tripsyTransportationCardHtml', start);
const walkSrc = html.slice(start, end);
const runWalk = (dayItems) => new Function('dayItems', `
  const dayKeys = Object.keys(dayItems);
  const summaryByDay = new Map(Object.entries(dayItems));
  ${walkSrc}
  return adjacentFlightPhotoSuppressed;
`)(dayItems);

const flight = (id, company, summary) => ({ ev: { id, summary: summary || `Flight from A to B • ${company || ''}`.trim(), tripsyRaw: { resource: 'transportation', category: 'airplane', company } } });
const car = id => ({ ev: { id, summary: 'Car from X to Y', tripsyRaw: { resource: 'transportation', category: 'car', company: 'Blacklane' } } });
const hotel = id => ({ ev: { id, summary: 'Hotel Check-out', tripsyRaw: { resource: 'hosting', name: 'H' } } });
const layover = () => ({ isLayover: true });
const ps = () => ({ psReservation: { reservationNumber: '1' } });

{
  // THE ASK's shape: a two-leg connection with a layover between -- one
  // photo (leg 1), the follow-on leg suppressed.
  const s = runWalk({ d1: [flight('f1', 'Singapore Airlines'), layover(), flight('f2', 'Singapore Airlines')] });
  assert(!s.has('f1') && s.has('f2'),
    'THE ASK: in an adjacent same-airline chain, only the FIRST leg keeps its photo -- a layover row never breaks the chain');
}
{
  // THE FOLLOW-UP: "If there are two legs separated by a p/s reservation,
  // there should be three pictures - the first a flight, then the p/s,
  // then another flight" -- a P/S card between legs BREAKS the chain, so
  // both legs keep their photos.
  const s = runWalk({ d1: [flight('f1', 'Singapore Airlines'), ps(), flight('f2', 'Singapore Airlines')] });
  assert(!s.has('f1') && !s.has('f2'),
    'THE FOLLOW-UP: a P/S reservation between two legs BREAKS the chain -- three pictures: flight, P/S, flight');
}
{
  // A different airline starts its own chain.
  const s = runWalk({ d1: [flight('f1', 'Singapore Airlines'), flight('f2', 'United'), flight('f3', 'United')] });
  assert(!s.has('f1') && !s.has('f2') && s.has('f3'),
    'a different airline breaks the chain and starts its own');
}
{
  // Any OTHER row between two legs means they are not directly adjacent.
  const s1 = runWalk({ d1: [flight('f1', 'SQ'), car('c1'), flight('f2', 'SQ')] });
  const s2 = runWalk({ d1: [flight('f1', 'SQ'), hotel('h1'), flight('f2', 'SQ')] });
  assert(!s1.has('f2') && !s2.has('f2'),
    'a car leg or any place row between two same-airline flights breaks the chain');
}
{
  // Adjacency spans a day boundary -- a red-eye's next leg the following
  // morning with nothing between is still directly adjacent.
  const s = runWalk({ d1: [flight('f1', 'SQ')], d2: [flight('f2', 'SQ')] });
  assert(s.has('f2'), 'directly-adjacent legs chain across a day boundary');
}
{
  // Company-less legs never chain, and case/spacing differences still match.
  const s1 = runWalk({ d1: [flight('f1', ''), flight('f2', '')] });
  const s2 = runWalk({ d1: [flight('f1', 'singapore airlines '), flight('f2', 'Singapore Airlines')] });
  assert(s1.size === 0 && s2.has('f2'),
    'no company means no chain; company matching ignores case and spacing');
}

// ---- wiring: the suppression reaches the card as the photo-less shape ----
assert(/const chainSuppressed = adjacentFlightPhotoSuppressed\.has\(String\(ev\.id\)\)/.test(html),
  'the transportation card reads the suppression set');
assert(/const cachedEntry = chainSuppressed \? null : await Store\.getTripsyPlacePhoto\(cacheKey\)/.test(html)
  && /const isSkipped = chainSuppressed \|\| !!\(cachedEntry && cachedEntry\.skipped\)/.test(html),
  'a suppressed leg fetches NOTHING and renders the photo-less card shape (no photo area, no controls)');
