import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { placePoint } from '../src/place-point.mjs';
import { nearbyPlaces } from '../src/places.mjs';

const park = JSON.parse(await readFile(new URL('./fixtures/north-tushino-park.json', import.meta.url)));
const geometry = points => points.map(([lat, lon]) => ({ lat, lon }));
const square = (from, to) => geometry([[from, from], [from, to], [to, to], [to, from], [from, from]]);
// Independent point-in-ring check for the recorded OSM outline.
function inOutline(element, point) {
  let inside = false;
  for (const member of element.members) for (let i = 1; i < member.geometry.length; i++) {
    const a = member.geometry[i - 1], b = member.geometry[i];
    if ((a.lat > point.lat) !== (b.lat > point.lat) &&
      point.lon < a.lon + (point.lat - a.lat) * (b.lon - a.lon) / (b.lat - a.lat)) inside = !inside;
  }
  return inside;
}

test('North Tushino recorded bounding-box centre is outside the park; its replacement is inside the actual outline', () => {
  assert.equal(inOutline(park, park.center), false);
  const point = placePoint(park);
  assert.equal(inOutline(park, point), true);
  assert(Math.abs(point.lon - park.center.lon) > .005);
  assert.equal(park.center.lon, 37.4442344);
});

test('concave ways and polygon holes cannot place a marker in the missing area', () => {
  const concave = { type: 'way', center: { lat: 2, lon: 2 }, geometry: geometry([[0, 0], [0, 4], [1, 4], [1, 1], [4, 1], [4, 0], [0, 0]]) };
  const point = placePoint(concave);
  assert(point.lat > 0 && point.lat < 4 && point.lon > 0 && point.lon < 1);
  const holed = { type: 'relation', tags: { type: 'multipolygon' }, center: { lat: 3, lon: 3 }, members: [
    { type: 'way', role: 'outer', geometry: square(0, 6) }, { type: 'way', role: 'inner', geometry: square(2, 4) },
  ] };
  const holePoint = placePoint(holed);
  assert(holePoint.lon < 2 || holePoint.lon > 4 || holePoint.lat < 2 || holePoint.lat > 4);
  assert(holePoint.lon > 0 && holePoint.lon < 6 && holePoint.lat > 0 && holePoint.lat < 6);
});

test('disconnected polygons choose land even when no component crosses the mid-latitude', () => {
  const point = placePoint({ type: 'relation', tags: { type: 'multipolygon' }, members: [
    { type: 'way', role: 'outer', geometry: square(0, 1) }, { type: 'way', role: 'outer', geometry: square(5, 6) },
  ] });
  assert(point.lat > 0 && point.lat < 1 && point.lon > 0 && point.lon < 1 ||
    point.lat > 5 && point.lat < 6 && point.lon > 5 && point.lon < 6);
});

test('valid centres and node coordinates are retained; incomplete outlines are never closed by guessing', () => {
  const centre = { lat: .5, lon: .5 };
  assert.deepEqual(placePoint({ type: 'way', geometry: square(0, 1), center: centre }), centre);
  assert.deepEqual(placePoint({ type: 'node', lat: 1, lon: 2, center: centre }), { lat: 1, lon: 2 });
  assert.deepEqual(placePoint({ type: 'way', tags: { area: 'no' }, geometry: square(0, 1), center: { lat: 2, lon: 2 } }), { lat: 2, lon: 2 });
  assert.deepEqual(placePoint({ ...park, members: park.members.slice(1) }), park.center);
  assert.equal(placePoint({ type: 'way', geometry: [{ lat: NaN, lon: 1 }] }), undefined);
});

test('compact and tiled discovery use the corrected point and emit one object when centre and shape are both returned', async () => {
  const city = { id: 1, name: 'Moscow', latitude: 55.75, longitude: 37.61 };
  const boundary = { relation: 10, name: 'Moscow', url: 'https://www.openstreetmap.org/relation/10',
    bounds: { minlat: 55.7, minlon: 37.3, maxlat: 55.9, maxlon: 37.7 } };
  const { members, ...compact } = park;
  const fetchResponse = async url => {
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    const query = url.searchParams.get('data');
    assert(query.includes('rel.places[leisure~"^(park|garden)$"]'));
    assert(query.includes('out body geom;'));
    return Response.json({ elements: [{ type: 'area', id: 3600000010 }, compact, park] });
  };
  const result = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => boundary, fetchResponse });
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0].url, 'https://www.openstreetmap.org/relation/3106459');
  assert(inOutline(park, { lat: result.places[0].latitude, lon: result.places[0].longitude }));
  const segments = [[55.7, 37.3, 55.7, 37.7], [55.7, 37.7, 55.9, 37.7], [55.9, 37.7, 55.9, 37.3], [55.9, 37.3, 55.7, 37.3]];
  const tiled = await nearbyPlaces(city, { scope: 'city', resolveBoundary: async () => ({ ...boundary, segments, parts: [boundary.bounds] }),
    fetchResponse: async () => Response.json({ elements: [park] }) });
  assert.equal(tiled.places.length, 1);
  assert.equal(tiled.places[0].latitude, result.places[0].latitude);
  assert.equal(tiled.places[0].longitude, result.places[0].longitude);
});
