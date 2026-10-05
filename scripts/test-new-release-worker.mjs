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
  Request, Response, Headers, Date, Map, console,
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
