import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { officialCalendars } from '../src/official-calendars.mjs';
import { officialEvents } from '../src/official-events.mjs';
import { validCalendarDay } from '../src/calendar-navigation.mjs';
import { nearbyPlaces } from '../src/places.mjs';
import { createWalkingRouter } from '../src/walking-router.mjs';

const assets = new Map([
  ['/', ['../web/index.html', 'text/html']],
  ['/site.css', ['../web/site.css', 'text/css']],
  ['/appearance.js', ['../web/appearance.js', 'text/javascript']],
  ['/site.mjs', ['../web/site.mjs', 'text/javascript']],
  ['/calendar-panel.mjs', ['../web/calendar-panel.mjs', 'text/javascript']],
  ['/day-panel.mjs', ['../web/day-panel.mjs', 'text/javascript']],
  ['/places-panel.mjs', ['../web/places-panel.mjs', 'text/javascript']],
  ['/itinerary-panel.mjs', ['../web/itinerary-panel.mjs', 'text/javascript']],
  ['/itinerary.mjs', ['../src/itinerary.mjs', 'text/javascript']],
  ['/walking-legs.mjs', ['../src/walking-legs.mjs', 'text/javascript']],
  ['/walking-panel.mjs', ['../web/walking-panel.mjs', 'text/javascript']],
  ['/arrival-times.mjs', ['../src/arrival-times.mjs', 'text/javascript']],
  ['/trip-window.mjs', ['../src/trip-window.mjs', 'text/javascript']],
  ['/city-workspace.mjs', ['../web/city-workspace.mjs', 'text/javascript']],
  ['/starting-point.mjs', ['../src/starting-point.mjs', 'text/javascript']],
  ['/alternatives.mjs', ['../src/alternatives.mjs', 'text/javascript']],
  ['/alternatives-panel.mjs', ['../web/alternatives-panel.mjs', 'text/javascript']],
  ['/stop-order.mjs', ['../src/stop-order.mjs', 'text/javascript']],
  ['/order-panel.mjs', ['../web/order-panel.mjs', 'text/javascript']],
  ['/alternatives.mjs', ['../src/alternatives.mjs', 'text/javascript']],
  ['/places-map.mjs', ['../web/places-map.mjs', 'text/javascript']],
  ['/opening-hours.mjs', ['../src/opening-hours.mjs', 'text/javascript']],
  ['/event-state.mjs', ['../src/event-state.mjs', 'text/javascript']],
  ['/opening-hours-lib.mjs', ['../node_modules/opening_hours/build/opening_hours.esm.mjs', 'text/javascript']],
  ['/suncalc.mjs', ['../node_modules/suncalc/index.js', 'text/javascript']],
  ['/saved-places.mjs', ['../src/saved-places.mjs', 'text/javascript']],
  ['/leaflet.mjs', ['../node_modules/leaflet/dist/leaflet-src.esm.js', 'text/javascript']],
  ['/leaflet.css', ['../node_modules/leaflet/dist/leaflet.css', 'text/css']],
  ['/day-agenda.mjs', ['../src/day-agenda.mjs', 'text/javascript']],
  ['/event-location.mjs', ['../src/event-location.mjs', 'text/javascript']],
  ['/cities.mjs', ['../src/cities.mjs', 'text/javascript']],
  ['/sources.mjs', ['../src/sources.mjs', 'text/javascript']],
  ['/guides.mjs', ['../src/guides.mjs', 'text/javascript']],
]);

const placesCache = new Map();
const walkingRoute = createWalkingRouter();
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url.startsWith('/api/walking?')) {
    const params = new URLSearchParams(request.url.slice('/api/walking?'.length));
    const values = ['fromLat', 'fromLon', 'toLat', 'toLon'].map(key => params.get(key));
    if (values.some(value => !value?.trim()) || values.some((value, i) =>
      !Number.isFinite(Number(value)) || Math.abs(Number(value)) > (i % 2 === 0 ? 90 : 180))) {
      response.writeHead(400).end();
      return;
    }
    try {
      const [fromLat, fromLon, toLat, toLon] = values.map(Number);
      const route = await walkingRoute({ latitude: fromLat, longitude: fromLon }, { latitude: toLat, longitude: toLon });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=3600' }).end(JSON.stringify(route));
    } catch { response.writeHead(502).end(); }
    return;
  }
  if (request.method === 'GET' && request.url.startsWith('/api/places?')) {
    const params = new URLSearchParams(request.url.slice('/api/places?'.length));
    const latitude = Number(params.get('lat'));
    const longitude = Number(params.get('lon'));
    if (!params.get('lat')?.trim() || !params.get('lon')?.trim() || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      response.writeHead(400).end();
      return;
    }
    const key = [latitude, longitude].join('/');
    let entry = placesCache.get(key);
    if (!entry || entry.expires < Date.now()) {
      if (placesCache.size >= 100) placesCache.delete(placesCache.keys().next().value);
      const fetchResponse = (url, options) => fetch(url, { ...options, headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city travel planner)' } });
      entry = { promise: nearbyPlaces({ latitude, longitude }, { fetchResponse }), expires: Date.now() + 3600000 };
      placesCache.set(key, entry);
    }
    try {
      const places = await entry.promise;
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=3600' }).end(JSON.stringify(places));
    } catch {
      if (placesCache.get(key) === entry) placesCache.delete(key);
      response.writeHead(502).end();
    }
    return;
  }
  const lookup = /^\/api\/official-(calendars|events)\/([1-9]\d{0,9})$/.exec(request.url.split('?')[0]);
  if (lookup && request.method === 'GET') {
    try {
      const params = new URL(request.url, 'http://localhost').searchParams;
      const refresh = params.get('refresh') === '1';
      const day = params.get('date') ?? undefined;
      if (day !== undefined && !validCalendarDay(day)) { response.writeHead(400).end('Invalid calendar date'); return; }
      const data = lookup[1] === 'events' ? await officialEvents(lookup[2], { refresh, day }) : await officialCalendars(lookup[2], refresh ? {} : undefined);
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' }).end(JSON.stringify(data));
    } catch {
      response.writeHead(502).end();
    }
    return;
  }
  const asset = assets.get(request.url.split('?')[0]);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const [file, type] = asset;
  try {
    const body = await readFile(new URL(file, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
  } catch (error) {
    console.error(error.message);
    response.writeHead(500).end();
  }
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log(`Worth a Stop: http://127.0.0.1:${server.address().port}`);
});
