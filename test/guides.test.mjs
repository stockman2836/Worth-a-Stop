import assert from 'node:assert/strict';
import test from 'node:test';
import { findGuide } from '../src/guides.mjs';

const city = { name: 'Longyearbyen', latitude: 78.22, longitude: 15.64 };

test('finds the named guide among nearby pages and takes event links only from its festival section', async () => {
  const guide = await findGuide(city, 'en', async url => {
    const p = url.searchParams;
    if (p.get('list') === 'geosearch') {
      assert.equal(p.get('gscoord'), '78.22|15.64');
      return Response.json({ query: { geosearch: [{ pageid: 9, title: 'Other' }, { pageid: 10, title: city.name }] } });
    }
    assert.equal(p.get('pageid'), '10');
    if (p.get('prop') === 'sections') return Response.json({ parse: { sections: [
      { index: '2', line: 'Eat', anchor: 'Eat' }, { index: '3', line: 'Events', anchor: 'Events' },
    ] } });
    assert.equal(p.get('section'), '3');
    return Response.json({ parse: { externallinks: ['https://festival.example/', 'mailto:festival@example.org'] } });
  });
  assert.equal(guide.url, 'https://en.wikivoyage.org/wiki/Longyearbyen#Events');
  assert.deepEqual(guide.links, [{ label: 'festival.example', url: 'https://festival.example/' }]);
});

test('returns a clearly identified English guide when Russian coverage is missing', async () => {
  const guide = await findGuide(city, 'ru', async url => {
    if (url.hostname.startsWith('ru.')) return new Response(null, { status: 503 });
    if (url.searchParams.has('list')) return Response.json({ query: { geosearch: [{ pageid: 10, title: city.name }] } });
    return Response.json({ parse: { sections: [] } });
  });
  assert.equal(guide.language, 'en');
  assert.deepEqual(guide.links, []);
});

test('keeps the link to the event section when its external links cannot be fetched', async () => {
  const guide = await findGuide(city, 'en', async url => {
    if (url.searchParams.has('list')) return Response.json({ query: { geosearch: [{ pageid: 10, title: city.name }] } });
    if (url.searchParams.has('section')) return new Response(null, { status: 503 });
    return Response.json({ parse: { sections: [{ index: '1', line: 'Events', anchor: 'Events' }] } });
  });
  assert.equal(guide.url, 'https://en.wikivoyage.org/wiki/Longyearbyen#Events');
  assert.deepEqual(guide.links, []);
});
