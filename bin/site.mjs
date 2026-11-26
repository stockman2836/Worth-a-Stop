import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { officialCalendars } from '../src/official-calendars.mjs';
import { officialEvents } from '../src/official-events.mjs';

const assets = new Map([
  ['/', ['../web/index.html', 'text/html']],
  ['/site.css', ['../web/site.css', 'text/css']],
  ['/site.mjs', ['../web/site.mjs', 'text/javascript']],
  ['/calendar-panel.mjs', ['../web/calendar-panel.mjs', 'text/javascript']],
  ['/day-panel.mjs', ['../web/day-panel.mjs', 'text/javascript']],
  ['/day-agenda.mjs', ['../src/day-agenda.mjs', 'text/javascript']],
  ['/cities.mjs', ['../src/cities.mjs', 'text/javascript']],
  ['/sources.mjs', ['../src/sources.mjs', 'text/javascript']],
  ['/guides.mjs', ['../src/guides.mjs', 'text/javascript']],
]);

const server = createServer(async (request, response) => {
  const lookup = /^\/api\/official-(calendars|events)\/([1-9]\d{0,9})$/.exec(request.url);
  if (lookup && request.method === 'GET') {
    try {
      const data = lookup[1] === 'events' ? await officialEvents(lookup[2]) : await officialCalendars(lookup[2]);
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
