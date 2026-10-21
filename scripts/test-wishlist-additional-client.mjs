import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const exports={};let calls=0,providerCalls=0,fail=false;
const mocks={
 './bookApis':{searchSeriesCandidates:async title=>{providerCalls++;return [{seriesTitle:title,isbn:'9780306406157',volumeNumber:1}];}},
 './series':{normalizeSeriesKey:s=>s},'./reviewedBookContent':{PENDING_BOOK_COVER_URL:'https://shushukaadmin.onrender.com/pending-cover.svg'},
 './supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}}},
};
runInNewContext(ts.transpileModule(readFileSync('src/lib/wishlistAdditionalSearch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:d=>mocks[d],URL,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
 calls++;assert.equal(new URL(url).origin,'https://shushukaadmin.onrender.com');assert.equal(options.headers.Authorization,'Bearer test-token');if(fail)throw new Error('Network failed');return {ok:true,json:async()=>({queries:['正式名','正式名']})};
}});
const first=exports.searchWishlistAgain(' ＡＢＣ '),second=exports.searchWishlistAgain('abc');
assert.equal(first,second);assert.equal((await first).length,1);assert.equal(calls,1);assert.equal(providerCalls,2);
await exports.searchWishlistAgain('abc');assert.equal(calls,1);
fail=true;await assert.rejects(exports.searchWishlistAgain('failure'));await assert.rejects(exports.searchWishlistAgain('failure'));assert.equal(calls,2);
console.log('Additional client: normalized-word memoization, simultaneous request deduplication, bearer to fixed origin, real provider verification, result deduplication, no automatic retry after failure: OK');
