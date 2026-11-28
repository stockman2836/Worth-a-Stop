import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enrichPlaceReferences, wikipediaLanguages } from '../src/place-references.mjs';
import { validPlaceReference } from '../src/place-reference.mjs';
import { createPlaceSearch } from '../src/place-search.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/place-references.json', import.meta.url)));
const place = (id, prominence = 'local') => ({ wikidata: id, name: id, names: {}, prominence,
  latitude: 41.9, longitude: 12.5, category: 'attraction', url: `https://www.openstreetmap.org/node/${id.slice(1)}` });
const result = places => ({ places, boundary: { name: 'City', url: 'https://www.openstreetmap.org/relation/1' } });

test('recorded references promote sparsely mapped visitor sites without promoting every referenced object or losing places', async () => {
  const original = result([place('Q211295'), place('Q1126723'), place('Q2031901'), place('Q9', 'highlight'),
    { ...place('Q8'), wikidata: undefined, name: 'Forum of Trajan' }]);
  const output = await enrichPlaceReferences(original, { fetchResponse: async () => Response.json(fixture) });
  assert.equal(output.places.length, original.places.length);
  for (const id of ['Q211295', 'Q1126723']) {
    const promoted = output.places.find(place => place.wikidata === id);
    assert.equal(promoted.prominence, 'highlight');
    assert(promoted.prominenceReasons.includes('encyclopedic'));
    assert(validPlaceReference(promoted.reference, id));
  }
  assert.equal(output.places.find(place => place.wikidata === 'Q2031901').prominence, 'local');
  assert.equal(output.places.find(place => place.wikidata === 'Q9').prominence, 'highlight');
  assert.equal(output.places.find(place => place.name === 'Forum of Trajan').reference, undefined);
  assert.equal(original.places[0].prominence, 'local');
  assert.equal(output.referencesStatus, 'partial');
});

test('counts actual Wikipedia language editions, excluding other projects, malformed links and language variants', () => {
  const sites = ['enwiki', 'ruwiki', 'be_x_oldwiki', 'bewiki', 'simplewiki', 'commonswiki', 'specieswiki', 'enwikivoyage', 'wikidatawiki'];
  const links = Object.fromEntries(sites.map(site => [site, { site, title: 'Article' }]));
  links.dewiki = { site: 'enwiki', title: 'Wrong site' };
  links.frwiki = { site: 'frwiki', title: '' };
  assert.equal(wikipediaLanguages(links), 4);
  assert.throws(() => wikipediaLanguages([]));
});

test('batches every unique identity, caps concurrency and never imposes a place-count quota', async () => {
  let active = 0, maximum = 0;
  const requested = [];
  const places = Array.from({ length: 125 }, (_, i) => place('Q' + (i + 1)));
  const output = await enrichPlaceReferences(result([...places, places[0]]), { fetchResponse: async url => {
    const ids = url.searchParams.get('ids').split('|'); assert(ids.length <= 50); requested.push(...ids);
    maximum = Math.max(maximum, ++active); await new Promise(setImmediate); active--;
    return Response.json({ entities: Object.fromEntries(ids.map(id => [id, { id, sitelinks: fixture.entities.Q211295.sitelinks }])) });
  } });
  assert.equal(maximum, 2); assert.equal(new Set(requested).size, 125); assert.equal(requested.length, 125);
  assert.equal(output.places.filter(place => place.prominence === 'highlight').length, 126);
  assert.equal(output.referencesStatus, 'checked');
});

test('successful reference batches are reused, expire independently and corrupt cache entries fall back to the source', async () => {
  let time = 1000, calls = 0;
  const entries = new Map(), queryCache = { get: async key => entries.get(key), set: async (key, value) => entries.set(key, value) };
  const options = { queryCache, now: () => time, fetchResponse: async () => { calls++; return Response.json(fixture); } };
  const input = result([place('Q211295')]);
  await enrichPlaceReferences(input, options); await enrichPlaceReferences(input, options); assert.equal(calls, 1);
  time += 7 * 86400000 + 1;
  await enrichPlaceReferences(input, options); assert.equal(calls, 2);
  for (const entry of entries.values()) entry.value = [null];
  await enrichPlaceReferences(input, options); assert.equal(calls, 3);
});

