import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaceCache } from '../src/place-cache.mjs';
import { createPlaceSearch } from '../src/place-search.mjs';

test('successful discoveries and boundaries survive a server restart but expire independently', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'worth-a-stop-places-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = 1000, boundaries = 0, places = 0;
  const options = { diskCache: createPlaceCache(directory), now: () => time,
    discoverBoundary: async () => { boundaries++; return { relation: 42 }; },
    discoverPlaces: async (_city, { resolveBoundary }) => { places++; return { boundary: await resolveBoundary() }; },
  };
  const city = { id: 42, name: 'Town', latitude: 10, longitude: 20 };
  const first = await createPlaceSearch(options)(city, { scope: 'city' });
  assert.deepEqual(await createPlaceSearch(options)(city, { scope: 'city' }), first);
  assert.equal(places, 1); assert.equal(boundaries, 1);
  time += 3600001;
  await createPlaceSearch(options)(city, { scope: 'city' });
  assert.equal(places, 2); assert.equal(boundaries, 1);
  time += 86400001;
  await createPlaceSearch(options)(city, { scope: 'city' });
  assert.equal(places, 3); assert.equal(boundaries, 2);
});

test('corrupt files, unsafe key text and unwritable caches do not prevent a live result', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'worth-a-stop-places-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createPlaceCache(directory, { limit: 2 });
  await cache.set('../anything', { expires: 100, value: [1] });
  const [name] = await readdir(directory);
  assert.match(name, /^[a-f0-9]{64}\.json$/);
  await writeFile(join(directory, name), 'broken json');
  assert.equal(await cache.get('../anything'), undefined);
  await cache.set('second', { expires: 100, value: [2] });
  await cache.set('third', { expires: 100, value: [3] });
  assert.equal((await readdir(directory)).length, 2);
  const search = createPlaceSearch({ diskCache: createPlaceCache(join(directory, 'not-a-directory')),
    discoverPlaces: async () => [42] });
  await writeFile(join(directory, 'not-a-directory'), 'file');
  assert.deepEqual(await search({ latitude: 10, longitude: 20 }), [42]);
});
