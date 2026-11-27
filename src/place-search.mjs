import { cityBoundary } from './city-boundary.mjs';
import { nearbyPlaces } from './places.mjs';

export function createPlaceSearch({ fetchResponse = fetch, now = Date.now,
  discoverBoundary = cityBoundary, discoverPlaces = nearbyPlaces } = {}) {
  const boundaries = new Map(), results = new Map();
  function cached(cache, key, ttl, load) {
    let entry = cache.get(key);
    if (entry && entry.expires > now()) return entry.promise;
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    entry = { expires: Infinity };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.expires = now() + ttl;
      return value;
    }, error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    return entry.promise;
  }
  return (city, { scope = 'nearby' } = {}) => {
    const identity = [city.id, city.latitude, city.longitude].join('/');
    const key = scope === 'city' ? 'city/' + identity : ['nearby', city.latitude, city.longitude].join('/');
    return cached(results, key, 3600000, () => discoverPlaces(city, {
      scope, fetchResponse, signal: AbortSignal.timeout(60000),
      resolveBoundary: () => cached(boundaries, identity, 86400000,
        () => discoverBoundary(city, { fetchResponse, signal: AbortSignal.timeout(35000) })),
    }));
  };
}
