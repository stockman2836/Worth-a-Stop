import { nextDate } from './day-agenda.mjs';

const memory = new Map();

export function itineraryStop(item, type) {
  const title = item.title || item.name;
  const url = new URL(item.url);
  if (!['place', 'event'].includes(type) || typeof title !== 'string' || !title.trim() || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Error('Invalid stop');
  }
  const start = type === 'event' && Number.isFinite(item.start) && Number.isFinite(new Date(item.start).getTime()) ? item.start : null;
  const end = type === 'event' && Number.isFinite(item.end) && Number.isFinite(new Date(item.end).getTime()) ? item.end : null;
  return { id: JSON.stringify([type, url.href, start]), type, title, url: url.href,
    names: item.names || {}, venue: item.venue || null, start, end, duration: null };
}

export function itineraryStore(cityId, storage) {
  function key(day) {
    nextDate(day);
    return `worth-a-stop.itinerary.v1.${cityId}.${day}`;
  }
  function read(day) {
    const id = key(day);
    const pending = memory.get(id);
    if (pending?.unsaved) return { stops: pending.stops, saved: false };
    try {
      const raw = storage?.getItem(id);
      if (!raw) return { stops: [], saved: Boolean(storage) };
      const stops = JSON.parse(raw);
      if (!Array.isArray(stops) || !stops.every(stop =>
        stop.id === itineraryStop(stop, stop.type).id &&
        (stop.duration === null || Number.isInteger(stop.duration) && stop.duration >= 1 && stop.duration <= 1440))) {
        throw Error('Invalid saved itinerary');
      }
      const valid = stops.map(stop => ({ ...itineraryStop(stop, stop.type), duration: stop.duration }));
      memory.set(id, { stops: valid, unsaved: false });
      return { stops: valid, saved: true };
    } catch {
      return { stops: memory.get(id)?.stops || [], saved: false };
    }
  }
  function change(day, edit) {
    const id = key(day);
    const stops = edit(structuredClone(read(day).stops));
    memory.set(id, { stops, unsaved: true });
    try {
      if (!storage) throw Error('Storage unavailable');
      storage.setItem(id, JSON.stringify(stops));
      memory.set(id, { stops, unsaved: false });
      return { stops, saved: true };
    } catch { return { stops, saved: false }; }
  }
  return {
    read,
    add(day, stop) { return change(day, stops => stops.some(s => s.id === stop.id) ? stops : [...stops, stop]); },
    remove(day, id) { return change(day, stops => stops.filter(stop => stop.id !== id)); },
    move(day, id, direction) {
      return change(day, stops => {
        const index = stops.findIndex(stop => stop.id === id);
        const target = index + direction;
        if (index >= 0 && target >= 0 && target < stops.length && [-1, 1].includes(direction)) {
          [stops[index], stops[target]] = [stops[target], stops[index]];
        }
        return stops;
      });
    },
    duration(day, id, value) {
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1440)) throw Error('Invalid duration');
      return change(day, stops => stops.map(stop => stop.id === id && stop.type === 'place' ? { ...stop, duration: value } : stop));
    },
  };
}
