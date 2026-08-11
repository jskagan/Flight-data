const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') paren++;
    else if (html[i] === ')') { paren--; if (!paren) { i++; break; } }
  }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- entry point ----
assert(/data-tripsy-trip-diary data-key="\$\{esc\(trip\.key\)\}"`, '📖', 'Trip Diary'/.test(html),
  'the gear menu carries a Trip Diary item');
assert(/querySelectorAll\("\[data-tripsy-trip-diary\]"\)/.test(html), 'and it is wired');
const gear = html.slice(html.indexOf('data-tripsy-trip-menu="${esc(trip.key)}"'), html.indexOf('data-tripsy-trip-menu="${esc(trip.key)}"') + 900);
assert(gear.indexOf('Verify Travel Details') < gear.indexOf('Trip Diary')
    && gear.indexOf('Trip Diary') < gear.indexOf('Hide Trip'), 'placed between Verify and Hide');

// ---- storage: own file, absent-is-normal, guarded write ----
const fetchFn = extractFn('fetchTripDiariesFromDrive');
assert(/trip-diaries\.json/.test(html), 'it has its own Drive file');
assert(/if \(!candidates\.length\) return null; \/\/ absent is NORMAL/.test(fetchFn),
  'a missing file is not an error -- nobody has written a diary yet');
assert(/vnd\.google-apps/.test(fetchFn), 'and it dodges the same-named-Google-Doc trap trips-data.json guards');
const saveFn = extractFn('saveTripDiaryToDrive');
assert(/fetchDriveHeadRevision/.test(saveFn) && /currentRev !== tripDiariesRevision/.test(saveFn),
  'writes go through the head-revision guard');
assert(/continue; \/\/ re-apply this diary onto the copy we just pulled/.test(saveFn),
  'a conflict reloads and RE-APPLIES rather than overwriting another device');
assert(/attempt < 3/.test(saveFn), 'and the retry is bounded');
assert(/filter\(d => d\.tripKey !== diary\.tripKey\)/.test(saveFn), 'only this trip\'s diary is replaced');
const writeFn = extractFn('writeTripDiariesDoc');
assert(/createDriveDataFile\(doc, TRIP_DIARIES_DRIVE_FILENAME\)/.test(writeFn), 'first save CREATES the file');
// createDriveDataFile had to be generalised without disturbing its existing caller.
assert(/function createDriveDataFile\(data, name = DRIVE_DATA_FILENAME\)/.test(html),
  'createDriveDataFile takes a name, defaulting to the main data file');
assert(/const metadata = \{ name, mimeType: 'application\/json'/.test(html), 'and actually uses it');

// ---- seeding ----
const seed = extractFn('generateTripsyDiaryDays');
assert(/model: 'claude-opus-4-8'/.test(seed), 'seeding uses the narrative model');
assert(!/thinking/.test(seed), 'with NO thinking param -- on opus-4.8 adding it would be slower');
assert(/PAST-TENSE/.test(seed) && /Never "you"; use "we"/.test(seed), 'the prompt demands past tense, not second person');
assert(/Invent NO facts/.test(seed), 'and forbids inventing what the app cannot know');
const page = extractFn('showTripsyTripDiary');
assert(/const targets = dayKeys\.filter\(k => !\(\(dayOf\(k\) \|\| \{\}\)\.text \|\| ''\)\.trim\(\)\)/.test(page),
  'seeding only targets days that are still EMPTY, so it can never overwrite writing');
assert(/if \(!targets\.includes\(d\.day_key\)\) continue;/.test(page),
  'and a day we did not ask about is ignored even if the model returns it');

// ---- day boundaries come from the itinerary's own builder ----
assert(/buildTripsyPrintDayData\(trip\)/.test(page), 'days come from the itinerary day builder, not trip.start');
assert(/tripsyDayNumberFromTripStart\(dayKey, firstDayKey\)/.test(page), 'Day N counts from the first dated day');

// ---- schedule block ----
assert(/showSchedule: true/.test(page), 'the schedule block defaults to shown');
assert(/d\.showSchedule !== false/.test(page), 'and only a stored false hides it');
assert(/data-diary-drop-schedule/.test(page), 'with a Remove control');
const sched = extractFn('tripsyDiaryScheduleLines');
assert(/if \(item\.isLayover\) continue;/.test(sched), 'layovers are not schedule lines');
assert(/item\.psReservation/.test(sched), 'P/S reservations are');

// ---- editing + saving ----
assert(/addEventListener\('blur'/.test(page), 'text saves on blur, not per keystroke');
assert(/if \(\(dayOf\(key\) \|\| \{\}\)\.text === el\.value\) return;/.test(page), 'an unchanged field spends no write');
assert(/saveChain = saveChain\.then/.test(page), 'saves are chained so two edits cannot race the same file');
// The ternary spans two lines in the source, so match across the newline.
assert(/const bookMode = photos\.length > 0 \|\| photoBoxDays\.has\(dayKey\)/.test(page),
  'a day is in book mode once it has photos, or the moment photos are asked for');
assert(/\? tripsyDiaryBookBodyHtml\(d, dayKey\)/.test(page), 'book mode renders paragraphs with floats');
assert(/isOwner\s*\n\s*\? `<textarea/.test(page), 'and a photoless day keeps the plain textarea');
assert(/: `<div class="tripsy-diary-read">/.test(page), 'a viewer gets read-only prose');
assert(/seedBtn\.style\.display = isOwner \? 'inline-block' : 'none'/.test(page),
  'and no draft-writing button at all');

// ---- shell ----
assert(/tripsy-close-x" id="tripsy-diary-close-btn"/.test(html), 'closes with the red X box');
assert(/class="tripsy-attire-cardhead"[\s\S]{0,400}tripsy-diary-title/.test(html), 'header sits on the card');

// ---- there is no Save button, so the page must SAY it saved ----
assert(/id="tripsy-diary-savestate"/.test(html), 'the header carries a save-state line');
assert(/setSaveState\('Saving…'\)/.test(page) && /setSaveState\(ok \? 'Saved' : 'Not saved'\)/.test(page),
  'every save reports in-flight then its outcome');
assert(!/>Save<\/button>/.test(page), 'and no Save button, since persistence is automatic');
// Closing straight from the textarea must not drop the last edit: blur is what persists.
const shell = extractFn('getOrCreateTripsyDiaryOverlay');
assert(/const closeDiary = \(\) => \{[\s\S]*?el\.blur\(\)/.test(shell),
  'closing blurs the focused field first, flushing a pending edit');
assert(/addEventListener\('click', closeDiary\)/.test(shell) && /if \(e\.target === ov\) closeDiary\(\)/.test(shell),
  'both the X and the backdrop go through it');
assert(/ov\.contains\(el\)/.test(shell), 'and only blurs something inside this page');

// ---- phase 3: photo flow ----
assert(/data-diary-photos="\$\{esc\(dayKey\)\}"/.test(page), 'each day has its own Add photos / Done button');
assert(/photoBoxDays\.has\(dayKey\) \? 'Done' : 'Add photos'/.test(page), 'the same button toggles to Done');
assert(/photoBoxDays\.delete\(dayKey\);\s*\n\s*render\(\);/.test(page), 'Done shuts the box');
// Opening the box must switch to paragraph view BEFORE any photo exists, or the + buttons
// are unreachable and there is no way to place the first one.
assert(/photoBoxDays\.add\(dayKey\);\s*\n\s*render\(\);\s*\n\s*await loadDayCandidates/.test(page),
  'asking for photos renders paragraph view first, then fetches candidates');
assert(/data-diary-addphoto="\$\{esc\(dayKey\)\}" data-para-index="\$\{pi\}"/.test(page),
  'every paragraph carries its own + Photo button');
assert(/tripsyPickImageFile\(files => addOwnPhoto\(dayKey, idx, files\)\)/.test(page),
  'which places the picked photos in THAT paragraph');
const picker = extractFn('tripsyPickImageFile');
assert(/data-pick-cam accept="image\/\*" capture="environment"/.test(picker) && /data-pick-lib accept="image\/\*"/.test(picker),
  'the picker offers camera and library as separate inputs');
assert(/input\.value = ''/.test(picker), 're-picking the same file still fires change');
// Several photos of one dinner should be ONE trip through the Photos app.
assert(/data-pick-lib accept="image\/\*" multiple/.test(picker), 'the library input takes a multi-selection');
assert(!/data-pick-cam[^>]*multiple/.test(picker), 'the camera does not -- it returns one shot');
assert(/const files = \[\.\.\.\(input\.files \|\| \[\]\)\]/.test(picker), 'and every picked file is passed on');
// Uploading a batch: sequential (each number depends on the last), one save at the end,
// and a single bad file must not discard the ones that worked.
assert(/for \(let i = 0; i < list\.length; i\+\+\)/.test(page), 'a batch uploads one at a time');
assert(/Uploading \$\{i \+ 1\} of \$\{list\.length\}/.test(page), 'reporting progress through the batch');
assert(/failed\+\+/.test(page) && /await save\(\);\s*\n\s*render\(\);\s*\n\s*if \(failed\)/.test(page),
  'a failure is counted but whatever uploaded is still kept');
// Uploads are resized -- a day of iPhone photos would otherwise be tens of MB.
assert(/tripsyResizeImageBlob\(list\[i\]\)/.test(page), 'every uploaded photo is resized before it goes to Drive');
// Candidates: ✓ places by place-mention, ✕ is remembered.
assert(/tripsyDiaryParagraphForPlace\(paras, c\.placeName\)/.test(page),
  'a ticked candidate lands in the paragraph that mentions its place');
assert(/rejectedPhotoNames: \[\.\.\.new Set\(/.test(page), 'a rejected candidate is remembered');
assert(/rejected\.has\(t\.photoName\) \|\| already\.has\(t\.photoName\)/.test(page),
  'and neither rejects nor already-used photos are offered again');
// Controls live outside the editable prose.
assert(/data-diary-caption/.test(page) && /data-diary-side/.test(page) && /data-diary-move/.test(page)
    && /data-diary-delphoto/.test(page), 'caption, side, move and remove controls exist');
assert(/const nextSide = \{ right: 'left', left: 'full', full: 'right' \}/.test(page), 'side cycles right → left → full');
// Editing a paragraph must not eat its photos.
assert(/tripsyDiarySerializeParagraph\(el\)/.test(page), 'a paragraph is serialized back through the token writer');
// A photo whose token was deleted is offered for re-placement rather than lost.
assert(/data-diary-replace/.test(page) && /not placed —/.test(page), 'an unplaced photo is flagged and re-placeable');
// Painting: the diary uses its own painter, since tripsyWardrobeLoadPhotos ignores these.
assert(/tripsyDiaryPaintPhotos\(content\)/.test(page), 'diary photos are painted by their own painter');
assert(/querySelectorAll\('\[data-diary-img\]'\)/.test(extractFn('tripsyDiaryPaintPhotos')), 'which matches the diary slots');

// ---- phase 4: the printed book ----
assert(/id="tripsy-diary-print-btn"/.test(html), 'the diary header has a Print / PDF button');
const shell2 = extractFn('getOrCreateTripsyDiaryOverlay');
assert(/el\.blur\(\)[\s\S]*?openTripsyDiaryPrintView/.test(shell2),
  'printing blurs first -- an unsaved paragraph would otherwise print as it was before');
assert(/ov\.dataset\.tripKey = tripKey/.test(page), 'the shell knows which trip to print');
const printer = extractFn('openTripsyDiaryPrintView');
assert(/if \(html == null\) \{ toast\(/.test(printer), 'an unwritten diary explains itself rather than printing a blank page');
assert(/getOrCreateTripsyPrintRoot\(\)/.test(printer) && /triggerTripsyPrint\(printRoot\)/.test(printer),
  'and it reuses the existing print path, which waits on image decode');
// The printed page must honour floats regardless of screen width, and keep a caption
// with its photo across a page break.
const css = html.slice(html.indexOf('#tripsy-print-root .dp-book'), html.indexOf('#tripsy-print-root { display: none; }'));
assert(/\.dp-fig \{[^}]*break-inside: avoid/.test(css), 'a figure never straddles a page break');
assert(/\.dp-day \{[^}]*page-break-before: always/.test(css), 'each written day starts its own page');
assert(/\.dp-cover \{[^}]*page-break-after: always/.test(css), 'and the cover stands alone');
assert(!/@media \(max-width/.test(css), 'print floats are not collapsed by a screen breakpoint');
