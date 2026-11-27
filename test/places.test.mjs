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

test('prioritizes a documented place across categories and handles area centres', async () => {
  const museums = Array.from({ length: 14 }, (_, i) => ({ ...node, id: i + 10, tags: { ...node.tags, name: 'Museum ' + i } }));
  const places = await query([...museums, { type: 'way', id: 7, center: { lat: 0, lon: .015 }, tags: { leisure: 'park', name: 'City Park', wikidata: 'Q7', wikipedia: 'en:City Park', 'name:en': 'City Park' } }]);
  assert.equal(places.length, 12);
  assert.ok(places.some(place => place.category === 'park'));
  assert.equal(places.find(place => place.category === 'park').hours, undefined);
});

test('rejects an uncorroborated marketplace tag, prioritizes the cathedral and merges duplicate landmark points', async () => {
  const places = await query([
    { ...node, id: 20, tags: { name: 'Faxcopy', amenity: 'marketplace', website: 'https://www.faxcopy.sk/' } },
    { ...node, id: 21, tags: { name: 'Cathedral', tourism: 'attraction', building: 'cathedral', wikidata: 'Q1' } },
    { ...node, id: 22, tags: { name: 'Cathedral', building: 'cathedral', wikidata: 'Q1' } },
    { type: 'way', id: 23, center: { lat: 0, lon: .01 }, tags: { name: 'Market', amenity: 'marketplace' } },
  ]);
  assert.equal(places.some(place => place.name === 'Faxcopy'), false);
  assert.equal(places[0].category, 'cathedral');
  assert.equal(places.filter(place => place.name === 'Cathedral').length, 1);
  assert.ok(places.some(place => place.category === 'marketplace'));
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

test('uses the POST backup with the same query when both GET providers are unavailable', async () => {
  const calls = [];
  const places = await nearbyPlaces(city, { fetchResponse: async (url, options) => {
    calls.push({ url, options });
    if (calls.length < 3) return new Response(null, { status: 503 });
    assert.equal(url.hostname, 'overpass.private.coffee');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(new URLSearchParams(options.body).get('data'), calls[0].url.searchParams.get('data'));
    return Response.json({ elements: [node] });
  } });
  assert.equal(places.length, 1);
  assert.equal(calls.length, 3);
});

test('city discovery includes documented landmarks beyond the local radius without category quotas', async () => {
  const landmarks = [
    { type: 'relation', id: 1834818, center: { lat: 41.89021, lon: 12.49223 }, tags: {
      name: 'Colosseo', tourism: 'attraction', historic: 'archaeological_site', building: 'amphitheatre', wikidata: 'Q10285', wikipedia: 'it:Colosseo',
      heritage: '1', 'ref:whc': '91', importance: 'international', landmark: '1', 'name:en': 'Colosseum', 'name:ru': 'Колизей', 'name:fr': 'Colisée',
    } },
    { type: 'relation', id: 3374342, center: { lat: 41.898616, lon: 12.4768334 }, tags: {
      name: 'Pantheon', tourism: 'attraction', building: 'temple', heritage: '1', wikidata: 'Q99309', wikipedia: 'it:Pantheon (Roma)',
      'name:ru': 'Пантеон', 'name:fr': 'Panthéon', 'name:en': 'Pantheon', 'ref:whc': '91',
    } },
    { type: 'way', id: 244159210, center: { lat: 41.9021569, lon: 12.4537105 }, tags: {
      name: 'Basilica di San Pietro', tourism: 'attraction', building: 'basilica', historic: 'church', heritage: '1', wikidata: 'Q12512', wikipedia: 'it:Basilica di San Pietro in Vaticano',
      'name:ru': 'Собор Святого Петра', 'name:en': "Saint Peter's Basilica", 'name:de': 'Petersdom', 'ref:whc': '286', importance: 'international',
    } },
  ];
  const ordinary = Array.from({ length: 30 }, (_,index) => ({ type: 'node', id: index + 100, lat: 41.892, lon: 12.512 + index / 100000,
    tags: { name: 'Local cathedral ' + index, building: 'cathedral' } }));
  const other = { type: 'node', id: 999, lat: 41.9, lon: 12.53, tags: { name: 'Local market', amenity: 'marketplace', market: 'yes' } };
  const centre = { latitude: 41.89193, longitude: 12.51133 };
  let requested;
  const fetchResponse = async url => { requested = url.searchParams.get('data'); return Response.json({ elements: [...ordinary, other, ...landmarks] }); };
  const places = await nearbyPlaces(centre, { radiusKm: 6, fetchResponse });
  assert.equal(places.length, 24);
  assert.deepEqual(new Set(places.slice(0, 3).map(place => place.name)), new Set(landmarks.map(place => place.tags.name)));
  assert.ok(places.find(place => place.name === 'Pantheon').km > 2);
  assert.ok(places.find(place => place.name === 'Basilica di San Pietro').km > 4);
  assert.ok(requested.includes('[wikidata]'));
  assert.ok(!requested.includes('Colosseo') && !requested.includes('Q10285'));
  const local = await nearbyPlaces(centre, { radiusKm: 2, fetchResponse });
  assert.equal(local.length, 12);
  assert.equal(local.some(place => place.name === 'Pantheon'), false);
});

test('wide discovery rejects non-attractions, undocumented distant places and points outside the circle', async () => {
  const samples = [
    { ...node, id: 1, lat: .03, tags: { name: 'Distant park', leisure: 'park' } },
    { ...node, id: 2, lat: .03, tags: { name: 'Metro station', railway: 'station', wikidata: 'Q1', wikipedia: 'en:Station' } },
    { ...node, id: 3, lat: .05, lon: .05, tags: { name: 'Outside circle', tourism: 'attraction', wikidata: 'Q2' } },
    { ...node, id: 4, lat: .03, tags: { name: 'Temple', building: 'temple', wikidata: 'Q3' } },
  ];
  const places = await nearbyPlaces(city, { radiusKm: 6, fetchResponse: async () => Response.json({ elements: samples }) });
  assert.deepEqual(places.map(place => place.name), ['Temple']);
  await assert.rejects(nearbyPlaces(city, { radiusKm: 500 }), /radius/);
});
