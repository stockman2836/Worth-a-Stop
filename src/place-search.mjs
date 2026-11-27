import { cityBoundary } from './city-boundary.mjs';
import { nearbyPlaces } from './places.mjs';

export function createPlaceSearch({ fetchResponse = fetch, now = Date.now,
  discoverBoundary = cityBoundary, discoverPlaces = nearbyPlaces, diskCache } = {}) {
  const boundaries = new Map(), results = new Map();
  function cached(cache, key, ttl, load, progressive = false) {
    let entry = cache.get(key);
    function response(entry) {
      if (!progressive || !entry.pending) return entry.promise;
      if (entry.snapshot) return Promise.resolve({ ...entry.snapshot, loading: true });
      return Promise.race([entry.promise, entry.progress]);
    }
    if (entry && entry.expires > now()) return response(entry);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    entry = { expires: Infinity, pending: true };
    let publish;
    entry.progress = new Promise(resolve => { publish = resolve; });
    entry.promise = Promise.resolve().then(async () => {
      const saved = await diskCache?.get(key).catch(() => undefined);
      if (saved?.expires > now()) { entry.pending = false; entry.expires = saved.expires; return saved.value; }
      let value;
      try {
        value = await load(snapshot => {
          entry.snapshot = { ...snapshot, incomplete: true, checkedAt: now() };
          publish({ ...entry.snapshot, loading: true });
        });
      } catch (error) {
        if (!entry.snapshot) throw error;
        value = entry.snapshot;
      }
      entry.pending = false;
      if (progressive && Array.isArray(value?.places)) value = { ...value, checkedAt: now() };
      entry.expires = now() + (value?.incomplete ? Math.min(ttl, 60000) : ttl);
      if (!value?.incomplete) await diskCache?.set(key, { expires: entry.expires, value }).catch(() => {});
      return value;
    }).catch(error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    return response(entry);
  }
  return (city, { scope = 'nearby' } = {}) => {
    const identity = [city.id, city.latitude, city.longitude].join('/');
    const key = 'places-v9/' + (scope === 'city' ? 'city/' + identity : ['nearby', city.latitude, city.longitude].join('/'));
    return cached(results, key, 3600000, onProgress => discoverPlaces(city, {
      scope, fetchResponse, queryCache: diskCache, signal: AbortSignal.timeout(180000),
      onProgress: scope === 'city' ? onProgress : undefined,
      resolveBoundary: () => cached(boundaries, 'boundary-v2/' + identity, 86400000,
        () => discoverBoundary(city, { fetchResponse, queryCache: diskCache, signal: AbortSignal.timeout(35000) })),
    }), scope === 'city');
  };
}
