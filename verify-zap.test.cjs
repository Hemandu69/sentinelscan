'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const verify = require('./verify-zap.cjs');
const url = 'http://127.0.0.1:8090/JSON/core/view/version/';

// Records every credential sent and every line printed.
function provider(t, key, { acceptAll = false, body, reset = false } = {}) {
  const sent = [], lines = [];
  t.mock.method(http, 'get', (target, options, callback) => {
    const credential = options.headers['X-ZAP-API-Key'];
    sent.push(credential);
    assert.equal(target, url);
    const request = new EventEmitter();
    request.setTimeout = () => {};
    queueMicrotask(() => {
      const accepted = acceptAll || credential === key;
      if (reset && !accepted) {
        const socket = new EventEmitter();
        request.emit('socket', socket);
        socket.emit('connect');
        request.emit('error', Object.assign(new Error(), { code: 'ECONNRESET' }));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = accepted ? 200 : 403;
      response.setEncoding = () => {};
      callback(response);
      response.emit('data', body ?? JSON.stringify(accepted ? { version: '2.17.0' } : { code: 'bad_api_key' }));
      response.emit('end');
    });
    return request;
  });
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  return { sent, lines };
}
const keys = ['fixture-key', randomBytes(32).toString('hex'), 'ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghjklmnpqrstuvwxyz'];
test('invalid keys share no character with the real key and are never reused', () => {
  for (const key of keys) {
    const made = Array.from({ length: 20 }, () => verify.unrelatedKey(key));
    assert.equal(new Set(made).size, made.length);
    for (const value of made) {
      assert.match(value, /^[A-Za-z]{48}$/);
      assert.ok(![...value].some(char => key.includes(char)));
    }
  }
});
test('invalid key construction fails closed when no unrelated alphabet remains', () => {
  const key = 'GHJKLMNPQRSTUVWXYZghjkmnpqrstuvwxyz';
  assert.throws(() => verify.unrelatedKey(key), error => !error.message.includes(key));
});
for (const reset of [false, true]) for (const [i, key] of keys.entries()) {
  test(`refused requests never carry any part of the real key (${i}, reset ${reset})`, async t => {
    const { sent, lines } = provider(t, key, { reset });
    assert.equal(await verify(url, key), '2.17.0');
    const refused = sent.filter(value => value !== key);
    assert.equal(refused.length, 4);
    assert.equal(refused.filter(value => value === undefined).length, 2);
    for (const value of refused.filter(Boolean)) assert.ok(![...value].some(char => key.includes(char)));
    assert.ok(!lines.some(line => line.includes(key)));
  });
}
test('a retired key passed by mistake is ignored and never sent', async t => {
  const { sent } = provider(t, 'fixture-key');
  await verify(url, 'fixture-key', 'retired-fixture');
  assert.ok(!sent.includes('retired-fixture'));
});
test('a provider that accepts any key is rejected without revealing a key', async t => {
  const { lines } = provider(t, 'fixture-key', { acceptAll: true });
  await assert.rejects(verify(url, 'fixture-key'), error => /missing-key check/.test(error.message) && !error.message.includes('fixture-key'));
  assert.ok(!lines.some(line => line.includes('fixture-key')));
});
test('a malformed response that echoes the key is not quoted in the error', async t => {
  provider(t, 'fixture-key', { acceptAll: true, body: 'fixture-key not json' });
  await assert.rejects(verify(url, 'fixture-key'), error => error.message === 'Unexpected ZAP version response');
});
test('no script derives a request credential from a real key or prints one', () => {
  const scripts = fs.readdirSync(__dirname).filter(file => /\.(cjs|ps1)$/.test(file) && !file.includes('.test.'));
  assert.ok(scripts.length >= 5);
  for (const name of scripts) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.doesNotMatch(source, /\b(?:key|fresh|old|credential)\s*\+\s*['"`]|-wrong|\$\{(?:key|fresh|old|credential)\}|\b(?:log|error|info|warn)\([^)]*\b(?:key|fresh|old|credential)\b\s*[,)]/, name);
  }
});
