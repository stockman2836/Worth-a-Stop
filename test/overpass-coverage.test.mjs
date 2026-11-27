import test from 'node:test';
import assert from 'node:assert/strict';
import { coveringMirrors, createCoverageLookup } from '../src/overpass-coverage.mjs';

const square = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const feature = (id, rings) => ({ properties: { id }, geometry: { type: 'MultiPolygon', coordinates: [rings] } });
const index = { type: 'FeatureCollection', features: [feature('europe', [square(0, 40, 30, 60)]), feature('asia', [square(100, 0, 150, 50)])] };
const extent = { minlat: 48, minlon: 2, maxlat: 49, maxlon: 3 };

test('selects mirrors by published geometry and requires coverage of the whole query extent', () => {
  assert.deepEqual(coveringMirrors(index, extent), ['https://ovp.dresel.systems/api/interpreter']);
  assert.deepEqual(coveringMirrors(index, { minlat: 30, minlon: 130, maxlat: 36, maxlon: 141 }), ['https://ovp.dresel.systems/api-as/interpreter']);
  assert.deepEqual(coveringMirrors(index, { ...extent, minlon: -1 }), []);
  assert.deepEqual(coveringMirrors(index, { ...extent, maxlat: 70 }), []);
  assert.deepEqual(coveringMirrors(index, { ...extent, minlon: 179, maxlon: -179 }), []);
  const dateLine = { features: [feature('asia', [square(170, -30, -170, 30)])] };
  assert.deepEqual(coveringMirrors(dateLine, { minlat: 0, maxlat: 1, minlon: 0, maxlon: 1 }), []);
});

test('rejects holes and concave coverage gaps even when all query corners lie inside the outer ring', () => {
  const hole = { features: [feature('europe', [square(0, 0, 10, 10), square(4, 4, 6, 6)])] };
  assert.deepEqual(coveringMirrors(hole, { minlat: 3, minlon: 3, maxlat: 7, maxlon: 7 }), []);
  const concave = { features: [feature('europe', [[[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10], [0, 0]]])] };
  assert.deepEqual(coveringMirrors(concave, { minlat: 2, minlon: 3, maxlat: 8, maxlon: 7 }), []);
});

test('coalesces index downloads and caches metadata without making it a mandatory dependency', async () => {
  let time = 1000, requests = 0, offline = false;
  const lookup = createCoverageLookup({ now: () => time, fetchResponse: async () => {
    requests++;
    if (offline) throw Error('offline');
    return Response.json(index);
  } });
  const results = await Promise.all([lookup(extent), lookup(extent)]);
  assert.equal(requests, 1);
  assert.equal(results[0].length, 1);
  time += 86400001;
  offline = true;
  assert.equal((await lookup(extent)).length, 1);
  assert.equal((await lookup(extent)).length, 1);
  assert.equal(requests, 2);
  const unavailable = createCoverageLookup({ fetchResponse: async () => { throw Error('offline'); } });
  assert.deepEqual(await unavailable(extent), []);
});
