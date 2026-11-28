import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedEvents, collectCalendar, createOfficialEventSearch } from '../src/official-events.mjs';
import { createSourceCache } from '../src/source-cache.mjs';
import { officialOnDay, mergeListings } from '../src/day-agenda.mjs';

const url = new URL('https://city.example/events/fair');

test('changing event dates or refreshing cannot repeatedly restart failed calendar discovery', async () => {
  let time = 1000, calls = 0, offline = true;
  const cache = createSourceCache({ now: () => time });
  const search = createOfficialEventSearch({ now: () => time, findCalendars: (id, refresh) => cache(id, async () => {
    calls++; if (offline) throw Error('offline'); return [];
  }, { refresh: Boolean(refresh) }) });
  await assert.rejects(search('42', { day: '2026-11-28' }));
  await assert.rejects(search('42', { day: '2026-11-29', refresh: true }));
  await assert.rejects(search('42', { day: '2026-11-30', refresh: true }));
  assert.equal(calls, 1);
  time += 60001; offline = false;
  const result = await search('42', { day: '2026-11-30' });
  assert.equal(calls, 2); assert.equal(result.incomplete, true);
});
test('individual performances inherit their venue and exclude gaps and cancellations', () => {
  const event = { '@type': 'MusicEvent', name: 'Choir', location: { name: 'Hall' }, subEvent: [
    { '@type': 'Event', startDate: '2026-11-28T15:30:00+01:00' },
    { '@type': 'Event', startDate: '2026-11-29T15:30:00+01:00', eventStatus: 'https://schema.org/EventCancelled' },
  ] };
  const events = publishedEvents({ html: '<script type="application/ld+json">' + JSON.stringify({ '@graph': [event] }) + '</script>', url });
  const day = officialOnDay({ events }, '2026-11-28', 'Europe/Vienna');
  assert.equal(day.events[0].venue, 'Hall');
  assert.equal(day.events[0].start, Date.parse('2026-11-28T14:30Z'));
  assert.equal(officialOnDay({ events }, '2026-11-29', 'Europe/Vienna').events.length, 0);
});

test('a published daily time range uses destination time on each day, including the final day', () => {
  const dates = [[{ start: '20/11/2026 10:00', end: '24/12/2026 20:00', format: '20. 11.—24. 12., 10:00—20:00' }]];
  const events = publishedEvents({ html: `<h1>Market</h1><span data-date_list='${JSON.stringify(dates)}'></span>`, url });
  const slot = officialOnDay({ events }, '2026-12-24', 'Europe/Prague').events[0];
  assert.equal(slot.start, Date.parse('2026-12-24T09:00Z'));
  assert.equal(slot.end, Date.parse('2026-12-24T19:00Z'));
  assert.equal(officialOnDay({ events }, '2026-12-25', 'Europe/Prague').events.length, 0);
});

test('date-only ranges include the published end date and reprints keep distinct sessions', () => {
  const event = { title: 'Book Fair', venue: 'Town-Hall', url: url.href, begin: '2026-11-26', end: '2026-11-28' };
  const result = officialOnDay({events: [event]}, '2026-11-28', 'Europe/Vienna');
  assert.equal(result.events[0].start, null);
  const session = { ...event, start: 100 };
  assert.equal(mergeListings([session, {...session, venue: 'Town Hall'}, {...session, start: 200}]).length, 2);
});

