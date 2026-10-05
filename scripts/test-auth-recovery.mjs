import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const file = new URL('../src/lib/authRecovery.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, URL, URLSearchParams, require: createRequire(import.meta.url) });
const { parseAuthCallback, validateNewPassword, EMAIL_PATTERN, AUTH_REDIRECT_URL } = exports;
const callback = (type) => `${AUTH_REDIRECT_URL}#type=${type}&access_token=test-access&refresh_token=test-refresh`;
assert.equal(parseAuthCallback(callback('recovery')).type, 'recovery');
assert.equal(parseAuthCallback(callback('signup')).type, 'signup');
assert.equal(parseAuthCallback(callback('recovery')).tokens.refresh_token, 'test-refresh');
for (const url of [
  callback('magiclink'),
  callback('recovery').replace('honnoma:', 'https:'),
  callback('recovery').replace('auth-callback', 'unexpected'),
  `${AUTH_REDIRECT_URL}#type=recovery&access_token=test-access`,
  `${AUTH_REDIRECT_URL}#type=recovery&refresh_token=test-refresh`,
  `${AUTH_REDIRECT_URL}#error=access_denied&error_description=expired`,
  `${AUTH_REDIRECT_URL}?error=access_denied`,
  AUTH_REDIRECT_URL,
]) assert.throws(() => parseAuthCallback(url));
assert.equal(validateNewPassword('new-password', 'new-password'), null);
assert.ok(validateNewPassword('short', 'short'));
assert.ok(validateNewPassword('new-password', 'different-password'));
assert.ok(EMAIL_PATTERN.test('reader@example.com'));
assert.ok(!EMAIL_PATTERN.test('reader@'));
assert.ok(!EMAIL_PATTERN.test('reader @example.com'));
console.log('認証リンクの種別・期限エラー・不正なリンク・パスワード入力のチェック: OK');
