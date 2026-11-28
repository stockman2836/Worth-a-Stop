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

test('stores and restores explicitly labelled nearby coverage only for the selected settlement centre', async () => {
  const saved = storage(), searchArea = { kind: 'nearby', radiusKm: 2, latitude: city.latitude, longitude: city.longitude };
  const first = await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json({ places: [place], searchArea }) });
  assert.equal(first.boundary, undefined); assert.deepEqual(first.searchArea, searchArea);
  const offline = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.deepEqual(offline.searchArea, searchArea); assert.equal(offline.stale, true);
  await assert.rejects(loadPlaces(city, { fetchResponse: async () => Response.json({ places: [], searchArea: { ...searchArea, latitude: 0 } }) }), /Invalid places response/);
  await assert.rejects(loadPlaces(city, { fetchResponse: async () => Response.json({ places: [], searchArea: { ...searchArea, radiusKm: 200 } }) }), /Invalid places response/);
});

test('progressive neighbourhood refreshes preserve coverage without fabricating a boundary object', async () => {
  const saved = storage(), searchArea = { kind: 'nearby', radiusKm: 2, latitude: city.latitude, longitude: city.longitude };
  await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json({ places: [place], searchArea }) });
  const updated = { ...place, name: 'Updated park' };
  const progress = await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json({ places: [updated], searchArea, incomplete: true, loading: true }) });
  assert.equal(progress.boundary, undefined);
  assert.deepEqual(progress.searchArea, searchArea);
  assert.equal(progress.places[0].name, updated.name);
  assert.equal(progress.loading, true);
  const restored = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.equal(restored.places[0].name, place.name);
});

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
  assert.equal(calls[0].searchParams.get('v'), '15');
  assert.equal(calls[0].searchParams.has('radius'), false);
  await assert.rejects(loadPlaces(city, { storage: saved, scope: 'nearby', fetchResponse: unavailable }));
  await loadPlaces(city, { storage: saved, scope: 'nearby', fetchResponse });
  assert.equal(calls[1].searchParams.get('scope'), 'nearby');
  assert.equal((await loadPlaces(city, { storage: saved, scope: 'nearby', fetchResponse: unavailable })).stale, true);
  await assert.rejects(loadPlaces(city, { scope: 'world', fetchResponse }), /scope/);
});

test('accepts thousands of city places and leaves capped shortlist caches unused', async () => {
  const saved = storage();
  saved.setItem(`worth-a-stop.places.v5.city.${city.id}.${city.latitude}.${city.longitude}`, JSON.stringify({ places: [place], boundary, checkedAt: Date.now() }));
  await assert.rejects(loadPlaces(city, { storage: saved, fetchResponse: unavailable }));
  saved.setItem(`worth-a-stop.places.v6.city.${city.id}.${city.latitude}.${city.longitude}`, JSON.stringify({ places: [place], boundary, checkedAt: Date.now() }));
  const older = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.equal(older.stale, true); assert.equal(older.incomplete, true);
  const places = Array.from({ length: 3000 }, (_,index) => ({ ...place, name: 'Place ' + index, url: 'https://www.openstreetmap.org/node/' + index }));
  assert.equal((await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json({ places, boundary }) })).places.length, 3000);
  await assert.rejects(loadPlaces(city, { scope: 'nearby', fetchResponse: async () => Response.json(places) }), /Invalid places/);
});

