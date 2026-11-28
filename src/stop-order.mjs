import { arrivalTimes } from './arrival-times.mjs';
import { visitOpeningState } from './opening-hours.mjs';
import { walkingLegs } from './walking-legs.mjs';

const conflicts = new Set(['closed-arrival', 'closes-during', 'break']);

function assess(stops, legs, start, timeZone) {
  const times = arrivalTimes(stops, legs, start);
  const visits = stops.map((stop, i) => ({ stop, ...times[i],
    hours: stop.type === 'place' ? visitOpeningState(stop.hours, times[i].arrival, times[i].departure, timeZone).state : null }));
  const complete = legs.length === stops.length - 1 && legs.every((leg, i) =>
    leg.status === 'ok' && leg.from.id === stops[i].id && leg.to.id === stops[i + 1].id);
  return {
    visits, finish: times.at(-1)?.departure,
    walkingMinutes: complete ? legs.reduce((sum, leg) => sum + Math.ceil(leg.duration / 60), 0) : null,
    conflicts: visits.filter(visit => conflicts.has(visit.hours) || visit.late > 0).length,
    unknown: visits.filter(visit => visit.reason || visit.hours === 'unknown' || visit.hours === 'unknown-time').length,
  };
}

export async function compareStopOrder(stops, id, legs, start, timeZone, { signal, fetchResponse = fetch } = {}) {
  const index = stops.findIndex(stop => stop.id === id);
  const pair = stops.slice(index, index + 2);
  if (index < 0 || pair.length !== 2 || pair.some(stop => stop.type !== 'place')) return { reason: 'pair' };
  if (pair.some(stop => !Number.isInteger(stop.duration) || stop.duration < 1)) return { reason: 'duration' };
  const before = assess(stops, legs, start, timeZone);
  if (before.visits[index].arrival === null) return { reason: 'arrival' };
  const trial = [...stops];
  [trial[index], trial[index + 1]] = [trial[index + 1], trial[index]];
  const first = Math.max(0, index - 1);
  const changed = await walkingLegs(trial.slice(first, index + 3), { signal, fetchResponse });
  if (changed.some(leg => leg.status !== 'ok')) return { reason: 'route' };
  const trialLegs = [...legs];
  for (const [offset, leg] of changed.entries()) trialLegs[first + offset] = leg;
  const after = assess(trial, trialLegs, start, timeZone);
  const previous = new Map(before.visits.map(visit => [visit.stop.id, visit]));
  const applicable = after.visits.every(visit => {
    const original = previous.get(visit.stop.id);
    const moved = pair.some(stop => stop.id === visit.stop.id);
    if (!moved && original.arrival === visit.arrival && original.departure === visit.departure) return true;
    if (visit.stop.type === 'place') return visit.hours === 'fits';
    if (visit.stop.type === 'return') return visit.arrival !== null && !visit.reason && visit.late === 0;
    return visit.arrival !== null && Number.isFinite(visit.stop.start) && visit.late === 0 && visit.reason !== 'event-ended';
  });
  return { before, after, applicable };
}
