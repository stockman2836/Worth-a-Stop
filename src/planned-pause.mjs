import { localInstant } from './opening-hours.mjs';
import { eventLocation } from './event-location.mjs';
import { nextDate } from './day-agenda.mjs';
import { pauseMemory } from './city-plan-state.mjs';
import { mealVenue } from './meal-venue.mjs';

const kinds = ['meal', 'rest'];
export function validPauseSettings(value) {
  return value && typeof value.enabled === 'boolean' && kinds.includes(value.kind) &&
    [value.from, value.to].every(time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) &&
    value.from < value.to && Number.isInteger(value.duration) && value.duration >= 5 && value.duration <= 180;
}
export function pauseWindow(settings, day, zone, start, end) {
  if (settings === null) return null;
  if (!validPauseSettings({ ...settings, enabled: true })) throw Error('Invalid pause options');
  const from = localInstant(day, settings.from, zone), to = localInstant(day, settings.to, zone);
  if (!Number.isFinite(from) || !Number.isFinite(to) ||
      Math.max(start, from) + settings.duration * 60000 > Math.min(end, to)) throw Error('Invalid pause options');
  return { kind: settings.kind, start: from, end: to, duration: settings.duration };
}
export function plannedPause(window, point, venue) {
  if (!kinds.includes(window?.kind) || !Number.isFinite(window.start) || !Number.isFinite(window.end) ||
      !Number.isFinite(new Date(window.start).getTime()) || !Number.isFinite(new Date(window.end).getTime()) ||
      !Number.isInteger(window.duration) || window.duration < 5 || window.duration > 180 ||
      window.end <= window.start || !eventLocation(point?.latitude, point?.longitude)) throw Error('Invalid planned pause');
  const location = eventLocation(point.latitude, point.longitude);
  const selected = venue === undefined ? undefined : mealVenue(venue);
  if (selected && (window.kind !== 'meal' || selected.latitude !== location.latitude || selected.longitude !== location.longitude)) throw Error('Invalid meal location');
  const url = selected?.url ?? `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=17/${location.latitude}/${location.longitude}`;
  const names = selected?.names ?? (window.kind === 'meal' ? { ru: 'Обеденная пауза', en: 'Meal break' } : { ru: 'Пауза на отдых', en: 'Rest break' });
  return { id: JSON.stringify(['pause', url, window.kind, window.start, window.end]), type: 'pause', pauseKind: window.kind,
    title: selected?.name ?? names.en, names, url, location, start: window.start, end: window.end, duration: window.duration,
    hours: selected?.hours ?? null, venue: selected?.name ?? null, ...(selected && { mealVenue: selected }) };
}

const defaults = () => ({ enabled: false, kind: 'meal', from: '13:00', to: '15:00', duration: 45 });
export function pauseSettingsStore(cityId, storage) {
  const key = day => { nextDate(day); return `worth-a-stop.auto-plan.pause.v1.${cityId}.${day}`; };
  return {
    read(day) {
      const id = key(day);
      if (pauseMemory.has(id)) return { settings: structuredClone(pauseMemory.get(id)), saved: false };
      try {
        const raw = storage?.getItem(id), value = raw ? JSON.parse(raw) : defaults();
        if (!validPauseSettings(value)) throw Error('Invalid pause settings');
        return { settings: value, saved: Boolean(storage) };
      } catch { return { settings: defaults(), saved: false }; }
    },
    set(day, value) {
      if (!validPauseSettings(value)) throw Error('Invalid pause settings');
      const id = key(day), settings = structuredClone(value);
      try {
        if (!storage) throw Error('Storage unavailable');
        storage.setItem(id, JSON.stringify(settings)); pauseMemory.delete(id);
        return { settings, saved: true };
      } catch { pauseMemory.set(id, settings); return { settings: structuredClone(settings), saved: false }; }
    },
  };
}
