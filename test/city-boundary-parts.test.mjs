import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedBounds, cityBoundaryParts, boundarySegments, containsPoint, tiledBounds } from '../src/city-boundary-parts.mjs';
import { coveringMirrors } from '../src/overpass-coverage.mjs';

const way = (id, nodes, minlon, maxlon) => ({ type: 'way', id, nodes,
  bounds: { minlat: 10, maxlat: 11, minlon, maxlon } });
const ways = [way(1, [1, 2, 3], 1, 2), way(2, [3, 4, 1], 2, 3), way(3, [5, 6, 5], 100, 101)];
const relation = { type: 'relation', id: 42, members: [
  ...ways.map(w => ({ type: 'way', ref: w.id, role: 'outer' })), { type: 'relation', ref: 100, role: 'subarea' },
] };

test('groups connected outlines without including the empty gap between distant islands', () => {
  assert.deepEqual(connectedBounds([relation, ...ways], 42), [
    { minlat: 10, maxlat: 11, minlon: 1, maxlon: 3 }, { minlat: 10, maxlat: 11, minlon: 100, maxlon: 101 },
  ]);
});

test('rejects missing boundary ways, malformed bounds and unsupported nested geometry', () => {
  assert.equal(connectedBounds([relation, ...ways.slice(1)], 42), null);
  assert.equal(connectedBounds([relation, ...ways.slice(1), { ...ways[0], bounds: {} }], 42), null);
  assert.equal(connectedBounds([{ ...relation, members: [...relation.members, { type: 'relation', ref: 5, role: 'outer' }] }, ...ways], 42), null);
});

test('requires coverage of every island while allowing different polygons in the same extract', () => {
  const ring = (left, right) => [[[left, 0], [right, 0], [right, 20], [left, 20], [left, 0]]];
  const index = { features: [{ properties: { id: 'asia' }, geometry: { type: 'MultiPolygon', coordinates: [ring(0, 5), ring(99, 102)] } }] };
  const parts = connectedBounds([relation, ...ways], 42);
  assert.equal(parts.every(box => coveringMirrors(index, box).length === 1), true);
  assert.equal([...parts, { ...parts[0], minlon: 50, maxlon: 51 }].every(box => coveringMirrors(index, box).length === 1), false);
  assert.deepEqual(coveringMirrors(index, []), []);
});

test('ordinary compact cities avoid the extra geometry lookup', async () => {
  let calls = 0;
  assert.equal(await cityBoundaryParts({ bounds: { minlat: 10, maxlat: 11, minlon: 1, maxlon: 2 } }, {}, {
    fetchResponse: async () => { calls++; throw Error('unexpected request'); },
  }), undefined);
  assert.equal(calls, 0);
});

test('checks disconnected polygons and holes locally, rejecting open and missing geometry', () => {
  const outline = (id, x, y, size) => ({ ...way(id, [id * 10, id * 10 + 1, id * 10 + 2, id * 10 + 3, id * 10], x, x + size),
    geometry: [{ lat: y, lon: x }, { lat: y, lon: x + size }, { lat: y + size, lon: x + size },
      { lat: y + size, lon: x }, { lat: y, lon: x }] });
  const shapes = [outline(1, 0, 0, 10), outline(2, 2, 2, 2), outline(3, 20, 20, 2)];
  const boundary = { ...relation, members: shapes.map(w => ({ type: 'way', ref: w.id, role: w.id === 2 ? 'inner' : 'outer' })) };
  const segments = boundarySegments([boundary, ...shapes], 42);
  const inside = containsPoint(segments);
  assert.equal(inside({ lat: 1, lon: 1 }), true);
  assert.equal(inside({ lat: 3, lon: 3 }), false);
  assert.equal(inside({ lat: 21, lon: 21 }), true);
  assert.equal(inside({ lat: 15, lon: 15 }), false);
  assert.equal(inside(null), false);
  assert.equal(boundarySegments([relation, ...ways], 42), null);
  assert.equal(boundarySegments([boundary, ...shapes.slice(1), { ...shapes[0], nodes: [1, 2, 3, 4, 5] }], 42), null);
});

test('tiles cover every component including shared edges without introducing a city radius', () => {
  const parts = [{ minlat: 0, maxlat: .41, minlon: 0, maxlon: .61 }, { minlat: 20, maxlat: 20.01, minlon: 100, maxlon: 100.01 }];
  const tiles = tiledBounds(parts);
  assert.equal(tiles.length, 13);
  for (const box of parts) for (const lat of [box.minlat, box.maxlat]) for (const lon of [box.minlon, box.maxlon]) {
    assert(tiles.some(tile => tile.minlat <= lat && tile.maxlat >= lat && tile.minlon <= lon && tile.maxlon >= lon));
  }
  assert(tiles.every(tile => tile.maxlat - tile.minlat <= .2 && tile.maxlon - tile.minlon <= .2));
});
