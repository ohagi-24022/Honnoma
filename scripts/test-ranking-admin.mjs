import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {registerContentAdmin} from './shushuka-content-admin.mjs';
import {rankingCandidates,rankingPageSize,rankingKey,rankingSelectionScript,rankingReturnTo} from './shushuka-ranking-admin.mjs';
const tables={public_ranking_aliases:[],public_ranking_catalog:[{ranking_key:'existing',title:'Existing <book>',isbn:'9784088914763',adult_only:false,enabled:true,reviewed_at:'version',source_url:'https://example.test/source',cover_url:'https://example.test/approved.jpg'}],book_content_review_jobs:[],reviewed_book_content:[]};
for(let i=0;i<115;i++)tables.book_content_review_jobs.push({isbn13:String(9780000000000+i),adult_only:i===0?true:i===1?null:false,candidate:{title:'Volume 1',series_title:'Candidate '+String(i).padStart(3,'0'),volume_number:1,source_url:'https://example.test/book',cover_url:'https://example.test/unreviewed.jpg'}});
tables.book_content_review_jobs.push({isbn13:'9789999999999',adult_only:false,candidate:{series_title:'Candidate 002',volume_number:2,source_url:'https://example.test/2'}});
tables.reviewed_book_content.push({isbn13:tables.book_content_review_jobs[2].isbn13,enabled:true,cover_url:'https://example.test/snapshot.jpg'});
const writes=[];let conflict=false;
function from(table){let filters=[],offset=0,last=999,single=false,write;
 const q={select(){return q},order(){return q},range(a,b){offset=a;last=b;return q},limit(n){last=n-1;return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){single=true;return q},upsert(v){write=v;return q},update(v){write=v;return q},then(resolve){if(write){writes.push({table,write,filters});return resolve({data:conflict?[]:[{ranking_key:write.ranking_key??filters[0]?.[1]}],error:null});}let data=tables[table].filter(row=>filters.every(([k,v])=>row[k]===v)).slice(offset,last+1);resolve({data:single?data[0]??null:data,error:null});}};return q;
}
const db={from},handlers=new Map(),escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
registerContentAdmin({get:(p,h)=>handlers.set('GET '+p,h),post:(p,h)=>handlers.set('POST '+p,h)},db,(_title,html)=>html,escape);
let html,code,redirect,cookie;
const res={send(v){html=v;return this},status(n){code=n;return this},redirect(n,v){code=n;redirect=v;},setHeader(_k,v){cookie=v;}};
const get=async query=>{code=200;await handlers.get('GET /rankings')({method:'GET',path:'/rankings',query,headers:{}},res);};
const post=async body=>{code=200;await handlers.get('POST /rankings/listing')({method:'POST',path:'/rankings/listing',body},res);};
await get({size:'10',page:'2'});assert.equal((html.match(/class="ranking-row"/g)||[]).length,10);assert(html.includes('全116作品'));assert(html.includes('2 / 12ページ'));assert(cookie.includes('honnoma_ranking_size=10'));
let csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
for(const size of [10,30,50,100]){await get({size:String(size)});assert.equal((html.match(/class="ranking-row"/g)||[]).length,size);}
await get({size:'10',page:'999'});assert(html.includes('12 / 12ページ'));assert.equal((html.match(/class="ranking-row"/g)||[]).length,6);
await get({q:'Candidate 002',key:'candidate002'});assert(html.includes('name="ranking_key" value="candidate002"'));assert(html.includes('https://example.test/snapshot.jpg'));assert(!html.includes('https://example.test/unreviewed.jpg'));assert(html.includes('全1作品'));
await get({view:'show'});assert(html.includes('全1作品'));assert(html.includes('Existing &lt;book>'));
const candidates=await rankingCandidates(db);assert.equal(candidates.find(x=>x.ranking_key==='candidate002').isbn,tables.book_content_review_jobs[2].isbn13);assert.equal(candidates.find(x=>x.ranking_key==='candidate003').cover_url,null);
assert.equal(rankingPageSize(undefined,'honnoma_ranking_size=100'),100);assert.equal(rankingPageSize('999','honnoma_ranking_size=50'),50);assert.equal(rankingKey('がっこうぐらし！'),'がっこうぐらし!');assert.equal(rankingReturnTo('//attacker.test/path'),'/rankings');
const body={csrf,row:'0',key_0:'candidate002',isbn_0:tables.book_content_review_jobs[2].isbn13,listing_0:'show',return_to:'/rankings?size=100&page=2'};
await post({...body,csrf:'bad'});assert.equal(code,403);assert.equal(writes.length,0);
await post({...body,key_0:'candidate000',isbn_0:tables.book_content_review_jobs[0].isbn13});assert.equal(code,400);assert.equal(writes.length,0);
await post({...body,isbn_0:'9789999999999'});assert.equal(code,400);assert.equal(writes.length,0);
await post(body);assert.equal(code,303);assert.equal(writes.at(-1).write.enabled,true);assert.equal(writes.at(-1).write.cover_url,'https://example.test/snapshot.jpg');assert(redirect.includes('size=100&page=2'));
await post({csrf,row:'all',key_0:'existing',isbn_0:'9784088914763',listing_0:'hide'});assert.equal(writes.at(-1).write.enabled,false);assert(writes.at(-1).filters.some(([k,v])=>k==='reviewed_at'&&v==='version'));
conflict=true;await post({csrf,row:'0',key_0:'existing',isbn_0:'9784088914763',listing_0:'hide',return_to:body.return_to});assert.equal(code,409);assert(html.includes('一覧を開き直して'));assert(html.includes('size=100&amp;page=2'));
const radios=[{value:'show',checked:false},{value:'hide',checked:true}],other=[{value:'show',checked:false}];let select,undo;const status={textContent:''},btn={disabled:true,addEventListener(_e,h){undo=h;}};
const form={querySelector:s=>s==='[data-ranking-select]'?{addEventListener(_e,h){select=h;}}:s==='[data-ranking-undo]'?btn:status,querySelectorAll:s=>s.startsWith('input')?radios.concat(other):[{querySelectorAll:()=>radios}]};
runInNewContext(rankingSelectionScript.replace('<script>','').replace('</script>',''),{document:{querySelector:()=>form}});select();assert(radios[0].checked);assert(!radios[1].checked);assert(!other[0].checked);undo();assert(!radios[0].checked);assert(radios[1].checked);
console.log('Ranking admin: series candidates, approved covers only, filtering/pagination/cookie, prefilled editor, CSRF, adult exclusion, exact representative, stale-write detection, selection/undo: OK');

