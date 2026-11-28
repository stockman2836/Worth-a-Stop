import { eventLocation } from './event-location.mjs';
import { nextDate } from './day-agenda.mjs';
import { returnMemory } from './city-plan-state.mjs';
import { withStartingPoint } from './starting-point.mjs';

export function validReturnTrip(trip) {
  return trip === null || Boolean(trip && eventLocation(trip.point?.latitude, trip.point?.longitude) &&
    Number.isInteger(trip.bufferMinutes) && trip.bufferMinutes >= 0 && trip.bufferMinutes <= 120);
}

export function returnStop(point, title = 'Return', deadline) {
  return { id: `return:${point.latitude},${point.longitude}`, type: 'return', title, names: {}, location: point,
    url: `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`,
    ...(Number.isFinite(deadline) && { deadline }) };
}

export function withTripEndpoints(stops, origin, trip, { originTitle = 'Start', returnTitle = 'Return', deadline } = {}) {
  const route = withStartingPoint(stops, origin, originTitle);
  return stops.length && trip?.point ? [...route, returnStop(trip.point, returnTitle, deadline)] : route;
}

const defaults = () => ({ enabled: false, mode: 'origin', point: null, bufferMinutes: 15 });
function validate(value) {
  return value && typeof value.enabled === 'boolean' && ['origin', 'point'].includes(value.mode) &&
    (value.point === null || Boolean(eventLocation(value.point?.latitude, value.point?.longitude))) &&
    Number.isInteger(value.bufferMinutes) && value.bufferMinutes >= 0 && value.bufferMinutes <= 120;
}
export function returnTripStore(cityId, storage) {
  const key = day => { nextDate(day); return `worth-a-stop.itinerary.return.v1.${cityId}.${day}`; };
  return {
    read(day) {
      const id = key(day);
      if (returnMemory.has(id)) return { settings: structuredClone(returnMemory.get(id)), saved: false };
      try {
        const raw = storage?.getItem(id), value = raw ? JSON.parse(raw) : defaults();
        if (!validate(value)) throw Error('Invalid return settings');
        return { settings: value, saved: Boolean(storage) };
      } catch { return { settings: defaults(), saved: false }; }
    },
    set(day, value) {
      if (!validate(value)) throw Error('Invalid return settings');
      const id = key(day), settings = structuredClone(value);
      try {
        if (!storage) throw Error('Storage unavailable');
        storage.setItem(id, JSON.stringify(settings)); returnMemory.delete(id);
        return { settings, saved: true };
      } catch { returnMemory.set(id, settings); return { settings: structuredClone(settings), saved: false }; }
    },
  };
}
