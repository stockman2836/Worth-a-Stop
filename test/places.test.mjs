import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbyPlaces } from '../src/places.mjs';

const city = { latitude: 0, longitude: 0 };
const node = { id: 9, type: 'node', lat: 0, lon: .009, tags: { tourism: 'museum', name: 'Museum', 'name:ru': 'Музей', opening_hours: 'Mo-Fr 10:00-18:00' } };
const query = elements => nearbyPlaces(city, { fetchResponse: async () => Response.json({ elements }) });

test('a confirmed settlement without its own polygon returns nearby coverage, not its larger municipality', async () => {
  const settlement = { id: 42, name: 'Small village', latitude: 0, longitude: 0 };
  const result = await nearbyPlaces(settlement, { scope: 'city', resolveBoundary: async () => {
    throw Object.assign(Error('No own boundary'), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
  }, fetchResponse: async url => {
    if (url.hostname === 'geocoding-api.open-meteo.com') return Response.json({ ...settlement, feature_code: 'PPL' });
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    return Response.json({ elements: [node, { ...node, id: 100, lon: 1, tags: { ...node.tags, name: 'Outside village' } }] });
  } });
  assert.equal(result.boundary, undefined);
  assert.deepEqual(result.searchArea, { kind: 'nearby', radiusKm: 2, latitude: 0, longitude: 0 });
  assert.deepEqual(result.places.map(place => place.name), ['Museum']);
});

test('missing boundary fallback preserves empty source results and never masks source outages or unverified identities', async () => {
  const settlement = { id: 42, name: 'Village', latitude: 0, longitude: 0 };
  const missing = async () => { throw Object.assign(Error('No polygon'), { code: 'CITY_BOUNDARY_UNAVAILABLE' }); };
  const result = await nearbyPlaces(settlement, { scope: 'city', resolveBoundary: missing, fetchResponse: async url =>
    url.hostname === 'geocoding-api.open-meteo.com' ? Response.json({ ...settlement, feature_code: 'PPL' }) :
      url.hostname === 'download.geofabrik.de' ? new Response(null, { status: 503 }) : Response.json({ elements: [] }) });
  assert.deepEqual(result.places, []); assert.equal(result.searchArea.kind, 'nearby');
  await assert.rejects(nearbyPlaces(settlement, { scope: 'city', resolveBoundary: missing, fetchResponse: async () =>
    Response.json({ ...settlement, id: 43, feature_code: 'PPL' }) }), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
  await assert.rejects(nearbyPlaces(settlement, { scope: 'city', resolveBoundary: missing, fetchResponse: async () =>
    new Response('upstream error', { status: 200 }) }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  await assert.rejects(nearbyPlaces(settlement, { scope: 'city', resolveBoundary: async () => {
    throw Object.assign(Error('Provider offline'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  }, fetchResponse: () => assert.fail('An outage must not trigger a different search area') }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
});

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
    { ...node, id: 24, tags: { name: 'Basilica', tourism: 'attraction', building: 'basilica' } },
    { ...node, id: 25, tags: { name: 'Church museum', tourism: 'museum', building: 'church' } },
  ]);
  assert.equal(places.some(place => place.name === 'Faxcopy'), false);
  assert.equal(places[0].category, 'cathedral');
  assert.equal(places.filter(place => place.name === 'Cathedral').length, 1);
  assert.ok(places.some(place => place.category === 'marketplace'));
  assert.equal(places.find(place => place.name === 'Basilica').category, 'basilica');
  assert.equal(places.find(place => place.name === 'Church museum').category, 'museum');
});

test('distinguishes an empty area from an incomplete Overpass response', async () => {
  assert.deepEqual(await query([]), []);
  await assert.rejects(nearbyPlaces(city, { fetchResponse: async () => Response.json({ elements: [], remark: 'timeout' }) }));
});

test('cultural discovery keeps documented venues without admitting every named artwork or theatre', async () => {
  const sample = (id, tags) => ({ ...node, id, tags: { name: 'Place ' + id, ...tags } });
  const places = await query([
    sample(1, { tourism: 'artwork' }), sample(2, { amenity: 'theatre' }),
    sample(3, { tourism: 'artwork', wikidata: 'Q3' }), sample(4, { amenity: 'theatre', wikipedia: 'en:Theatre' }),
    sample(5, { tourism: 'artwork', heritage: '2' }),
    sample(6, { name: 'Drama theatre', highway: 'bus_stop', wikidata: 'Q6' }),
  ]);
  assert.deepEqual(new Set(places.map(place => place.name)), new Set(['Place 3', 'Place 4', 'Place 5']));
  assert(places.every(place => place.prominence !== 'highlight'));
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
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
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
  const centre = { id: 3169070, name: 'Rome', latitude: 41.89193, longitude: 12.51133 };
  let requested;
  const fetchResponse = async url => {
    if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
    requested = url.searchParams.get('data');
    if (requested.includes('is_in')) return Response.json({ elements: [{ type: 'relation', id: 41485,
      bounds: { minlat: 41.6, minlon: 12.2, maxlat: 42.15, maxlon: 12.86 },
      tags: { name: 'Roma', 'name:en': 'Rome', boundary: 'administrative', admin_level: '8', 'geonames:id': '3169070' } }] });
    return Response.json({ elements: [{ type: 'area', id: 3600041485 }, ...ordinary, other, ...landmarks] });
  };
  const { places, boundary } = await nearbyPlaces(centre, { scope: 'city', fetchResponse });
  assert.equal(places.length, 34);
  assert.deepEqual(new Set(places.slice(0, 3).map(place => place.name)), new Set(landmarks.map(place => place.tags.name)));
  assert.ok(places.find(place => place.name === 'Pantheon').km > 2);
  assert.ok(places.find(place => place.name === 'Basilica di San Pietro').km > 4);
  assert.ok(requested.includes('rel(41485);map_to_area->.city;'));
  assert.ok(requested.includes('(area.city)'));
  assert.ok(requested.includes('nwr(41.6,12.2,42.15,12.86)[name]->.nearby;'));
  assert.ok(requested.includes('nwr.candidates(area.city)(41.6,12.2,42.15,12.86)'));
  assert.equal(requested.split('(area.city)').length - 1, 1);
  assert.ok(requested.includes('nwr.nearby['));
  assert.equal(boundary.url, 'https://www.openstreetmap.org/relation/41485');
  assert.ok(!requested.includes('Colosseo') && !requested.includes('Q10285'));
  const local = await nearbyPlaces(centre, { scope: 'nearby', fetchResponse });
  assert.equal(local.length, 12);
  assert.equal(local.some(place => place.name === 'Pantheon'), false);
});

test('city discovery includes distant places without wiki annotations and rejects non-attractions', async () => {
  const samples = [
    { ...node, id: 1, lat: .03, tags: { name: 'Distant park', leisure: 'park' } },
    { ...node, id: 2, lat: .03, tags: { name: 'Metro station', railway: 'station', wikidata: 'Q1', wikipedia: 'en:Station' } },
    { ...node, id: 3, lat: .2, lon: .2, tags: { name: 'Remote attraction', tourism: 'attraction' } },
    { ...node, id: 4, lat: .03, tags: { name: 'Temple', building: 'temple', wikidata: 'Q3' } },
  ];
  let query;
  const { places } = await nearbyPlaces({ ...city, id: 1, name: 'Town' }, { scope: 'city', fetchResponse: async url => {
    query = url.searchParams.get('data');
    return Response.json({ elements: query.includes('is_in') ? [{ type: 'relation', id: 10, tags: { name: 'Town', boundary: 'administrative', admin_level: '8' } }] : [{ type: 'area', id: 3600000010 }, ...samples] });
  } });
  assert.deepEqual(new Set(places.map(place => place.name)), new Set(['Temple', 'Distant park', 'Remote attraction']));
  assert.ok(places.some(place => place.km > 6));
  assert.ok(!query.includes('around:'));
  assert.ok(query.includes('nwr[leisure~"^(park|garden)$"][name](area.city)'));
  await assert.rejects(nearbyPlaces(city, { scope: 'world' }), /scope/);
});

test('a missing generated area is unavailable rather than an empty city shortlist', async () => {
  const fetchResponse = async url => Response.json({ elements: url.searchParams.get('data').includes('is_in') ?
    [{ type: 'relation', id: 10, tags: { name: 'Town', boundary: 'administrative', admin_level: '8' } }] : [] });
  await assert.rejects(nearbyPlaces({ ...city, id: 1, name: 'Town' }, { scope: 'city', fetchResponse }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
});

test('an empty settlement footprint uses explicitly labelled surroundings, while a failed city query cannot trigger that fallback', async () => {
  const boundary = { relation: 10, kind: 'settlement', name: 'Village', url: 'https://www.openstreetmap.org/relation/10',
    bounds: { minlat: -.001, minlon: -.001, maxlat: .001, maxlon: .001 } };
  let nearbyCalls = 0;
  const result = await nearbyPlaces({ latitude: 0, longitude: 0 }, { scope: 'city', resolveBoundary: async () => boundary,
    fetchResponse: async url => {
      if (url.hostname === 'download.geofabrik.de') return new Response(null, { status: 503 });
      const query = url.searchParams.get('data');
      if (query.includes('map_to_area')) return Response.json({ elements: [{ type: 'area', id: 3600000010 }] });
      nearbyCalls++;
      return Response.json({ elements: [{ type: 'node', id: 100, lat: .01, lon: 0, tags: { name: 'Garden', leisure: 'garden' } },
        { type: 'node', id: 101, lat: .03, lon: 0, tags: { name: 'Too far', tourism: 'attraction' } }] });
    } });
  assert.equal(result.surroundings, true);
  assert.deepEqual(result.places.map(place => place.name), ['Garden']);
  assert.equal(result.boundary.url, boundary.url);
  assert.equal(nearbyCalls, 1);
  await assert.rejects(nearbyPlaces({ latitude: 0, longitude: 0 }, { scope: 'city', resolveBoundary: async () => boundary,
    fetchResponse: async () => new Response(null, { status: 503 }) }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
});
