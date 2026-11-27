import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { officialCalendars } from '../src/official-calendars.mjs';
import { officialEvents } from '../src/official-events.mjs';
import { validCalendarDay } from '../src/calendar-navigation.mjs';
import { createPlaceSearch } from '../src/place-search.mjs';
import { createPlaceCache } from '../src/place-cache.mjs';
import { fileURLToPath } from 'node:url';
import { createWalkingRouter } from '../src/walking-router.mjs';

const assets = new Map([
  ['/', ['../web/index.html', 'text/html']],
  ['/site.css', ['../web/site.css', 'text/css']],
  ['/appearance.js', ['../web/appearance.js', 'text/javascript']],
  ['/icons.mjs', ['../web/icons.mjs', 'text/javascript']],
  ['/map-symbols.mjs', ['../web/map-symbols.mjs', 'text/javascript']],
  ['/discovery-index.mjs', ['../src/discovery-index.mjs', 'text/javascript']],
  ['/discovery-visibility.mjs', ['../src/discovery-visibility.mjs', 'text/javascript']],
  ['/supercluster.mjs', ['../node_modules/supercluster/index.js', 'text/javascript']],
  ['/kdbush.mjs', ['../node_modules/kdbush/index.js', 'text/javascript']],
  ['/supercluster.LICENSE.txt', ['../node_modules/supercluster/LICENSE', 'text/plain']],
  ['/kdbush.LICENSE.txt', ['../node_modules/kdbush/LICENSE', 'text/plain']],
  ['/icons.svg', ['../web/icons.svg', 'image/svg+xml']],
  ['/icons.LICENSE.txt', ['../web/icons.LICENSE.txt', 'text/plain']],
  ['/site.mjs', ['../web/site.mjs', 'text/javascript']],
  ['/calendar-panel.mjs', ['../web/calendar-panel.mjs', 'text/javascript']],
  ['/day-panel.mjs', ['../web/day-panel.mjs', 'text/javascript']],
  ['/places-panel.mjs', ['../web/places-panel.mjs', 'text/javascript']],
  ['/place-list.mjs', ['../web/place-list.mjs', 'text/javascript']],
  ['/itinerary-panel.mjs', ['../web/itinerary-panel.mjs', 'text/javascript']],
  ['/itinerary.mjs', ['../src/itinerary.mjs', 'text/javascript']],
  ['/walking-legs.mjs', ['../src/walking-legs.mjs', 'text/javascript']],
  ['/walking-panel.mjs', ['../web/walking-panel.mjs', 'text/javascript']],
  ['/arrival-times.mjs', ['../src/arrival-times.mjs', 'text/javascript']],
  ['/trip-window.mjs', ['../src/trip-window.mjs', 'text/javascript']],
  ['/auto-plan.mjs', ['../src/auto-plan.mjs', 'text/javascript']],
  ['/plan-candidates.mjs', ['../src/plan-candidates.mjs', 'text/javascript']],
  ['/auto-plan-panel.mjs', ['../web/auto-plan-panel.mjs', 'text/javascript']],
  ['/city-workspace.mjs', ['../web/city-workspace.mjs', 'text/javascript']],
  ['/city-reset.mjs', ['../web/city-reset.mjs', 'text/javascript']],
  ['/city-plan-state.mjs', ['../src/city-plan-state.mjs', 'text/javascript']],
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

const searchPlaces = createPlaceSearch({ diskCache: process.env.PLACE_CACHE_DIR === 'off' ? undefined :
  createPlaceCache(process.env.PLACE_CACHE_DIR || fileURLToPath(new URL('../.cache/places', import.meta.url))) });
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
    const scope = params.get('scope') ?? 'nearby';
    const id = Number(params.get('id'));
    const name = params.get('name')?.trim();
    if (!params.get('lat')?.trim() || !params.get('lon')?.trim() || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !['city', 'nearby'].includes(scope) ||
        params.has('radius') && params.get('radius') !== '2' ||
        scope === 'city' && (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 200)) {
      response.writeHead(400).end();
      return;
    }
    try {
      const places = await searchPlaces({ latitude, longitude, id, name }, { scope });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': places.incomplete ? 'no-store' : 'private, max-age=3600' }).end(JSON.stringify(places));
    } catch (error) {
      const boundaryMissing = error.code === 'CITY_BOUNDARY_UNAVAILABLE';
      response.writeHead(boundaryMissing ? 422 : 503, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(!boundaryMissing && { 'Retry-After': '60' }),
      }).end(JSON.stringify({ code: boundaryMissing ? error.code : 'PLACE_SOURCE_UNAVAILABLE' }));
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
