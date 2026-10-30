import assert from 'node:assert/strict';
import {fetchBook} from './shushuka-content-review.mjs';
import {retrieveSynopsis,registerSynopsisAdmin} from './shushuka-synopsis-admin.mjs';
const isbn='9784757560062';let calls=[],writes=[],mode='text';
const db={from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{metadata:{normalized_isbn:isbn,title:'Confirmed 9',thumbnail_url:'https://cover.openbd.jp/exact.jpg'}}})};},
 functions:{invoke:async()=>({data:{body:{Items:[{Item:{isbn,title:'Rakuten 9',largeImageUrl:'https://cover.openbd.jp/other.jpg',itemCaption:''}}]}}})},
 rpc:async(name,args)=>{writes.push({name,args});return {data:{count:1,page:1,rows:[{isbn,title:'<script>9',description:'<script>本文',status:'acquired',source_url:'javascript:alert(1)',attempted_at:null}]}};}};
const fetcher=async url=>{calls.push(url);if(mode==='offline')throw Error('token=private');return Response.json(url.includes('openbd')?[{summary:{isbn:mode==='wrong'?'9784757562448':isbn,title:'OpenBD 9'},onix:{CollateralDetail:{TextContent:[{Text:'九巻の紹介文'}]}}}]:{items:[]});};
const original=await fetchBook(db,isbn,fetcher);assert.equal(original.description,'');assert.equal(calls.length,0,'Cover preparation retains its cheap early exit.');
const full=await fetchBook(db,isbn,fetcher,new Set(),{requireDescription:true});assert.equal(full.title,'Confirmed 9');assert.equal(full.cover_url,original.cover_url);assert.equal(full.description,'九巻の紹介文');assert.equal(full.description_provider,'openbd');assert(full.description_source_url.includes('openbd'));
const read=(...args)=>fetchBook(args[0],args[1],fetcher,args[3],args[4]);
assert.equal(await retrieveSynopsis(db,isbn,{read}),'acquired');assert.equal(writes.at(-1).args.p_description,'九巻の紹介文');
mode='wrong';assert.equal(await retrieveSynopsis(db,isbn,{read}),'missing');assert.equal(writes.at(-1).args.p_description,null);
mode='offline';assert.equal(await retrieveSynopsis(db,isbn,{read}),'failed');assert.equal(writes.at(-1).args.p_reason,'provider_unavailable');assert(!JSON.stringify(writes).includes('private'));
assert(writes.every(x=>x.name==='record_book_synopsis_fetch'));assert(calls.every(x=>!x.includes('openai')));
const handlers=new Map();registerSynopsisAdmin({get:(p,f)=>handlers.set('GET '+p,f),post:(p,f)=>handlers.set('POST '+p,f)},db,(_t,b)=>b,x=>String(x).replaceAll('<','&lt;').replaceAll('"','&quot;'));
let html,code;const res={send(x){html=x;return this},status(x){code=x;return this},sendStatus(x){code=x},redirect(){}};
await handlers.get('GET /synopses')({query:{}},res);assert(html.includes('&lt;script>本文'));assert(!html.includes('href="javascript:'));assert(html.includes('紹介文を確認'));assert(html.includes('取得済み'));const before=writes.length;
await handlers.get('POST /synopses/retrieve')({method:'POST',body:{csrf:'wrong',isbn}},res);assert.equal(code,403);assert.equal(writes.length,before);
console.log('Synopsis: cover-only early exit preserved; exact ISBN text fallback, source attribution, failures vs missing text, no AI/approval, escaped preview and CSRF: OK');
