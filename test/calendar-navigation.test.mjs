import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDateLinks, validCalendarDay } from '../src/calendar-navigation.mjs';
import { collectCalendar, createOfficialEventSearch } from '../src/official-events.mjs';
import { officialOnDay } from '../src/day-agenda.mjs';

const url = new URL('https://town.example/events/');
const document = html => ({ url, html });

test('submits published GET date filters and retains successful form controls', () => {
  const html = '<form action="/events/search" method="get"><input name="from" type="date" min="2026-11-01">' +
    '<input name="to" type="date"><input name="language" type="hidden" value="en">' +
    '<input name="category" type="checkbox" value="music" checked><input name="hiddenCategory" type="checkbox" value="other">' +
    '<input name="ignored" type="date" disabled><button name="submit" value="delete">Search</button></form>';
  const [link] = calendarDateLinks(document(html), '2026-12-06');
  assert.equal(link, 'https://town.example/events/search?from=2026-12-06&to=2026-12-06&language=en&category=music');
  assert.deepEqual(calendarDateLinks(document(html), '2026-10-01'), []);
});

test('reads localized date widget values without executing form handlers', () => {
  const html = '<html lang="de"><form action="./" onsubmit="return false"><input class="date" name="from" type="hidden" value="27.11.2026">' +
    '<input class="datepicker" name="until" value="27.10.2027"></form></html>';
  assert.equal(calendarDateLinks(document(html), '2026-12-06')[0], 'https://town.example/events/?from=06.12.2026&until=06.12.2026');
  assert.deepEqual(calendarDateLinks(document(html.replace('lang="de"', 'lang="en-US"')), '2026-12-06'), []);
});

test('uses only published months and days and honors a same-origin HTML base', () => {
  const doc = { url: new URL('https://town.example/en/program/2026-11.html'), html:
    '<base href="/en/"><a href="program/2026-12.html">December</a><a href="program/2026-12-06.html">6</a>' +
    '<a href="program/2026-12-06/concert.html"><h2>Concert</h2></a><a href="https://ads.example/2026-12.html">Ad</a>' };
  assert.deepEqual(calendarDateLinks(doc, '2026-12-06'), ['https://town.example/en/program/2026-12-06.html', 'https://town.example/en/program/2026-12.html']);
  assert.deepEqual(calendarDateLinks(doc, '2027-01-01'), []);
});

test('selects a month and year only when both values are offered', () => {
  const html = '<form><select name="year"><option value="2026">2026</option></select>' +
    '<select name="month"><option value="11">November</option><option value="12">December</option></select></form>';
  assert.equal(calendarDateLinks(document(html), '2026-12-06')[0], 'https://town.example/events/?year=2026&month=12');
  assert.deepEqual(calendarDateLinks(document(html), '2027-12-06'), []);
  assert.deepEqual(calendarDateLinks(document('<form><select name="year"><option value="2026">2026</option></select></form>'), '2026-12-06'), []);
});

test('follows published month steps across the year boundary without inventing a URL', async () => {
  const visited = [];
  const pages = new Map([
    ['https://town.example/program/2026-11.html', '<a href="2027-11.html">2027</a>'],
    ['https://town.example/program/2027-11.html', '<a href="2027-12.html">December</a><a href="2026-11.html">Back</a>'],
    ['https://town.example/program/2027-12.html', '<div itemscope itemtype="https://schema.org/Event"><h1 itemprop="name">Concert</h1><time itemprop="startDate" datetime="2027-12-06T19:00"></time></div>'],
  ]);
  const result = await collectCalendar('https://town.example/program/2026-11.html', { day: '2027-12-06', readPage: async address => {
    visited.push(address.href);
    assert.ok(pages.has(address.href));
    return { url: address, html: pages.get(address.href) };
  } });
  assert.equal(visited.length, 3);
  assert.equal(officialOnDay(result, '2027-12-06', 'Europe/Berlin').events.length, 1);
  assert.equal(result.source.dateSearchUrl, 'https://town.example/program/2027-12.html');
  assert.deepEqual(calendarDateLinks({ url: new URL('https://town.example/program/2027-11.html'), html: '<a href="2026-11.html">Back</a>' }, '2027-12-06', { nearestMonth: true }), []);
});

