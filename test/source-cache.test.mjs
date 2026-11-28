import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceCache } from '../src/source-cache.mjs';

test('refresh shares pending work and cannot bypass a failed-source cooldown', async () => {
  let calls = 0, time = 1000, finish;
  const cache = createSourceCache({ now: () => time });
  const load = async () => { calls++; return new Promise((resolve, reject) => { finish = reject; }); };
  const first = cache('city', load);
  const refresh = cache('city', load, { refresh: true });
  await new Promise(setImmediate); assert.equal(calls, 1);
  finish(Error('offline'));
  await assert.rejects(first); await assert.rejects(refresh);
  for (let i = 0; i < 10; i++) await assert.rejects(cache('city', load, { refresh: true }));
  assert.equal(calls, 1);
  time += 60001;
  assert.deepEqual(await cache('city', async () => { calls++; return ['recovered']; }), ['recovered']);
});

test('nested discovery errors keep the original recovery time instead of extending it for every date', async () => {
  let time = 1000;
  const cache = createSourceCache({ now: () => time });
  const error = Object.assign(Error('calendar discovery unavailable'), { retryAt: 5000 });
  await assert.rejects(cache('today', async () => { throw error; }));
  time = 3000;
  await assert.rejects(cache('tomorrow', async () => { throw error; }));
  assert.equal(error.retryAt, 5000);
  time = 5001;
  assert.equal(await cache('tomorrow', async () => 'recovered'), 'recovered');
});
