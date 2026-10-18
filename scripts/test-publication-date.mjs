import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/publicationDate.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {formatPublicationDate:f}=exports;
for(const [input,expected] of [
 ['2026-10-17','2026年10月17日'],['2026年10月17日','2026年10月17日'],['20261017','2026年10月17日'],
 ['2026/10/17','2026年10月17日'],['２０２６年１０月１７日','2026年10月17日'],['2024-02-29','2024年2月29日'],
 ['2026-10','2026年10月'],['202610','2026年10月'],['2026','2026年'],['2026年10月上旬','2026年10月上旬'],['2026年10月頃','2026年10月頃'],
])assert.equal(f(input),expected);
for(const input of [undefined,null,'','not a date','2023-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','0000-01-01'])assert.equal(f(input),undefined);
console.log('Publication dates: Japanese/ISO/compact, partial precision, leap years, invalid dates: OK');
