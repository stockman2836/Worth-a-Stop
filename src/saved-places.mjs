function validPlaces(places, limit) {
  return Array.isArray(places) && places.length <= limit && places.every(place =>
    typeof place?.name === 'string' && typeof place.names === 'object' && place.names !== null &&
    Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
    Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180 &&
    Number.isFinite(place.km) && place.km >= 0 &&
    /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(place.url));
}

function validBoundary(boundary) {
  return typeof boundary?.name === 'string' && boundary.name.trim() &&
    /^https:\/\/www\.openstreetmap\.org\/relation\/[1-9]\d*$/.test(boundary.url);
}

export async function loadPlaces(city, { signal, fetchResponse = fetch, storage, scope = 'city' } = {}) {
  if (!['city', 'nearby'].includes(scope)) throw Error('Invalid place search scope');
  const limit = scope === 'city' ? Infinity : 12;
  const key = `worth-a-stop.places.v7.${scope}.${scope === 'city' ? city.id + '.' : ''}${city.latitude}.${city.longitude}`;
  const validResult = result => validPlaces(result?.places, limit) && (scope !== 'city' || validBoundary(result.boundary));
  let saved;
  try {
    const data = JSON.parse(storage?.getItem(key) ?? 'null');
    if (validResult(data) && Number.isFinite(data.checkedAt) && data.checkedAt >= 0 && data.checkedAt <= Date.now()) saved = data;
  } catch { /* Storage is optional. */ }
  try {
    const query = new URLSearchParams({ lat: city.latitude, lon: city.longitude, scope, v: '9' });
    if (scope === 'city') { query.set('id', city.id); query.set('name', city.name); }
    const response = await fetchResponse('/api/places?' + query, { signal });
    if (response.status === 422) throw Object.assign(Error('City boundary unavailable'), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
    if (response.status === 503) throw Object.assign(Error('Place sources temporarily unavailable'), { code: 'PLACE_SOURCE_UNAVAILABLE' });
    if (!response.ok) throw Error('Places unavailable');
    const payload = await response.json();
    const data = scope === 'city' ? payload : { places: payload };
    if (!validResult(data)) throw Error('Invalid places response');
    signal?.throwIfAborted();
    if (data.incomplete && saved && !saved.incomplete) return { ...saved, stale: true, incomplete: true, loading: Boolean(data.loading) };
    const result = { places: data.places, ...(scope === 'city' && { boundary: data.boundary }),
      ...(data.incomplete && { incomplete: true }),
      checkedAt: Number.isFinite(data.checkedAt) && data.checkedAt >= 0 && data.checkedAt <= Date.now() ? data.checkedAt : Date.now() };
    try { storage?.setItem(key, JSON.stringify(result)); } catch { /* Live results remain usable. */ }
    return { ...result, stale: false, ...(data.loading && { loading: true }) };
  } catch (error) {
    signal?.throwIfAborted();
    if (saved) return { ...saved, stale: true };
    throw error;
  }
}
