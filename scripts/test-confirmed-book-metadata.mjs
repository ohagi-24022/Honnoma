import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = (file, require) => {
 const exports={}; vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,console:{warn(){}},Date,setTimeout,clearTimeout,AbortController});return exports;
};
const isbn='9784089082386',storage=new Map();let payload,error,rpcCalls=0;
const asyncStorage={getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>storage.set(key,value),removeItem:async key=>storage.delete(key)};
const known=compile('src/lib/knownBookOverrides.ts',()=>({}));
const confirmed=compile('src/lib/confirmedBookMetadata.ts',name=>name.includes('async-storage')?asyncStorage:name.includes('knownBookOverrides')?known:{supabase:{rpc:()=>({abortSignal:async()=>{rpcCalls++;return {data:payload,error};}})}});
payload={metadata:{normalized_isbn:isbn,title:'ハイキュー!! 15 DVDアニメ同梱版',subtitle:'DVDアニメ同梱版',series_title:'ハイキュー!!',volume_number:15}};
assert.equal((await confirmed.getConfirmedBookMetadata(isbn)).title,payload.metadata.title);
error=new Error('offline');assert.equal((await confirmed.getConfirmedBookMetadata(isbn)).title,payload.metadata.title);
assert.equal(await confirmed.getConfirmedBookMetadata('9784088803166'),undefined); // No same-volume fallback.
error=null;payload={metadata:{normalized_isbn:'9784088803166',title:'Wrong edition'}};
assert.equal((await confirmed.getConfirmedBookMetadata(isbn)).subtitle,'DVDアニメ同梱版'); // Reject wrong ISBN, retain confirmed data.
payload={metadata:null};assert.equal(await confirmed.getConfirmedBookMetadata(isbn),null);
error=new Error('offline');assert.equal(await confirmed.getConfirmedBookMetadata(isbn),undefined); // Withdrawal clears durable copy.
assert.equal(known.getKnownBookMetadataOverride({isbn:'9784088803166',title:'GIFT 久保さん 公式ファンブック'}),undefined);
let providerCalls=0,cacheWrites=0,forceCalls=0;
const cache=compile('src/lib/bookDetailsCache.ts',name=>{
 if(name.includes('async-storage'))return asyncStorage;
 if(name.endsWith('asyncStorageCompat'))return {getStorageItemWithLegacy:async()=>null};
 if(name.endsWith('bookApis'))return {lookupBookVolumeDetails:async(_book,options)=>{assert.equal(options.exactIsbnOnly,true);providerCalls++;return {title:'Wrong provider',description:'Exact ISBN synopsis',thumbnailUrl:'https://wrong.test/cover',source:'Google Books'};}};
 if(name.endsWith('bookMetadataOverrides'))return {getBookMetadataOverrideDetails:async()=>{forceCalls++;return {title:'Confirmed edition',source:'Developer Override'};}};
 if(name.endsWith('series'))return {normalizeSeriesKey:x=>x};
 if(name.endsWith('demoLibrary'))return {getDemoBookDetails:()=>null};
 if(name.endsWith('supabase'))return {supabase:{from:()=>{cacheWrites++;throw new Error('Unexpected provider write');}}};
 throw new Error(name);
});
const book={isbn,id:'test',title:'Old',seriesTitle:'Haikyu',volumeNumber:15};
assert.equal((await cache.getBookVolumeDetails(book,{forceRefresh:true})).title,'Confirmed edition');
assert.equal(providerCalls,1);assert.equal(cacheWrites,0);assert.equal(forceCalls,1);
console.log('Confirmed metadata: offline persistence, exact edition, mismatched response, withdrawal, protected force-refresh: OK');

const result=await cache.getBookVolumeDetails(book);assert.equal(result.title,'Confirmed edition');assert.equal(result.description,'Exact ISBN synopsis');assert.equal(result.thumbnailUrl,undefined);assert.equal(providerCalls,1);assert.equal(cacheWrites,0);
await cache.getBookVolumeDetails(book,{forceRefresh:true});assert.equal(providerCalls,2);
console.log('Confirmed synopsis: missing text supplemented by exact ISBN only, confirmed title/cover preserved, local cache and explicit retry: OK');
