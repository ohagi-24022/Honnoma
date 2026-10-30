// Read-only provider integration check. Never adds books to a real account.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import ts from 'typescript';import {createClient} from '@supabase/supabase-js';
if(!process.argv.includes('--live'))throw Error('Use --live to call the bibliographic providers.');
for(const file of ['.env.local','.env'])if(fs.existsSync(file))process.loadEnvFile(file);
const url=process.env.EXPO_PUBLIC_SUPABASE_URL,key=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if(!url||!key)throw Error('Public app connection settings are unavailable.');
assert.equal(new URL(url).hostname,'ccaregwftbjqwaztvwdu.supabase.co');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const modules=new Map();let providerCalls=0,warnings=0;
const proxy={functions:{invoke:async(...args)=>{providerCalls++;return db.functions.invoke(...args);}}};
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch,console:{warn(){warnings++;}},require:name=>{
 if(name==='./env')return {env:{}};
 if(name==='./supabase')return {supabase:proxy};
 if(name==='./confirmedBookMetadata')return {getConfirmedBookMetadata:async()=>null}; // Deliberately bypass all prefilled confirmed/cache prices.
 if(name==='./kana')return {normalizeKanaReading:x=>x};
 if(!name.startsWith('.'))throw Error('Unexpected dependency '+name);
 return load(path.resolve(path.dirname(file),name)+'.ts');
}});return exports;}
const api=load('src/lib/bookApis.ts');
for(const isbn of ['9784088838199','9784087032925']){
 const input=await api.lookupBookByIsbn(isbn);assert(input,'No matching book');
 const ready=await api.withBookRetailPrice(input);
 assert.equal(ready.isbn,isbn);assert(ready.listPrice>0,'Retail price absent');assert.equal(ready.priceSource,'rakuten');
 console.log(JSON.stringify({kind:'new-isbn-registration',isbn,title:ready.title,listPrice:ready.listPrice,priceSource:ready.priceSource}));
}
const {addMissingVolume}=load('src/lib/bookRegistration.ts');
const item={id:'integration-only',title:'カグラバチ 1',seriesTitle:'カグラバチ',volumeNumber:1,status:'missing',isMissing:true};
const added=await addMissingVolume(item,[],api.lookupBookByTitle,async input=>({...await api.withBookRetailPrice(input),id:'integration-local',userId:'integration-local',createdAt:new Date().toISOString()}));
assert(added?.listPrice>0,'Series registration price absent');assert.equal(added.isbn,'9784088838199');
console.log(JSON.stringify({kind:'series-registration',isbn:added.isbn,title:added.title,listPrice:added.listPrice,priceSource:added.priceSource}));
console.log(JSON.stringify({providerCalls,warnings,confirmedPricesBypassed:true,realAccountWrites:0}));
