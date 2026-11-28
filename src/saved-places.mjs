import { validTerritory } from './territory.mjs';
import { validPlaceReference } from './place-reference.mjs';
import { validNearbySearchArea } from './search-area.mjs';

function validPlaces(places, limit) {
  return Array.isArray(places) && places.length <= limit && places.every(place =>
    typeof place?.name === 'string' && typeof place.names === 'object' && place.names !== null &&
    Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
    Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180 &&
    Number.isFinite(place.km) && place.km >= 0 &&
    /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(place.url) &&
    (place.territory === undefined || validTerritory(place.territory)) &&
    (place.reference === undefined || validPlaceReference(place.reference, place.wikidata)));
}

function validBoundary(boundary) {
  return typeof boundary?.name === 'string' && boundary.name.trim() &&
    /^https:\/\/www\.openstreetmap\.org\/relation\/[1-9]\d*$/.test(boundary.url) &&
    (boundary.enclaves === undefined || Array.isArray(boundary.enclaves) && boundary.enclaves.every(validTerritory));
}

const failures = new WeakMap();

export async function loadPlaces(city, { signal, fetchResponse = fetch, storage, scope = 'city' } = {}) {
  signal?.throwIfAborted();
  if (!['city', 'nearby'].includes(scope)) throw Error('Invalid place search scope');
  const limit = scope === 'city' ? Infinity : 12;
  const key = `worth-a-stop.places.v7.${scope}.${scope === 'city' ? city.id + '.' : ''}${city.latitude}.${city.longitude}`;
  const validResult = result => validPlaces(result?.places, limit) && (scope !== 'city' || validBoundary(result.boundary) ||
    result.boundary === undefined && validNearbySearchArea(result.searchArea, city));
  let saved;
  try {
    let data = JSON.parse(storage?.getItem(key) ?? 'null');
    if (!validResult(data)) {
      const older = JSON.parse(storage?.getItem(key.replace('.v7.', '.v6.')) ?? 'null');
      if (validResult(older)) data = { ...older, incomplete: true };
    }
    if (validResult(data) && Number.isFinite(data.checkedAt) && data.checkedAt >= 0 && data.checkedAt <= Date.now()) {
      const { loading, ...record } = data;
      saved = record;
    }
  } catch { /* Storage is optional. */ }
  if (!failures.has(fetchResponse)) failures.set(fetchResponse, new Map());
  const cooldown = failures.get(fetchResponse);
  try {
    const blocked = cooldown.get(key);
    if (blocked?.retryAt > Date.now()) throw blocked;
    const query = new URLSearchParams({ lat: city.latitude, lon: city.longitude, scope, v: '15' });
    if (scope === 'city') { query.set('id', city.id); query.set('name', city.name); }
    const response = await fetchResponse('/api/places?' + query, { signal });
    const payload = await response.json().catch(() => undefined);
    if (response.status === 422 || payload?.status === 'unsupported' || response.status === 503 || payload?.status === 'unavailable') {
      const boundaryMissing = response.status === 422 || payload?.status === 'unsupported';
      const seconds = Number(response.headers.get('Retry-After'));
      const delay = seconds > 0 && seconds <= 300 ? seconds * 1000 : boundaryMissing ? 300000 : 60000;
      const retryAt = Number.isFinite(payload?.retryAt) && payload.retryAt > Date.now() && payload.retryAt <= Date.now() + 300000 ? payload.retryAt : Date.now() + delay;
      throw Object.assign(Error(boundaryMissing ? 'City boundary unavailable' : 'Place sources temporarily unavailable'), {
        code: boundaryMissing ? 'CITY_BOUNDARY_UNAVAILABLE' : 'PLACE_SOURCE_UNAVAILABLE', retryAt,
      });
    }
    if (!response.ok) throw Error('Places unavailable');
    const data = scope === 'city' ? payload : { places: payload };
    if (!validResult(data)) throw Error('Invalid places response');
    signal?.throwIfAborted();
    cooldown.delete(key);
    if (data.incomplete && saved && !saved.incomplete && Boolean(data.boundary) === Boolean(saved.boundary)) {
      const places = new Map(saved.places.map(place => [place.url, place]));
      for (const place of data.places) places.set(place.url, place);
      const enclaves = new Map((saved.boundary?.enclaves ?? []).map(territory => [territory.url, territory]));
      for (const territory of data.boundary?.enclaves ?? []) enclaves.set(territory.url, territory);
      return { ...saved, places: [...places.values()],
        ...(scope === 'city' && data.boundary && { boundary: { ...data.boundary, ...(enclaves.size && { enclaves: [...enclaves.values()] }) } }),
        referencesStatus: data.referencesStatus, revision: data.checkedAt ?? Date.now(), stale: true, incomplete: true, loading: Boolean(data.loading), retryAt: data.retryAt };
    }
    const result = { places: data.places, ...(scope === 'city' && (data.boundary ? { boundary: data.boundary } : { searchArea: data.searchArea })),
      ...(data.surroundings && { surroundings: true }),
      ...(['loading', 'checked', 'partial', 'unavailable'].includes(data.referencesStatus) && { referencesStatus: data.referencesStatus }),
      ...(data.incomplete && { incomplete: true }), ...(Number.isFinite(data.retryAt) && { retryAt: data.retryAt }),
      checkedAt: Number.isFinite(data.checkedAt) && data.checkedAt >= 0 && data.checkedAt <= Date.now() ? data.checkedAt : Date.now() };
    try { storage?.setItem(key, JSON.stringify(result)); } catch { /* Live results remain usable. */ }
    return { ...result, stale: Boolean(data.stale), ...(data.loading && { loading: true }) };
  } catch (error) {
    signal?.throwIfAborted();
    error.retryAt ??= Date.now() + 10000;
    if (cooldown.size >= 100) cooldown.delete(cooldown.keys().next().value);
    cooldown.set(key, error);
    if (saved) return { ...saved, stale: true, retryAt: error.retryAt };
    throw error;
  }
}
