import test from 'node:test';
import assert from 'node:assert/strict';
import { readNuxtData } from '../src/embedded-data.mjs';
import { publishedEvents } from '../src/official-events.mjs';
import { officialOnDay } from '../src/day-agenda.mjs';

test('decodes constant payload references and refuses executable expressions', () => {
  const data = readNuxtData('window.__NUXT__=(function(a){return {items:[{title:a,value:-1}]}})("Event");');
  assert.equal(data.items[0].title, 'Event');
  assert.equal(data.items[0].value, -1);
  assert.throws(() => readNuxtData('window.__NUXT__=(function(){return fetch("https://example.org")})()'));
  assert.throws(() => readNuxtData('window.__NUXT__=globalThis.process'));
});

test('reads dates and venue coordinates from embedded event records and published links', () => {
  const url = new URL('https://city.example/en/events/category/current');
  const html = '<a href="/en/events/talk">Talk</a><script>window.__NUXT__=(function(a){return {events:[{title:"Art &amp; Tech",slug:"talk",start_date:"2026-11-26",end_date:a,time:"09:00",google_place:{name:"Hall",lat:50,lng:14}}]}})(null);</script>';
  const events = publishedEvents({ url, html });
  assert.equal(events.length, 1);
  assert.equal(events[0].url, 'https://city.example/en/events/talk');
  assert.equal(events[0].title, 'Art & Tech');
  const [event] = officialOnDay({ events }, '2026-11-26', 'Europe/Bratislava').events;
  assert.equal(event.start, Date.parse('2026-11-26T08:00Z'));
  assert.equal(event.end, null);
  assert.deepEqual(event.location, { latitude: 50, longitude: 14 });
  assert.deepEqual(publishedEvents({ url, html: html.replace('<a href="/en/events/talk">Talk</a>', '') }), []);
  const multi = publishedEvents({ url, html: html.replace('end_date:a', 'end_date:"2026-11-28"') });
  const [lastDay] = officialOnDay({ events: multi }, '2026-11-28', 'Europe/Bratislava').events;
  assert.equal(lastDay.start, null);
  assert.equal(lastDay.end, null);
  assert.equal(lastDay.publishedTime, '09:00');
  assert.equal(officialOnDay({ events: multi }, '2026-11-29', 'Europe/Bratislava').events.length, 0);
});
