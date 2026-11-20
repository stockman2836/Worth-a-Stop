import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCities, suggestCities } from '../src/cities.mjs';

test('preserves distinct settlements with the same name and skips other features', async () => {
  const place = {
    id: 3054643, name: 'Будапешт', latitude: 47.49835, longitude: 19.04045,
    feature_code: 'PPLC', timezone: 'Europe/Budapest',
    country: 'Венгрия', country_code: 'HU', admin1: 'Budapest',
  };
  const namesake = {
    id: 4185074, name: 'Budapest', latitude: 33.71511, longitude: -85.21801,
    feature_code: 'PPL', country_code: 'US',
  };
  const cities = await searchCities('  Будапешт  ', async url => {
    assert.equal(url.searchParams.get('name'), 'Будапешт');
    assert.equal(url.searchParams.get('language'), 'ru');
    return Response.json({ results: [place, namesake, { feature_code: 'ADM1' }] });
  });
  assert.deepEqual(cities, [
    {
      id: place.id, name: place.name, latitude: place.latitude, longitude: place.longitude,
      timezone: 'Europe/Budapest', region: 'Budapest', country: 'Венгрия', countryCode: 'HU',
    },
    {
      id: namesake.id, name: namesake.name, latitude: namesake.latitude, longitude: namesake.longitude,
      timezone: null, region: null, country: null, countryCode: 'US',
    },
  ]);
});

test('accepts the empty response returned by Open-Meteo', async () => {
  const result = await searchCities('unlikely place', async () => Response.json({ generationtime_ms: 1 }));
  assert.deepEqual(result, []);
});

test('requests city and region names in the selected language', async () => {
  const cities = await searchCities('Будапешт', async url => {
    assert.equal(url.searchParams.get('name'), 'Будапешт');
    assert.equal(url.searchParams.get('language'), 'en');
    return Response.json({ results: [{
      id: 3054643, name: 'Budapest', latitude: 47.49835, longitude: 19.04045,
      feature_code: 'PPLC', country: 'Hungary', admin1: 'Budapest',
    }] });
  }, 'en');
  assert.equal(cities[0].country, 'Hungary');
});

test('keeps a provider outage distinguishable from an empty search', async () => {
  await assert.rejects(searchCities('Porto', async () => new Response(null, { status: 503 })), /503/);
});

test('rejects a broken coordinate before it can reach the map', async () => {
  const place = { id: 123, name: 'Porto', feature_code: 'PPL', latitude: 41.15, longitude: null };
  await assert.rejects(searchCities('Porto', async () => Response.json({ results: [place] })), /координаты/);
});

test('rejects an empty query before contacting the provider', async () => {
  await assert.rejects(searchCities('  ', () => assert.fail('unexpected request')), /два символа/);
});

test('corrects a missing Cyrillic letter using real place candidates and preserves namesakes', async () => {
  const place = { id: 1, name: 'Будапешт', latitude: 47, longitude: 19, feature_code: 'PPLC' };
  const result = await suggestCities('Будапшт', async url => {
    assert.equal(url.hostname, 'geocoding-api.open-meteo.com');
    const name = url.searchParams.get('name');
    return Response.json({ results: name === 'Будапшт' ? [] : [place, { ...place, id: 2 }] });
  });
  assert.equal(result.correction, 'Будапешт');
  assert.deepEqual(result.cities.map(city => city.id), [1, 2]);
});

test('verifies a transposed spelling from Wikipedia with the geocoder and keeps the country constraint', async () => {
  const place = { id: 1, name: 'London', latitude: 51, longitude: 0, feature_code: 'PPLC' };
  const result = await suggestCities('Lnodon', async url => {
    if (url.hostname === 'en.wikipedia.org') return Response.json({ query: { searchinfo: { suggestion: 'london' } } });
    assert.equal(url.searchParams.get('countryCode'), 'GB');
    return Response.json({ results: url.searchParams.get('name') === 'london' ? [place] : [] });
  }, 'en', 'GB');
  assert.equal(result.correction, 'London');
});

test('does not invent a correction when the optional spelling service is down or suggests an unrelated word', async () => {
  for (const spelling of [new Response(null, { status: 503 }), Response.json({ query: { searchinfo: { suggestion: 'apple' } } })]) {
    const result = await suggestCities('qxzzzz', async url =>
      url.hostname === 'en.wikipedia.org' ? spelling : Response.json({}), 'en');
    assert.deepEqual(result, { cities: [], correction: null });
  }
});
