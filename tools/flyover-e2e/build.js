const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
const a = html.indexOf('// ---- Trip Fly-over ---');
const b = html.indexOf('// ---- Trip Diary storage ---');
const ex = n => { const i = html.indexOf('function ' + n + '('); let d = 0, j = html.indexOf('{', i); for (let k = j; ; k++) { if (html[k] == '{') d++; else if (html[k] == '}' && --d == 0) return html.slice(i, k + 1); } };
const cl = n => { const i = html.indexOf('const ' + n + ' ='); let k = i, d = 0; for (; ; k++) { const c = html[k]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (c == ';' && d == 0) break; } return html.slice(i, k + 1); };
// Helpers outside the fly-over section that the airport-transfer rule (2026-10-22) uses.
const extra = [cl('TRIPSY_JP_PREFECTURES'), cl('TRIPSY_TAXI_GLYPH_SVG'), cl('TRIPSY_TAXI_GLYPH_URL'), cl('TRIPSY_TAXI_ICON_MARKER'), cl('TRIPSY_FLYOVER_ICON_CAMERA_BODY'), cl('TRIPSY_FLYOVER_ICON_ADD_PHOTOS'), cl('TRIPSY_FLYOVER_ICON_EDIT_PHOTOS'), cl('TRIPSY_FLYOVER_ICON_MUSIC'), cl('TRIPSY_FLYOVER_ICON_PREVIEW'), cl('TRIPSY_FLYOVER_ICON_DESTINATIONS'), cl('TRIPSY_FLYOVER_ICON_TRIP_PHOTOS'), cl('TRIPSY_FLYOVER_ICON_UPLOAD'), cl('TRIPSY_FLYOVER_ICON_COMPLETE'), cl('TRIPSY_FLYOVER_ICON_WORKING'), cl('TRIPSY_FLYOVER_ICON_SEGMENTS'), cl('TRIPSY_FLYOVER_SLIDESHOW_SAVE_DEBOUNCE_MS'), cl('TRIPSY_FLYOVER_ICON_EDIT_SLIDESHOW'), 'const tripsyIsPhoneDevice = () => false;',
  ex('tripsyVerifyLodgingCity'), ex('tripsyDescMatchesCity'), cl('tripsyFlyoverInPlaceIds'), cl('TRIPSY_FLYOVER_INPLACE_PX'), ex('tripsyFlyoverPreviewUrlAt'), 'async ' + ex('tripsyFlyoverDrivePhotoUrl')].join('\n');
const block = extra + '\n' + html.slice(a, b);
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body style="background:#111">
<script>
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.toasts=[]; const toast = (m,t) => { window.toasts.push(m); console.log('TOAST', m); };
let isOwner = true; const driveData = { tripsyPlacePhotoCache: {} }; function renderTripsyEventsList(){}
function isTripsyEventEffectivelyHidden(ev){return !!ev.hidden;}
function tripsyPrimaryCityFromAddress(a){ const p=String(a||'').split(',').map(x=>x.trim()); return p.length>1?p[p.length-2].replace(/\\d+/g,'').trim():''; }
const tripsyDayKey = v => String(v||'').slice(0,10) || null;
const formatTripDateRange = (a,b) => a===b? a : a+' – '+b;
const tripsyItineraryStartDayKey = t => '2030-05-01', tripsyItineraryEndDayKey = t => '2030-05-12';
const tripsyTodayDayKey = () => '2030-06-01';
const GEO = { 'LAX airport':[33.94,-118.41,'Los Angeles'], 'Raffles':[1.29,103.85,'Singapore'], 'Ritz':[33.59,130.40,'Fukuoka'], 'Paris':[48.86,2.35,'Paris'] };
const Store = { _r:null, getTripsyFlyover(){return this._r;}, async saveTripsyFlyover(r){ this._r=r; return true; }, async getPlacesApiKey(){ return 'k'; } };
const _fetch = window.fetch;
window.fetch = async (url, opts) => { if (String(url).includes('places.googleapis')) { const q = JSON.parse(opts.body).textQuery; const k = Object.keys(GEO).find(k => q.includes(k)); const g = k && GEO[k]; return { ok:true, json: async()=>({places: g?[{location:{latitude:g[0],longitude:g[1]}, addressComponents:[{types:['locality'],longText:g[2]}]}]:[]}) }; } return _fetch(url, opts); };
async function tripsyWeatherGeocode(){ return null; }
function tripsyPutCachedPhotoBlob(){}
async function tripsyGetCachedPhotoBlob(){ return null; }
async function uploadBlobToDrive(){ return 'f'+Math.random(); }
async function tripsyResizeImageBlob(b){ return b; }
function tripsyPickImageFile(){}
async function tripsyGatherPlacePhotoThumbnailsForQuery(){ return []; }
async function tripsyDiaryPaintPhotos(){}
const colors=['#c33','#3a3','#33c','#cc3'];
async function tripsyPlacePhotoDisplayUrl(id){ const c=document.createElement('canvas'); c.width=800;c.height=600; const x=c.getContext('2d'); x.fillStyle=colors[id.length%4]; x.fillRect(0,0,800,600); x.fillStyle='#fff'; x.font='60px sans-serif'; x.fillText(id,100,300); return c.toDataURL(); }
const leg = (id, category, summary, dep, arr, depAt, arrAt) => ({ id:'t'+id, summary, start:depAt, end:arrAt, tripsyRaw:{resource:'transportation', id, category, departureDescription:dep, arrivalDescription:arr, departureAt:depAt, arrivalAt:arrAt}});
const stay = (id, name, address, start, end) => ({ id:'h'+id, summary:name, start, end, tripsyRaw:{resource:'hosting', id, name, address}});
let tripsyDecryptedTrips = [{ key:'T1', name:'Synthetic Asia Trip', events:[
  leg(1,'airplane','Flight from LAX to SIN','LAX','SIN','2030-05-01T22:00:00','2030-05-03T06:00:00'),
  stay(10,'Raffles','1 Beach Rd, Singapore, Singapore','2030-05-03T15:00:00','2030-05-06T11:00:00'),
  leg(2,'airplane','Flight from SIN to FUK','SIN','FUK','2030-05-06T09:00:00','2030-05-06T16:00:00'),
  stay(11,'Ritz','2 Rd, Fukuoka, Japan','2030-05-06T15:00:00','2030-05-09T11:00:00'),
  leg(3,'train','Train','Fukuoka','Tokyo','2030-05-09T12:00:00','2030-05-09T17:00:00'),
  stay(12,'Paris','1 Rue, Paris, France','2030-05-09T18:00:00','2030-05-11T11:00:00'),
  leg(4,'airplane','Flight from CDG to LAX','CDG','LAX','2030-05-11T12:00:00','2030-05-11T15:00:00'),
]}];
<\/script>
<script>${block.replace(/<\/script>/g,'<\\/script>')}<\/script>
</body></html>`;
fs.writeFileSync(__dirname + '/harness.html', page);