for(let i=0;i<1100;i++)tables.book_content_review_jobs.push({isbn13:String(9790000000000+i),adult_only:false,candidate:{series_title:'Extra '+i,volume_number:1,source_url:'https://example.test'}});
assert.equal((await rankingCandidates(db)).length,1216);
await get({q:'Extra 1099'});assert(html.includes('全1作品'));assert(html.includes('Extra 1099'));
console.log('Ranking data beyond 1000 rows remains searchable and pageable: OK');

const extraJob={isbn13:'9784088704531',title:'Candidate 003 (1)',adult_only:false,candidate:{title:'Candidate 003 (1)',cover_hash:'hash',source_url:'https://example.test/first'}};
tables.book_content_review_jobs.push(extraJob);
let updated=await rankingCandidates(db);
assert.equal(updated.find(row=>row.ranking_key==='candidate003').isbn,extraJob.isbn13);
assert.equal(updated.find(row=>row.ranking_key==='candidate003').preview_url,`/reviews/${extraJob.isbn13}/cover`);
assert.equal(updated.find(row=>row.ranking_key==='candidate003').cover_url,null);
tables.reviewed_book_content.push({isbn13:'9789999999999',enabled:true,cover_url:'https://example.test/approved-second.jpg'});
tables.reviewed_book_content[0].enabled=false;
updated=await rankingCandidates(db);assert.equal(updated.find(row=>row.ranking_key==='candidate002').isbn,'9789999999999');
assert.equal(updated.find(row=>row.ranking_key==='candidate002').cover_url,'https://example.test/approved-second.jpg');
await get({q:'Candidate 003'});assert(html.includes('表紙候補・表示未許可'));assert(html.includes(`/reviews/${extraJob.isbn13}/cover`));assert(html.includes('表紙確認'));
await post({csrf,row:'0',key_0:'candidate003',isbn_0:extraJob.isbn13,listing_0:'show'});
assert.equal(writes.at(-1).write.cover_url,null); // Administrative previews never become public ranking covers.
console.log('Representative covers: approved later volume preferred, incomplete first-volume series inferred only by known title, admin-only preview and review link, no preview publication: OK');

const mergedIsbn='9784832242364';
tables.public_ranking_catalog.push(
 {ranking_key:'がっこうぐらし!',title:'がっこうぐらし！',isbn:mergedIsbn,adult_only:false,enabled:true},
 {ranking_key:'がっこうぐらし',title:'がっこうぐらし',isbn:mergedIsbn,adult_only:false,enabled:false});
