import test from 'node:test';
import assert from 'node:assert/strict';
import { cityBoundary } from '../src/city-boundary.mjs';
import { readFile } from 'node:fs/promises';

test('recorded settlement polygons resolve Yalta, Sevastopol, Nikita and the Vatican city-state', async () => {
  const records = JSON.parse(await readFile(new URL('./fixtures/settlement-boundaries.json', import.meta.url)));
  const cities = [
    { id: 688533, name: 'Ялта', latitude: 44.50218, longitude: 34.16624, relation: 3005461 },
    { id: 694423, name: 'Севастополь', latitude: 44.60795, longitude: 33.52134, relation: 3030976 },
    { id: 711527, name: 'Никита', latitude: 44.51335, longitude: 34.23517, relation: 3598392 },
    { id: 6691831, name: 'Ватикан', latitude: 41.90268, longitude: 12.45414, relation: 36989 },
  ];
  for (const city of cities) {
    const polygon = records.find(record => record.id === city.relation);
    const ambiguousAdmins = [1, 2].map(id => ({ type: 'relation', id,
      tags: { name: city.name, boundary: 'administrative', admin_level: '4' } }));
    const result = await cityBoundary(city, { fetchResponse: async url => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = url.searchParams.get('data');
      assert(query.includes('area.all[place~'));
      assert(query.includes('[admin_level=2][city=yes]'));
      return Response.json({ elements: [polygon, ...ambiguousAdmins] });
    } });
    assert.equal(result.relation, city.relation);
    assert.equal(result.kind, city.relation === 36989 ? 'city-state' : 'settlement');
  }
});

const city = { id: 42, name: 'Town', latitude: 50, longitude: 14 };

test('a failed canonical lookup is a source outage, not an unsupported city', async () => {
  await assert.rejects(cityBoundary(city, { fetchResponse: async url =>
    url.hostname === 'geocoding-api.open-meteo.com' ? new Response(null, { status: 503 }) : Response.json({ elements: [] }) }),
  { code: 'PLACE_SOURCE_UNAVAILABLE' });
});
const relation = (id, tags) => ({ type: 'relation', id, tags: { name: 'Town', boundary: 'administrative', admin_level: '8', ...tags } });
const lookup = (elements, place = city) => cityBoundary(place, { fetchResponse: async url => {
  if (url.hostname === 'geocoding-api.open-meteo.com') return Response.json({ id: place.id, name: place.name, feature_code: 'PPL' });
  const query = url.searchParams.get('data');
  assert.ok(query.includes('is_in(50,14)'));
  assert.ok(query.includes('rel(pivot.boundaries)'));
  assert.ok(!query.includes(place.name)); // User names are matched locally, not interpolated into QL.
  return Response.json({ elements });
} });

test('matches GeoNames identity before names and ignores countries and conflicting identities', async () => {
  const result = await lookup([
    relation(1, { admin_level: '2', 'geonames:id': '42' }),
    relation(2, { name: 'Local name', 'geonames:id': '42' }),
    relation(3, { 'geonames:id': '99' }), relation(4, { place: 'city' }),
  ]);
  assert.equal(result.relation, 2);
  assert.equal(result.name, 'Local name');
});

test('retains only inner way references needed to discover enclosed territories', async () => {
  const result = await lookup([{ ...relation(1, {}), members: [
    { type: 'way', ref: 11, role: 'inner' }, { type: 'way', ref: 12, role: 'outer' },
    { type: 'relation', ref: 13, role: 'subarea' },
  ] }]);
  assert.deepEqual(result.innerWays, [11]);
});

test('uses the existing city identity when OSM lacks the requested-language translation', async () => {
  const result = await cityBoundary({ ...city, name: 'Кошице' }, { fetchResponse: async url => {
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      assert.equal(url.searchParams.get('id'), String(city.id));
      assert.equal(url.searchParams.get('language'), 'en');
      return Response.json({ id: city.id, name: 'Košice', feature_code: 'PPL' });
    }
    return Response.json({ elements: [relation(1, { name: 'Košice', place: 'city', admin_level: '5' })] });
  } });
  assert.equal(result.relation, 1);
});

test('rejects a conflicting identity from the canonical-name fallback', async () => {
  await assert.rejects(cityBoundary({ ...city, name: 'Translation' }, { fetchResponse: async url =>
    Response.json(url.hostname === 'geocoding-api.open-meteo.com' ? { id: 999, name: 'Town', feature_code: 'PPL' } : { elements: [relation(1, {})] })
  }), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
});

test('matches translated and alternate names without taking the surrounding province', async () => {
  const result = await lookup([relation(1, { name: 'Province', admin_level: '4' }),
    relation(2, { name: 'Město', 'alt_name:en': 'Old town;Town' }),
    relation(3, { name: 'Town', admin_level: '6' })]);
  assert.equal(result.relation, 2);
});

test('does not invent boundaries for unmatched cities, ambiguous names or invalid results', async () => {
  for (const elements of [[], [relation(1, { name: 'Different city' })], [relation(1, {}), relation(2, {})],
    [{ ...relation(1, {}), type: 'node' }], [relation(1, { admin_level: 'not-a-level' })]]) {
    await assert.rejects(lookup(elements), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
  }
  await assert.rejects(lookup([], { ...city, latitude: Infinity }), /Invalid city/);
});
