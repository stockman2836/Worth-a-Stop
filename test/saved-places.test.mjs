import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaces } from '../src/saved-places.mjs';

const city = { id: 42, name: 'Town', latitude: 50, longitude: 14 };
const place = { name: 'Park', names: {}, latitude: 50.01, longitude: 14, km: 1, url: 'https://www.openstreetmap.org/way/1' };
const boundary = { name: 'Town', url: 'https://www.openstreetmap.org/relation/42' };
const cityResponse = () => Response.json({ places: [place], boundary });
function storage() {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
}
const unavailable = async () => new Response(null, { status: 502 });

test('restores the last successful result for the same centre after an outage', async () => {
  const saved = storage();
  const live = await loadPlaces(city, { storage: saved, fetchResponse: cityResponse });
  const fallback = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.deepEqual(fallback.places, [place]);
  assert.equal(fallback.checkedAt, live.checkedAt);
  assert.equal(fallback.stale, true);
  assert.deepEqual(fallback.boundary, boundary);
  await assert.rejects(loadPlaces({ latitude: 51, longitude: 14 }, { storage: saved, fetchResponse: unavailable }));
});
test('handles blocked storage and rejects obsolete records without coordinates', async () => {
  const blocked = { setItem() { throw Error('blocked'); }, getItem() { return '{"places":[{}],"checkedAt":1}'; } };
  assert.equal((await loadPlaces(city, { storage: blocked, fetchResponse: cityResponse })).stale, false);
  await assert.rejects(loadPlaces(city, { storage: blocked, fetchResponse: unavailable }));
});
test('a cancelled city lookup never replaces the new city with a saved result', async () => {
  const saved = storage();
  await loadPlaces(city, { storage: saved, fetchResponse: cityResponse });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadPlaces(city, { signal: controller.signal, storage: saved, fetchResponse: unavailable }), { name: 'AbortError' });
});

test('city and local searches use separate versioned cache entries and the correct scope', async () => {
  const saved = storage();
  const calls = [];
  const fetchResponse = async value => {
    const url = new URL(value, 'https://app.example');
    calls.push(url);
    return url.searchParams.get('scope') === 'city' ? cityResponse() : Response.json([place]);
  };
  await loadPlaces(city, { storage: saved, fetchResponse });
  assert.equal(calls[0].searchParams.get('scope'), 'city');
  assert.equal(calls[0].searchParams.get('id'), '42');
  assert.equal(calls[0].searchParams.get('name'), 'Town');
  assert.equal(calls[0].searchParams.get('v'), '5');
  assert.equal(calls[0].searchParams.has('radius'), false);
  await assert.rejects(loadPlaces(city, { storage: saved, scope: 'nearby', fetchResponse: unavailable }));
  await loadPlaces(city, { storage: saved, scope: 'nearby', fetchResponse });
  assert.equal(calls[1].searchParams.get('scope'), 'nearby');
  assert.equal((await loadPlaces(city, { storage: saved, scope: 'nearby', fetchResponse: unavailable })).stale, true);
  await assert.rejects(loadPlaces(city, { scope: 'world', fetchResponse }), /scope/);
});

test('accepts 24 city suggestions and leaves old shortlist caches unused', async () => {
  const saved = storage();
  saved.setItem(`worth-a-stop.places.v3.6.${city.latitude}.${city.longitude}`, JSON.stringify({ places: [place], checkedAt: Date.now() }));
  await assert.rejects(loadPlaces(city, { storage: saved, fetchResponse: unavailable }));
  const places = Array.from({ length: 24 }, (_,index) => ({ ...place, name: 'Place ' + index, url: 'https://www.openstreetmap.org/node/' + index }));
  assert.equal((await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json({ places, boundary }) })).places.length, 24);
  await assert.rejects(loadPlaces(city, { scope: 'nearby', fetchResponse: async () => Response.json(places) }), /Invalid places/);
});

test('requires a valid boundary for city results and distinguishes an unavailable boundary', async () => {
  for (const payload of [[place], { places: [place] }, { places: [place], boundary: { name: 'Town', url: 'https://other.example/' } }]) {
    await assert.rejects(loadPlaces(city, { fetchResponse: async () => Response.json(payload) }), /Invalid places/);
  }
  await assert.rejects(loadPlaces(city, { fetchResponse: async () => new Response(null, { status: 422 }) }), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
  const empty = await loadPlaces(city, { fetchResponse: async () => Response.json({ places: [], boundary }) });
  assert.deepEqual(empty.places, []);
});
