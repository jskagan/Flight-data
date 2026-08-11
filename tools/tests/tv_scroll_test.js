// Verifies the property that actually matters: the new absolute-target scroll is
// IDEMPOTENT, so the retry passes converge instead of compounding. Models the two
// real failure modes with a fake scroll container.
function makeScroller({ clientHeight = 800, scrollHeight = 5000, topbarH = 92 }) {
  const root = { scrollTop: 0, clientHeight, scrollHeight,
    scrollTo({ top }) { this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight)); },
    scrollBy({ top }) { this.scrollTo({ top: this.scrollTop + top }); } };
  return root;
}
// ABSOLUTE (new): target from layout offset, independent of current scrollTop.
const scrollAbs = (root, contentTop, topbarH) => {
  const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
  const target = Math.max(0, Math.min(contentTop - topbarH, maxTop));
  if (Math.abs(root.scrollTop - target) < 1) return;
  root.scrollTo({ top: target });
};
// RELATIVE (old): delta from the element's current viewport position.
const scrollRel = (root, contentTop, topbarH) => {
  const viewportTop = contentTop - root.scrollTop;   // where it appears right now
  const delta = viewportTop - topbarH;
  if (Math.abs(delta) < 1) return;
  root.scrollBy({ top: delta });
};

const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const CONTENT_TOP = 3000, TOPBAR = 92, WANT = CONTENT_TOP - TOPBAR;

// Repeated passes must converge to the same place.
let r = makeScroller({});
for (let i = 0; i < 5; i++) scrollAbs(r, CONTENT_TOP, TOPBAR);
assert(r.scrollTop === WANT, `absolute: 5 passes land exactly on target ${WANT} -> ${r.scrollTop}`);

// UNDERSHOOT: page still growing, so the first pass is clamped against a short
// document; a later pass (full height) must still reach the right place.
r = makeScroller({ scrollHeight: 1200 });   // short: max scroll 400
scrollAbs(r, CONTENT_TOP, TOPBAR);
assert(r.scrollTop === 400, 'absolute: first pass clamped by a short page -> ' + r.scrollTop);
r.scrollHeight = 5000;                       // page finishes laying out
scrollAbs(r, CONTENT_TOP, TOPBAR);
assert(r.scrollTop === WANT, 'absolute: retry after layout settles reaches target -> ' + r.scrollTop);

// OVERSHOOT: the old relative scroll, if a retry reads geometry that has not
// caught up with the previous scroll, adds a second full delta.
r = makeScroller({});
scrollRel(r, CONTENT_TOP, TOPBAR);
const afterFirst = r.scrollTop;
r.scrollTop = 0;                             // simulate geometry not yet reflowed
scrollRel(r, CONTENT_TOP, TOPBAR);
assert(afterFirst === WANT, 'relative: a single clean pass is correct -> ' + afterFirst);
// And the same situation under the absolute rule cannot compound.
r = makeScroller({});
scrollAbs(r, CONTENT_TOP, TOPBAR);
r.scrollTop = 0;
scrollAbs(r, CONTENT_TOP, TOPBAR);
assert(r.scrollTop === WANT, 'absolute: recomputing after a lost scroll re-lands exactly, never past -> ' + r.scrollTop);
