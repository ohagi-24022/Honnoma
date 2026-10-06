import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(path, require) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require });
  return exports;
}
const series = loadModule('../src/lib/series.ts');
const { buildRankingRows } = loadModule('../src/lib/rankings.ts', (name) => {
  assert.equal(name, './series');
  return series;
});
const row = (title, values = {}) => ({
  title, cover_url: null, want_count: 0, owner_count: 0, favorite_count: 0,
  owned_volume_count: 0, average_score: null, top_score: null, popularity_score: 0,
  ...values,
});
const rows = [
  row('欲しいだけ', { want_count: 4 }),
  row('欲しいが多く所持は1人', { want_count: 4, owner_count: 1, owned_volume_count: 2 }),
  row('所持3人', { owner_count: 3, owned_volume_count: 8, want_count: 1 }),
  row('所持4人', { owner_count: 4, owned_volume_count: 5 }),
  row('お気に入りだけ', { favorite_count: 3 }),
];
const titles = (category, data = rows) => Array.from(buildRankingRows(category, data, []), (r) => r.title);
assert.deepEqual(titles('owned'), ['所持4人', '所持3人']);
assert.deepEqual(new Set(titles('wanted')), new Set(['欲しいだけ', '欲しいが多く所持は1人']));
assert.deepEqual(titles('favorite'), ['お気に入りだけ']);
assert.equal(titles('overall').length, rows.length);
// Normalizing titles must not promote separate, below-threshold counts to public rankings.
assert.deepEqual(titles('owned', [row('作品!', { owner_count: 2 }), row('作品！', { owner_count: 1 })]), []);
const tied = [
  row('欲しいが多い', { owner_count: 3, owned_volume_count: 4, want_count: 10 }),
  row('所持冊数が多い', { owner_count: 3, owned_volume_count: 8 }),
];
assert.deepEqual(titles('owned', tied), ['所持冊数が多い', '欲しいが多い']);
const personal = buildRankingRows('personal', [], [{ title: '個人の欲しい作品', score: 80 }]);
assert.equal(personal.length, 1);
console.log('ランキングのカテゴリ別人数条件・欲しいのみの除外・所持順・個人リスト: OK');
