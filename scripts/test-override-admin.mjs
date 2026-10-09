import assert from 'node:assert/strict';
import {registerOverrideAdmin, searchCandidates, normalizeIsbn, overrideValues, readMetadataCacheFallback} from './shushuka-override-admin.mjs';
const isbn='9784088744421';
const tables={book_content_review_jobs:[{isbn13:isbn,title:'ONE PIECE 48',candidate:{title:'ONE PIECE 48',series_title:'ONE PIECE',volume_number:48,publisher:'集英社',cover_url:'https://example.org/48.jpg',cover_hash:'hash',source_url:'https://example.org/book48'}}],books:[],book_metadata_cache:[],book_metadata_overrides:[]};
const calls=[],writes=[];
function from(table){const call={table};calls.push(call);let single=false;
 const q={select(){return q},order(){return q},limit(){return q},not(){return q},or(v){call.filter=v;return q},eq(k,v){call.eq=[k,v];return q},maybeSingle(){single=true;return q},single(){single=true;return q},update(v){writes.push({table,value:v});call.write=true;return q},insert(v){writes.push({table,value:v});call.write=true;return q},then(resolve){
 let data=tables[table]??[];
 if(call.filter){const f=call.filter.split('.eq.');if(f.length===2)data=data.filter(row=>row[f[0]]===f[1]);}
 if(call.eq)data=data.filter(row=>row[call.eq[0]]===call.eq[1]);
 resolve({data:single?(data[0]??null):data,error:null});}};return q;
}
const db={from};
assert.equal(normalizeIsbn('９７８-４-０８-８７４４４２-１'),isbn);
const results=await searchCandidates(db,'９７８-４-０８-８７４４４２-１');
assert.equal(results.length,1);assert.equal(results[0].source,'review');assert.equal(results[0].thumbnail_url,'https://example.org/48.jpg');
assert.equal(results[0].preview_url,`/reviews/${isbn}/cover`);
assert.equal(calls.find(x=>x.table==='book_content_review_jobs').filter,`isbn13.eq.${isbn}`);
await searchCandidates(db,'Title, (book) "test"');
assert(calls.at(-1).filter.includes('title.ilike."%Title, (book) \\"test\\"%"'));
const handlers=new Map();registerOverrideAdmin({get:(p,f)=>handlers.set('GET '+p,f),post:(p,f)=>handlers.set('POST '+p,f)},db,(_t,b)=>b,v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'));
let html='',status=200,redirect;
const res={send(v){html=v;return this},status(v){status=v;return this},sendStatus(v){status=v;return this},redirect(code,to){redirect=to;return this}};
await handlers.get('GET /')({method:'GET',query:{bookq:isbn,source:'review',key:isbn}},res);
assert(html.includes('value="48"'));assert(html.includes('name="source_url" value="https://example.org/book48"'));assert(html.includes('name="thumbnail_url" value="https://example.org/48.jpg"'));
assert.equal(writes.length,0);
const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
await handlers.get('POST /overrides')({method:'POST',path:'/overrides',body:{csrf:'wrong',isbn}},res);assert.equal(status,403);assert.equal(writes.length,0);
await handlers.get('POST /overrides')({method:'POST',path:'/overrides',body:{csrf,isbn,title:'ONE PIECE 48',source_url:'javascript:alert(1)'}},res);assert.equal(status,400);assert.equal(writes.length,0);assert(html.includes('ONE PIECE 48'));
await handlers.get('POST /overrides')({method:'POST',path:'/overrides',body:{csrf,isbn,title:'ONE PIECE 48',source_url:'https://example.org/book48',thumbnail_url:'https://example.org/48.jpg',volume_number:'48'}},res);
assert.equal(redirect,'/?saved=1');assert.equal(writes.length,1);assert.equal(writes[0].table,'book_metadata_overrides');assert.equal(writes[0].value.normalized_isbn,isbn);
assert(!writes.some(x=>['reviewed_book_content','book_content_review_jobs'].includes(x.table)));
assert.throws(()=>overrideValues({isbn,list_price:'12xyz'}));
await readMetadataCacheFallback(db,{normalizedIsbn:isbn});assert.deepEqual(calls.at(-1).eq,['normalized_isbn',isbn]);
console.log('Preloaded ISBN lookup, normalized ISBN, quoted title filters, URL prefill, validation/CSRF, correction-only writes and public cache fallback: OK');
