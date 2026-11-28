import { overpassQuery } from './overpass.mjs';
import { eventLocation } from './event-location.mjs';
import { mealCategories, mealVenue, validMealVenue } from './meal-venue.mjs';

function distance(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function createMealSearch({ fetchResponse = fetch, cache, now = Date.now } = {}) {
  const memory = new Map();
  return async (point, { signal } = {}) => {
    if (!eventLocation(point?.latitude, point?.longitude)) throw Error('Invalid meal search point');
    signal?.throwIfAborted();
    const key = `meal-venues-v1/${point.latitude.toFixed(4)}/${point.longitude.toFixed(4)}`;
    const saved = memory.get(key) || await cache?.get(key).catch(() => undefined);
    if (saved?.expires > now()) {
      if (saved.error) throw Object.assign(Error('Meal sources unavailable'), { code: 'MEAL_SOURCE_UNAVAILABLE', retryAt: saved.expires });
      if (Array.isArray(saved.value?.venues) && saved.value.venues.every(validMealVenue)) return saved.value;
    }
    try {
      const elements = await overpassQuery(`nwr(around:1000,${point.latitude},${point.longitude})[name][amenity~"^(${mealCategories.join('|')})$"];out center tags;`, {
        signal, fetchResponse, queryTimeout: 6,
        extent: { minlat: Math.max(-90, point.latitude - .01), maxlat: Math.min(90, point.latitude + .01),
          minlon: Math.max(-180, point.longitude - .02), maxlon: Math.min(180, point.longitude + .02) },
      });
      const venues = [];
      for (const { type, id, lat, lon, center, tags = {} } of elements) {
        if (!['node', 'way', 'relation'].includes(type) || !Number.isSafeInteger(id) || id < 1 ||
            ['private', 'no'].includes(tags.access) || tags.opening_hours === 'off' || tags.disused === 'yes' || tags.abandoned === 'yes') continue;
        try {
          const venue = mealVenue({ name: tags.name, names: { ru: tags['name:ru'], en: tags['name:en'] },
            latitude: lat ?? center?.lat, longitude: lon ?? center?.lon, category: tags.amenity,
            hours: tags.opening_hours, url: `https://www.openstreetmap.org/${type}/${id}`, checkedAt: now() });
          if (distance(point, venue) <= 1.05) venues.push(venue);
        } catch { /* Invalid or unnamed records are not recommendations. */ }
      }
      venues.sort((a, b) => distance(point, a) - distance(point, b));
      const unique = [];
      for (const venue of venues) {
        if (unique.some(other => other.url === venue.url || other.name.toLocaleLowerCase() === venue.name.toLocaleLowerCase() && distance(other, venue) < .03)) continue;
        unique.push(venue); if (unique.length >= 50) break;
      }
      const value = { venues: unique, radiusKm: 1, checkedAt: now() }, entry = { value, expires: now() + 900000 };
      memory.set(key, entry); if (memory.size > 100) memory.delete(memory.keys().next().value);
      await cache?.set(key, entry).catch(() => {});
      return value;
    } catch (cause) {
      signal?.throwIfAborted();
      const retryAt = now() + 60000;
      memory.set(key, { error: true, expires: retryAt });
      if (memory.size > 100) memory.delete(memory.keys().next().value);
      throw Object.assign(Error('Meal sources unavailable', { cause }), { code: 'MEAL_SOURCE_UNAVAILABLE', retryAt });
    }
  };
}
