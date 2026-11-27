import { createCoverageLookup } from './overpass-coverage.mjs';

const globalProviders = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

function unavailable() {
  return Object.assign(Error('Place sources temporarily unavailable'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
}

export function createOverpassClient({ fetchResponse = fetch, now = Date.now,
  mirrors = createCoverageLookup({ fetchResponse, now }) } = {}) {
  const health = new Map(), slots = new Map();
  async function acquire(endpoint, signal) {
    signal.throwIfAborted();
    if (!slots.has(endpoint)) slots.set(endpoint, { active: 0, waiting: [] });
    const state = slots.get(endpoint);
    if (state.active < 3) state.active++;
    else await new Promise((resolve, reject) => {
      const ready = () => { signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => {
        state.waiting.splice(state.waiting.indexOf(ready), 1);
        reject(signal.reason);
      };
      state.waiting.push(ready);
      signal.addEventListener('abort', abort, { once: true });
    });
    return () => {
      const ready = state.waiting.shift();
      if (ready) ready();
      else state.active--;
    };
  }
  return async (query, { signal, extent, queryTimeout = 12, accept = () => true, subdivide = false } = {}) => {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(35000);
    const regional = await mirrors(extent);
    signal?.throwIfAborted();
    const endpoints = [...regional, ...globalProviders]
      .filter(endpoint => (health.get(endpoint)?.retryAt ?? 0) <= now())
      .sort((a, b) => Number(regional.includes(b)) - Number(regional.includes(a)) ||
        (health.get(b)?.success ?? 0) - (health.get(a)?.success ?? 0));
    const data = `[out:json][timeout:${queryTimeout}];${query}`;
    for (const endpoint of endpoints) {
      signal?.throwIfAborted();
      if (deadline.aborted) throw unavailable();
      const release = await acquire(endpoint, signal ? AbortSignal.any([signal, deadline]) : deadline);
      const timeout = AbortSignal.timeout((queryTimeout + 3) * 1000);
      try {
        const url = new URL(endpoint);
        const post = url.hostname === 'overpass.private.coffee' || new URLSearchParams({ data }).toString().length > 6000;
        if (!post) url.searchParams.set('data', data);
        const response = await fetchResponse(url, {
          signal: AbortSignal.any([timeout, deadline, ...(signal ? [signal] : [])]),
          headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city travel planner)', ...(post && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
          ...(post && { method: 'POST', body: new URLSearchParams({ data }).toString() }),
        });
        if (!response.ok) throw unavailable();
        const { elements, remark } = await response.json();
        if (subdivide && /timed out|timeout|out of memory/i.test(remark || '')) {
          throw Object.assign(Error('Place query needs smaller tiles'), { code: 'PLACE_QUERY_TOO_LARGE' });
        }
        if (remark || !Array.isArray(elements) || !accept(elements)) throw unavailable();
        signal?.throwIfAborted();
        health.set(endpoint, { success: now(), retryAt: 0 });
        return elements;
      } catch (error) {
        // Cancellation says nothing about a provider's health.
        signal?.throwIfAborted();
        const recentlyHealthy = health.get(endpoint)?.success > 0 && now() - health.get(endpoint).success < 30000;
        if (subdivide && (error.code === 'PLACE_QUERY_TOO_LARGE' || timeout.aborted && !deadline.aborted && recentlyHealthy)) {
          throw Object.assign(Error('Place query needs smaller tiles'), { code: 'PLACE_QUERY_TOO_LARGE' });
        }
        health.set(endpoint, { success: 0, retryAt: now() + 60000 });
      } finally { release(); }
    }
    throw unavailable();
  };
}

// Share health and coverage across boundary/place queries and city retries.
const clients = new WeakMap();
export function overpassQuery(query, { fetchResponse = fetch, ...options } = {}) {
  if (!clients.has(fetchResponse)) clients.set(fetchResponse, createOverpassClient({ fetchResponse }));
  return clients.get(fetchResponse)(query, options);
}
