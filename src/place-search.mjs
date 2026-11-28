import { cityBoundary } from './city-boundary.mjs';
import { nearbyPlaces } from './places.mjs';
import { enrichPlaceReferences } from './place-references.mjs';

export function createPlaceSearch({ fetchResponse = fetch, now = Date.now,
  discoverBoundary = cityBoundary, discoverPlaces = nearbyPlaces, enrichPlaces = enrichPlaceReferences, diskCache, idleTimeout = 6000, failureTtl = 60000 } = {}) {
  const boundaries = new Map(), results = new Map();
  function subscribe(entry, signal) {
    signal?.throwIfAborted();
    clearTimeout(entry.idleTimer);
    entry.users++;
    return new Promise((resolve, reject) => {
      let settled = false;
      function finish(value, error) {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', abort);
        entry.users--;
        if (entry.pending && !entry.users) {
          if (error && signal?.aborted && !entry.snapshot) entry.controller.abort();
          else {
            entry.idleTimer = setTimeout(() => entry.controller.abort(), idleTimeout);
            entry.idleTimer.unref?.();
          }
        }
        error ? reject(error) : resolve(value);
      }
      const abort = () => finish(undefined, signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const result = entry.pending ? entry.snapshot ? Promise.resolve({ ...entry.snapshot, loading: true }) :
        Promise.race([entry.promise, entry.progress]) : entry.promise;
      result.then(value => finish(value), error => finish(undefined, error));
    });
  }
  function cached(cache, key, ttl, load, job = false, requestSignal) {
    let entry = cache.get(key);
    function response(entry) {
      return job ? subscribe(entry, requestSignal) : entry.promise;
    }
    if (entry && entry.expires > now() && !(entry.pending && entry.signal?.aborted)) return response(entry);
    const previous = entry?.value;
    if (cache.size >= 100) {
      const oldest = [...cache].find(([, value]) => !value.pending);
      if (oldest) cache.delete(oldest[0]);
    }
    entry = { expires: Infinity, pending: true, users: 0, controller: job ? new AbortController() : undefined };
    entry.signal = job ? AbortSignal.any([entry.controller.signal, AbortSignal.timeout(180000)]) : requestSignal;
    const abortSignal = job ? entry.controller.signal : requestSignal;
    const abandon = () => { if (entry.pending && cache.get(key) === entry) cache.delete(key); };
    abortSignal?.addEventListener('abort', abandon, { once: true });
    let publish;
    entry.progress = new Promise(resolve => { publish = resolve; });
    entry.promise = Promise.resolve().then(async () => {
      entry.signal?.throwIfAborted();
      let saved = await diskCache?.get(key).catch(() => undefined);
      if (saved?.expires > now()) { entry.pending = false; entry.expires = saved.expires; return saved.value; }
      if (!saved && job && key.startsWith('places-v15/city/')) {
        for (const version of ['v14', 'v13', 'v12', 'v11', 'v10', 'v9']) {
          saved = await diskCache?.get(key.replace('places-v15/', `places-${version}/`)).catch(() => undefined);
          if (saved) break;
        }
      }
      const fallback = previous ?? saved?.value;
      if (job && Array.isArray(fallback?.places) && (fallback.boundary || fallback.searchArea) &&
          now() - (fallback.checkedAt ?? saved?.expires - ttl) <= 7 * 86400000) {
        entry.snapshot = { ...fallback, checkedAt: fallback.checkedAt ?? Math.max(0, saved.expires - ttl), stale: true, incomplete: true };
        publish({ ...entry.snapshot, loading: true });
      }
      let value;
      try {
        value = await load(snapshot => {
          entry.snapshot = { ...snapshot, incomplete: true, checkedAt: now() };
          publish({ ...entry.snapshot, loading: true });
        }, entry.signal);
        entry.signal?.throwIfAborted();
      } catch (error) {
        if (entry.controller?.signal.aborted || !entry.snapshot) throw error;
        value = entry.snapshot;
      }
      entry.pending = false;
      if (job && Array.isArray(value?.places) && !value.stale) value = { ...value, checkedAt: now() };
      entry.expires = now() + (value?.incomplete ? Math.min(ttl, 60000) : ttl);
      if (value?.incomplete) value = { ...value, retryAt: entry.expires };
      entry.value = value;
      if (!value?.incomplete) await diskCache?.set(key, { expires: entry.expires, value }).catch(() => {});
      return value;
    }).catch(error => {
      entry.pending = false;
      if (abortSignal?.aborted) { if (cache.get(key) === entry) cache.delete(key); }
      else {
        entry.expires = now() + (error.code === 'CITY_BOUNDARY_UNAVAILABLE' ? 300000 : failureTtl);
        error.retryAt = entry.expires;
      }
      throw error;
    }).finally(() => {
      clearTimeout(entry.idleTimer);
      abortSignal?.removeEventListener('abort', abandon);
    });
    cache.set(key, entry);
    return response(entry);
  }
  return async (city, { scope = 'nearby', signal } = {}) => {
    signal?.throwIfAborted();
    const identity = [city.id, city.latitude, city.longitude].join('/');
    const key = 'places-v15/' + (scope === 'city' ? 'city/' + identity : ['nearby', city.latitude, city.longitude].join('/'));
    return cached(results, key, 3600000, async (onProgress, jobSignal) => {
      const result = await discoverPlaces(city, {
        scope, fetchResponse, queryCache: diskCache, signal: jobSignal,
        onProgress: scope === 'city' ? onProgress : undefined,
        resolveBoundary: () => cached(boundaries, 'boundary-v4/' + identity, 86400000,
          () => discoverBoundary(city, { fetchResponse, queryCache: diskCache,
            signal: AbortSignal.any([jobSignal, AbortSignal.timeout(35000)]) }), false, jobSignal),
      });
      if (scope !== 'city' || !Array.isArray(result?.places) || !result.places.some(place => place.wikidata)) return result;
      onProgress({ ...result, referencesStatus: 'loading' });
      return enrichPlaces(result, { signal: jobSignal, fetchResponse, queryCache: diskCache, now });
    }, true, signal);
  };
}
