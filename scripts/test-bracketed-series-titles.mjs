import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/series.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
for (const title of ['【推しの子】 13', '「作品名」 2', '『作品名』 第3巻']) {
  const parsed = exports.parseSeriesTitle(title);
  assert(!/\d/.test(parsed.seriesTitle), title);
  assert(parsed.volumeNumber > 0, title);
}
assert.equal(exports.normalizeSeriesKey('【推しの子】 13'), exports.normalizeSeriesKey('推しの子'));
assert.equal(exports.parseSeriesTitle('作品名（コミック） 2').seriesTitle, '作品名');
assert.equal(exports.parseSeriesTitle('オリエント（16）').volumeNumber, 16);
console.log('Bracketed series names keep the actual title and exclude the volume from its identity: OK');