test('source outages and deadlines preserve the base selection; parent cancellation still propagates', async () => {
  const input = result([place('Q211295')]);
  const broken = await enrichPlaceReferences(input, { fetchResponse: async () => new Response(null, { status: 503 }) });
  assert.deepEqual(broken.places, input.places); assert.equal(broken.referencesStatus, 'unavailable');
  const waiting = async (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const timedOut = await enrichPlaceReferences(input, { timeout: 10, fetchResponse: waiting });
    assert.deepEqual(timedOut.places, input.places);
    assert.equal(timedOut.referencesStatus, 'unavailable');
    const controller = new AbortController();
    const pending = enrichPlaceReferences(input, { signal: controller.signal, fetchResponse: waiting });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { clearTimeout(keepAlive); }
});

test('unrelated and missing entities cannot borrow another identity or erase correctly resolved references', async () => {
  for (const invalid of [{ ...fixture.entities.Q211295, id: 'Q999' }, { id: 'Q211295', sitelinks: [] }, { id: 'Q211295', missing: '' }]) {
    const output = await enrichPlaceReferences(result([place('Q211295'), place('Q1126723')]), { fetchResponse: async () => Response.json({ entities: {
      Q211295: invalid, Q1126723: fixture.entities.Q1126723,
    } }) });
    assert.equal(output.places.find(place => place.wikidata === 'Q211295').reference, undefined);
    assert.equal(output.places.find(place => place.wikidata === 'Q1126723').prominence, 'highlight');
  }
  assert.equal(validPlaceReference({ url: 'https://example.com', wikipediaLanguages: 50, checkedAt: 0 }, 'Q1'), false);
});

test('city API publishes base places before reference work completes and returns enriched places on the next poll', async () => {
  const base = result([place('Q211295')]);
  let finish;
  const search = createPlaceSearch({ discoverPlaces: async () => base,
    enrichPlaces: async () => new Promise(resolve => { finish = resolve; }) });
  const city = { id: 1, name: 'City', latitude: 41.9, longitude: 12.5 };
  const first = await search(city, { scope: 'city' });
  assert.equal(first.loading, true); assert.equal(first.referencesStatus, 'loading');
  assert.deepEqual(first.places, base.places);
  finish({ ...base, referencesStatus: 'checked', places: [{ ...base.places[0], prominence: 'highlight' }] });
  await new Promise(setImmediate);
  const final = await search(city, { scope: 'city' });
  assert.equal(final.loading, undefined); assert.equal(final.referencesStatus, 'checked');
  assert.equal(final.places[0].prominence, 'highlight');
});

test('exact entity labels fill missing RU/EN names without replacing OSM translations or borrowing a different language', async () => {
  const source = { entities: {
    Q211295: { ...fixture.entities.Q211295, labels: { ru: { language: 'ru', value: 'Форум Траяна' }, en: { language: 'en', value: "Trajan's Forum" } } },
    Q1126723: { ...fixture.entities.Q1126723, labels: { ru: { language: 'en', value: 'Wrong language' }, en: { language: 'en', value: 'Villa Farnesina' } } },
  } };
  const output = await enrichPlaceReferences(result([
    { ...place('Q211295'), names: { en: 'OSM English', ru: undefined } },
    { ...place('Q1126723'), names: {} },
  ]), { fetchResponse: async url => {
    assert.equal(url.searchParams.get('languages'), 'ru|en');
    assert(url.searchParams.get('props').includes('labels'));
    return Response.json(source);
  } });
  const forum = output.places.find(place => place.wikidata === 'Q211295');
  assert.deepEqual(forum.names, { ru: 'Форум Траяна', en: 'OSM English' });
  assert.equal(forum.reference.names.ru, 'Форум Траяна');
  const villa = output.places.find(place => place.wikidata === 'Q1126723');
  assert.equal(villa.names.ru, undefined); assert.equal(villa.names.en, 'Villa Farnesina');
});
