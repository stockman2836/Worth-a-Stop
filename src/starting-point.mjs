import { eventLocation } from './event-location.mjs';
import { nextDate } from './day-agenda.mjs';
import { originMemory as unsaved } from './city-plan-state.mjs';

export function withStartingPoint(stops, point, title) {
  if (!point || !stops.length) return stops;
  return [{
    id: `origin:${point.latitude},${point.longitude}`, type: 'origin', title, names: {},
    location: point, url: `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`,
  }, ...stops];
}

export function startingPointStore(cityId, storage) {
  function key(day) {
    nextDate(day);
    return `worth-a-stop.itinerary.origin.v1.${cityId}.${day}`;
  }
  function read(day) {
    const id = key(day);
    if (unsaved.has(id)) return { point: unsaved.get(id), saved: false };
    try {
      const raw = storage?.getItem(id);
      const value = raw ? JSON.parse(raw) : null;
      if (value === null) return { point: null, saved: Boolean(storage) };
      const point = eventLocation(value.latitude, value.longitude);
      if (!point) throw Error('Invalid starting point');
      return { point, saved: true };
    } catch { return { point: null, saved: false }; }
  }
  return {
    read,
    set(day, value) {
      const id = key(day);
      const point = value === null ? null : eventLocation(value?.latitude, value?.longitude);
      if (value !== null && !point) throw Error('Invalid starting point');
      try {
        if (!storage) throw Error('Storage unavailable');
        storage.setItem(id, JSON.stringify(point));
        unsaved.delete(id);
        return { point, saved: true };
      } catch {
        unsaved.set(id, point);
        return { point, saved: false };
      }
    },
  };
}
