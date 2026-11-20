import assert from 'node:assert/strict';
import test from 'node:test';
import { featuredCities, findSources } from '../src/sources.mjs';

const city = { id: 12, latitude: 47.5, longitude: 19.04 };
const row = { originagenda_uid: '80', originagenda_title: 'Arts programme', location_uid: '33', location_name: 'Galéria' };
const offline = async () => new Response(null, { status: 503 });

function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
}

test('finds active nearby sources and links each calendar to its own venue', async () => {
  const result = await findSources(city, { fetchResponse: async url => {
    const filter = url.searchParams.get('where');
    assert.match(filter, /POINT\(19\.04 47\.5\)/);
    assert.match(filter, /5km/);
    assert.match(filter, /lastdate_end >= now\(\)/);
    return Response.json({ results: [row, row, { ...row, location_uid: '34', location_name: 'Other venue' }] });
  } });
  assert.equal(result.sources.length, 2);
  const [first, second] = result.sources;
  assert.equal(first.venue, 'Galéria');
  const feed = new URL(first.calendarUrl);
  assert.equal(feed.origin, 'https://openagenda.com');
  assert.equal(feed.pathname, '/agendas/80/events.v2.ics');
  assert.equal(feed.searchParams.get('locationUid[0]'), '33');
  assert.equal(feed.searchParams.get('relative[1]'), 'upcoming');
  assert.equal(new URL(second.calendarUrl).searchParams.get('locationUid[0]'), '34');
});

test('reuses saved sources for the same city and keeps them available after a failed refresh', async () => {
  const storage = memoryStorage();
  const first = await findSources(city, { storage, fetchResponse: async () => Response.json({ results: [row] }) });
  const hit = await findSources(city, { storage, fetchResponse: () => assert.fail('unexpected network request') });
  assert.deepEqual(hit, first);
  const fallback = await findSources(city, { storage, refresh: true, fetchResponse: offline });
  assert.deepEqual(fallback, { ...first, stale: true });
  await assert.rejects(findSources({ ...city, id: 13 }, { storage, fetchResponse: offline }), /503/);
});

test('refreshes expired storage and distinguishes an empty directory from an outage', async () => {
  const storage = memoryStorage();
  storage.setItem('worth-a-stop.sources.v1.12', JSON.stringify({ checkedAt: 1, rows: [row] }));
  const result = await findSources(city, { storage, fetchResponse: async () => Response.json({ results: [] }) });
  assert.deepEqual(result.sources, []);
  assert.equal(result.stale, false);
  await assert.rejects(findSources(city, { fetchResponse: offline }), /503/);
});

test('a malformed directory response does not become an empty list', async () => {
  await assert.rejects(findSources(city, { fetchResponse: async () => Response.json({}) }), /directory response/);
  await assert.rejects(findSources(city, {
    fetchResponse: async () => Response.json({ results: [{ ...row, location_uid: null }] }),
  }), /directory entry/);
});

test('widens a successful empty inner search and keeps the actual radius on a cache hit', async () => {
  const storage = memoryStorage();
  const seen = [];
  const fetchResponse = async url => {
    const km = Number(/,(\d+)km\)/.exec(url.searchParams.get('where'))[1]);
    seen.push(km);
    return Response.json({ results: km === 25 ? [row] : [] });
  };
  const found = await findSources(city, { storage, fetchResponse });
  assert.equal(found.radiusKm, 25);
  assert.equal(found.sources.length, 1);
  assert.deepEqual(await findSources(city, { storage, fetchResponse }), found);
  assert.deepEqual(seen, [5, 25]);
});

test('suggests destinations drawn from the current directory and retains their country codes', async () => {
  const cities = await featuredCities(async url => {
    assert.match(url.searchParams.get('where'), /lastdate_end >= now\(\)/);
    return Response.json({ results: [['Nantes','FR'], ['Paris','FR'], ['Genève','CH']].map(
      ([location_city, location_countrycode]) => ({ location_city, location_countrycode })) });
  });
  assert.deepEqual(cities.map(city => city.countryCode), ['FR', 'CH', 'FR']);
});
