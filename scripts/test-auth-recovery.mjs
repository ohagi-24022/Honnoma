import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const file = new URL('../src/lib/authRecovery.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadAuth(scheme) {
  const exports = {};
  const nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(compiled, { exports, URL, URLSearchParams, require: (name) =>
    name === 'expo-constants' ? { __esModule: true, default: { expoConfig: { scheme } } } : nativeRequire(name) });
  return exports;
}
const exports = loadAuth('honnoma');
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

for (const scheme of ['honnoma-preview', ['honnoma-preview']]) {
  const preview = loadAuth(scheme);
  assert.equal(preview.AUTH_REDIRECT_URL, 'honnoma-preview://auth-callback');
  for (const type of ['signup', 'recovery']) {
    const url = callback(type).replace('honnoma:', 'honnoma-preview:');
    assert.equal(preview.parseAuthCallback(url).type, type);
    assert.throws(() => parseAuthCallback(url));
    assert.throws(() => preview.parseAuthCallback(callback(type)));
  }
}
assert.equal(loadAuth(undefined).AUTH_REDIRECT_URL, 'honnoma://auth-callback');
for (const url of [callback('signup').replace('://', '://user@'), callback('signup').replace('auth-callback', 'auth-callback:123')]) {
  assert.throws(() => parseAuthCallback(url));
}

const require = createRequire(import.meta.url);
const makeConfig = require('../app.config.js');
const originalEnv = process.env.APP_ENV;
try {
  for (const env of ['production', 'preview', 'development']) {
    process.env.APP_ENV = env;
    const config = makeConfig({ config: {} });
    const preview = env === 'preview';
    assert.equal(config.scheme, preview ? 'honnoma-preview' : 'honnoma');
    assert.equal(config.ios.bundleIdentifier, `com.ohagiworks.honnoma${preview ? '.preview' : ''}`);
    assert.equal(config.android.package, `com.ohagiworks.honnoma${preview ? '.preview' : ''}`);
    assert.equal(loadAuth(config.scheme).AUTH_REDIRECT_URL, `${config.scheme}://auth-callback`);
  }
} finally {
  if (originalEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalEnv;
}
console.log('本番・previewのリンク分離とアプリ識別子の整合: OK');
