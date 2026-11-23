'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const verify = require('./verify-zap.cjs');

for (const acceptRetired of [false, true]) {
  test('retired credential control when accepted=' + acceptRetired, async t => {
    const calls = [];
    t.mock.method(http, 'get', (url, options, callback) => {
      const credential = options.headers['X-ZAP-API-Key'];
      calls.push(credential);
      assert.equal(url, 'http://127.0.0.1:8090/JSON/core/view/version/');
      const request = new EventEmitter();
      request.setTimeout = () => {};
      queueMicrotask(() => {
        const accepted = credential === 'new-fixture' || (acceptRetired && credential === 'old-fixture');
        const response = new EventEmitter();
        response.statusCode = accepted ? 200 : 403;
        response.setEncoding = () => {};
        callback(response);
        response.emit('data', JSON.stringify(accepted ? {version:'2.17.0'} : {code:'bad_api_key'}));
        response.emit('end');
      });
      return request;
    });
    t.mock.method(console,'log',()=>{});
    const result = verify('http://127.0.0.1:8090/JSON/core/view/version/', 'new-fixture', 'old-fixture');
    if (acceptRetired) await assert.rejects(result, /retired-key check/);
    else assert.equal(await result, '2.17.0');
    assert.ok(calls.includes('old-fixture'));
  });
}
