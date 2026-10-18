import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const cache = new Map();
function load(file, mocks = {}) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved);
  const exports = {};
  cache.set(resolved, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(resolved, 'utf8') + (resolved.endsWith('/LibraryContext.tsx') ? '\nexport {fromBookRow,toBookInsert,toBookUpdate};' : ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, console, require: (name) => {
    if (name in mocks) return mocks[name];
    if (!name.startsWith('.')) throw new Error(`Unexpected dependency ${name}`);
    return load(path.resolve(path.dirname(resolved), name) + '.ts', mocks);
  } });
  return exports;
}
const { renamedBook, resolveUserSeriesName: resolve } = load('src/lib/userSeriesNames.ts');
const duplicate = load('src/lib/duplicate.ts');
const base = { id: 'one', userId: 'local-user', title: 'ワールドトリガー 1', seriesTitle: 'ワールドトリガー', author: '葦原大介', publisher: '集英社', volumeNumber: 1, status: 'read', createdAt: '2026-10-17' };
const next = { ...base, id: undefined, title: 'ワールドトリガー 2', volumeNumber: 2, status: 'unread' };
const renamed = renamedBook(base, 'ワートリ');
assert.equal(resolve([renamed], next).seriesTitle, 'ワートリ');
const twice = renamedBook(renamed, 'お気に入りの作品');
for (const name of ['ワールドトリガー', 'ワートリ']) {
  assert.equal(resolve([twice], { ...next, seriesTitle: name }).seriesTitle, 'お気に入りの作品');
}
assert.equal(resolve([renamedBook(twice, 'ワールドトリガー')], next).seriesTitle, 'ワールドトリガー');
assert.equal(resolve(JSON.parse(JSON.stringify([twice])), next).seriesTitle, 'お気に入りの作品');
// Legacy renames without aliases can recover from original book title + matching author.
assert.equal(resolve([{ ...base, seriesTitle: 'ワートリ' }], next).seriesTitle, 'ワートリ');
assert.equal(resolve([{ ...base, seriesTitle: 'ワートリ', author: undefined }], next).seriesTitle, next.seriesTitle);
assert.equal(resolve([renamed], { ...next, author: '別の著者' }).seriesTitle, next.seriesTitle);
assert.equal(resolve([renamed], { ...next, publisher: '別の出版社' }).seriesTitle, next.seriesTitle);
assert.equal(resolve([renamed], { ...next, title: 'ワールドトリガー 完全版 2' }).seriesTitle, next.seriesTitle);
assert.equal(resolve([renamed], { ...next, volumeKind: 'extra' }).seriesTitle, next.seriesTitle);
assert.equal(resolve([renamed, renamedBook(base, '別の整理名')], next).seriesTitle, next.seriesTitle);
assert.equal(resolve([base, renamed], next).seriesTitle, 'ワートリ', 'An old split group must not override the renamed destination.');
assert.equal(resolve([], next).seriesTitle, next.seriesTitle);
assert.equal(duplicate.findDuplicateBook([renamed], { ...next, volumeNumber: 1 }).id, base.id);

// Run real provider handlers, including state changes and local persistence effects.
const states = [], refs = [];
let slot = 0, refSlot = 0;
let seed = [base];
const writes = new Map();
const effects = [];
const react = {
  createContext: () => ({ Provider: 'Provider' }),
  useState: (initial) => { const i = slot++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
  useRef: (v) => { const i = refSlot++; return refs[i] ??= { current: v }; },
  useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: (fn) => effects.push(fn),
};
const mocks = {
  react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  'react-native': { AppState: {} },
  '@react-native-async-storage/async-storage': { setItem: async (k, v) => writes.set(k, v) },
  '../lib/asyncStorageCompat': { getStorageItemWithLegacy: async () => null },
  '../lib/bookApis': { lookupBookByIsbn: async () => next },
  '../lib/bookMetadataOverrides': {},
  '../lib/demoLibrary': { createDemoBooks: () => seed, repairDemoBook: (b) => b },
  '../lib/kana': { normalizeKanaReading: (s) => s },
  '../lib/knownBookOverrides': { getKnownBookCoverOverride: () => undefined },
  '../lib/errorMessages': {},
  '../lib/seriesSelectors': { buildSeriesGroups: () => [], buildSeriesItems: () => [] },
  '../lib/supabase': { supabase: null },
  './AuthContext': { useAuth: () => ({ configured: false, initializing: false, user: null }) },
};
const { LibraryProvider, fromBookRow, toBookInsert, toBookUpdate } = load('src/store/LibraryContext.tsx', mocks);
assert.equal(fromBookRow({id:'row',user_id:'u',title:'Book',series_title:'Series',book_format:'novel'}).bookFormat,'novel');
assert.equal(toBookInsert({...next,bookFormat:'comic'},'u','b').book_format,'comic');
assert.equal(toBookUpdate({bookFormat:'novel'}).book_format,'novel');
function render() { slot = 0; refSlot = 0; effects.length = 0; return LibraryProvider({ children: null }).props.value; }
let library = render();
await library.renameSeries('ワールドトリガー', 'ワートリ');
library = render();
await library.addBookByIsbn('test');
library = render();
assert.equal(library.books.length, 2);
assert.ok(library.books.every((b) => b.seriesTitle === 'ワートリ'));
assert.equal(library.findDuplicateBook(next).volumeNumber, 2);
await assert.rejects(() => library.addBook(next), /すでに登録/);
await library.renameSeries('ワートリ', '私の本棚');
library = render();
assert.ok(library.books.every((b) => b.seriesTitle === '私の本棚'));
await library.updateBook(library.books[0].id,{bookFormat:'novel'});
library=render();
assert.equal(library.books[0].bookFormat,'novel');
// Hydration completes, then persistence writes aliases along with the books.
for (const effect of [...effects]) effect();
await new Promise((r) => setTimeout(r, 0));
render();
for (const effect of [...effects]) effect();
const saved = JSON.parse(writes.get('honnoma.library.v1'));
assert.ok(saved.every((b) => b.seriesAliases.includes('ワールドトリガー')));
assert.ok(saved.some(book=>book.bookFormat==='novel'),'Book format is persisted locally with user edits.');
assert.equal(resolve(saved, { ...next, title: 'ワールドトリガー 3', volumeNumber: 3 }).seriesTitle, '私の本棚');
console.log('User series names: real rename/add/duplicate handlers, repeated renames, persisted history, legacy names, ambiguity, author/edition safeguards: OK');
