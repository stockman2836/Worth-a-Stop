import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { localizedMapStyle } from '../src/map-style.mjs';
import { placeName } from '../src/place-name.mjs';
import { readFile } from 'node:fs/promises';

const original = { version: 8, sources: {}, layers: [
  { id: 'city', type: 'symbol', layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'] } },
  { id: 'street', type: 'symbol', layout: { 'text-field': '{name:latin}' } },
  { id: 'shield', type: 'symbol', layout: { 'text-field': ['get', 'ref'] } },
  { id: 'building', type: 'fill', paint: { 'fill-color': '#abc' } },
] };
function label(style, properties, state) {
  const expression = createExpression(style.layers[0].layout['text-field'], 'layers[0].layout.text-field', undefined, state);
  assert.equal(expression.result, 'success');
  return expression.value.evaluate({ zoom: 12 }, { type: 1, properties });
}

test('the actual style evaluator selects the requested language and falls back to the local name, including empty translations', () => {
  const properties = { name: 'Paris', 'name:ru': 'Париж', 'name:en': 'Paris' };
  assert.equal(label(localizedMapStyle(original, 'ru'), properties), 'Париж');
  assert.equal(label(localizedMapStyle(original, 'en'), properties), 'Paris');
  assert.equal(label(localizedMapStyle(original, 'ru'), { name: 'Local', 'name:en': 'English' }), 'English');
  assert.equal(label(localizedMapStyle(original, 'ru'), { name: 'Local', 'name:ru': '' }), 'Local');
  assert.equal(label(localizedMapStyle(original, 'en'), { name: 'Local', name_en: 'Legacy English' }), 'Legacy English');
  assert.equal(label(localizedMapStyle(original, 'en'), { name: 'Local', name_en: '' }), 'Local');
  assert.equal(label(localizedMapStyle(original, 'en'), {}), '');
});

test('live translation state updates missing labels while preserving published translations', () => {
  const state = { translatedNames: { 'Dubai Design District': 'Район дизайна в Дубае' } };
  const properties = { name: 'حي دبي للتصميم', 'name:en': 'Dubai Design District' };
  assert.equal(label(localizedMapStyle(original, 'ru'), properties, state), 'Район дизайна в Дубае');
  assert.equal(label(localizedMapStyle(original, 'ru'), { ...properties, 'name:ru': 'Готовое название' }, state), 'Готовое название');
  assert.equal(label(localizedMapStyle(original, 'en'), properties, state), 'Dubai Design District');
});

test('localization preserves road numbers, fonts, colours and the original provider style', () => {
  const result = localizedMapStyle(original, 'ru');
  assert.deepEqual(result.layers[2], original.layers[2]);
  assert.deepEqual(result.layers[3], original.layers[3]);
  assert.deepEqual(result.layers[0].layout['text-font'], ['Noto Sans Regular']);
  assert.equal(typeof result.layers[1].layout['text-field'], 'object');
  assert.deepEqual(original.layers[0].layout['text-field'], ['coalesce', ['get', 'name_en'], ['get', 'name']]);
  assert.throws(() => localizedMapStyle(original, 'xx'));
  assert.throws(() => localizedMapStyle({ version: 7, sources: {}, layers: [] }, 'en'));
});

test('place names use the requested published translation, then the original name or saved title', () => {
  const place = { name: 'Colosseo', names: { ru: 'Колизей', en: 'Colosseum' } };
  assert.equal(placeName(place, 'ru'), 'Колизей');
  assert.equal(placeName(place, 'en'), 'Colosseum');
  assert.equal(placeName({ name: 'Original', names: { ru: ' ', en: 'English' } }, 'ru'), 'English');
  assert.equal(placeName({ title: 'Saved original', names: {} }, 'en'), 'Saved original');
});

test('recorded Dubai labels use available English instead of an Arabic original in Russian mode', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dubai-map-labels.json', import.meta.url)));
  for (const properties of fixture.features) {
    assert.equal(label(localizedMapStyle(original, 'ru'), properties), properties['name:en'] || properties['name:latin'] || properties.name_en);
  }
  assert.equal(placeName({ name: 'حي دبي للتصميم', names: { en: 'Dubai Design District' } }, 'ru'), 'Dubai Design District');
});

test('local Cyrillic stays readable and a Latin label can replace a non-English legacy name_en', () => {
  const names = { name: 'Москва', 'name:en': 'Moscow', 'name:latin': 'Moskva' };
  assert.equal(label(localizedMapStyle(original, 'ru'), names), 'Москва');
  assert.equal(placeName({ name: 'Москва', names: { en: 'Moscow' } }, 'ru'), 'Москва');
  assert.equal(label(localizedMapStyle(original, 'ru'), { name: 'دبي', name_en: 'دبي', 'name:latin': 'Dubai' }), 'Dubai');
  assert.equal(label(localizedMapStyle(original, 'en'), { name: 'دبي', name_en: 'دبي', 'name:latin': 'Dubai' }), 'Dubai');
  assert.equal(placeName({ name: 'دبي', names: {} }, 'ru'), 'دبي'); // No invented translation.
});
