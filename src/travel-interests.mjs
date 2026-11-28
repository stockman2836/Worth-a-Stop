export const interestIds = ['history', 'architecture', 'museums', 'nature', 'art'];
export const interestKey = 'worth-a-stop.travel-interests.v1';

const categories = {
  history: ['castle', 'monument', 'ruins', 'archaeological_site', 'city_gate', 'amphitheatre', 'fort', 'palace', 'church', 'temple', 'monastery'],
  architecture: ['cathedral', 'basilica', 'church', 'temple', 'monastery', 'castle', 'palace', 'city_gate', 'amphitheatre'],
  museums: ['museum'], nature: ['park', 'garden', 'viewpoint'], art: ['gallery', 'artwork', 'theatre'],
};

export function normalizeInterests(value) {
  return Array.isArray(value) ? interestIds.filter(id => value.includes(id)) : [];
}

export function matchingInterests(category, interests) {
  return normalizeInterests(interests).filter(id => categories[id].includes(category));
}

const unsaved = new WeakMap();
let temporary = [];
export function readInterests(storage) {
  if (!storage) return { interests: [...temporary], saved: false };
  if (unsaved.has(storage)) return { interests: [...unsaved.get(storage)], saved: false };
  try { return { interests: normalizeInterests(JSON.parse(storage.getItem(interestKey) ?? 'null')), saved: true }; }
  catch { return { interests: [], saved: false }; }
}

export function saveInterests(value, storage) {
  const interests = normalizeInterests(value);
  if (!storage) { temporary = interests; return { interests, saved: false }; }
  try { storage.setItem(interestKey, JSON.stringify(interests)); unsaved.delete(storage); return { interests, saved: true }; }
  catch { unsaved.set(storage, interests); return { interests, saved: false }; }
}

// Keep a general fallback in the bounded planner pool. Preferences are a
// ranking signal, so unavailable or distant matches cannot exclude every alternative.
export function shortlistPlaces(places, interests, origin) {
  if (!normalizeInterests(interests).length) return places.slice(0, 12);
  const matched = places.map((place, index) => ({ place, index })).filter(({ place }) => matchingInterests(place.category, interests).length);
  function proximity(place) {
    if (!origin) return Number.isFinite(place.km) ? place.km : Infinity;
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return Infinity;
    const rad = Math.PI / 180;
    const h = Math.sin((place.latitude - origin.latitude) * rad / 2) ** 2 +
      Math.cos(origin.latitude * rad) * Math.cos(place.latitude * rad) * Math.sin((place.longitude - origin.longitude) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  const priority = place => proximity(place) + (place.prominence === 'highlight' ? 0 : place.prominence === 'notable' ? 2 : 4);
  matched.sort((a, b) => priority(a.place) - priority(b.place) || a.index - b.index);
  const selected = [], urls = new Set();
  for (const { place } of matched) {
    if (!urls.has(place.url)) { selected.push(place); urls.add(place.url); }
    if (selected.length === 8) break;
  }
  for (const place of places.filter(place => !matchingInterests(place.category, interests).length).slice(0, 4)) {
    if (!urls.has(place.url)) { selected.push(place); urls.add(place.url); }
  }
  for (const place of places) {
    if (selected.length === 12) break;
    if (!urls.has(place.url)) { selected.push(place); urls.add(place.url); }
  }
  return selected;
}
