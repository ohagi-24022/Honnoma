import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
function load(file, mocks = {}) {
  const resolved = path.resolve(file);
  if (modules.has(resolved)) return modules.get(resolved);
  const exports = {};
  modules.set(resolved, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, require: (name) => {
    if (name in mocks) return mocks[name];
    if (!name.startsWith('.')) throw new Error(`Unexpected dependency ${name}`);
    return load(path.resolve(path.dirname(resolved), name) + '.ts', mocks);
  } });
  return exports;
}
const registration = load('src/lib/bookRegistration.ts');
const { addMissingVolume, DuplicateBookError, missingVolumeInput } = registration;
const {missingRegistrationTargets}=registration;
const firstOwned={id:'first',title:'化物語 1',seriesTitle:'化物語',volumeNumber:1,volumeKind:'main'};
assert.deepEqual(Array.from(missingRegistrationTargets('化物語',[firstOwned],5,'user'),item=>item.volumeNumber),[2,3,4,5],'New series works before a publication cache exists.');
assert.equal(missingRegistrationTargets('化物語',[firstOwned],5,'user',3).length,2,'Known publication limits are respected.');
assert.equal(missingRegistrationTargets('化物語',[{...firstOwned,volumeKind:'extra'}],1,'user').length,1,'Companions do not count as owned main volumes.');
for(const invalid of [0,-1,NaN,501,1.5]) assert.equal(missingRegistrationTargets('化物語',[],invalid,'user').length,0);

const item = { id: 'missing-5', userId: 'local-user', isMissing: true, seriesTitle: '化物語', title: '化物語 5', volumeNumber: 5, status: 'missing', createdAt: '' };
const metadata = { isbn: '9784065148891', title: '化物語（5）', seriesTitle: '化物語', volumeNumber: 5, author: '西尾維新, 大暮維人', publisher: '講談社', status: 'unread' };
let added = [], lookups = 0;
const lookup = async () => { lookups++; return metadata; };
const add = async (input) => { added.push(input); return { ...input, id: 'registered', userId: 'local-user', createdAt: '' }; };
await addMissingVolume(item, [], lookup, add);
assert.equal(added[0].isbn, '9784065148891');
const owned = { ...metadata, id: 'owned', userId: 'local-user', createdAt: '' };
assert.equal(await addMissingVolume(item, [owned], lookup, add), null);
assert.equal(lookups, 1, 'Already owned volumes require no provider call.');
await assert.rejects(() => addMissingVolume(item, [], lookup, async () => { throw new DuplicateBookError('ISBN conflict', 'isbn'); }), /ISBN conflict/);
assert.equal(added.length, 1, 'A conflicting ISBN must never be removed and retried.');
assert.equal(await addMissingVolume(item, [], lookup, async () => { throw new DuplicateBookError('Volume exists', 'volume'); }), null);
await assert.rejects(() => addMissingVolume(item, [], lookup, async () => { throw Error('network failure'); }), /network failure/);
for (const wrong of [
  { ...metadata, title: '化物語（6）' }, { ...metadata, seriesTitle: '別の作品' },
  { ...metadata, volumeNumber: 6 }, { ...metadata, title: '化物語（5）特装版' },
]) assert.equal(missingVolumeInput(item, wrong).isbn, undefined);
const conflict = { ...owned, title: '誤った登録の6巻', volumeNumber: 6 };
await assert.rejects(() => addMissingVolume(item, [conflict], lookup, add), /誤った登録の6巻/);

// Verify the actual API chooses the publisher-confirmed ISBN for the reported volume
// without making network calls or selecting a special edition.
const api = load('src/lib/bookApis.ts', {
  './env': { env: {} }, './kana': { normalizeKanaReading: (s) => s },
  './knownBookOverrides': { getKnownBookCoverOverride: () => undefined, getKnownIsbnCoverOverride: () => undefined },
  './supabase': { supabase: null }, './confirmedBookMetadata': { getConfirmedBookMetadata: async () => null },
});
assert.equal((await api.lookupBookByTitle('化物語 5巻')).isbn, metadata.isbn);
assert.equal((await api.lookupBookByTitle('化物語（５）')).volumeNumber, 5);
assert.notEqual((await api.lookupBookByTitle('化物語（5）特装版'))?.isbn, metadata.isbn);
assert.notEqual((await api.lookupBookByTitle('化物語 5巻', '9784065148907'))?.isbn, metadata.isbn, 'An explicitly requested special-edition ISBN must not be replaced by the regular edition.');

