import assert from 'node:assert/strict';
import test from 'node:test';
import { importCalendar } from '../src/events.mjs';

const source = 'https://events.example.org/program/calendar.ics';

function event(...lines) {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

function calendar(...items) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...items, 'END:VCALENDAR'].join('\r\n');
}

function load(text) {
  return importCalendar(source, async () => new Response(text));
}

test('imports a local event with folded text, an escaped venue and an organizer link', async () => {
  const before = Date.now();
  const result = await load(calendar(event(
    'UID:market-1', 'SUMMARY:Winter craft', '  market', 'LOCATION:Town Hall\\, West Wing',
    'DTSTAMP:20260910T150000Z', 'DTSTART;TZID=America/Vancouver:20261128T110000',
    'DTEND;TZID=America/Vancouver:20261128T160000', 'STATUS:CONFIRMED', 'URL:../fair',
  )));
  assert.equal(result.sourceUrl, source);
  assert.ok(Date.parse(result.checkedAt) >= before && Date.parse(result.checkedAt) <= Date.now());
  assert.deepEqual(result.events, [{
    uid: 'market-1', title: 'Winter craft market', location: 'Town Hall, West Wing',
    start: { date: '2026-11-28', time: '11:00:00', timezone: 'America/Vancouver' },
    end: { date: '2026-11-28', time: '16:00:00', timezone: 'America/Vancouver' },
    duration: null, status: 'CONFIRMED', url: 'https://events.example.org/fair',
    recurring: false, recurrenceId: null,
  }]);
});

test('preserves date-only boundaries, missing information and the source fallback', async () => {
  const { events: [concert] } = await load(calendar(event(
    'UID:concert', 'DTSTART;VALUE=DATE:20261128', 'DTEND;VALUE=DATE:20261129',
  )));
  assert.deepEqual(concert.start, { date: '2026-11-28', time: null, timezone: null });
  assert.deepEqual(concert.end, { date: '2026-11-29', time: null, timezone: null });
  assert.equal(concert.location, null);
  assert.equal(concert.status, null);
  assert.equal(concert.url, source);
});

test('keeps UTC, a declared calendar zone and floating time distinguishable', async () => {
  const showing = event('UID:show', 'DTSTART:20261128T233000', 'DURATION:PT1H');
  const utc = event('UID:utc', 'DTSTART:20261128T233000Z');
  const result = await load(calendar('X-WR-TIMEZONE:Europe/London', showing, utc));
  assert.equal(result.events[0].start.timezone, 'Europe/London');
  assert.equal(result.events[0].duration, 'PT1H');
  assert.equal(result.events[1].start.timezone, 'UTC');
  const floating = await load(calendar(showing));
  assert.equal(floating.events[0].start.timezone, null);
});

test('keeps a series and a cancelled occurrence distinct', async () => {
  const result = await load(calendar(
    event('UID:weekly', 'DTSTART:20261101T120000Z', 'RRULE:FREQ=WEEKLY'),
    event('UID:weekly', 'RECURRENCE-ID:20261108T120000Z', 'STATUS:CANCELLED'),
  ));
  const [series, exception] = result.events;
  assert.equal(series.recurring, true);
  assert.deepEqual(exception.recurrenceId, { date: '2026-11-08', time: '12:00:00', timezone: 'UTC' });
  assert.equal(exception.status, 'CANCELLED');
  assert.equal(exception.start, null);
  const cancellation = await load(calendar('METHOD:CANCEL', event('UID:single')));
  assert.equal(cancellation.events[0].status, 'CANCELLED');
});

test('distinguishes a valid empty calendar, an unavailable source and malformed input', async () => {
  assert.deepEqual((await load(calendar())).events, []);
  await assert.rejects(importCalendar(source, async () => new Response(null, { status: 503 })), /HTTP 503/);
  await assert.rejects(load('<html>Event listing</html>'));
  await assert.rejects(load(calendar(event('UID:missing-start', 'DTSTAMP:20261128T120000Z'))), /start date/);
  await assert.rejects(load(calendar(event('UID:bad-date', 'DTSTART;VALUE=DATE:20260231'))), /calendar date/);
});
