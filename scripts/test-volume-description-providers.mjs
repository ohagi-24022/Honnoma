import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const modules=new Map();let payload,requests=[];
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);let source=fs.readFileSync(file,'utf8');if(file.endsWith('/bookApis.ts'))source+='\nexport {lookupGoogleBookVolumeDetails,lookupOpenBdVolumeDetails};';vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async url=>{requests.push(url);return {ok:true,json:async()=>payload};},require:name=>{
 if(name==='./env')return {env:{}};if(name==='./supabase')return {supabase:null};if(name==='./confirmedBookMetadata')return {getConfirmedBookMetadata:async()=>null};if(name==='./kana')return {normalizeKanaReading:x=>x};if(name==='./knownBookOverrides')return {getKnownBookCoverOverride:()=>undefined,getKnownIsbnCoverOverride:()=>undefined};if(!name.startsWith('.'))throw Error(name);return load(path.resolve(path.dirname(file),name)+'.ts');}});return exports;}
const api=load('src/lib/bookApis.ts');
const book={isbn:'9784088917177',title:'推しの子 2',seriesTitle:'推しの子',volumeNumber:2};
payload={items:[{volumeInfo:{title:book.title,industryIdentifiers:[{identifier:'9784088918013'}],description:'Wrong ISBN'}}]};
assert.equal(await api.lookupGoogleBookVolumeDetails(book),null);
payload.items[0].volumeInfo.industryIdentifiers[0].identifier=book.isbn;
assert.equal((await api.lookupGoogleBookVolumeDetails(book)).description,'Wrong ISBN');
payload=[{summary:{isbn:'9784088918013',title:book.title},onix:{CollateralDetail:{TextContent:[{TextType:'03',Text:'Other volume'}]}}}];assert.equal(await api.lookupOpenBdVolumeDetails(book),null);
payload[0].summary.isbn=book.isbn;assert.equal((await api.lookupOpenBdVolumeDetails(book)).description,'Other volume');
payload={items:[]};requests=[];await api.lookupBookVolumeDetails(book,{exactIsbnOnly:true});assert(requests.every(url=>!url.includes('intitle')));
console.log('Synopsis providers: wrong ISBN never replaces the requested volume, exact ISBN text accepted, confirmed supplement never falls back to title search: OK');
