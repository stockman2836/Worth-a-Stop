import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameTranslator } from '../src/name-translator.mjs';
import { nameTranslationRequest } from '../src/name-translation.mjs';
import { placeName, rememberNameTranslations } from '../src/place-name.mjs';

const name = { text: 'Dubai Design District', source: 'en' };
const success = value => Response.json({ responseStatus: 200, responseData: { translatedText: value } });
const disk = () => { const values = new Map(); return { get: async key => values.get(key), set: async (key, value) => values.set(key, structuredClone(value)) }; };

test('translation requests preserve published labels and distinguish English from unknown scripts', () => {
  assert.equal(nameTranslationRequest({ name: 'حي', 'name:ru': 'Район' }, 'ru'), undefined);
  assert.equal(nameTranslationRequest({ name: 'Москва', 'name:en': 'Moscow' }, 'ru'), undefined);
  assert.deepEqual(nameTranslationRequest({ name: 'حي', 'name:en': name.text }, 'ru'), name);
  assert.deepEqual(nameTranslationRequest({ name: 'حي' }, 'en'), { text: 'حي', source: 'autodetect' });
  assert.equal(nameTranslationRequest({ name: 'حي', 'name:latin': 'Dubai' }, 'en'), undefined);
  assert.equal(nameTranslationRequest({ name: ' ' }, 'ru'), undefined);
});

test('concurrent city requests share successful translations and persistent cache survives restart', async () => {
  const cache = disk(); let requests = 0;
  const fetchResponse = async url => {
    requests++; assert.equal(url.searchParams.get('langpair'), 'en|ru');
    assert.equal(url.searchParams.get('q'), name.text); return success('Район дизайна в Дубае');
  };
  const translate = createNameTranslator({ cache, fetchResponse });
  const [first, second] = await Promise.all([translate([name], 'ru'), translate([name], 'ru')]);
  assert.deepEqual(first, second); assert.equal(requests, 1);
  assert.deepEqual(await createNameTranslator({ cache, fetchResponse })([name], 'ru'), first);
  assert.equal(requests, 1);
});

test('daily quota reservations survive restart and reset on the next UTC day', async () => {
  const cache = disk(); let requests = 0, time = Date.parse('2026-11-28T12:00:00Z');
  const options = { cache, now: () => time, dailyLimit: name.text.length,
    fetchResponse: async () => { requests++; return success('Район'); } };
  await createNameTranslator(options)([name], 'ru');
  const other = { text: 'Another district', source: 'en' };
  assert.equal((await createNameTranslator(options)([other], 'ru')).translations.length, 0);
  assert.equal(requests, 1);
  time += 86400000;
  assert.equal((await createNameTranslator(options)([other], 'ru')).translations.length, 1);
  assert.equal(requests, 2);
});

test('upstream errors keep names intact, use cooldown, and do not poison the success cache', async () => {
  let time = 0, requests = 0;
  const translate = createNameTranslator({ now: () => time, fetchResponse: async () => {
    requests++; return requests === 1 ? Response.json({ responseStatus: 500, responseData: { translatedText: 'ERROR' } }) : success('Район');
  } });
  const first = await translate([name], 'ru');
  assert.equal(first.translations.length, 0); assert.equal(first.retryAt, 60000);
  await translate([name], 'ru'); assert.equal(requests, 1);
  time = 60001;
  assert.equal((await translate([name], 'ru')).translations[0].translation, 'Район');
});

test('quota exhaustion pauses until the next day but still serves cached labels', async () => {
  let requests = 0;
  const translate = createNameTranslator({ fetchResponse: async () => ++requests === 1 ? success('Район') :
    Response.json({ responseStatus: 429, quotaFinished: true }) });
  await translate([name], 'ru');
  const stopped = await translate([{ text: 'Another', source: 'en' }], 'ru');
  assert.ok(stopped.retryAt > Date.now());
  assert.equal((await translate([name], 'ru')).translations.length, 1);
  assert.equal(requests, 2);
});

test('abandoned work does not send queued names to the provider', async () => {
  const controller = new AbortController(); controller.abort();
  const translate = createNameTranslator({ fetchResponse: async () => { assert.fail('Aborted request'); } });
  assert.deepEqual(await translate([name], 'ru', controller.signal), { translations: [] });
});

test('machine names are display-only and never override published or readable Cyrillic names', () => {
  const place = { name: 'حي دبي للتصميم', names: { en: name.text } }, snapshot = structuredClone(place);
  rememberNameTranslations([{ ...name, translation: 'Район дизайна в Дубае' }], 'ru');
  assert.equal(placeName(place, 'ru'), 'Район дизайна в Дубае');
  assert.equal(placeName({ ...place, names: { ...place.names, ru: 'Официальное название' } }, 'ru'), 'Официальное название');
  assert.equal(placeName({ name: 'Москва', names: { en: name.text } }, 'ru'), 'Москва');
  assert.equal(placeName(place, 'en'), name.text);
  assert.deepEqual(place, snapshot);
});
