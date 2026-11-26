import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedEvents } from '../src/official-events.mjs';
import { officialOnDay, mergeListings } from '../src/day-agenda.mjs';

const url = new URL('https://city.example/events/fair');
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
