import assert from 'node:assert/strict';
import {processCatalogPrices,registerCatalogPriceAdmin} from './shushuka-catalog-prices.mjs';
const isbns=['9784757560062','9784757562448','9784088838199','9784087032925','9784087033076'];
const jobs=isbns.map(isbn13=>({isbn13,lease_token:'lease',title:'Original admin title'}));
const writes=[],requests=[],sleeps=[];let enabled=true;
const db={from(table){let isbn;const q={select(){return q},eq(k,v){if(k==='normalized_isbn')isbn=v;return q},single:async()=>({data:{enabled}}),maybeSingle:async()=>({data:table==='book_metadata_cache'&&isbn===isbns[2]?{list_price:777}:null})};return q;},
 rpc:async(name,args)=>{if(name==='claim_catalog_price_jobs')return {data:jobs};writes.push({name,args});return {data:true};},
 functions:{invoke:async(name,{body})=>{assert.equal(name,'rakuten-books');assert.equal(body.params.outOfStockFlag,'1');requests.push(body.params.isbn);if(body.params.isbn===isbns[3])return {data:{ok:false,status:429}};return {data:{ok:true,status:200,body:{Items:[{Item:{isbn:body.params.isbn===isbns[1]?isbns[0]:body.params.isbn,title:'Provider verified title',itemPrice:550}}]}}};}}
};
const result=await processCatalogPrices(db,{sleep:async ms=>sleeps.push(ms),now:()=>0});
assert.deepEqual(result.outcomes.map(x=>x.result),['acquired','missing','existing','rate_limit','deferred']);
assert.deepEqual(requests,[isbns[0],isbns[1],isbns[3]]);assert.deepEqual(sleeps,[1000,1000,1000]);
assert.equal(writes[0].args.p_book.title,'Provider verified title');assert.equal(writes[0].args.p_book.price,550);assert.equal(writes[1].args.p_book,null);assert(writes.every(x=>x.name==='finish_catalog_price_job'));
requests.length=0;enabled=false;const paused=await processCatalogPrices(db,{sleep:async()=>{},now:()=>0});assert(paused.outcomes.every(x=>x.result==='deferred'));assert.equal(requests.length,0);
enabled=true;let clock=-110001;const limited=await processCatalogPrices(db,{sleep:async()=>{},now:()=>{clock+=110001;return clock;}});assert(limited.outcomes.every(x=>x.result==='deferred'));assert.equal(requests.length,0);
const routes=new Map();registerCatalogPriceAdmin({get:(p,f)=>routes.set('GET '+p,f),post:(p,f)=>routes.set('POST '+p,f)},db,(_t,b)=>b,x=>String(x).replaceAll('<','&lt;'));let status;const before=writes.length;
await routes.get('POST /catalog-prices/control')({method:'POST',body:{csrf:'bad',action:'resume'}},{status(n){status=n;return this},send(){}});assert.equal(status,403);assert.equal(writes.length,before);
console.log('Catalog prices: exact ISBN/provider fields, existing-price protection, no AI/mail, rate-limit stop and deferred remainder, manual pause, time budget and CSRF: OK');