// Verify the Supabase proxy actually receives an abort signal and releases its
// timer when the request times out, without sending an external request.
let timeoutCallback, cancelled = false, proxySignal;
const proxyExports = {};
const proxyRequire = (name) => {
  if (name === './supabase') return { supabase: { functions: { invoke: async (_name, options) => {
    proxySignal = options.signal;
    await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    return { data: null, error: { message: 'timed out' } };
  } } } };
  if (name === './env') return { env: {} };
  if (name === './confirmedBookMetadata') return { getConfirmedBookMetadata: async () => null };
  if (name === './knownBookOverrides') return { getKnownIsbnCoverOverride: () => undefined, getKnownBookCoverOverride: () => undefined };
  if (name === './kana') return { normalizeKanaReading: (s) => s };
  return load(path.resolve('src/lib', name) + '.ts');
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/bookApis.ts', 'utf8') + '\nexport { fetchRakutenProxy };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: proxyExports, require: proxyRequire, AbortController, URLSearchParams,
  setTimeout: (fn) => { timeoutCallback = fn; return 1; }, clearTimeout: () => { cancelled = true; }, console,
});
const timedRequest = proxyExports.fetchRakutenProxy({ path: 'test', params: {} }, 12);
timeoutCallback();
assert.equal((await timedRequest).status, 503);
assert.equal(proxySignal.aborted, true);
assert.equal(cancelled, true);

