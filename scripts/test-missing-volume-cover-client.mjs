import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const sourceBook={title:'化物語 19',seriesTitle:'化物語',volumeNumber:19,isbn:'9784065296356',bookFormat:'comic',publisher:'講談社',thumbnailUrl:'https://example.test/19.jpg'};
let sourceCalls=0,failSource=false;
const exports={};let calls=0,release,payload={items:[{volumeNumber:2,isbn:'9784757549920',thumbnailUrl:'https://example.test/comic2.jpg'}]};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/missingVolumeCovers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='./bookApis'?{searchMissingVolumeBookCandidates:async()=>{sourceCalls++;if(failSource)throw Error('offline');return [sourceBook];}}:name==='./bookFormat'?{resolveBookFormat:b=>b.bookFormat??'unknown'}:name==='./series'?{normalizeSeriesKey:s=>s.normalize('NFKC').replace(/[\s!！]/g,'')}:{PENDING_BOOK_COVER_URL:'https://example.test/pending.png'},URL,AbortController,setTimeout,clearTimeout,fetch:async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert(body.volumes.length<=10);assert(!('userId'in body));if(release===undefined)await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>payload};}});
const request={seriesTitles:['りゅうおうのおしごと!'],volumes:[2],publisher:'スクウェア・エニックス',format:'comic'};
const one=exports.loadMissingVolumeCovers(request),two=exports.loadMissingVolumeCovers(request);assert.equal(calls,1);release();const results=await Promise.all([one,two]);assert.equal(results[0][0].isbn,'9784757549920');assert.equal(results[1][0].thumbnailUrl,payload.items[0].thumbnailUrl);await exports.loadMissingVolumeCovers(request);assert.equal(calls,1);
payload={items:[]};await exports.loadMissingVolumeCovers({...request,volumes:[3]});await exports.loadMissingVolumeCovers({...request,volumes:[3]});assert.equal(calls,2,'Missing catalog results also have a short cache.');
payload={items:[{volumeNumber:4,isbn:'9784757549920',thumbnailUrl:'file:///wrong'}]};assert.equal((await exports.loadMissingVolumeCovers({...request,volumes:[4]})).length,0);
console.log('Missing volume client: one request per page, concurrent deduplication, positive/negative cache, HTTPS filtering, no registration/account mutations: OK');

const privateRequest={seriesTitles:['化物語'],volumes:[19],publisher:'講談社',format:'comic'};
payload={items:[]};
let found=await exports.loadMissingVolumeCovers(privateRequest);
assert.equal(found[0].thumbnailUrl,sourceBook.thumbnailUrl,'Private series fills a missing admin-catalog record.');
const sourcesBefore=sourceCalls;
await exports.loadMissingVolumeCovers({...privateRequest,volumes:[18]});
assert.equal(sourceCalls,sourcesBefore,'Other pages reuse one series-level provider result.');
const pick=exports.selectMissingVolumeSourceCovers;
assert.equal(pick([sourceBook],privateRequest).length,1);
for(const change of [{seriesTitle:'別作品'},{publisher:'別出版社'},{bookFormat:'novel'},{bookFormat:'unknown'},{title:'化物語 19 特装版'},{title:'化物語 19 同人版'},{title:'化物語 19 SPECIAL EDITION'},{volumeKind:'extra'},{isbn:'9784065296357'},{thumbnailUrl:'file:///private'}])
 assert.equal(pick([{...sourceBook,...change}],privateRequest).length,0,JSON.stringify(change));
assert.equal(pick([sourceBook,{...sourceBook,isbn:'9784065286593'}],privateRequest).length,0,'Ambiguous ISBNs are not selected.');
failSource=true;const retry={...privateRequest,seriesTitles:['化物語','Retry']};
assert.equal((await exports.loadMissingVolumeCovers(retry)).length,0);
failSource=false;
assert.equal((await exports.loadMissingVolumeCovers(retry))[0].isbn,sourceBook.isbn,'A failed provider lookup is retried rather than negative-cached.');
console.log('Private missing-volume fallback: exact identity, format/edition filtering, one source lookup per series, transient failure recovery: OK');
