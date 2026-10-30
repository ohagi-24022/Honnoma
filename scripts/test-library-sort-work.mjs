import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';

const context = { exports: {} };
vm.createContext(context);
vm.runInContext(ts.transpileModule(fs.readFileSync('src/lib/series.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
let normalizations = 0;
context.normalizeSeriesKey = value => { normalizations++; return context.exports.normalizeSeriesKey(value); };
context.getKnownSeriesReading = context.exports.getKnownSeriesReading;
const source = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const file = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Set(['toHiraganaSortText', 'normalizeSortText', 'usableReading', 'buildJapaneseSortKey', 'compareSortKey', 'compareText', 'getSeriesReadingSortText', 'buildSeriesReadingSortTextMap']);
const snippets = file.statements.filter(node =>
  ts.isFunctionDeclaration(node) && functions.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ['japaneseSortCollator', 'japaneseStrictSortCollator'].includes(d.name.getText(file))),
).map(node => node.getText(file)).join('\n');
vm.runInContext(ts.transpileModule(snippets, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);

const titles = Array.from({ length: 35 }, (_, i) => `作品${String.fromCharCode(0x4e00 + i)}`);
const books = titles.flatMap((seriesTitle, i) => Array.from({ length: 14 }, (_, j) => ({
  seriesTitle, volumeNumber: j + 1, volumeKind: 'main', seriesReading: `あ${35 - i}`, titleReading: `い${i}`,
})));
// Preserve known readings, corrections, representative-volume priority and the
// fallback when a series has no readable metadata.
books[0].seriesReading = undefined;
books[0].titleReading = undefined;
const corrections = new Map([[context.exports.normalizeSeriesKey(titles[3]), { correctedReading: 'わ' }]]);
assert.equal(context.buildSeriesReadingSortTextMap([], ['ワールドトリガー'], corrections).get('ワールドトリガー'), 'わるどとりが');
assert.equal(context.buildSeriesReadingSortTextMap([], ['作品ABC'], corrections).get('作品ABC'), '作品ABC');
normalizations = 0;
let start = performance.now();
const before = [...titles].sort((a, b) => context.compareText(
  context.getSeriesReadingSortText(books, a, corrections), context.getSeriesReadingSortText(books, b, corrections),
));
const beforeMs = performance.now() - start, beforeWork = normalizations;
normalizations = 0;
start = performance.now();
const readings = context.buildSeriesReadingSortTextMap(books, titles, corrections);
const after = [...titles].sort((a, b) => context.compareText(readings.get(a), readings.get(b)));
const afterMs = performance.now() - start, afterWork = normalizations;
assert.deepEqual(after, before, 'Precomputation must preserve the existing order.');
for (const title of titles) assert.equal(readings.get(title), context.getSeriesReadingSortText(books, title, corrections));
assert(afterWork < beforeWork / 10, 'Comparisons must not rescan the entire library.');
console.log(JSON.stringify({ books: books.length, series: titles.length, beforeNormalizations: beforeWork, afterNormalizations: afterWork,
  beforeMs: Math.round(beforeMs), afterMs: Math.round(afterMs) }));
