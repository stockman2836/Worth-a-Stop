import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbyPlaces } from '../src/places.mjs';

const city = { latitude: 0, longitude: 0 };
const node = { id: 9, type: 'node', lat: 0, lon: .009, tags: { tourism: 'museum', name: 'Museum', 'name:ru': 'Музей', opening_hours: 'Mo-Fr 10:00-18:00' } };
const query = elements => nearbyPlaces(city, { fetchResponse: async () => Response.json({ elements }) });

test('uses localized names, published hours and object links with great-circle distances', async () => {
  const places = await query([node, { ...node, lon: .05 }, { ...node, tags: { ...node.tags, access: 'private' } }]);
  assert.equal(places.length, 1);
  const [place] = places;
  assert.equal(place.names.ru, 'Музей');
  assert.equal(place.url, 'https://www.openstreetmap.org/node/9');
  assert.equal(place.latitude, node.lat);
  assert.equal(place.longitude, node.lon);
  assert.equal(place.hours, node.tags.opening_hours);
  assert.ok(Math.abs(place.km - 1) < .002);
});

test('keeps a more distant category in the shortlist and handles area centres', async () => {
  const museums = Array.from({ length: 14 }, (_, i) => ({ ...node, id: i + 10 }));
  const places = await query([...museums, { type: 'way', id: 7, center: { lat: 0, lon: .015 }, tags: { leisure: 'park', name: 'City Park' } }]);
  assert.equal(places.length, 12);
  assert.equal(places.at(-1).category, 'park');
  assert.equal(places.at(-1).hours, undefined);
});

test('distinguishes an empty area from an incomplete Overpass response', async () => {
  assert.deepEqual(await query([]), []);
  await assert.rejects(nearbyPlaces(city, { fetchResponse: async () => Response.json({ elements: [], remark: 'timeout' }) }));
});

test('uses the other endpoint after an outage and respects a cancelled city search', async () => {
  const hosts = [];
  const places = await nearbyPlaces(city, { fetchResponse: async url => {
    hosts.push(url.host);
    return hosts.length === 1 ? new Response(null, { status: 503 }) : Response.json({ elements: [node] });
  } });
  assert.equal(new Set(hosts).size, 2);
  assert.equal(places.length, 1);
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(nearbyPlaces(city, { signal: controller.signal, fetchResponse: async () => {
    attempts++;
    controller.abort();
    throw Error('cancelled');
  } }));
  assert.equal(attempts, 1);
});
