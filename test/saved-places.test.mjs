import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaces } from '../src/saved-places.mjs';

const city = { latitude: 50, longitude: 14 };
const place = { name: 'Park', names: {}, latitude: 50.01, longitude: 14, km: 1, url: 'https://www.openstreetmap.org/way/1' };
function storage() {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
}
const unavailable = async () => new Response(null, { status: 502 });

test('restores the last successful result for the same centre after an outage', async () => {
  const saved = storage();
  const live = await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json([place]) });
  const fallback = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.deepEqual(fallback.places, [place]);
  assert.equal(fallback.checkedAt, live.checkedAt);
  assert.equal(fallback.stale, true);
  await assert.rejects(loadPlaces({ latitude: 51, longitude: 14 }, { storage: saved, fetchResponse: unavailable }));
});
test('handles blocked storage and rejects obsolete records without coordinates', async () => {
  const blocked = { setItem() { throw Error('blocked'); }, getItem() { return '{"places":[{}],"checkedAt":1}'; } };
  assert.equal((await loadPlaces(city, { storage: blocked, fetchResponse: async () => Response.json([place]) })).stale, false);
  await assert.rejects(loadPlaces(city, { storage: blocked, fetchResponse: unavailable }));
});
test('a cancelled city lookup never replaces the new city with a saved result', async () => {
  const saved = storage();
  await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json([place]) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadPlaces(city, { signal: controller.signal, storage: saved, fetchResponse: unavailable }), { name: 'AbortError' });
});

test('city and local searches use separate versioned cache entries and the correct radius', async () => {
  const saved = storage();
  const calls = [];
  const fetchResponse = async value => { calls.push(new URL(value, 'https://app.example')); return Response.json([place]); };
  await loadPlaces(city, { storage: saved, fetchResponse });
  assert.equal(calls[0].searchParams.get('radius'), '6');
  assert.equal(calls[0].searchParams.get('v'), '4');
  await assert.rejects(loadPlaces(city, { storage: saved, radiusKm: 2, fetchResponse: unavailable }));
  await loadPlaces(city, { storage: saved, radiusKm: 2, fetchResponse });
  assert.equal(calls[1].searchParams.get('radius'), '2');
  assert.equal((await loadPlaces(city, { storage: saved, radiusKm: 2, fetchResponse: unavailable })).stale, true);
  await assert.rejects(loadPlaces(city, { radiusKm: 99, fetchResponse }), /radius/);
});

test('accepts 24 city suggestions and leaves old shortlist caches unused', async () => {
  const saved = storage();
  saved.setItem(`worth-a-stop.places.v2.${city.latitude}.${city.longitude}`, JSON.stringify({ places: [place], checkedAt: Date.now() }));
  await assert.rejects(loadPlaces(city, { storage: saved, fetchResponse: unavailable }));
  const places = Array.from({ length: 24 }, (_,index) => ({ ...place, name: 'Place ' + index, url: 'https://www.openstreetmap.org/node/' + index }));
  assert.equal((await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json(places) })).places.length, 24);
  await assert.rejects(loadPlaces(city, { radiusKm: 2, fetchResponse: async () => Response.json(places) }), /Invalid places/);
});
