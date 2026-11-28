import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { localizedMapStyle } from '../src/map-style.mjs';
import { placeName } from '../src/place-name.mjs';

const original = { version: 8, sources: {}, layers: [
  { id: 'city', type: 'symbol', layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'] } },
  { id: 'street', type: 'symbol', layout: { 'text-field': '{name:latin}' } },
  { id: 'shield', type: 'symbol', layout: { 'text-field': ['get', 'ref'] } },
  { id: 'building', type: 'fill', paint: { 'fill-color': '#abc' } },
] };
function label(style, properties) {
  const expression = createExpression(style.layers[0].layout['text-field'], 'layers[0].layout.text-field');
  assert.equal(expression.result, 'success');
  return expression.value.evaluate({ zoom: 12 }, { type: 1, properties });
}

test('the actual style evaluator selects the requested language and falls back to the local name, including empty translations', () => {
  const properties = { name: 'Paris', 'name:ru': 'Париж', 'name:en': 'Paris' };
  assert.equal(label(localizedMapStyle(original, 'ru'), properties), 'Париж');
  assert.equal(label(localizedMapStyle(original, 'en'), properties), 'Paris');
  assert.equal(label(localizedMapStyle(original, 'ru'), { name: 'Local', 'name:en': 'English' }), 'Local');
  assert.equal(label(localizedMapStyle(original, 'ru'), { name: 'Local', 'name:ru': '' }), 'Local');
  assert.equal(label(localizedMapStyle(original, 'en'), { name: 'Local', name_en: 'Legacy English' }), 'Legacy English');
  assert.equal(label(localizedMapStyle(original, 'en'), { name: 'Local', name_en: '' }), 'Local');
  assert.equal(label(localizedMapStyle(original, 'en'), {}), '');
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
  assert.equal(placeName({ name: 'Original', names: { ru: ' ', en: 'English' } }, 'ru'), 'Original');
  assert.equal(placeName({ title: 'Saved original', names: {} }, 'en'), 'Saved original');
});
