import { arrivalTimes } from './arrival-times.mjs';
import { visitOpeningState } from './opening-hours.mjs';
import { withStartingPoint } from './starting-point.mjs';
import { plannedPause } from './planned-pause.mjs';

// First confirm every required visit, then insert optional visits into the gaps.
// Both stages use the same full schedule check; neither can discard an anchor.
export async function planRequiredVisits({ candidates, start, end, timeZone, origin, destination, returnDeadline,
  returnTrip, pauseOptions, profile, interests }, { legTo, signal, onProgress }) {
  const required = candidates.filter(candidate => candidate.stop.required);
  const optional = candidates.filter(candidate => !candidate.stop.required);
  let attempts = 0, limited = false, conflict;
  const hoursCache = new Map();
  function hoursFor(stop, timing) {
    const key = JSON.stringify([stop.hours, timing.arrival, timing.departure]);
    if (!hoursCache.has(key)) hoursCache.set(key, visitOpeningState(stop.hours, timing.arrival, timing.departure, timeZone).state);
    return hoursCache.get(key);
  }
  const fail = (code, stop) => ({ conflict: { code, ...(stop && { stop }) } });
  async function check(stops) {
    const route = [...withStartingPoint(stops, origin, 'Start'), ...(destination ? [destination] : [])];
    const legs = [];
    for (let i = 1; i < route.length; i++) {
      const leg = await legTo(route[i - 1], route[i]);
      signal?.throwIfAborted();
      if (!leg) return fail('route', route[i]);
      if (Math.ceil(leg.duration / 60) > profile.walk) return fail('walk-limit', route[i]);
      legs.push(leg);
    }
    const times = arrivalTimes(route, legs, start);
    const entries = [], categories = new Set();
    for (const [i, stop] of route.entries()) {
      const timing = times[i];
      if (stop.type === 'return') {
        if (timing.late || timing.reason) return fail('return', stop);
        continue;
      }
      if (stop.type === 'origin') continue;
      if (timing.reason || timing.late || timing.departure > end) return fail(stop.type === 'pause' ? 'pause' : 'time', stop);
      if (stop.type === 'event' && timing.waiting > 60) return fail('time', stop);
      const hours = stop.type === 'place' ? hoursFor(stop, timing) : stop.type === 'pause' ? 'pause' : 'event';
      if (!['fits', 'unknown', 'pause', 'event'].includes(hours)) return fail(hours, stop);
      const candidate = candidates.find(candidate => candidate.stop.id === stop.id);
      const category = candidate?.category;
      entries.push({ stop, ...timing, hours, walkingMinutes: i ? Math.ceil(legs[i - 1].duration / 60) : 0,
        variety: stop.type === 'place' && !categories.has(category), interests: candidate?.interests ?? [] });
      if (category) categories.add(category);
    }
    const finish = times.at(-1).departure;
    if (finish > returnDeadline) return fail(destination ? 'return' : 'time', destination);
    return { stops, entries, legs, start, end, finish, interests, walkingLimit: profile.walk,
      walkingMinutes: legs.reduce((sum, leg) => sum + Math.ceil(leg.duration / 60), 0),
      unverifiedHours: entries.filter(entry => entry.hours === 'unknown').length,
      ...(pauseOptions && { pause: stops.find(stop => stop.type === 'pause') }),
      ...(returnTrip && { returnTrip: { stop: destination, arrival: finish, leg: legs.at(-1),
        deadline: returnDeadline, bufferMinutes: returnTrip.bufferMinutes } }) };
  }
  async function schedule(sequence) {
    signal?.throwIfAborted();
    if (++attempts > 120) { limited = true; return fail('search-limit'); }
    const stops = sequence.map(candidate => candidate.stop);
    if (!pauseOptions) return check(stops);
    let failure;
    // Later break placements avoid waiting away a whole morning at the start.
    for (let at = stops.length; at >= 0; at--) {
      const point = stops[at - 1]?.location ?? origin ?? stops[0].location;
      const pause = plannedPause(pauseOptions, point);
      const result = await check([...stops.slice(0, at), pause, ...stops.slice(at)]);
      if (!result.conflict) return result;
      failure = result;
    }
    return failure;
  }
  const missing = required.find(candidate => !candidate.stop.location);
  if (missing) return { requiredConflict: { code: 'location', stop: missing.stop }, stops: [], entries: [], limited };
  async function seed(sequence, remaining) {
    for (const candidate of remaining) {
      if (limited) break;
      const next = [...sequence, candidate];
      const result = await schedule(next);
      if (result.conflict) { conflict = result.conflict; continue; }
      if (remaining.length === 1) return { sequence: next, result };
      const complete = await seed(next, remaining.filter(item => item !== candidate));
      if (complete) return complete;
    }
  }
  const initial = await seed([], required);
  if (!initial) return { requiredConflict: limited ? { code: 'search-limit' } : conflict, stops: [], entries: [], limited };
  let { sequence, result } = initial;
  onProgress({ stops: sequence.length });
  while (!limited && sequence.length < Math.max(profile.stops, required.length)) {
    let best;
    for (const candidate of optional.filter(candidate => !sequence.includes(candidate))) {
      for (let at = 0; at <= sequence.length && !limited; at++) {
        const trial = [...sequence.slice(0, at), candidate, ...sequence.slice(at)];
        const plan = await schedule(trial);
        if (plan.conflict) continue;
        const entry = plan.entries.find(entry => entry.stop.id === candidate.stop.id);
        const score = (entry.hours === 'fits' ? 12 : entry.hours === 'event' ? 24 : 0) +
          (candidate.interests.length ? 12 : 0) + (entry.variety ? 5 : 0) - plan.walkingMinutes * .2 -
          (plan.finish - start) / 60000 * .05 - candidate.order * .01;
        if (!best || score > best.score) best = { sequence: trial, result: plan, score };
      }
      // Prefer the first viable ranked candidate, choosing its best insertion.
      if (best || limited) break;
    }
    if (!best) break;
    ({ sequence, result } = best);
    onProgress({ stops: sequence.length });
  }
  return { ...result, limited };
}