test('requires a valid boundary for city results and distinguishes an unavailable boundary', async () => {
  for (const payload of [[place], { places: [place] }, { places: [place], boundary: { name: 'Town', url: 'https://other.example/' } }]) {
    await assert.rejects(loadPlaces(city, { fetchResponse: async () => Response.json(payload) }), /Invalid places/);
  }
  await assert.rejects(loadPlaces(city, { fetchResponse: async () => new Response(null, { status: 422 }) }), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
  await assert.rejects(loadPlaces(city, { fetchResponse: async () => new Response(null, { status: 503 }) }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  const empty = await loadPlaces(city, { fetchResponse: async () => Response.json({ places: [], boundary }) });
  assert.deepEqual(empty.places, []);
});

test('preserves progress timestamps and does not save a loading flag for offline restoration', async () => {
  const saved = storage();
  const result = await loadPlaces(city, { storage: saved, fetchResponse: async () =>
    Response.json({ places: [place], boundary, checkedAt: 1000, incomplete: true, loading: true }) });
  assert.equal(result.checkedAt, 1000); assert.equal(result.loading, true);
  const offline = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.equal(offline.incomplete, true); assert.equal(offline.loading, undefined);
});

test('a partial refresh cannot overwrite the last complete city catalogue', async () => {
  const saved = storage();
  await loadPlaces(city, { storage: saved, fetchResponse: cityResponse });
  const result = await loadPlaces(city, { storage: saved, fetchResponse: async () =>
    Response.json({ places: [], boundary, incomplete: true, loading: true }) });
  assert.deepEqual(result.places, [place]);
  assert.equal(result.incomplete, true); assert.equal(result.loading, true);
  assert.equal(result.stale, true);
  const offline = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.equal(offline.incomplete, undefined);
});

test('new partial places appear immediately alongside a complete saved catalogue without replacing its offline baseline', async () => {
  const saved = storage();
  const baseline = await loadPlaces(city, { storage: saved, fetchResponse: cityResponse });
  const updated = { ...place, name: 'Updated park' };
  const addition = { ...place, name: 'New museum', url: 'https://www.openstreetmap.org/node/2' };
  const progress = await loadPlaces(city, { storage: saved, fetchResponse: async () =>
    Response.json({ places: [updated, addition], boundary, checkedAt: 1234, incomplete: true, loading: true }) });
  assert.deepEqual(progress.places, [updated, addition]);
  assert.equal(progress.checkedAt, baseline.checkedAt);
  assert.equal(progress.revision, 1234);
  const offline = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.deepEqual(offline.places, [place]);
});

test('unavailable states respect cooldown across workspace recreations and recover afterwards', async () => {
  let calls = 0;
  const fetchResponse = async () => {
    calls++;
    return calls === 1 ? Response.json({ status: 'unavailable', code: 'PLACE_SOURCE_UNAVAILABLE', retryAt: Date.now() + 200 }) : cityResponse();
  };
  for (let i = 0; i < 10; i++) {
    await assert.rejects(loadPlaces({ ...city, name: 'Translation ' + i }, { fetchResponse }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  }
  assert.equal(calls, 1);
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal((await loadPlaces(city, { fetchResponse })).places.length, 1);
  assert.equal(calls, 2);
});

test('legacy loading flags cannot restart polling after an unavailable response', async () => {
  const saved = storage();
  saved.setItem(`worth-a-stop.places.v6.city.${city.id}.${city.latitude}.${city.longitude}`,
    JSON.stringify({ places: [place], boundary, checkedAt: 1000, loading: true }));
  let calls = 0;
  const fetchResponse = async () => { calls++; return Response.json({ status: 'unavailable', retryAt: Date.now() + 60000 }); };
  const first = await loadPlaces(city, { storage: saved, fetchResponse });
  const second = await loadPlaces(city, { storage: saved, fetchResponse });
  assert.equal(first.loading, undefined); assert.equal(second.loading, undefined);
  assert.equal(first.checkedAt, 1000); assert.equal(first.stale, true);
  assert.equal(first.incomplete, true); assert.equal(calls, 1);
});

test('verified reference evidence survives offline restoration, while mismatched source links are rejected', async () => {
  const saved = storage();
  const referenced = { ...place, wikidata: 'Q211295', prominence: 'highlight', prominenceReasons: ['encyclopedic'], names: { ru: 'Форум Траяна', en: "Trajan's Forum" },
    reference: { url: 'https://www.wikidata.org/wiki/Q211295', wikipediaLanguages: 44, checkedAt: 1000, names: { ru: 'Форум Траяна', en: "Trajan's Forum" } } };
  await loadPlaces(city, { storage: saved, fetchResponse: async () => Response.json({ places: [referenced], boundary, referencesStatus: 'checked' }) });
  const offline = await loadPlaces(city, { storage: saved, fetchResponse: unavailable });
  assert.deepEqual(offline.places[0].reference, referenced.reference);
  assert.deepEqual(offline.places[0].names, referenced.names);
  assert.equal(offline.referencesStatus, 'checked');
  await assert.rejects(loadPlaces(city, { fetchResponse: async () => Response.json({ places: [{ ...referenced,
    reference: { ...referenced.reference, url: 'https://www.wikidata.org/wiki/Q999' } }], boundary }) }), /Invalid places response/);
});
