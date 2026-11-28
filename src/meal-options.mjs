import { validMealVenue } from './meal-venue.mjs';
import { plannedPause } from './planned-pause.mjs';
import { withTripEndpoints } from './return-trip.mjs';
import { walkingLegs } from './walking-legs.mjs';
import { arrivalTimes } from './arrival-times.mjs';
import { visitOpeningState } from './opening-hours.mjs';

const allowed = new Set(['fits', 'unknown']);
export async function findMealOptions(plan, { origin = null, returnTrip = null, timeZone },
  { signal, fetchResponse = fetch } = {}) {
  const index = plan.stops.findIndex(stop => stop.type === 'pause' && stop.pauseKind === 'meal');
  if (index < 0) return { options: [], state: 'not-needed' };
  const pause = plan.stops[index], baseline = plan.entries[index];
  const params = new URLSearchParams({ lat: pause.location.latitude, lon: pause.location.longitude });
  let data;
  try {
    const response = await fetchResponse('/api/meal-venues?' + params, {
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]),
    });
    if (!response.ok) throw Error('Meal source unavailable');
    data = await response.json();
    if (data.status === 'unavailable' || !Array.isArray(data.venues) || data.venues.length > 50) throw Object.assign(Error('Meal source unavailable'), { retryAt: data.retryAt });
  } catch (error) {
    signal?.throwIfAborted();
    return { options: [], state: 'unavailable', retryAt: error.retryAt ?? Date.now() + 60000 };
  }
  const valid = data.venues.filter(validMealVenue);
  if (data.venues.length && !valid.length) return { options: [], state: 'unavailable', retryAt: Date.now() + 60000 };
  const candidates = valid.map(venue => ({ venue,
    open: visitOpeningState(venue.hours, baseline.visitStart, baseline.departure, timeZone).state === 'fits',
    proximity: (venue.latitude - pause.location.latitude) ** 2 + ((venue.longitude - pause.location.longitude) * Math.cos(pause.location.latitude * Math.PI / 180)) ** 2 }))
    .sort((a, b) => Number(b.open) - Number(a.open) || a.proximity - b.proximity).slice(0, 4);
  const options = [];
  let incomplete = valid.length !== data.venues.length;
  for (const { venue } of candidates) {
    signal?.throwIfAborted();
    const replacement = plannedPause({ kind: 'meal', start: pause.start, end: pause.end, duration: pause.duration },
      { latitude: venue.latitude, longitude: venue.longitude }, venue);
    const stops = plan.stops.map((stop, i) => i === index ? replacement : stop);
    const route = withTripEndpoints(stops, origin, returnTrip, { deadline: plan.returnTrip?.deadline });
    const at = route.findIndex(stop => stop.id === replacement.id), first = Math.max(0, at - 1);
    const changed = await walkingLegs(route.slice(first, at + 2), { signal, fetchResponse });
    if (changed.some(leg => leg.status !== 'ok' || !Number.isFinite(leg.duration) || leg.duration < 0 ||
        !Number.isFinite(leg.distance) || leg.distance < 0)) { incomplete = true; continue; }
    if (changed.some(leg => Math.ceil(leg.duration / 60) > (plan.walkingLimit ?? 45))) continue;
    const legs = [...plan.legs];
    for (const [offset, leg] of changed.entries()) legs[first + offset] = leg;
    const times = arrivalTimes(route, legs, plan.start);
    if (times.some(time => time.reason || time.late > 0 || !Number.isFinite(time.departure))) continue;
    const finish = times.at(-1).departure;
    if (finish > plan.end || plan.returnTrip && finish > plan.returnTrip.deadline) continue;
    const visits = times.slice(origin ? 1 : 0, (origin ? 1 : 0) + stops.length);
    let rejected = false;
    const entries = stops.map((stop, i) => {
      const timing = visits[i];
      const check = stop.type === 'place' || stop.type === 'pause' && stop.mealVenue
        ? visitOpeningState(stop.hours, stop.type === 'pause' ? timing.visitStart : timing.arrival, timing.departure, timeZone).state : null;
      if (check && !allowed.has(check)) rejected = true;
      return { ...plan.entries[i], stop, ...timing,
        hours: stop.type === 'pause' ? 'pause' : check ?? 'event', ...(stop.mealVenue && { venueHours: check }),
        walkingMinutes: i + (origin ? 1 : 0) > 0 ? Math.ceil(legs[i + (origin ? 1 : 0) - 1].duration / 60) : 0 };
    });
    if (rejected) continue;
    const walkingMinutes = legs.reduce((sum, leg) => sum + Math.ceil(leg.duration / 60), 0);
    const suggestion = { ...plan, stops, entries, legs, finish, walkingMinutes, pause: replacement,
      unverifiedHours: entries.filter(entry => entry.hours === 'unknown' || entry.venueHours === 'unknown').length,
      ...(plan.returnTrip && { returnTrip: { ...plan.returnTrip, arrival: finish, leg: legs.at(-1) } }) };
    options.push({ venue, plan: suggestion, hours: entries[index].venueHours,
      extraWalkingMinutes: Math.max(0, walkingMinutes - plan.walkingMinutes), walkingDifference: walkingMinutes - plan.walkingMinutes });
  }
  options.sort((a, b) => Number(b.hours === 'fits') - Number(a.hours === 'fits') || a.extraWalkingMinutes - b.extraWalkingMinutes);
  const least = options.length ? Math.min(...options.map(option => option.extraWalkingMinutes)) : null;
  return { options: options.slice(0, 3).map(option => ({ ...option, onWay: option.extraWalkingMinutes <= 5,
    leastDetour: option.extraWalkingMinutes === least })), state: options.length ? 'ready' : data.venues.length ? 'no-fit' : 'empty', incomplete,
    ...(incomplete && { retryAt: Date.now() + 60000 }), checkedAt: data.checkedAt };
}
