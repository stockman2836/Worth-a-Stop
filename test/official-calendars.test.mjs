import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarLink, officialCalendars } from '../src/official-calendars.mjs';

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
