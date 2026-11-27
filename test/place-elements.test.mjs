import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbyPlaces } from '../src/places.mjs';

const city = { id: 42, name: 'Town', latitude: .01, longitude: .01 };
const square = (x, y, size) => [[y, x, y, x + size], [y, x + size, y + size, x + size],
  [y + size, x + size, y + size, x], [y + size, x, y, x]];
const boundary = { relation: 42, name: 'Town', url: 'https://www.openstreetmap.org/relation/42',
  parts: [{ minlat: 0, maxlat: .1, minlon: 0, maxlon: .1 }, { minlat: 1, maxlat: 1.1, minlon: 1, maxlon: 1.1 }],
  segments: [...square(0, 0, .1), ...square(.04, .04, .02), ...square(1, 1, .1)] };
const element = (id, lat, lon) => ({ type: 'node', id, lat, lon, tags: { name: 'Museum ' + id, tourism: 'museum', wikidata: 'Q' + id } });
const data = (url, options) => url.searchParams.get('data') || new URLSearchParams(options.body).get('data');

test('tiled discovery checks exact boundaries locally and keeps distant components without duplicates', async () => {
  let active = 0, maximum = 0, publications = 0;
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => boundary,
    onProgress: () => { publications++; }, fetchResponse: async (url, options) => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = data(url, options);
      assert(!query.includes('area.city'));
      assert(query.includes('geom;'));
      maximum = Math.max(maximum, ++active);
      await new Promise(setImmediate); active--;
      return Response.json({ elements: [element(1, .01, .01), element(2, .05, .05), element(3, 1.01, 1.01), element(4, .5, .5),
        { ...element(5, .5, .5), type: 'way', center: { lat: .5, lon: .5 }, geometry: [{ lat: .01, lon: .01 }] },
        { type: 'way', id: 6, tags: element(6).tags, geometry: [{ lat: .01, lon: .01 }, { lat: .02, lon: .02 }] },
        { type: 'relation', id: 7, tags: element(7).tags, members: [{ type: 'way', ref: 7, geometry: [{ lat: .01, lon: .01 }, { lat: .02, lon: .02 }] }] }] });
    } });
  assert.deepEqual(new Set(result.places.map(p => p.name)), new Set(['Museum 1', 'Museum 3', 'Museum 5', 'Museum 6', 'Museum 7']));
  assert(result.places.find(p => p.name === 'Museum 3').km > 100);
  assert.equal(result.incomplete, undefined);
  assert(maximum <= 3); assert(publications > 0);
});

test('a compact city also switches to tiled discovery when its area query proves too expensive', async () => {
  const queries = [];
  const compact = { relation: 42, name: boundary.name, url: boundary.url, bounds: boundary.parts[0] };
  const geometry = [{ lat: 0, lon: 0 }, { lat: 0, lon: .1 }, { lat: .1, lon: .1 }, { lat: .1, lon: 0 }, { lat: 0, lon: 0 }];
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => compact,
    fetchResponse: async (url, options) => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = data(url, options); queries.push(query);
      if (query.includes('area.city')) return Response.json({ elements: [], remark: 'Query timed out' });
      if (query.includes('.boundary out body')) return Response.json({ elements: [
        { type: 'relation', id: 42, members: [{ type: 'way', ref: 1, role: 'outer' }] },
        { type: 'way', id: 1, nodes: [1, 2, 3, 4, 1], bounds: compact.bounds, geometry },
      ] });
      return Response.json({ elements: [element(1, .01, .01)] });
    } });
  assert.equal(result.places.length, 1);
  assert.equal(queries.length, 3);
  assert.equal(result.incomplete, undefined);
});

test('subdivides expensive tiles and reuses successful tile responses on the next search', async () => {
  const entries = new Map(), queries = [];
  const queryCache = { get: async key => entries.get(key), set: async (key, value) => entries.set(key, value) };
  const onePart = { ...boundary, parts: boundary.parts.slice(0, 1) };
  const fetchResponse = async (url, options) => {
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    const query = data(url, options); queries.push(query);
    if (query.includes('(0,0,0.1,0.1)')) return Response.json({ elements: [], remark: 'Query timed out' });
    return Response.json({ elements: [element(1, .01, .01)] });
  };
  const options = { scope: 'city', queryCache, resolveBoundary: async () => onePart, fetchResponse };
  const first = await nearbyPlaces(city, options);
  assert.equal(first.places.length, 1); assert.equal(queries.length, 5);
  assert.equal(entries.size, 5);
  assert.deepEqual(await nearbyPlaces(city, options), first);
  assert.equal(queries.length, 5);
});

test('an unavailable component is labelled partial instead of discarding successfully loaded places', async () => {
  let published;
  const ready = new Promise(resolve => { published = resolve; });
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => boundary,
    onProgress: published,
    fetchResponse: async (url, options) => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      if (data(url, options).includes('(1,1,1.1,1.1)')) { await ready; return new Response(null, { status: 503 }); }
      return Response.json({ elements: [element(1, .01, .01)] });
    } });
  assert.equal(result.incomplete, true);
  assert.equal(result.places.length, 1);
});
