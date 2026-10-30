import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
import {retrieveRetailPrice,registerRetailPriceAdmin} from './shushuka-retail-prices.mjs';
const isbn='9784757560062';let price=null,calls=0,itemIsbn=isbn;const writes=[];
const db={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{list_price:price}})}),functions:{invoke:async(_name,{body})=>{assert.equal(body.params.outOfStockFlag,'1');calls++;return {data:{ok:true,status:200,body:{Items:[{Item:{isbn:itemIsbn,title:'Provider name',itemPrice:628}}]}}};}},rpc:async(name,args)=>{writes.push({name,args});return {data:true};}};
assert.equal(await retrieveRetailPrice(db,isbn),'acquired');assert.equal(writes.at(-1).args.p_price,628);
itemIsbn='9784757562448';assert.equal(await retrieveRetailPrice(db,isbn),'missing');assert.equal(writes.length,1);
price=500;const before=calls;assert.equal(await retrieveRetailPrice(db,isbn),'skipped');assert.equal(calls,before);
const handlers=new Map();const token=registerRetailPriceAdmin({post:(p,f)=>handlers.set(p,f)},db);let code,redirect;
const res={status(n){code=n;return this},send(){},redirect(_code,url){redirect=url}};
await handlers.get('/cache/prices')({body:{csrf:'invalid',isbn}},res);assert.equal(code,403);
await handlers.get('/cache/prices')({body:{csrf:token,isbn,q:'book & name'}},res);assert(redirect.includes('price_skipped=1'));assert(redirect.includes('q=book+%26+name'));
let appCalls=0,confirmedPrice=null,useConfirmed=true;itemIsbn=isbn;
const modules=new Map();function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async url=>url.includes('api.openbd.jp')?Response.json([{summary:{isbn:'9780306406157',title:'価格テスト 1',author:'著者',publisher:'出版社',cover:'https://cover.openbd.jp/9780306406157.jpg'}}]):url.includes('ndl.go.jp')?new Response(''):Response.json({items:[]}),require:name=>{
 if(name==='./env')return {env:{}};
 if(name==='./supabase')return {supabase:{functions:{invoke:async(_name,{body})=>{assert.equal(body.params.outOfStockFlag,'1');appCalls++;return {data:{ok:true,status:200,body:{Items:[{Item:{isbn:itemIsbn,title:'Provider replacement name',itemPrice:628}}]}}};}}}};
 if(name==='./confirmedBookMetadata')return {getConfirmedBookMetadata:async normalized_isbn=>useConfirmed?({normalized_isbn,title:'Confirmed name',series_title:'Confirmed series',volume_number:9,list_price:confirmedPrice,thumbnail_url:'https://example.test/confirmed.jpg'}):null};
 if(name==='./kana')return {normalizeKanaReading:x=>x};
 if(name==='./knownBookOverrides')return {getKnownBookCoverOverride:()=>undefined,getKnownIsbnCoverOverride:()=>undefined};
 if(!name.startsWith('.'))throw Error(name);return load(path.resolve(path.dirname(file),name)+'.ts');}});return exports;}
const api=load('src/lib/bookApis.ts');const [a,b]=await Promise.all([api.lookupBookRetailPrice(isbn),api.lookupBookRetailPrice(isbn)]);assert.equal(a.listPrice,628);assert.equal(b.listPrice,628);assert.equal(appCalls,1);
const input=await api.lookupBookByIsbn(isbn);assert.equal(input.title,'Confirmed name');assert.equal(input.thumbnailUrl,'https://example.test/confirmed.jpg');assert.equal(input.listPrice,628);assert.equal(appCalls,1);
assert.equal(await api.lookupBookRetailPrice('9784757562448'),null,'A price from another ISBN is never adopted.');
confirmedPrice=777;const kept=await api.lookupBookByIsbn(isbn);assert.equal(kept.listPrice,777);assert.equal(appCalls,2);
console.log('Retail prices: exact printed-book ISBN only, no overwrite, bounded/CSRF admin action, concurrent request reuse, confirmed name/cover and existing price preserved: OK');

confirmedPrice=null;const overrides=load('src/lib/bookMetadataOverrides.ts');const callsBefore=appCalls;const local=await overrides.getBookMetadataOverrideDetails({isbn,title:'User title',seriesTitle:'User series',listPrice:456,priceSource:'manual'});assert.equal(local.listPrice,456);assert.equal(local.priceSource,'manual');assert.equal(appCalls,callsBefore);console.log('A known personal retail price avoids a redundant provider request.');

useConfirmed=false;itemIsbn='9780306406157';const normal=await api.lookupBookByIsbn(itemIsbn);assert.equal(normal.title,'価格テスト 1');assert.equal(normal.listPrice,628);assert.equal(normal.priceSource,'rakuten');
itemIsbn='9784087032925';const companion=await api.lookupBookByIsbn(itemIsbn);assert(companion.title.includes('ウラバナ'));assert.equal(companion.listPrice,628);
const unavailable={isbn:'9784757562448',title:'Manual name',seriesTitle:'Manual series',purchasePrice:110,status:'unread'};const fallback=await api.withBookRetailPrice(unavailable);assert.equal(fallback.purchasePrice,110);assert.equal(fallback.title,'Manual name');assert.equal(fallback.listPrice,undefined);
console.log('New registration: OpenBD cover does not discard Rakuten price; known companion gets price; unavailable price never clears explicit payment/name.');
