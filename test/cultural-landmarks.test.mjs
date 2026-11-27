import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nearbyPlaces } from '../src/places.mjs';
import { detailZoom } from '../src/discovery-visibility.mjs';
import { placeGroup, placeSymbols } from '../web/map-symbols.mjs';
import { iconNames } from '../web/icons.mjs';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/cultural-landmarks.json', import.meta.url), 'utf8'));

test('published Sea Organ and drama theatre records survive discovery and appear on the overview map', async () => {
  for (const element of fixtures) {
    const category = element.tags.tourism ?? element.tags.amenity;
    let requested;
    const result = await nearbyPlaces({ id: 42, name: 'Town', latitude: element.center.lat, longitude: element.center.lon }, {
      scope: 'city', resolveBoundary: async () => ({ relation: 42, name: 'Town', url: 'https://www.openstreetmap.org/relation/42' }),
      fetchResponse: async (url, options) => {
        requested = url.searchParams.get('data') ?? new URLSearchParams(options.body).get('data');
        return Response.json({ elements: [{ type: 'area', id: 3600000042 }, element] });
      },
    });
    const [place] = result.places;
    assert.equal(result.places.length, 1);
    assert.equal(place.category, category);
    assert.equal(place.prominence, 'highlight');
    assert.equal(detailZoom(place), 0);
    assert.equal(place.names.en, element.tags['name:en']);
    assert.equal(place.names.ru, element.tags['name:ru']);
    assert.equal(place.hours, undefined);
    assert(requested.includes(`[${element.tags.tourism ? 'tourism' : 'amenity'}=${category}][wikidata]`));
    assert(requested.includes(`[${element.tags.tourism ? 'tourism' : 'amenity'}=${category}][wikipedia]`));
    assert(iconNames.includes(placeSymbols[placeGroup(category)].icon));
  }
});
