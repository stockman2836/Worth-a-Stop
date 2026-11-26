import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';

function website(value) {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  url.protocol = 'https:';
  return url;
}

// Resolve each redirect independently and connect to the vetted address.
export async function page(url, redirects = 0) {
  if (!url || redirects > 4 || !/^[a-z\d.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw Error('Invalid portal URL');
  const { address, family } = await lookup(url.hostname);
  if (ipaddr.process(address).range() !== 'unicast') throw Error('Invalid portal address');
  const response = await new Promise((resolve, reject) => {
    https.get(url, { agent: false, family, autoSelectFamily: false, headers: { 'User-Agent': 'Worth-a-Stop/0.1 (travel calendar discovery)' },
      lookup: (_host, _opts, cb) => cb(null, address, family),
      signal: AbortSignal.timeout(8000) }, resolve).on('error', reject);
  });
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.destroy();
    return page(website(new URL(response.headers.location, url).href), redirects + 1);
  }
  if (response.statusCode !== 200 || !response.headers['content-type']?.includes('html')) {
    response.destroy();
    throw Error('Portal unavailable');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > 4_000_000) throw Error('Page too large');
    chunks.push(chunk);
  }
  return { url, html: Buffer.concat(chunks).toString() };
}

export function calendarLink({ url, html }) {
  const $ = load(html);
  const section = /^(events?|what.s on|calendar of events|event calendar|veranstaltungen|veranstaltungskalender|akce|kalendář akcí|podujatia|kalendár podujatí|agenda|événements|eventos|eventi|афиша|события)$/iu;
  for (const a of $('a[href]').toArray()) {
    const href = $(a).attr('href');
    if (!href || href.startsWith('#') || !URL.canParse(href, url)) continue;
    const target = website(new URL(href, url).href);
    if (!target || target.hostname.replace(/^www\./, '') !== url.hostname.replace(/^www\./, '')) continue;
    const segment = target.pathname.replace(/\/+$/, '').split('/').pop().replace(/[-_]/g, ' ');
    if (section.test(segment) || section.test($(a).text().trim())) return target.href;
  }
  return null;
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'User-Agent': 'Worth-a-Stop/0.1 (travel calendar discovery)' } });
  if (!response.ok) throw Error('Directory unavailable');
  const data = await response.json();
  if (data.error) throw Error('Directory lookup failed');
  return data;
}

async function tourismPortal(title) {
  async function article(params) {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({ action: 'parse', page: title, format: 'json', formatversion: '2', ...params });
    return (await json(url)).parse;
  }
  const { sections } = await article({ prop: 'sections' });
  const section = sections.find(s => s.anchor === 'External_links');
  if (!section) return null;
  const $ = load((await article({ prop: 'text', section: section.index })).text);
  const link = $('a.external').toArray().find(a => /official.*(?:touris|visitor)|(?:touris|visitor).*official/i.test($(a).text()));
  return link && website($(link).attr('href'));
}

export async function officialCalendars(id) {
  if (!/^[1-9]\d{0,9}$/.test(id)) throw Error('Invalid GeoNames ID');
  const query = `SELECT ?site ?title WHERE { ?city wdt:P1566 "${id}". OPTIONAL { ?city wdt:P856 ?site }
    OPTIONAL { ?article schema:about ?city; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title } } LIMIT 8`;
  const url = new URL('https://query.wikidata.org/sparql');
  url.search = new URLSearchParams({ format: 'json', query });
  const rows = (await json(url)).results.bindings;
  const sites = [...new Set(rows.map(r => r.site?.value).filter(Boolean))].map(website).filter(Boolean);
  const title = rows.find(r => r.title)?.title.value;
  const jobs = sites.map(site => Promise.resolve(site));
  if (title) jobs.push(tourismPortal(title));
  const results = await Promise.allSettled(jobs.map(async job => {
    const site = await job;
    return site && calendarLink(await page(site));
  }));
  const links = [...new Set(results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value))];
  if (!links.length && results.some(r => r.status === 'rejected')) throw results.find(r => r.status === 'rejected').reason;
  return links;
}
