import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const assets = new Map([
  ['/', ['../web/index.html', 'text/html']],
  ['/site.css', ['../web/site.css', 'text/css']],
  ['/site.mjs', ['../web/site.mjs', 'text/javascript']],
  ['/cities.mjs', ['../src/cities.mjs', 'text/javascript']],
]);

const server = createServer(async (request, response) => {
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
