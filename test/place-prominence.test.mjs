import test from 'node:test';
import assert from 'node:assert/strict';
import { prominenceSignals, classifyProminence } from '../src/place-prominence.mjs';
import { detailZoom, initialHighlights } from '../src/discovery-visibility.mjs';

const place = (id, rank, tags = {}, category = 'attraction') => ({ name: 'Place ' + id, rank, category, signals: prominenceSignals(tags) });
test('uses prominence evidence without a top-N cutoff and keeps weakly annotated records available as context', () => {
  const main = Array.from({ length: 45 }, (_, i) => place(i, 35, { wikipedia: 'en:Place', 'name:en': 'Place', 'name:ru': 'Место' }));
  const result = classifyProminence([...main, place('local', 3), place('documented', 8, { wikidata: 'Q1' })]);
  assert.equal(result.filter(p => p.prominence === 'highlight').length, 45);
  assert.equal(result.find(p => p.name === 'Place local').prominence, 'local');
  assert.equal(result.find(p => p.name === 'Place documented').prominence, 'notable');
  assert.equal(result.length, 47);
});

test('does not mistake language variants, a Wikidata-only square or a generic landmark flag for a must-see', () => {
  assert.equal(prominenceSignals({ 'name:zh': 'A', 'name:zh-Hans': 'B', 'name:zh-Hant': 'C' }).languages, 1);
  const reference = place('major', 40, { wikidata: 'Q1' });
  const square = place('square', 17, { wikidata: 'Q2', 'name:en': 'A', 'name:de': 'B', 'name:eo': 'C' }, 'park');
  const obelisk = place('obelisk', 10, { wikidata: 'Q3', landmark: 'yes' }, 'monument');
  for (const result of classifyProminence([reference, square, obelisk]).slice(1)) assert.notEqual(result.prominence, 'highlight');
});

test('recognizes cultural and park signals despite sparse OSM name translations and adapts to smaller towns', () => {
  const tags = { wikidata: 'Q1', wikipedia: 'en:Park', 'name:en': 'A', 'name:it': 'B', 'name:ru': 'C' };
  const results = classifyProminence([place('city icon', 50, tags), place('park', 17, tags, 'park'),
    place('international', 12, { wikidata: 'Q2', importance: 'international' })]);
  assert.ok(results.every(p => p.prominence === 'highlight'));
  assert.equal(classifyProminence([place('town', 18, { wikipedia: 'en:Town landmark' })])[0].prominence, 'highlight');
  assert.equal(classifyProminence([place('unknown', 3)])[0].prominence, 'local');
});

test('adds context progressively while using central highlights only to frame the initial camera', () => {
  assert.equal(detailZoom({ prominence: 'highlight' }), 0);
  assert.equal(detailZoom({ prominence: 'notable' }), 15);
  assert.equal(detailZoom({ prominence: 'local' }), 17);
  const places = [1, 2, 3, 4, 40].map(km => ({ km, prominence: 'highlight' }));
  assert.equal(initialHighlights(places).length, 4);
  assert.equal(places.length, 5);
  assert.deepEqual(initialHighlights([{ km: 1, prominence: 'local' }]), []);
});
