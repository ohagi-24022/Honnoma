import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/check-new-releases/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*createClient.*;\r?\n/m, '');
let handler;
let receiptError = false;
let stage = 'send';
const mutations = [];
const fixtures = {
  notification_logs: [{ id: 'notification', user_id: 'user', attempt_count: 0 }],
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
  fetch: async url => {
    if (stage === 'send') {
      assert.equal(url, 'https://exp.host/--/api/v2/push/send');
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
fixtures.notification_logs = [{ id: 'notification', user_id: 'user', response: sent.response }];
mutations.length = 0;
assert.equal((await call('receipts')).status, 200);
assert.ok(mutations.find(m => m.table === 'notification_logs' && m.action === 'update').value.delivered_at);
receiptError = true;
fixtures.notification_logs = [{ id: 'notification', user_id: 'user', response: { tickets: [{ id: 'ticket', token: 'mock-token' }] } }];
mutations.length = 0;
assert.equal((await call('receipts')).status, 502);
assert.equal(mutations.find(m => m.table === 'push_tokens' && m.action === 'update').value.enabled, false);
assert.equal(mutations.find(m => m.table === 'notification_logs' && m.action === 'update').value.status, 'failed');
console.log('Notification worker checks passed: malformed responses, authorization, tickets, receipts, invalid tokens. No real notifications sent.');
