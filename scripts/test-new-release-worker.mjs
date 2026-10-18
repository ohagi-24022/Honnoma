import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/check-new-releases/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*createClient.*;\r?\n/m, '');
let handler;
let receiptError = false;
let stage = 'send';
let fetchCount = 0;
const mutations = [];
const fixtures = {
  notification_logs: [{ id: 'notification', user_id: 'user', attempt_count: 0, series_key: 'sample', series_title: 'テスト作品', volume_number: 2 }],
  push_tokens: [{ user_id: 'user', expo_push_token: 'mock-token' }],
};
function query(table) {
  let mutation;
  const chain = new Proxy({}, { get(_target, key) {
    if (key === 'then') return (resolve, reject) => Promise.resolve({ data: mutation ? null : fixtures[table] ?? [], count: 4, error: null }).then(resolve, reject);
    return (...args) => {
      if (['insert', 'update', 'delete'].includes(key)) {
        mutation = { table, action: key, value: args[0] };
        mutations.push(mutation);
      }
      return chain;
    };
  } });
  return chain;
}
const context = vm.createContext({
  Request, Response, Headers, Date, Map, console, crypto, setTimeout, AbortSignal,
  createClient: () => ({ from: query, rpc: async (_name, params) => ({ data: params.provided_token === 'valid-cron', error: null }) }),
  Deno: { env: { get: name => ({ SUPABASE_URL: 'https://mock.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only' })[name] }, serve: fn => { handler = fn; } },
  fetch: async (url, options) => {
    fetchCount += 1;
    if (stage === 'send') {
      assert.equal(url, 'https://exp.host/--/api/v2/push/send');
      const message = JSON.parse(options.body);
      assert.equal(message.title, '本の間 新刊情報');
      assert.equal(message.body, '『テスト作品』第2巻の新刊情報が見つかりました。');
      assert.equal(message.data.url, '/notifications');
      return Response.json({ data: { status: 'ok', id: 'ticket' } });
    }
    assert.equal(url, 'https://exp.host/--/api/v2/push/getReceipts');
    return Response.json({ data: { ticket: receiptError ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' } } });
  },
});
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
const call = (mode, headers = { authorization: 'Bearer server-only' }) => handler(new Request('https://mock.invalid', { method: 'POST', headers, body: JSON.stringify({ mode }) }));
for (const body of [null, {}, { errors: [{ code: 'error' }] }, { data: { status: 'ok' } }]) {
  assert.equal(context.parseExpoPushResult({ body, ok: true, status: 200 }).accepted, false);
}
const digest = context.buildNewReleaseMessage([
  { series_key: 'a', series_title: '作品A', volume_number: 1 },
  { series_key: 'a', series_title: '作品A', volume_number: 3 },
  { series_key: 'b', series_title: '作品B', volume_number: 2 },
  { series_key: 'c', series_title: '作品C', volume_number: 4 },
  { series_key: 'd', series_title: '作品D', volume_number: 5 },
]);
assert.equal(digest.title, '本の間 4作品の新刊情報');
assert.ok(digest.body.includes('『作品A』第3巻'));
assert.ok(digest.body.includes('ほか1作品'));
assert.ok(!digest.body.includes('第1巻'));
assert.equal((await call('health', { authorization: 'Bearer fake.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake' })).status, 403);
assert.equal((await call('health', { 'x-honnoma-cron-secret': 'invalid' })).status, 403);
assert.equal((await call('health', { 'x-honnoma-cron-secret': 'valid-cron' })).status, 200);
mutations.length = 0;
assert.equal((await call('deliver')).status, 200);
const sent = mutations.find(m => m.table === 'notification_logs' && m.action === 'update').value;
assert.equal(sent.status, 'sent');
assert.equal(sent.delivered_at, null);
assert.equal(sent.response.tickets[0].id, 'ticket');
stage = 'receipts';
fixtures.notification_logs = [1, 2, 3].map(id => ({ id, user_id: 'user', response: structuredClone(sent.response) }));
fetchCount = 0;
mutations.length = 0;
assert.equal((await call('receipts')).status, 200);
assert.ok(mutations.find(m => m.table === 'notification_logs' && m.action === 'update').value.delivered_at);
assert.equal(fetchCount, 1, 'A digest receipt must be fetched once, even with three volume logs.');
assert.equal(mutations.filter(m => m.table === 'notification_logs' && m.action === 'update').length, 3);
receiptError = true;
fixtures.notification_logs = [{ id: 'notification', user_id: 'user', response: { tickets: [{ id: 'ticket', token: 'mock-token' }] } }];
mutations.length = 0;
assert.equal((await call('receipts')).status, 502);
assert.equal(mutations.find(m => m.table === 'push_tokens' && m.action === 'update').value.enabled, false);
assert.equal(mutations.find(m => m.table === 'notification_logs' && m.action === 'update').value.status, 'failed');
fixtures.notification_logs = [];
fetchCount = 0;
assert.equal((await call('deliver')).status, 200);
assert.equal(fetchCount, 0, 'No notifications must be sent when there are no new volumes.');
console.log('Notification worker checks passed: malformed responses, authorization, digest text/link, empty queue, receipt deduplication, invalid tokens. No real notifications sent.');
const originalCheckSeries = context.checkSeries;
const originalGetLatestPublication = context.getLatestPublication;
// Verify readable admin history metadata without contacting any external services.
context.checkSeries = async () => [
  {seriesTitle:'作品A',latestVolume:3,queued:2},
  {seriesTitle:'作品B',latestVolume:null,queued:0,error:'private provider detail',stage:'provider',reason:'rate_limit'},
];
mutations.length=0;
assert.equal((await call('check')).status,502);
const history=mutations.filter(m=>m.table==='server_operation_logs'&&m.action==='insert'&&m.value.operation==='check-new-releases');
assert.equal(history[0].value.metadata.phase,'started');
assert.equal(history.at(-1).value.metadata.phase,'completed');
assert.equal(history.at(-1).value.metadata.newReleaseCount,1);
assert.equal(history.at(-1).value.metadata.checkResults[1].failed,true);
assert.ok(!JSON.stringify(history.at(-1).value.metadata).includes('private provider detail'));
context.checkSeries = async () => {throw Error('simulated');};
mutations.length=0;
assert.equal((await call('check')).status,500);
assert.equal(mutations.at(-1).value.metadata.mode,'check');
assert.equal(mutations.at(-1).value.metadata.phase,'completed');
console.log('Notification history metadata checks passed: start, completion, per-work failures, fatal failures.');

assert.equal(context.notificationFailureReason(new Error('Rakuten Books HTTP 429')), 'rate_limit');
assert.equal(context.notificationFailureReason(new Error('fetch failed')), 'network');

fixtures.series_subscriptions = [{id:'subscription',user_id:'user',series_key:'series',series_title:'確認テスト',latest_known_volume:1}];
context.getLatestPublication = async (_key,_title,progress) => { await progress('provider'); throw new Error('Rakuten Books HTTP 429'); };
mutations.length=0;
const failedSeries = await originalCheckSeries(10,'test-run');
assert.equal(failedSeries[0].stage,'provider');
assert.equal(failedSeries[0].reason,'rate_limit');
assert.ok(mutations.some(m=>m.table==='server_operation_logs'&&m.value.metadata?.phase==='progress'&&m.value.metadata?.runId==='test-run'));
console.log('Per-series progress checks passed without external requests.');

// A fake clock exercises pacing and backoff without waiting or calling providers.
let clockMs=100_000;
const requestTimes=[];
const waits=[];
const wait=async ms=>{waits.push(ms);clockMs+=ms;};
const progressStages=[];
let attempts=0;
const paced=context.createPacedPublicationLookup({now:()=>clockMs,wait,lookup:async()=>{requestTimes.push(clockMs);attempts++;if(attempts===2)throw Error('Rakuten Books HTTP 429');return 3;}});
assert.equal(await paced('A'),3);
assert.equal(await paced('B',async stage=>progressStages.push(stage)),3);
assert.deepEqual(requestTimes,[100_000,102_000,107_000]);
assert.ok(progressStages.includes('retry_wait'));
let calls=0;
const limited=context.createPacedPublicationLookup({now:()=>clockMs,wait,lookup:async()=>{calls++;throw Error('Rakuten Books HTTP 429');}});
await assert.rejects(limited('A'),/429/);
await assert.rejects(limited('B'),/429/);
assert.equal(calls,2,'Stop provider calls for the rest of the run after two 429s.');
const exhausted=context.createPacedPublicationLookup({now:()=>clockMs,wait,budgetMs:14_000,lookup:async()=>{throw Error('must not call');}});
await assert.rejects(exhausted('A'),/DEFERRED_CHECK/);
let nonRetryCalls=0;
const other=context.createPacedPublicationLookup({now:()=>clockMs,wait,lookup:async()=>{nonRetryCalls++;throw Error('HTTP 400');}});
await assert.rejects(other('A'),/400/);assert.equal(nonRetryCalls,1);
console.log('Rate-limit checks passed: 2-second spacing, one 5-second retry, circuit break, bounded runtime, no retry for invalid requests.');

const latest=context.latestPublicationFromItems([
 {Item:{title:'作品 1',salesDate:'2020年1月1日'}},
 {Item:{title:'作品 3'}},
 {Item:{title:'作品 2',salesDate:'2020年2月2日'}},
]);
assert.equal(latest.latestVolume,3);assert.equal(latest.publishedDate,null,'Never use another volume date.');
const dated=context.latestPublicationFromItems([{Item:{title:'作品 3',salesDate:'2026年10月17日'}},{Item:{title:'作品 2',salesDate:'2025年1月1日'}}]);
assert.equal(dated.publishedDate,'2026年10月17日');
context.getRecentPublicationCheck=async()=>({latest_volume:3,raw:{publishedDate:'2026年10月17日'},source:'Rakuten Books'});
assert.equal((await originalGetLatestPublication('a','A')).publishedDate,'2026年10月17日');
context.getRecentPublicationCheck=async()=>({latest_volume:3,raw:null,source:'Rakuten Books'});
assert.equal((await originalGetLatestPublication('a','A')).publishedDate,null);
context.getRecentPublicationCheck=async()=>null;
mutations.length=0;
await originalGetLatestPublication('a','A',async()=>{},async()=>({latestVolume:3,publishedDate:'2026年10月17日'}));
assert.equal(mutations.find(m=>m.table==='publication_checks'&&m.action==='insert').value.raw.publishedDate,'2026年10月17日');
mutations.length=0;
await context.insertNotificationLog({series_key:'a',series_title:'A',user_id:'user'},3,'2026年10月17日');
assert.equal(mutations.find(m=>m.table==='notification_logs').value.published_date,'2026年10月17日');
console.log('Notification publication dates: exact volume pairing, missing dates, cached dates, persisted dates: OK');