tables.public_ranking_aliases.push({alias_key:'がっこうぐらし',ranking_key:'がっこうぐらし!'});
tables.book_content_review_jobs.push({isbn13:mergedIsbn,adult_only:false,candidate:{series_title:'がっこうぐらし',volume_number:1}});
updated=await rankingCandidates(db);
assert.equal(updated.filter(row=>row.isbn===mergedIsbn).length,1);
assert.equal(updated.find(row=>row.isbn===mergedIsbn).ranking_key,'がっこうぐらし!');
// Known aliases still need unambiguous matching; clearly separated volume notation
// also identifies a new series when the provider omitted series_title on every volume.
tables.book_content_review_jobs.push(
 {isbn13:'9784091233721',adult_only:false,candidate:{title:'名探偵コナン 2',series_title:'名探偵コナン',volume_number:2}},
 {isbn13:'9784091233714',adult_only:false,candidate:{title:'名探偵コナン. volume 1'}});
tables.reviewed_book_content.push(
 {isbn13:'9784091233721',enabled:true,cover_url:'https://example.test/conan2.jpg'},
 {isbn13:'9784091233714',enabled:true,cover_url:'https://example.test/conan1.jpg'});
updated=await rankingCandidates(db);
assert.equal(updated.find(row=>row.ranking_key==='名探偵コナン').isbn,'9784091233714');
tables.book_content_review_jobs.push(
 {isbn13:'9784757550711',adult_only:false,candidate:{title:'りゅうおうのおしごと! 3',cover_hash:'third',source_url:'https://example.test/ryu3'}},
 {isbn13:'9784757548565',adult_only:false,candidate:{title:'りゅうおうのおしごと! 1',cover_hash:'first',source_url:'https://example.test/ryu1'}},
 {isbn13:'9780306406157',adult_only:false,candidate:{title:'東京2020',source_url:'https://example.test/year'}});
tables.reviewed_book_content.push({isbn13:'9784757548565',enabled:true,cover_url:'https://example.test/ryu1.jpg'});
updated=await rankingCandidates(db);
const ryu=updated.find(row=>row.ranking_key==='りゅうおうのおしごと!');
assert.equal(ryu.isbn,'9784757548565');
assert.equal(ryu.cover_url,'https://example.test/ryu1.jpg');
assert.equal(ryu.registered,false);assert.equal(ryu.enabled,false);
assert(!updated.some(row=>row.ranking_key==='東京'));
console.log('Ranking candidates: every volume missing provider series_title, first-volume approved cover, no auto-listing, numeric work-title safeguard: OK');
assert.equal(updated.find(row=>row.ranking_key==='名探偵コナン').cover_url,'https://example.test/conan1.jpg');
console.log('Merged ranking aliases stay hidden and do not reappear as candidates; approved English-volume first cover is selected: OK');

// A translated subtitle or bibliographic full stop may differ by volume.
for(const [base,variant,first,second] of [
 ['可愛いだけじゃない式守さん','可愛いだけじゃない式守さん = MISS SHIKIMORI IS NOT JUST CUTE.','9784065220320','9784065162231'],
 ['彼女、人見知ります','彼女、人見知ります.','9784065206027','9784065220696'],
 ['別の作品','別の作品 = Another Story','9780000008001','9780000008002'],
]){
 tables.book_content_review_jobs.push(
  {isbn13:first,adult_only:false,candidate:{title:variant+' vol.1',cover_hash:'first',source_url:'https://example.test/first'}},
  {isbn13:second,adult_only:false,candidate:{title:base+'（2）',cover_hash:'second',source_url:'https://example.test/second'}});
 tables.reviewed_book_content.push({isbn13:first,enabled:true,cover_url:'https://example.test/first.jpg'});
 updated=await rankingCandidates(db);
 assert.equal(updated.filter(row=>row.title.startsWith(base)).length,1);
 const row=updated.find(row=>row.ranking_key===rankingKey(base));assert.equal(row.isbn,first);assert.equal(row.cover_url,'https://example.test/first.jpg');assert.equal(row.enabled,false);
}
tables.book_content_review_jobs.push(
 {isbn13:'9780000008003',adult_only:false,candidate:{title:'別の作品 外伝（1）'}},
 {isbn13:'9780000008004',adult_only:false,candidate:{title:'単独シリーズ = An English Subtitle vol.1'}},
 {isbn13:'9780000008005',adult_only:false,candidate:{title:'別の作品 = 日本語の別作品 vol.1'}});
updated=await rankingCandidates(db);
assert(updated.some(row=>row.title==='別の作品 外伝'));
assert(updated.some(row=>row.title==='単独シリーズ = An English Subtitle'));
assert(updated.some(row=>row.title==='別の作品 = 日本語の別作品'));
console.log('Future split prevention: exact existing Japanese series + English subtitle/full stop, either order, approved representative; spin-offs/Japanese subtitles/unknown bases stay separate: OK');
