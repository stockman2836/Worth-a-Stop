function validPlaces(places) {
  return Array.isArray(places) && places.length <= 12 && places.every(place =>
    typeof place?.name === 'string' && typeof place.names === 'object' && place.names !== null &&
    Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
    Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180 &&
    Number.isFinite(place.km) && place.km >= 0 &&
    /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(place.url));
}

export async function loadPlaces(city, { signal, fetchResponse = fetch, storage } = {}) {
  const key = `worth-a-stop.places.v1.${city.latitude}.${city.longitude}`;
  let saved;
  try {
    const data = JSON.parse(storage?.getItem(key) ?? 'null');
    if (data && validPlaces(data.places) && Number.isFinite(data.checkedAt) && data.checkedAt >= 0 && data.checkedAt <= Date.now()) saved = data;
  } catch { /* Storage is optional. */ }
  try {
    const query = new URLSearchParams({ lat: city.latitude, lon: city.longitude, v: '2' });
    const response = await fetchResponse('/api/places?' + query, { signal });
    if (!response.ok) throw Error('Places unavailable');
    const places = await response.json();
    if (!validPlaces(places)) throw Error('Invalid places response');
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
