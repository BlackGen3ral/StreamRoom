import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewQueue } from '../../src/StreamRoom.App/Web/preview-queue.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('rapid tab changes discard stale previews and retain the concurrency bound', async () => {
  const started = [], finish = new Map(), shown = [];
  const queue = createPreviewQueue(source => {
    started.push(source);
    return new Promise(resolve => finish.set(source, resolve));
  });
  for (const id of ['old1','old2','never']) queue.add(id, value => shown.push(value));
  await tick(); assert.deepEqual(started, ['old1','old2']);
  queue.reset();
  queue.add('monitor', value => shown.push(value));
  await tick(); assert.equal(started.length, 2);
  finish.get('old1')('stale'); await tick();
  assert.deepEqual(started, ['old1','old2','monitor']);
  finish.get('monitor')('fresh'); finish.get('old2')('stale'); await tick();
  assert.deepEqual(shown, ['fresh']);
});

test('failed images do not stop the queue, and closing discards pending work', async () => {
  let calls = 0; const shown = [];
  const queue = createPreviewQueue(async () => { calls++; if (calls === 1) throw Error('closed window'); return 'image'; }, 1);
  queue.add('bad', value => shown.push(value)); queue.add('good', value => shown.push(value));
  await tick(); assert.deepEqual(shown, [null, 'image']);
  queue.add('inflight', value => shown.push(value)); queue.add('never', value => shown.push(value)); queue.reset();
  await tick(); assert.equal(calls, 3); assert.deepEqual(shown, [null, 'image']);
});