test('rejects invalid dates, POST filters, unrelated searches and off-site form actions', async () => {
  assert.equal(validCalendarDay('2028-02-29'), true);
  for (const day of ['2026-02-29', '2026-11-31', '2026-1-1', 'today']) {
    assert.equal(validCalendarDay(day), false);
    await assert.rejects(collectCalendar(url.href, { day, readPage: () => { throw Error('Should not fetch'); } }), /date/);
  }
  const html = '<form method="post"><input name="date" type="date"></form>' +
    '<form action="https://other.example/"><input name="date" type="date"></form>' +
    '<form><input name="q" type="search"></form>';
  assert.deepEqual(calendarDateLinks(document(html), '2026-12-06'), []);
});

test('prioritizes the selected day and avoids spending its budget on dated unrelated details', async () => {
  const requested = [];
  const oldCards = Array.from({ length: 30 }, (_,index) => `<a href="/events/old-${index}"><h2>Old ${index}</h2><time datetime="2026-11-01"></time></a>`).join('');
  const result = await collectCalendar(url.href, { day: '2026-12-06', maxPages: 4, readPage: async address => {
    requested.push(address.href);
    if (address.pathname === '/events/concert') return { url: address, html: '<div itemscope itemtype="https://schema.org/MusicEvent"><h1 itemprop="name">Concert</h1>' +
      '<time itemprop="startDate" datetime="2026-12-06T19:00"></time><time itemprop="endDate" datetime="2026-12-06T21:00"></time></div>' };
    return { url: address, html: address.search ? '<main><a href="/events/concert"><h2>Concert</h2><time datetime="2026-12-06T19:00"></time></a></main>' :
      '<form><input type="date" name="day"></form><main>' + oldCards + '</main>' };
  } });
  assert.equal(requested[1], 'https://town.example/events/?day=2026-12-06');
  assert.ok(requested.includes('https://town.example/events/concert'));
  assert.equal(requested.some(link => link.includes('/old-')), false);
  const day = officialOnDay(result, '2026-12-06', 'Europe/Bratislava');
  assert.equal(day.events.length, 1);
  assert.equal(day.events[0].end, Date.parse('2026-12-06T20:00Z'));
  assert.equal(result.source.dateSearchUrl, requested[1]);
});

test('separates cached city results by trip date, shares concurrent lookups and refreshes explicitly', async () => {
  let lookups = 0;
  const search = createOfficialEventSearch({ findCalendars: async () => { lookups++; return [url.href]; },
    readPage: async address => ({ url: address, html: '<form><input type="date" name="day"></form>' }) });
  await Promise.all([search('123', { day: '2026-12-06' }), search('123', { day: '2026-12-06' })]);
  assert.equal(lookups, 1);
  await search('123', { day: '2026-12-07' });
  assert.equal(lookups, 2);
  await search('123', { day: '2026-12-06', refresh: true });
  assert.equal(lookups, 3);
  await assert.rejects(search('123', { day: '2026-11-31' }), /date/);
  assert.equal(lookups, 3);
});

test('reads published year-first venue rows and resolves their source links against the HTML base', async () => {
  const result = await collectCalendar('https://town.example/en/program/2026-12.html', { day: '2026-12-06', readPage: async address => ({ url: address,
    html: '<base href="/en/"><aside><span>2026.12.06. 19:00 | Concert Hall</span><h2><a href="program/concert.html">Concert</a></h2></aside>' +
      '<aside><span>2026.12.32. 19:00 | Hall</span><h2><a href="program/invalid.html">Invalid</a></h2></aside>',
  }), maxPages: 1 });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].url, 'https://town.example/en/program/concert.html');
  assert.equal(result.events[0].venue, 'Concert Hall');
  assert.equal(result.events[0].begin, '2026-12-06T19:00:00');
  assert.equal(result.events[0].end, undefined);
});
