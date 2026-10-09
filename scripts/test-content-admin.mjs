import assert from 'node:assert/strict';
import { registerContentAdmin } from './shushuka-content-admin.mjs';

const writes = [];
const db = { from: (table) => ({
  select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  upsert: async (row) => { writes.push({ table, row }); return { error: null }; },
}) };
const handlers = new Map();
const app = { get: (path, fn) => handlers.set(`GET ${path}`, fn), post: (path, fn) => handlers.set(`POST ${path}`, fn) };
const e = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
registerContentAdmin(app, db, (_title, body) => body, e);
const request = async (method, path, body = {}) => {
  const res = { statusCode: 200, text: '', status(code) { this.statusCode = code; return this; }, send(text) { this.text = text; }, redirect(code, url) { this.statusCode = code; this.location = url; } };
  await handlers.get(`${method} ${path}`)({ method, path, query: {}, body }, res);
  return res;
};
{
  const html = (await request('GET', '/content')).text;
  const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  const post = (path, fields) => request('POST', path, fields);
  assert.equal((await post('/content', { isbn13: '9784088914763' })).statusCode, 403);
  assert.equal(writes.length, 0);
  const valid = { csrf, isbn13: '9784088914763', source_url: 'https://example.test/book', enabled: 'true', description: 'Checked text' };
  assert.equal((await post('/content', { ...valid, cover_url: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal(writes.length, 0);
  assert.equal((await post('/content', { ...valid, cover_url: 'https://example.test/checked.jpg' })).statusCode, 303);
  assert.equal(writes[0].row.description, 'Checked text');
  assert.equal(writes[0].row.enabled, true);
  assert.equal((await post('/rankings', { ...valid, ranking_key: 'example', title: '<Example>', adult_only: 'true' })).statusCode, 303);
  assert.equal(writes.at(-1).row.enabled, false);
  assert.equal(writes.at(-1).row.adult_only, true);
  assert.equal(writes.at(-1).row.isbn, valid.isbn13);
  assert.equal((await post('/rankings', { ...valid, ranking_key: 'example', title: 'Example', adult_only: '' })).statusCode, 303);
  assert.equal(writes.at(-1).row.enabled, false);
  console.log('Admin handlers: CSRF / URL validation / exact content / adult and unknown exclusion: OK');
}
