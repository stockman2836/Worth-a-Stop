import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarLink, calendarLinks, visitorLinks, officialCalendars } from '../src/official-calendars.mjs';
import { cityWebsites } from '../src/city-websites.mjs';

const url = new URL('https://city.example/en/');
test('uses published calendar navigation on the portal and resolves relative links', () => {
  const html = '<a href="#main">Events</a><a href="https://ads.example/events/">Events</a><a href="../akce/">Programme</a>';
  assert.equal(calendarLink({ url, html }), 'https://city.example/akce/');
});
test('accepts calendar labels and skips individual event pages and unrelated sites', () => {
  assert.equal(calendarLink({ url, html: '<a href="/events/concert">Concert</a>' }), null);
  assert.equal(calendarLink({ url, html: '<a href="/program/">Veranstaltungen</a>' }), 'https://city.example/program/');
});
test('rejects requests that are not GeoNames identifiers', async () => {
  await assert.rejects(officialCalendars('https://example.org'), /GeoNames/);
});

test('finds multiple local-language calendars and a municipal cultural subdomain', () => {
  const html = '<a href="/program/">Kalendarz wydarzeń</a><a href="/esemenyek/">Események</a>' +
    '<a href="https://culture.city.example/calendar">Events</a><a href="https://ads.example/events">Events</a>';
  assert.deepEqual(calendarLinks({ url, html }), ['https://city.example/program/', 'https://city.example/esemenyek/', 'https://culture.city.example/calendar']);
  assert.deepEqual(visitorLinks({ url, html: '<a href="https://visit.example/">Tourism</a><a href="https://ads.example/">Buy tickets</a>' }), ['https://visit.example/']);
});

test('discovers published visitor portals and native Wikipedia tourism references without an English article', async () => {
  const requested = [];
  const links = await officialCalendars('123', {
    fetchJSON: async address => {
      if (address.hostname === 'query.wikidata.org') return { results: { bindings: [{ site: { value: 'https://town.sk/' }, title: { value: 'Town' }, wiki: { value: 'https://sk.wikipedia.org/' } }] } };
      assert.equal(address.hostname, 'sk.wikipedia.org');
      return address.searchParams.get('prop') === 'sections' ? { parse: { sections: [{ anchor: 'Externé_odkazy', index: '3' }] } } :
        { parse: { text: '<a class="external" href="https://tourism.example/">Oficiálny turistický portál</a>' } };
    },
    readPage: async address => {
      requested.push(address.href);
      return { url: address, html: address.hostname === 'town.sk' ? '<a href="https://visitor.example/">Tourism</a>' : '<a href="/podujatia/">Podujatia</a>' };
    },
  });
  assert.ok(requested.includes('https://visitor.example/'));
  assert.deepEqual(links.sort(), ['https://tourism.example/podujatia/', 'https://visitor.example/podujatia/']);
});

test('geographic fallback rejects namesakes and conflicting GeoNames associations', async () => {
  async function lookup(address) {
    if (address.hostname.includes('open-meteo')) return { id: 123, name: 'Town', feature_code: 'PPL', latitude: 49, longitude: 20 };
    if (address.searchParams.get('list') === 'geosearch') return { query: { geosearch: [{ title: 'Other Town', pageid: 1 }, { title: 'Town (district)', pageid: 2 }] } };
    if (address.hostname.includes('wikipedia')) { assert.equal(address.searchParams.get('pageids'), '2'); return { query: { pages: [{ pageprops: { wikibase_item: 'Q12' } }] } }; }
    return { entities: { Q12: { claims: { P1566: [{ mainsnak: { datavalue: { value: '999' } } }], P856: [{ mainsnak: { datavalue: { value: 'https://town.example/' } } }] } } } };
  }
  assert.deepEqual(await cityWebsites('123', lookup), []);
  const sites = await cityWebsites('123', async address => {
    const result = await lookup(address);
    if (result.entities) result.entities.Q12.claims.P1566 = [];
    return result;
  });
  assert.equal(sites[0].site.value, 'https://town.example/');
});

test('uses the geographic fallback when the SPARQL directory is unavailable', async () => {
  const links = await officialCalendars('123', {
    fetchJSON: async address => {
      if (address.hostname === 'query.wikidata.org') throw Error('Directory offline');
      if (address.hostname.includes('open-meteo')) return { id: 123, name: 'Town', feature_code: 'PPL', latitude: 49, longitude: 20 };
      if (address.searchParams.get('list') === 'geosearch') return { query: { geosearch: [{ title: 'Town', pageid: 2 }] } };
      if (address.searchParams.get('prop') === 'pageprops') return { query: { pages: [{ pageprops: { wikibase_item: 'Q12' } }] } };
      if (address.hostname === 'www.wikidata.org') return { entities: { Q12: { claims: { P856: [{ mainsnak: { datavalue: { value: 'https://town.example/' } } }] } } } };
      return { parse: { sections: [] } };
    },
    readPage: async address => ({ url: address, html: '<a href="/events/">Events</a>' }),
  });
  assert.deepEqual(links, ['https://town.example/events/']);
});
