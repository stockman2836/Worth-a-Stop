function validPlaces(places, limit) {
  return Array.isArray(places) && places.length <= limit && places.every(place =>
    typeof place?.name === 'string' && typeof place.names === 'object' && place.names !== null &&
    Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
    Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180 &&
    Number.isFinite(place.km) && place.km >= 0 &&
    /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(place.url));
}

export async function loadPlaces(city, { signal, fetchResponse = fetch, storage, radiusKm = 6 } = {}) {
  if (![2, 6].includes(radiusKm)) throw Error('Invalid place search radius');
  const limit = radiusKm === 6 ? 24 : 12;
  const key = `worth-a-stop.places.v3.${radiusKm}.${city.latitude}.${city.longitude}`;
  let saved;
  try {
    const data = JSON.parse(storage?.getItem(key) ?? 'null');
    if (data && validPlaces(data.places, limit) && Number.isFinite(data.checkedAt) && data.checkedAt >= 0 && data.checkedAt <= Date.now()) saved = data;
  } catch { /* Storage is optional. */ }
  try {
    const query = new URLSearchParams({ lat: city.latitude, lon: city.longitude, radius: radiusKm, v: '4' });
    const response = await fetchResponse('/api/places?' + query, { signal });
    if (!response.ok) throw Error('Places unavailable');
    const places = await response.json();
    if (!validPlaces(places, limit)) throw Error('Invalid places response');
    signal?.throwIfAborted();
    const result = { places, checkedAt: Date.now() };
    try { storage?.setItem(key, JSON.stringify(result)); } catch { /* Live results remain usable. */ }
    return { ...result, stale: false };
  } catch (error) {
    signal?.throwIfAborted();
    if (saved) return { ...saved, stale: true };
    throw error;
  }
}
