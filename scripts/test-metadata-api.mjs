import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const server=readFileSync(process.argv[2]??'/private/tmp/honnoma-canonical-server.js','utf8');
const start=server.indexOf("app.post('/api/book-metadata-overrides'");
const end=server.indexOf("app.options('/api/book-metadata-overrides'",start);
let handler,rpcArgs,legacyQueries=0,failed=false;
vm.runInNewContext(server.slice(start,end),{
 app:{post(_path,h){handler=h;}},supabase:{async rpc(_name,args){rpcArgs=args;return failed?{error:Error('offline')}:{data:{metadata:args.p_isbn==='9784088803166'?{normalized_isbn:args.p_isbn,title:'Standard edition'}:null}};},from(){legacyQueries++;throw Error('Unexpected edition fallback');}},
 reviewService:{enqueue:async()=>{}},isPublicLookupAllowed:()=>true,normalizeIsbn:x=>String(x).replace(/[^0-9X]/gi,''),normalizeText:x=>x??null,optionalNumber:x=>x??null,console:{error(){}},
});
let result,code=200;const res={setHeader(){},status(n){code=n;return this;},json(data){result=data;}};
await handler({body:{isbn:'9784088803166',seriesKey:'Haikyu',volumeNumber:15}},res);
assert.equal(result.override.title,'Standard edition');assert.equal(rpcArgs.p_isbn,'9784088803166');
await handler({body:{isbn:'9784089082386',seriesKey:'Haikyu',volumeNumber:15}},res);
assert.equal(result.override,null);assert.equal(legacyQueries,0);
failed=true;await handler({body:{isbn:'9784088803166'}},res);assert.equal(code,503);
console.log('Metadata API: confirmed RPC, no cross-edition fallback, transient error distinguished: OK');
