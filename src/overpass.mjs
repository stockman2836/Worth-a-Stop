import { createCoverageLookup } from './overpass-coverage.mjs';

const globalProviders = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

function unavailable() {
  return Object.assign(Error('Place sources temporarily unavailable'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
}

export function createOverpassClient({ fetchResponse = fetch, now = Date.now,
  mirrors = createCoverageLookup({ fetchResponse, now }) } = {}) {
  const health = new Map();
  return async (query, { signal, extent, queryTimeout = 12, accept = () => true } = {}) => {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(35000);
    const regional = await mirrors(extent);
    signal?.throwIfAborted();
    const endpoints = [...regional, ...globalProviders]
      .filter(endpoint => (health.get(endpoint)?.retryAt ?? 0) <= now())
      .sort((a, b) => (health.get(b)?.success ?? 0) - (health.get(a)?.success ?? 0));
    const data = `[out:json][timeout:${queryTimeout}];${query}`;
    for (const endpoint of endpoints) {
      signal?.throwIfAborted();
      if (deadline.aborted) throw unavailable();
      try {
        const url = new URL(endpoint);
        const post = url.hostname === 'overpass.private.coffee';
        if (!post) url.searchParams.set('data', data);
        const timeout = AbortSignal.timeout((queryTimeout + 3) * 1000);
        const response = await fetchResponse(url, {
          signal: AbortSignal.any([timeout, deadline, ...(signal ? [signal] : [])]),
          headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city travel planner)', ...(post && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
          ...(post && { method: 'POST', body: new URLSearchParams({ data }).toString() }),
        });
        if (!response.ok) throw unavailable();
        const { elements, remark } = await response.json();
        if (remark || !Array.isArray(elements) || !accept(elements)) throw unavailable();
        signal?.throwIfAborted();
        health.set(endpoint, { success: now(), retryAt: 0 });
        return elements;
      } catch {
        // Cancellation says nothing about a provider's health.
        signal?.throwIfAborted();
        health.set(endpoint, { success: 0, retryAt: now() + 60000 });
      }
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
