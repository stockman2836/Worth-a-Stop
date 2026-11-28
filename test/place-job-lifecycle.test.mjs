import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceSearch } from '../src/place-search.mjs';

const city = { id: 42, name: 'Town', latitude: 50, longitude: 14 };
const tick = () => new Promise(setImmediate);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('rapid city switching cancels boundary work and leaves the next city free to load', async () => {
  let active = 0, cancelled = 0;
  const search = createPlaceSearch({
    discoverBoundary: async (_city, { signal }) => {
      active++;
      try { return await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { cancelled++; reject(signal.reason); }, { once: true });
      }); } finally { active--; }
    },
    discoverPlaces: async (_city, { resolveBoundary }) => resolveBoundary(),
  });
  for (let id = 1; id <= 15; id++) {
    const controller = new AbortController();
    const pending = search({ ...city, id }, { scope: 'city', signal: controller.signal });
    await tick(); assert.equal(active, 1);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await tick(); assert.equal(active, 0);
  }
  assert.equal(cancelled, 15);
});

test('one cancelled viewer does not cancel a shared search used by another viewer', async () => {
  let finish, jobSignal, calls = 0;
  const search = createPlaceSearch({ discoverPlaces: async (_city, { signal }) => {
    calls++; jobSignal = signal;
    return new Promise(resolve => { finish = resolve; });
  } });
  const first = new AbortController();
  const cancelled = search(city, { scope: 'city', signal: first.signal });
  const surviving = search(city, { scope: 'city' });
  await tick(); first.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(jobSignal.aborted, false);
  finish({ places: ['landmark'] });
  assert.deepEqual((await surviving).places, ['landmark']);
  assert.equal(calls, 1);
});

test('polling renews a background lease and abandoned jobs can restart without a failure cooldown', async () => {
  let signal, calls = 0;
  const search = createPlaceSearch({ idleTimeout: 80, discoverPlaces: async (_city, options) => {
    calls++; signal = options.signal;
    if (calls > 1) return { places: ['complete'] };
    options.onProgress({ places: ['first'] });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  assert.equal((await search(city, { scope: 'city' })).loading, true);
  await delay(40);
  assert.equal((await search(city, { scope: 'city' })).loading, true);
  await delay(50); assert.equal(signal.aborted, false);
  await delay(50); assert.equal(signal.aborted, true);
  assert.deepEqual((await search(city, { scope: 'city' })).places, ['complete']);
});

test('expired and previous-version catalogues remain visibly stale during an outage', async () => {
  const value = { places: ['saved'], boundary: { name: 'Town', url: 'https://www.openstreetmap.org/relation/42' }, checkedAt: 1000 };
  const records = new Map([['places-v9/city/42/50/14', { expires: 5000, value }]]);
  const search = createPlaceSearch({ now: () => 10000,
    diskCache: { get: async key => records.get(key), set: async () => { throw Error('partial results must not replace the catalogue'); } },
    discoverPlaces: async () => { throw Error('offline'); },
  });
  const initial = await search(city, { scope: 'city' });
  assert.equal(initial.loading, true); assert.equal(initial.stale, true);
  await tick();
  const fallback = await search(city, { scope: 'city' });
  assert.equal(fallback.loading, undefined); assert.equal(fallback.stale, true);
  assert.equal(fallback.checkedAt, 1000); assert.equal(fallback.incomplete, true);
  assert.deepEqual(fallback.places, ['saved']);
});

test('failure cooldown coalesces repeated requests and is independent between cities', async () => {
  let calls = 0, time = 1000;
  const search = createPlaceSearch({ now: () => time, discoverPlaces: async () => { calls++; throw Error('offline'); } });
  for (let attempt = 0; attempt < 20; attempt++) await assert.rejects(search(city, { scope: 'city' }));
  assert.equal(calls, 1);
  await assert.rejects(search({ ...city, id: 43 }, { scope: 'city' }));
  assert.equal(calls, 2);
  time += 60001;
  await assert.rejects(search(city, { scope: 'city' }));
  assert.equal(calls, 3);
});
