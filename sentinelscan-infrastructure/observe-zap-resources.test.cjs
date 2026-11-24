'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { options, observe } = require('./observe-zap-resources.cjs');

test('default samples once and accepts bounded explicit options', () => {
  assert.deepEqual(options([]), { count: 1, interval: 10 });
  assert.deepEqual(options(['--count=120','--interval-seconds','60']), { count: 120, interval: 60 });
});
test('invalid arguments fail before sampling', () => {
  for (const args of [['--count','0'], ['--count','121'], ['--count','1.2'],
    ['--interval-seconds','0'], ['--interval-seconds','61'], ['--unknown'], ['extra']]) {
    assert.throws(() => options(args));
  }
});
test('waits between completed samples only', async () => {
  const events = [];
  await observe({ count: 3, interval: 2 }, async i => { events.push(i); }, async ms => { events.push(ms); });
  assert.deepEqual(events, [1, 2000, 2, 2000, 3]);
});
test('stops on first failure', async () => {
  let calls = 0;
  await assert.rejects(observe({ count: 3, interval: 1 }, async () => {
    if (++calls === 2) throw Error('fixture outage');
  }, async () => {}), /fixture outage/);
  assert.equal(calls, 2);
});
