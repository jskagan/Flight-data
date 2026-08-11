const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
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
const src = html.match(/const TRIPSY_DIARY_TOKEN_RE = [^\n]*/)[0] + '\n'
  + ['tripsyDiaryParagraphs','tripsyDiaryNextPhotoNo','tripsyDiaryTokenNumbers','tripsyDiaryParagraphForPlace',
     'tripsyDiaryInsertToken','tripsyDiaryRemoveToken','tripsyDiaryMoveToken','tripsyDiarySerializeParagraph',
     'tripsyDiaryUnplacedPhotos'].map(extractFn).join('\n');
eval(src);
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- paragraphs ----
assert(JSON.stringify(tripsyDiaryParagraphs('a\n\nb')) === '["a","b"]', 'blank line splits paragraphs');
assert(JSON.stringify(tripsyDiaryParagraphs('a\n\n\n  \n b ')) === '["a","b"]', 'extra blank lines and padding collapse');
assert(JSON.stringify(tripsyDiaryParagraphs('')) === '[""]', 'an empty day still offers one paragraph to write into');
assert(JSON.stringify(tripsyDiaryParagraphs('one\nline\nbreaks')) === '["one\\nline\\nbreaks"]',
  'single newlines stay INSIDE a paragraph');

// ---- stable numbering ----
assert(tripsyDiaryNextPhotoNo({ photos: [] }) === 1, 'numbering starts at 1');
assert(tripsyDiaryNextPhotoNo({ photos: [{ no: 1 }, { no: 3 }] }) === 4, 'and never reuses a gap -> 4');
assert(tripsyDiaryNextPhotoNo(null) === 1, 'a dayless call is safe');

// ---- placement by place mention ----
const paras = ['We landed at Heathrow and took a car in.', "Dinner was at Brown's, on Albemarle Street.", 'Then bed.'];
assert(tripsyDiaryParagraphForPlace(paras, "Brown's Hotel, a Rocco Forte hotel") === 1,
  'a photo lands in the paragraph that mentions its place, matched on a significant word');
assert(tripsyDiaryParagraphForPlace(paras, 'Heathrow') === 0, 'exact mentions match too');
assert(tripsyDiaryParagraphForPlace(paras, 'Somewhere Never Mentioned') === 2,
  'an unmentioned place falls back to the LAST paragraph, not the first');
assert(tripsyDiaryParagraphForPlace([''], 'Anything') === 0, 'an empty day is index 0');

// ---- insert / remove / move ----
let t = 'First para.\n\nSecond para.';
t = tripsyDiaryInsertToken(t, 1, 1);
assert(t === 'First para.\n\nSecond para. [photo 1]', 'the token appends to its paragraph -> ' + JSON.stringify(t));
t = tripsyDiaryInsertToken(t, 2, 0);
assert(t === 'First para. [photo 1x]'.replace('1x','2') + '\n\nSecond para. [photo 1]', 'a second photo, another paragraph');
assert(JSON.stringify(tripsyDiaryTokenNumbers(t)) === '[2,1]', 'both tokens are found, in text order');
// Moving is by paragraph, and stops at the ends rather than falling off.
let m = tripsyDiaryMoveToken(t, 1, -1);
assert(m === 'First para. [photo 2] [photo 1]\n\nSecond para.', 'moving up puts it in the previous paragraph -> ' + JSON.stringify(m));
assert(tripsyDiaryMoveToken(t, 2, -1) === t, 'moving up from the first paragraph is a no-op');
assert(tripsyDiaryMoveToken(t, 1, 1) === t, 'as is moving down from the last');
assert(tripsyDiaryMoveToken(t, 99, 1) === t, 'moving a token that is not there changes nothing');
// Removing takes its spacing with it.
assert(tripsyDiaryRemoveToken(t, 1) === 'First para. [photo 2]\n\nSecond para.',
  'removing a token leaves no double space -> ' + JSON.stringify(tripsyDiaryRemoveToken(t, 1)));
// Insert into an EMPTY paragraph must not leave a leading space.
assert(tripsyDiaryInsertToken('', 1, 0) === '[photo 1]', 'an empty day gets a bare token');

// ---- serialize an edited paragraph back to text ----
const el = { childNodes: [
  { nodeType: 3, nodeValue: 'We ate at ' },
  { nodeType: 1, tagName: 'FIGURE', getAttribute: k => (k === 'data-photo-no' ? '3' : null), textContent: 'caption text' },
  { nodeType: 3, nodeValue: ' and walked home.' },
] };
assert(tripsyDiarySerializeParagraph(el) === 'We ate at [photo 3] and walked home.',
  'a figure serializes back to its token, not its caption -> ' + tripsyDiarySerializeParagraph(el));
const el2 = { childNodes: [
  { nodeType: 3, nodeValue: 'line one' },
  { nodeType: 1, tagName: 'BR', getAttribute: () => null, textContent: '' },
  { nodeType: 3, nodeValue: 'line two' },
] };
assert(tripsyDiarySerializeParagraph(el2) === 'line one\nline two', 'a <br> becomes a newline');
assert(tripsyDiarySerializeParagraph({ childNodes: [] }) === '', 'an emptied paragraph serializes to empty');

// ---- a photo whose token was deleted is not lost ----
const day = { text: 'Only [photo 1] here.', photos: [{ no: 1 }, { no: 2 }] };
assert(JSON.stringify(tripsyDiaryUnplacedPhotos(day).map(p => p.no)) === '[2]',
  'a photo with no token drops to the unplaced tray rather than vanishing');
assert(tripsyDiaryUnplacedPhotos({ text: 'x', photos: [] }).length === 0, 'no photos, nothing unplaced');