// Exercise the screen's real bulk handler. A failed volume must not prevent the
// following volumes from being added, and a retry must not add those twice.
const seriesSource = fs.readFileSync('app/series/[title].tsx', 'utf8');
const bulkSource = seriesSource.slice(seriesSource.indexOf('  const addMissingVolumesAsOwnedQueue ='), seriesSource.indexOf('  const addMissingToWishlist ='));
const bulkBooks = [], alerts = [], providerCalls = [], progressResults = [];
let failFive = true;
const bulkContext = {
  books: bulkBooks, bulkFillTargetVolume: '7', seriesTitle: '化物語',
  beginRegistration: () => 1, updateRegistration() {}, finishRegistration: (_id,result) => progressResults.push(result),
  bulkFillMissingTargets: [5, 6, 7].map((n) => ({ ...item, volumeNumber: n, title: `化物語 ${n}` })),
  setBulkFillRunning() {}, setBulkFillProgress() {}, setBulkFillOpen() {}, setBulkFillTargetVolume() {}, refreshLibrary() {},
  Alert: { alert: (...args) => alerts.push(args) }, addMissingVolume,
  lookupBookByTitle: async (title) => { providerCalls.push(title); const n = Number(title.match(/(\d+)巻/)[1]); return { ...metadata, title: `化物語（${n}）`, volumeNumber: n, isbn: `isbn-${n}` }; },
  addBook: async (input) => { if (input.volumeNumber === 5 && failFive) throw new DuplicateBookError('ISBN conflict', 'isbn'); const book = { ...input, id: input.isbn, userId: 'local-user', createdAt: '' }; bulkBooks.push(book); return book; },
  wait: async () => {}, MISSING_VOLUME_QUEUE_INTERVAL_MS: 6500,
};
vm.createContext(bulkContext);
vm.runInContext(ts.transpileModule(bulkSource + '\nglobalThis.runBulk = addMissingVolumesAsOwnedQueue;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bulkContext);
await bulkContext.runBulk();
assert.equal(bulkBooks.length, 2);
assert.deepEqual(bulkBooks.map((b) => b.volumeNumber), [6, 7]);
assert.equal(progressResults.at(-1).added, 2);
assert.equal(progressResults.at(-1).failures.length, 1);
failFive = false;
await bulkContext.runBulk();
assert.equal(bulkBooks.length, 3);
assert.equal(progressResults.at(-1).skipped, 2);
assert.equal(providerCalls.length, 4, 'Retry looks up only the previously failed volume.');

// Render the real screen and operate its buttons with a deferred provider request.
const registrationAdds = [], navigationCalls = [];
const states = [], refs = [];
let stateIndex = 0, refIndex = 0, focused = true, onAppState;
let tourFocus=null;
const effects = [];
let lookupImpl = async () => null, searchCount = 0;
let titleSearchImpl = async () => [], titleSearchCount = 0;
const nativeNames = ['ActivityIndicator','Alert','KeyboardAvoidingView','Pressable','ScrollView','Switch','Text','TextInput','View'];
const native = Object.fromEntries(nativeNames.map((name) => [name, name]));
native.StyleSheet = { create: (v) => v, absoluteFillObject: {} };
native.Platform = { OS: 'ios' };
native.AppState = { currentState: 'active', addEventListener: (_name, fn) => { onAppState = fn; return { remove() {} }; } };
const colors = new Proxy({}, { get: () => '#123456' });
const mocks = {
  '../../src/store/OnboardingContext': { useOnboardingTour:()=>({focus:tourFocus}) },
  react: {
    useState: (v) => { const i = stateIndex++; if (!(i in states)) states[i] = typeof v === 'function' ? v() : v; return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef: (v) => { const i = refIndex++; return refs[i] ??= { current: v }; },
    useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: (fn) => { effects.push(fn); },
  },
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  'react-native': native,
  'expo-router/react-navigation': { useIsFocused: () => focused, useScrollToTop() {} },
  'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, () => {}] },
  'expo-router': { useRouter: () => ({ replace: route => navigationCalls.push(route) }) },
  '../../src/components/BookCover': { BookCover: 'BookCover' },
  '../../src/components/BookFormatControl': { BookFormatControl: 'BookFormatControl' },
  '../../src/lib/bookApis': { searchBookCandidates: async (q) => { titleSearchCount++; return titleSearchImpl(q); }, isBookIsbnBarcode: (s) => /^97[89]\d{10}$/.test(s), lookupBookByIsbn: async (isbn) => { searchCount++; return lookupImpl(isbn); } },
  '../../src/lib/errorMessages': { formatNetworkAwareError: (e) => e?.message ?? '', NETWORK_ERROR_MESSAGE: 'offline' },
  '../../src/lib/scanQueueReviewBridge': { registerScanQueueReviewHandler: () => () => {} },
  '../../src/store/AppSettingsContext': { useAppSettings: () => ({ trackPurchasePrices: false }) },
  '../../src/store/LibraryContext': { useLibrary: () => ({ books: [], findDuplicateBook: () => undefined, addBook: async input => { registrationAdds.push(input); return {...input,id:'saved-book',seriesTitle:'自分の化物語'}; } }) },
  '../../src/store/ThemeContext': { useAppTheme: () => ({ colors }) },
};
const Screen = load('app/(tabs)/scan.tsx', mocks).default;
function render() { stateIndex = 0; refIndex = 0; effects.length = 0; return Screen(); }
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
const content = (tree) => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(content).join('') : content(tree?.props?.children ?? '');
const find = (tree, predicate) => nodes(tree).find(predicate);
let tree = render();
for (const effect of effects) effect();
assert.ok(find(tree, (n) => n.type === 'CameraView'));
const staleBarcodeHandler=find(tree,n=>n.type==='CameraView').props.onBarcodeScanned;
tourFocus='scan';tree=render();
assert.ok(!find(tree,n=>n.type==='CameraView'),'Onboarding must never start the real camera.');
assert.match(content(tree),/ここでISBNバーコード/);
const beforeGuideSearches=searchCount;
await staleBarcodeHandler({data:'9784065148891'});
assert.equal(searchCount,beforeGuideSearches,'Even a stale barcode callback must be blocked when the guide starts.');
tourFocus=null;tree=render();
assert.equal(find(tree, (n) => n.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
find(tree, (n) => n.type === 'Pressable' && content(n) === 'スキャン停止').props.onPress();
tree = render(); assert.ok(!find(tree, (n) => n.type === 'CameraView'));
find(tree, (n) => n.type === 'Pressable' && content(n) === 'スキャン再開').props.onPress();
tree = render(); assert.ok(find(tree, (n) => n.type === 'CameraView'));
find(tree, (n) => n.type === 'Switch').props.onValueChange(true);
tree = render(); assert.ok(!find(tree, (n) => n.type === 'CameraView'));
assert.equal(nodes(tree).filter(n=>n.props?.placeholder==='作品名・巻数で検索').length,1);
await find(tree, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'ISBNで検索').props.onPress();
tree = render(); assert.match(content(tree), /ISBNを入力してから/); assert.equal(searchCount, 0);
find(tree, (n) => n.type === 'TextInput' && n.props.placeholder === 'ISBN').props.onChangeText('９７８４０６５１４８８９１');
tree = render();
let release;
lookupImpl = () => new Promise((resolve) => { release = resolve; });
const search = find(tree, (n) => n.props?.accessibilityLabel === 'ISBNで検索').props.onPress;
const inFlight = search(); await search();
assert.equal(searchCount, 1, 'Immediate double taps must issue only one request.');
tree = render();
assert.ok(find(tree, (n) => n.type === 'ActivityIndicator'));
assert.equal(find(tree, (n) => n.props?.accessibilityLabel === 'ISBNを検索中').props.disabled, true);
release(null); await inFlight;
tree = render(); assert.match(content(tree), /書籍データが見つかりませんでした/);
assert.equal(find(tree, (n) => n.props?.accessibilityLabel === 'ISBNで検索').props.disabled, false);
lookupImpl = async () => { throw Error('通信に失敗しました'); };
await find(tree, (n) => n.props?.accessibilityLabel === 'ISBNで検索').props.onPress();
tree = render(); assert.match(content(tree), /通信に失敗しました/);
find(tree, (n) => n.type === 'Switch').props.onValueChange(false);
tree = render(); assert.ok(find(tree, (n) => n.type === 'CameraView'));
onAppState('background'); tree = render(); assert.ok(!find(tree, (n) => n.type === 'CameraView'));
onAppState('active'); focused = false; tree = render(); assert.ok(!find(tree, (n) => n.type === 'CameraView'));
focused = true; tree = render();
find(tree, (n) => n.type === 'Switch').props.onValueChange(true);
tree=render();
tree = render();
await find(tree, n=>n.props?.accessibilityLabel==='作品名で検索').props.onPress();
tree = render(); assert.match(content(tree), /作品名を入力してください/); assert.equal(titleSearchCount,0);
find(tree,n=>n.props?.placeholder==='作品名・巻数で検索').props.onChangeText('化物語 5巻');
tree=render();
let finishTitleSearch;
titleSearchImpl=()=>new Promise(resolve=>{finishTitleSearch=resolve;});
const titleSearch=find(tree,n=>n.props?.accessibilityLabel==='作品名で検索').props.onPress;
const pendingTitleSearch=titleSearch(); await titleSearch();
tree=render(); assert.equal(titleSearchCount,1); assert.ok(find(tree,n=>n.type==='ActivityIndicator'));
finishTitleSearch([]); await pendingTitleSearch;
tree=render(); assert.match(content(tree),/作品が見つかりませんでした/);
titleSearchImpl=async()=>{throw Error('通信に失敗しました');};
await find(tree,n=>n.props?.accessibilityLabel==='作品名で検索').props.onPress();
tree=render(); assert.match(content(tree),/通信に失敗しました/);
titleSearchImpl=async()=>[{...metadata,bookFormat:'comic'},{...metadata,title:'小説 化物語 5',isbn:'novel-fixture',bookFormat:'novel'}];
await find(tree,n=>n.props?.accessibilityLabel==='作品名で検索').props.onPress();
tree=render();
const searchFormatControl=find(tree,n=>n.type==='BookFormatControl' && n.props.label==='検索する本の種類');
searchFormatControl.props.onChange('novel');tree=render();
assert.equal(nodes(tree).filter(n=>n.type==='BookCover').length,1);
assert.equal(find(tree,n=>n.type==='BookCover').props.isbn,'novel-fixture');
find(tree,n=>n.type==='BookFormatControl' && n.props.label==='検索する本の種類').props.onChange('comic');tree=render();
assert.equal(find(tree,n=>n.type==='BookCover').props.isbn,metadata.isbn);
find(tree,n=>n.props?.accessibilityLabel===`${metadata.title}の登録内容を確認`).props.onPress();
tree = render();
assert.match(content(tree), /化物語（5）/);
assert.ok(!find(tree, (n) => n.type === 'CameraView'));
assert.ok(!find(tree, (n) => n.type === 'ActivityIndicator'));
assert.equal(nodes(tree).filter(n=>n.props?.placeholder==='作品名・巻数で検索').length,0,'Candidates selected: manual form is hidden.');
// Series registration starts from the scanner, preserving manual title search separately.
find(tree,n=>n.type==='Pressable' && content(n)==='修正する').props.onPress();
tree=render();
find(tree,n=>n.props?.accessibilityLabel==='スキャンからシリーズ登録を始める').props.onPress();
tree=render();
assert.ok(find(tree,n=>n.type==='CameraView'),'Series registration activates the camera.');
assert.equal(find(tree,n=>n.props?.placeholder==='作品名・巻数で検索'),undefined,'A scan entry does not require title search.');
find(tree,n=>n.type==='Pressable' && content(n)==='通常').props.onPress();
tree=render();
assert.equal(find(tree,n=>n.props?.accessibilityLabel==='スキャンからシリーズ登録を始める').props.accessibilityState.selected,false);
find(tree,n=>n.props?.accessibilityLabel==='スキャンからシリーズ登録を始める').props.onPress();
tree=render();
lookupImpl=async()=>metadata;
await find(tree,n=>n.type==='CameraView').props.onBarcodeScanned({data:metadata.isbn});
tree=render();
assert.ok(!find(tree,n=>n.type==='CameraView'),'Confirm the scanned book before entering the volume range.');
assert.match(content(tree),/化物語（5）/);
assert.equal(registrationAdds.length,0,'Scanning alone must not register any books.');
find(tree,n=>n.type==='Pressable' && content(n)==='登録して巻数を選ぶ').props.onPress();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(registrationAdds.length,1,'The entry registers one selected book, never automatically all volumes.');
assert.equal(navigationCalls.at(-1).pathname,'/series/[title]');
assert.equal(navigationCalls.at(-1).params.bulk,'1');
assert.equal(navigationCalls.at(-1).params.title,'自分の化物語','Navigation must use the saved user series name.');

// Execute the series screen's actual route-entry effect: open the panel only,
// retain a manually entered limit on rerender, and never begin an add job.
const entrySource=seriesSource.slice(seriesSource.indexOf('  const bulkEntryRoute = useRef'),seriesSource.indexOf('  const bulkFillTarget = Number.parseInt'));
const routeRef={current:''}; let panelOpen=false, target='';
const routeContext={useRef:()=>routeRef,useEffect:fn=>fn(),params:{bulk:'1'},seriesTitle:'化物語',latestKnownMainVolume:13,
 setBulkFillOpen:value=>{panelOpen=value;},setBulkFillTargetVolume:fn=>{target=fn(target);}};
vm.createContext(routeContext);
const entryCode=ts.transpileModule(`(()=>{${entrySource}})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInContext(entryCode,routeContext);
assert.equal(panelOpen,true);assert.equal(target,'13');
target='5';vm.runInContext(entryCode,routeContext);assert.equal(target,'5');
routeRef.current='';routeContext.params={};panelOpen=false;vm.runInContext(entryCode,routeContext);assert.equal(panelOpen,false);
// A lookup that began before the tour must not open a confirmation afterward.
tourFocus=null;tree=render();
let resolveBeforeTour;
lookupImpl=()=>new Promise(resolve=>{resolveBeforeTour=resolve;});
const scanBeforeTour=find(tree,n=>n.type==='CameraView').props.onBarcodeScanned({data:'9784065244814'});
tourFocus='series';tree=render();assert.ok(!find(tree,n=>n.type==='CameraView'));
resolveBeforeTour(metadata);await scanBeforeTour;
tree=render();assert.equal(find(tree,n=>n.type==='Pressable'&&content(n)==='修正する'),undefined);
assert.equal(registrationAdds.length,1,'The tour does not register a late lookup result.');
console.log('Scan and registration: keyboard taps, inline search progress, loading animation, double taps, validation, failure recovery, camera stop/manual/background, exact 化物語5 ISBN, safe duplicate handling, title candidates/progress/errors/selection, bulk registration entry and editable route panel: OK');
