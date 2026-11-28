import test from 'node:test';
import assert from 'node:assert/strict';
import { enclosedTerritories, cityEnclaves } from '../src/city-enclaves.mjs';
import { nearbyPlaces } from '../src/places.mjs';
import { territoryLabel } from '../src/territory.mjs';
import { itineraryStop, itineraryStore } from '../src/itinerary.mjs';

const box = { minlat: 0, minlon: 0, maxlat: .1, maxlon: .1 };
const host = { relation: 100, name: 'Host', url: 'https://www.openstreetmap.org/relation/100', bounds: box, innerWays: [11, 12, 13] };
const candidate = (id, ways, level = '2', tags = {}) => ({ type: 'relation', id,
  bounds: { minlat: .02, minlon: .02, maxlat: .03, maxlon: .03 },
  members: ways.map(ref => ({ type: 'way', ref, role: 'outer' })),
  tags: { name: 'Enclave', 'name:en': 'Country', 'name:ru': 'Страна', boundary: 'administrative', admin_level: level, 'ISO3166-1:alpha2': 'VA', ...tags } });

test('requires every outer boundary way to belong to the host holes and rejects neighbours and enclosing regions', () => {
  const result = enclosedTerritories(host, [candidate(200, [11, 12, 13]), candidate(300, [11, 12, 99]),
    candidate(400, [90, 91]), candidate(100, [11, 12, 13]), candidate(500, []),
    { ...candidate(600, [11, 12]), bounds: { ...box, maxlat: 1 } },
    { ...candidate(700, [11, 12]), members: [{ type: 'relation', ref: 11, role: 'outer' }] }]);
  assert.deepEqual(result.map(value => value.relation), [200]);
  assert.equal(result[0].kind, 'country'); assert.equal(result[0].countryCode, 'VA');
});

test('coextensive municipality and country relations do not duplicate a territory; ambiguous identities are excluded', () => {
  assert.deepEqual(enclosedTerritories(host, [candidate(200, [11, 12, 13]), candidate(201, [11, 12, 13], '8')]).map(r => r.relation), [200]);
  assert.deepEqual(enclosedTerritories(host, [candidate(200, [11, 12, 13]), candidate(201, [11, 12, 13])]), []);
});

test('discovery skips cities without holes and caches confirmed topology', async () => {
  let calls = 0;
  const records = new Map(), queryCache = { get: async key => records.get(key), set: async (key, value) => records.set(key, value) };
  const options = { queryCache, fetchResponse: async url => {
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    calls++;
    assert(url.searchParams.get('data').includes('way(id:11,12,13)'));
    return Response.json({ elements: [candidate(200, [11, 12, 13])] });
  } };
  assert.deepEqual(await cityEnclaves({ ...host, innerWays: [] }, options), []);
  assert.equal(calls, 0);
  assert.equal((await cityEnclaves(host, options)).length, 1);
  assert.equal((await cityEnclaves(host, options)).length, 1);
  assert.equal(calls, 1);
});

const square = (x, y, size) => [[y, x, y, x + size], [y, x + size, y + size, x + size],
  [y + size, x + size, y + size, x], [y + size, x, y, x]];
const territory = enclosedTerritories(host, [candidate(200, [11, 12, 13])])[0];
const city = { id: 42, name: 'Host', latitude: .01, longitude: .01 };
const point = (id, coordinate) => ({ type: 'node', id, lat: coordinate, lon: coordinate,
  tags: { name: 'Site ' + id, tourism: 'museum', wikidata: 'Q' + id, wikipedia: 'en:Site', 'name:en': 'Site', 'name:ru': 'Место' } });
const boundary = { ...host, enclaves: [territory], parts: [box], segments: [...square(0, 0, .1), ...square(.02, .02, .01)] };