test('reads event microdata without confusing nested venue names or article publication dates', () => {
  const html = '<article><h1>News</h1><time itemprop="datePublished" datetime="2026-11-28">Today</time></article>' +
    '<div itemscope itemtype="https://schema.org/TheaterEvent"><h1 itemprop="name">Play</h1>' +
    '<time itemprop="startDate" datetime="2026-11-28T19:00"></time><meta itemprop="endDate" content="2026-11-28T20:00">' +
    '<div itemprop="location" itemscope itemtype="https://schema.org/Place"><span itemprop="name">Town Hall</span>' +
    '<div itemprop="geo" itemscope itemtype="https://schema.org/GeoCoordinates"><meta itemprop="latitude" content="49"><meta itemprop="longitude" content="20"></div></div></div>';
  const [event] = publishedEvents({ html, url });
  assert.equal(event.title, 'Play');
  assert.equal(event.venue, 'Town Hall');
  assert.deepEqual(event.location, { latitude: 49, longitude: 20 });
  const external = publishedEvents({ url, html: html.replace('<h1 itemprop="name">', '<a itemprop="url" href="https://organizer.example/">Website</a><h1 itemprop="name">') });
  assert.equal(external[0].url, url.href);
  assert.equal(officialOnDay({ events: [event] }, '2026-11-28', 'Europe/Bratislava').events[0].end, Date.parse('2026-11-28T19:00Z'));
  assert.deepEqual(publishedEvents({ url, html: '<article><h1>News</h1><time datetime="2026-11-28">Today</time></article>' }), []);
  assert.deepEqual(publishedEvents({ url, html: html.replace('<h1 itemprop="name">', '<link itemprop="eventStatus" href="https://schema.org/EventCancelled"><h1 itemprop="name">') }), []);
});

function listing(name) {
  return '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Event', name, startDate: '2026-11-28T12:00:00Z' }) + '</script>';
}

test('continues past structured index events and pagination while avoiding loops and external pages', async () => {
  const requested = [];
  const calendar = 'https://town.example/events/';
  const result = await collectCalendar(calendar, { readPage: async address => {
    requested.push(address.href);
    return { url: address, html: address.search ? listing('Page two') + '<a rel="next" href="/events/">Previous</a>' :
      address.pathname.endsWith('/concert') ? listing('Detail') : listing('Index') + '<main><a href="/events/concert">Concert</a>' +
      '<a href="https://ads.example/events/x">Ad</a><a href="/events/categories/music">Category</a></main><link rel="next" href="?page=2">' };
  } });
  assert.deepEqual(result.events.map(event => event.title).sort(), ['Detail', 'Index', 'Page two']);
  assert.equal(requested.length, 3);
  assert.equal(result.incomplete, false);
  assert.equal(result.source.pagesRead, 3);
  assert.equal(result.source.eventsFound, 3);
});

test('reports crawl limits, unreadable dates and individual page failures', async () => {
  const calendar = 'https://town.example/events/';
  const readPage = async address => {
    if (address.pathname.endsWith('/broken')) throw Error('Offline');
    return { url: address, html: listing('Index') + '<main><a href="/events/broken">Broken</a></main>' };
  };
  const limited = await collectCalendar(calendar, { readPage, maxPages: 1 });
  assert.equal(limited.source.limited, true);
  assert.equal(limited.incomplete, true);
  const failed = await collectCalendar(calendar, { readPage });
  assert.equal(failed.source.failedPages, 1);
  assert.equal(failed.events.length, 1);
  assert.equal(failed.incomplete, true);
  const empty = await collectCalendar(calendar, { readPage: async address => ({ url: address, html: '<h1>Calendar</h1>' }) });
  assert.equal(empty.source.eventsFound, 0);
  assert.equal(empty.incomplete, true);
});

test('reads published calendar cards in the page language and follows sibling detail paths', async () => {
  for (const [language, date] of [['de', '27. November 2026'], ['sk', '27. novembra 2026'], ['en-US', 'November 27, 2026']]) {
    const calendar = 'https://town.example/calendar/';
    const result = await collectCalendar(calendar, { readPage: async address => ({ url: address,
      html: address.pathname === '/calendar/' ? `<html lang="${language}"><main><a href="/shows/concert"><h2>Concert</h2><p class="date">${date}</p><p class="times">19:00 – 20:30</p></a>` +
        '<a href="/shows/invalid"><h2>Invalid</h2><p class="date">31. November 2026</p></a>' +
        '<a href="https://ads.example/event"><h2>Ad</h2><time datetime="2026-11-27"></time></a></main></html>' : '<h1>Concert</h1>',
    }) });
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].begin, '2026-11-27T19:00:00');
    assert.equal(result.events[0].end, '2026-11-27T20:30:00');
    assert.equal(result.source.pagesRead, 3);
    assert.equal(officialOnDay({ ...result, sources: [result.source] }, '2026-11-27', 'Europe/Berlin').sources[0].eventsFound, 1);
  }
});
