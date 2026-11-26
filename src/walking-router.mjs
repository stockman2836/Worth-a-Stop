import { eventLocation } from './event-location.mjs';

export function createWalkingRouter(fetchResponse = fetch) {
  const cache = new Map();
  let queue = Promise.resolve();
  let lastRequest = 0;
  let waiting = 0;
  return function route(from, to) {
    if (!eventLocation(from?.latitude, from?.longitude) || !eventLocation(to?.latitude, to?.longitude)) {
      return Promise.reject(Error('Invalid route coordinates'));
    }
    const key = [from.longitude, from.latitude, to.longitude, to.latitude].join(',');
    const saved = cache.get(key);
    if (saved?.expires > Date.now()) return saved.promise;
    if (waiting >= 20) return Promise.reject(Error('Router busy'));
    waiting++;
    // The public FOSSGIS service allows at most one request per second.
    const promise = queue.catch(() => {}).then(async () => {
      const delay = Math.max(0, 1000 - (Date.now() - lastRequest));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = Date.now();
      const url = new URL(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`);
      url.search = new URLSearchParams({ geometries: 'geojson', overview: 'full', steps: 'false', radiuses: '100;100' });
      const response = await fetchResponse(url, { signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city walking itinerary)' } });
      const data = await response.json();
      if (['NoRoute', 'NoSegment'].includes(data.code)) return { status: 'no-route' };
      if (!response.ok || data.code !== 'Ok') throw Error('Walking route unavailable');
      const result = data.routes?.[0];
      if (!Number.isFinite(result?.distance) || result.distance < 0 ||
          !Number.isFinite(result.duration) || result.duration < 0 ||
          result.geometry?.type !== 'LineString' || !Array.isArray(result.geometry.coordinates) ||
          result.geometry.coordinates.length < 2 || !result.geometry.coordinates.every(point =>
            Array.isArray(point) && eventLocation(point[1], point[0]))) throw Error('Invalid walking route');
      return { status: 'ok', distance: result.distance, duration: result.duration, geometry: result.geometry };
    }).finally(() => { waiting--; });
    queue = promise;
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { promise, expires: Date.now() + 3600000 });
    promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
    return promise;
  };
}
