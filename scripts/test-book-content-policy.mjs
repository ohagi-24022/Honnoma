import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Personal search keeps adult titles; public ranking classification is enforced on the server.
const source = readFileSync(new URL('../src/lib/bookApis.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source + '\nexport { googleBookItems };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const series = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/series.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: series });
const exports = {};
vm.runInNewContext(compiled, {
  exports, URLSearchParams,
  require: name => name === './series' ? series : ({ env: {}, getKnownIsbnCoverOverride: () => undefined }),
});
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
