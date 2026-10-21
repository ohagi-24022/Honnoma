import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const cache=new Map();let partialFailure=false,calls=0;
const items=Array.from({length:12},(_,n)=>({Item:{isbn:'9780306406157',title:`無関係な作品${String.fromCharCode(65+n)} 1`,largeImageUrl:'https://example.test/cover.jpg'}}));
items.push({Item:{isbn:'9784088800158',title:'目的の作品 1'}});
items.push({Item:{isbn:'9784088800158',title:'目的の作品 2',largeImageUrl:'https://example.test/later.jpg'}});
items.push({Item:{isbn:'9784088800158',title:'目的の作品 フィギュア 1'}});
items.push({Item:{isbn:'9784088800158',title:'目的の作品 音楽 1',booksGenreId:'002'}});
items.push({Item:{isbn:'0000000000000',title:'目的の作品 無効な商品 1'}});
items.push({Item:{isbn:'9784088800264',title:'目的の作品 外伝 1',largeImageUrl:'https://example.test/extra.jpg'}});
const mocks={'./env':{env:{}},'./kana':{normalizeKanaReading:x=>x},'./confirmedBookMetadata':{getConfirmedBookMetadata:async()=>null},'./knownBookOverrides':{getKnownBookCoverOverride:()=>undefined,getKnownIsbnCoverOverride:()=>undefined},'./supabase':{supabase:{functions:{invoke:async(_name,{body})=>{calls++;return {data:{ok:true,status:200,body:partialFailure&&body.path.startsWith('BooksTotal')?null:{Items:items}},error:null};}}}}};
function load(file){const name=path.resolve(file);if(cache.has(name))return cache.get(name);const exports={};cache.set(name,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,require:d=>d in mocks?mocks[d]:load(path.resolve(path.dirname(name),d)+'.ts')});return exports;}
const api=load('src/lib/bookApis.ts');
let results=await api.searchSeriesCandidates('目的の作品');assert.equal(results.length,8);assert.equal(results[0].seriesTitle,'目的の作品');assert.equal(results[0].isbn,'9784088800158');assert.equal(results[1].seriesTitle,'目的の作品 外伝');assert.equal(results[0].sampleTitle,'目的の作品 1');assert(!results.some(x=>/フィギュア|音楽|無効な商品/.test(x.seriesTitle)));
partialFailure=true;results=await api.searchSeriesCandidates('目的の作品');assert.equal(results[0].seriesTitle,'目的の作品');assert.equal(results[0].isbn,'9784088800158');assert.equal(new Set(results.map(x=>x.seriesTitle)).size,results.length);
const before=calls;assert.equal((await api.searchSeriesCandidates('  ')).length,0);assert.equal(calls,before);
console.log('Real wishlist search: exact title survives top-eight cap ahead of unrelated covers/low volumes, spin-offs stay separate, partial provider failure retains valid results, deduplication and blank-query guard: OK');
