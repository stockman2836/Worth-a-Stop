import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceSearch } from '../src/place-search.mjs';

const city = { id: 42, name: 'Town', latitude: 50, longitude: 14 };

test('shares pending city searches across interface languages and isolates nearby searches', async () => {
  let calls = 0;
  const search = createPlaceSearch({ discoverPlaces: async (_city, { scope }) => { calls++; return scope; } });
  assert.deepEqual(await Promise.all([search(city, { scope: 'city' }), search({ ...city, name: 'Город' }, { scope: 'city' })]), ['city', 'city']);
  assert.equal(calls, 1);
  assert.equal(await search(city, { scope: 'nearby' }), 'nearby');
  assert.equal(calls, 2);
});

test('keeps a confirmed boundary after place lookup failure and starts TTL after completion', async () => {
  let boundaries = 0, calls = 0, time = 1000;
  const search = createPlaceSearch({ now: () => time,
    discoverBoundary: async () => { boundaries++; return { relation: 1 }; },
    discoverPlaces: async (_city, { resolveBoundary }) => {
      const boundary = await resolveBoundary();
      calls++;
      if (calls === 1) throw Error('place provider offline');
      time += 10000;
      return boundary;
    },
  });
  await assert.rejects(search(city, { scope: 'city' }));
  assert.equal((await search(city, { scope: 'city' })).relation, 1);
  assert.equal(boundaries, 1);
  time += 3599999;
  await search(city, { scope: 'city' });
  assert.equal(calls, 2);
  time += 2;
  await search(city, { scope: 'city' });
  assert.equal(calls, 3);
  assert.equal(boundaries, 1);
});

test('does not reuse a boundary from another city or cache a failed boundary lookup', async () => {
  let calls = 0;
  const search = createPlaceSearch({ discoverBoundary: async city => {
    calls++;
    if (calls === 1) throw Error('offline');
    return city.id;
  }, discoverPlaces: async (_city, { resolveBoundary }) => resolveBoundary() });
  await assert.rejects(search(city, { scope: 'city' }));
  assert.equal(await search(city, { scope: 'city' }), 42);
  assert.equal(await search({ ...city, id: 43 }, { scope: 'city' }), 43);
  assert.equal(calls, 3);
});

test('publishes progress without restarting the shared job and replaces it with the complete result', async () => {
  let finish, publish, calls = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const search = createPlaceSearch({ now: () => 1000, discoverPlaces: async (_city, { onProgress }) => {
    calls++; publish = onProgress;
    onProgress({ places: ['first'] });
    await finished;
    return { places: ['first', 'second'] };
  } });
  assert.deepEqual(await search(city, { scope: 'city' }), { places: ['first'], checkedAt: 1000, incomplete: true, loading: true });
  publish({ places: ['first', 'second'] });
  assert.equal((await search({ ...city, name: 'Translated' }, { scope: 'city' })).places.length, 2);
  assert.equal(calls, 1);
  finish(); await new Promise(setImmediate);
  const result = await search(city, { scope: 'city' });
  assert.equal(result.loading, undefined);
  assert.equal(result.incomplete, undefined);
  assert.deepEqual(result.places, ['first', 'second']);
});

test('keeps published places after a background failure and permits recovery after one minute', async () => {
  let calls = 0, time = 1000;
  const saved = new Map();
  const search = createPlaceSearch({ now: () => time,
    diskCache: { get: async key => saved.get(key), set: async (key, value) => saved.set(key, value) },
    discoverPlaces: async (_city, { onProgress }) => {
      calls++;
      if (calls === 1) { onProgress({ places: ['landmark'] }); throw Error('offline'); }
      return { places: ['landmark', 'park'] };
    },
  });
  await search(city, { scope: 'city' }); await new Promise(setImmediate);
  const partial = await search(city, { scope: 'city' });
  assert.equal(partial.incomplete, true); assert.equal(partial.loading, undefined);
  assert.equal(saved.size, 0);
  time += 60001;
  assert.equal((await search(city, { scope: 'city' })).places.length, 2);
  assert.equal(calls, 2); assert.equal(saved.size, 1);
});