test('enclave places survive the host hole filter, retain territorial provenance and are not duplicated', async () => {
  const snapshots = [];
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => boundary, onProgress: value => snapshots.push(value),
    fetchResponse: async url => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = url.searchParams.get('data');
      assert(!query.includes('around:'));
      return Response.json({ elements: query.includes('rel(200)') ? [{ type: 'area', id: 3600000200 }, point(2, .025)] : [point(1, .01), point(2, .025), point(3, .2)] });
    } });
  assert.equal(result.places.length, 2);
  assert.equal(result.places.find(p => p.name === 'Site 1').territory, undefined);
  const foreign = result.places.find(p => p.name === 'Site 2');
  assert.equal(foreign.territory.countryCode, 'VA');
  assert.equal(result.boundary.enclaves[0].bounds, undefined);
  assert.equal(result.incomplete, undefined);
  assert(snapshots.some(snapshot => snapshot.places.length === 1));
  assert.equal(territoryLabel(foreign.territory, 'en'), 'Country: Country (VA)');
  assert.equal(territoryLabel(foreign.territory, 'ru'), 'Страна: Страна (VA)');
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = itineraryStore(420001, storage);
  store.add('2026-11-28', itineraryStop(foreign, 'place'));
  assert.equal(itineraryStore(420001, storage).read('2026-11-28').stops[0].territory.countryCode, 'VA');
});

test('optional territory failures keep the host catalogue available and labelled incomplete', async () => {
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => boundary,
    fetchResponse: async (url, options) => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = url.searchParams.get('data') ?? new URLSearchParams(options.body).get('data');
      return query.includes('rel(200)') ? new Response(null, { status: 503 }) : Response.json({ elements: [point(1, .01)] });
    } });
  assert.equal(result.places.length, 1); assert.equal(result.incomplete, true);
});

test('early city preview and enclave records survive a later whole-city batch', async () => {
  let finishHost;
  const hostPending = new Promise(resolve => { finishHost = resolve; });
  const snapshots = [];
  const result = await nearbyPlaces(city, { scope: 'city',
    resolveBoundary: async () => ({ ...boundary, bounds: { ...box, maxlat: .2, maxlon: .2 } }),
    onProgress: snapshot => snapshots.push(snapshot),
    fetchResponse: async url => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = url.searchParams.get('data');
      if (query.includes('rel(200)')) {
        assert(snapshots.some(snapshot => snapshot.places.some(place => place.name === 'Site 1')));
        finishHost();
        return Response.json({ elements: [{ type: 'area', id: 3600000200 }, point(2, .025)] });
      }
      if (!query.includes('(0,0,0.1,0.1)')) return Response.json({ elements: [point(1, .01)] });
      await hostPending;
      return Response.json({ elements: [point(1, .01), point(3, .05)] });
    } });
  assert.deepEqual(new Set(result.places.map(place => place.name)), new Set(['Site 1', 'Site 2', 'Site 3']));
  assert.equal(result.places.find(place => place.name === 'Site 2').territory.countryCode, 'VA');
  assert.equal(result.incomplete, undefined);
});

test('optional topology discovery runs after the host is published and cannot discard its places', async () => {
  let published = false;
  const { enclaves, ...undiscovered } = boundary;
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => undiscovered,
    onProgress: snapshot => { if (snapshot.places.length) published = true; },
    fetchResponse: async (url, options) => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = url.searchParams.get('data') ?? new URLSearchParams(options.body).get('data');
      if (query.includes('bw.holes')) { assert(published); return new Response(null, { status: 503 }); }
      return Response.json({ elements: [point(1, .01)] });
    } });
  assert.equal(result.places.length, 1); assert.equal(result.incomplete, true);
});

test('territory discovery respects cancellation rather than converting it to an empty result', async () => {
  const controller = new AbortController();
  await assert.rejects(cityEnclaves(host, { signal: controller.signal, fetchResponse: async url => {
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    controller.abort(); throw controller.signal.reason;
  } }), { name: 'AbortError' });
});
