import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// Personal search keeps adult titles; public ranking classification is enforced on the server.
const cache = new Map();
const mocks = {
  './env': { env: {} },
  './supabase': { supabase: null },
  './confirmedBookMetadata': { getConfirmedBookMetadata: async () => null },
  './knownBookOverrides': { getKnownBookCoverOverride: () => undefined, getKnownIsbnCoverOverride: () => undefined },
};
function load(filename, entry = false) {
  const name = path.resolve(filename);
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  cache.set(name, exports);
  const source = readFileSync(name, 'utf8') + (entry ? '\nexport { googleBookItems };' : '');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    require: dependency => dependency in mocks ? mocks[dependency] : load(path.resolve(path.dirname(name), dependency) + '.ts'),
  });
  return exports;
}
const exports = load(fileURLToPath(new URL('../src/lib/bookApis.ts', import.meta.url)), true);
const { googleBookItems, buildPurchaseUrl } = exports;
const items = [
  { id: 'adult', volumeInfo: { title: 'Example', maturityRating: 'MATURE', imageLinks: { thumbnail: 'https://example.test/adult.jpg' } } },
  { id: 'general', volumeInfo: { title: 'Example', maturityRating: 'NOT_MATURE' } },
  { id: 'unclassified', volumeInfo: { title: 'Example' } },
  { id: 'dvd', volumeInfo: { title: 'Example DVD', maturityRating: 'NOT_MATURE' } },
];
assert.deepEqual(Array.from(googleBookItems({ items }), item => item.id), ['adult', 'general', 'unclassified']);
assert.equal(googleBookItems({}).length, 0);
// A typed title or restored list cannot supply an executable URL or change the purchase host.
const title = 'javascript:alert(1) & redirect=https://example.test/';
const url = new URL(buildPurchaseUrl(title, 2));
assert.equal(url.protocol, 'https:');
assert.equal(url.hostname, 'books.rakuten.co.jp');
assert.equal(url.searchParams.get('sitem'), `${title} 2巻 本`);
console.log('個人検索で成人向け登録を妨げないこと・購入URLの入力分離: OK');
