import { loadPlaces } from './saved-places.mjs';
import { itineraryStop } from './itinerary.mjs';
import { walkingLegs } from './walking-legs.mjs';
import { arrivalTimes } from './arrival-times.mjs';
import { visitOpeningState } from './opening-hours.mjs';

export function planSignature(stops, start, legs) {
  return JSON.stringify([start, stops, legs.map(leg => [leg.from.id, leg.to.id, leg.status, leg.duration])]);
}

export async function findAlternatives(stops, id, legs, start, timeZone, { signal, fetchResponse = fetch, storage } = {}) {
  const index = stops.findIndex(stop => stop.id === id);
  const original = stops[index];
  if (!original || original.type !== 'place' || !original.location) return { reason: 'location', alternatives: [] };
  if (!Number.isInteger(original.duration) || original.duration < 1) return { reason: 'duration', alternatives: [] };
  const baseline = arrivalTimes(stops, legs, start);
  if (baseline[index].arrival === null) return { reason: 'arrival', alternatives: [] };
  const { places, stale } = await loadPlaces(original.location, { signal, fetchResponse, storage, scope: 'nearby' });
  const used = new Set(stops.map(stop => stop.url));
  const candidates = places.filter(place => !used.has(place.url) &&
    visitOpeningState(place.hours, baseline[index].arrival, baseline[index].departure, timeZone).state === 'fits')
    .sort((a, b) => a.km - b.km).slice(0, 3);
  const alternatives = [];
  let incomplete = false;
  for (const place of candidates) {
    signal?.throwIfAborted();
    const replacement = { ...itineraryStop(place, 'place'), duration: original.duration };
    const trial = stops.map((stop, i) => i === index ? replacement : stop);
    const first = Math.max(0, index - 1);
    const changed = await walkingLegs(trial.slice(first, index + 2), { signal, fetchResponse });
    if (changed.some(leg => leg.status !== 'ok')) { incomplete = true; continue; }
    const trialLegs = [...legs];
    for (const [offset, leg] of changed.entries()) trialLegs[first + offset] = leg;
    const times = arrivalTimes(trial, trialLegs, start);
    const visit = times[index];
    if (visitOpeningState(place.hours, visit.arrival, visit.departure, timeZone).state !== 'fits') continue;
    const nextEvent = trial.findIndex((stop, i) => i > index && stop.type === 'event');
    if (nextEvent >= 0 && (times[nextEvent].arrival === null || !Number.isFinite(trial[nextEvent].start) ||
        times[nextEvent].late > 0 || times[nextEvent].reason === 'event-ended')) continue;
    const destination = trial.findIndex(stop => stop.type === 'return');
    if (destination >= 0 && (times[destination].arrival === null || times[destination].late > 0)) continue;
    alternatives.push({ stop: replacement, km: place.km, arrival: visit.arrival, departure: visit.departure });
  }
  return { alternatives, stale, incomplete };
}
