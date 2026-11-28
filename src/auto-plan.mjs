import { itineraryStop } from './itinerary.mjs';
import { walkingLegs } from './walking-legs.mjs';
import { arrivalTimes } from './arrival-times.mjs';
import { localInstant, visitOpeningState } from './opening-hours.mjs';
import { withStartingPoint } from './starting-point.mjs';
import { eventLocation } from './event-location.mjs';
import { interestIds, normalizeInterests, matchingInterests, shortlistPlaces } from './travel-interests.mjs';
import { validReturnTrip, returnStop } from './return-trip.mjs';

const paces = { relaxed: { factor: 1.3, stops: 4, walk: 25 }, balanced: { factor: 1, stops: 6, walk: 35 }, active: { factor: .8, stops: 8, walk: 45 } };
const visits = { museum: 75, gallery: 50, cathedral: 40, castle: 60, park: 35, garden: 35, viewpoint: 20, marketplace: 30 };

function distance(a, b) {
  if (!a || !b) return 0;
  const rad = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * rad, lon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export async function generateDayPlan({ day, startTime, endTime, timeZone, pace = 'balanced', interests = [], origin = null, returnTrip = null, places = [], events = [] },
  { signal, fetchResponse = fetch, onProgress = () => {} } = {}) {
  const start = timeZone && localInstant(day, startTime, timeZone);
  const end = timeZone && localInstant(day, endTime, timeZone);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Object.hasOwn(paces, pace) ||
      !Array.isArray(interests) || interests.some(id => !interestIds.includes(id)) ||
      !validReturnTrip(returnTrip) || origin !== null && !eventLocation(origin?.latitude, origin?.longitude)) throw Error('Invalid planning options');
  const returnDeadline = returnTrip ? end - returnTrip.bufferMinutes * 60000 : end;
  if (returnDeadline <= start) throw Error('Invalid planning options');
  const destination = returnTrip && returnStop(returnTrip.point, 'Return', returnDeadline);
  signal?.throwIfAborted();
  const profile = paces[pace];
  interests = normalizeInterests(interests);
  const candidates = [], ids = new Set();
  let skippedEvents = 0;
  for (const [items, type] of [[shortlistPlaces(places, interests, origin), 'place'], [events, 'event']]) {
    for (const item of items) {
      try {
        const stop = itineraryStop(item, type);
        if (!stop.location) { if (type === 'event') skippedEvents++; continue; }
        if (ids.has(stop.id)) continue;
        if (type === 'event' && ([3, 4, 5, 6].includes(item.status) || !Number.isFinite(stop.start) ||
            !Number.isFinite(stop.end) || stop.end <= stop.start || stop.start < start || stop.end > end)) { skippedEvents++; continue; }
        if (type === 'place') stop.duration = Math.round(((visits[item.category] || 40) * profile.factor) / 5) * 5;
        candidates.push({ stop, category: item.category || type, interests: type === 'place' ? matchingInterests(item.category, interests) : [], order: candidates.length });
        ids.add(stop.id);
      } catch { if (type === 'event') skippedEvents++; }
    }
  }
  const pool = [...candidates.filter(c => c.stop.type === 'place'), ...candidates.filter(c => c.stop.type === 'event')
    .sort((a,b) => a.stop.start - b.stop.start).slice(0, 12)];
  const stops = [], entries = [], legs = [], categories = new Set(), routes = new Map();
  let checks = 0, failedRoutes = 0, limited = false, finalReturn;
  async function legTo(from, to) {
    const key = JSON.stringify([from.location, to.location]);
    if (!routes.has(key)) {
      if (checks >= 24) { limited = true; return null; }
      checks++;
      routes.set(key, walkingLegs([from, to], { signal, fetchResponse }).then(([leg]) => {
        if (leg.status !== 'ok' || !Number.isFinite(leg.duration) || leg.duration < 0 || !Number.isFinite(leg.distance) || leg.distance < 0) {
          failedRoutes++;
          return null;
        }
        return leg;
      }));
    }
    const cached = await routes.get(key);
    return cached && { ...cached, from, to };
  }
  async function evaluate(candidate) {
    const trial = withStartingPoint([...stops, candidate.stop], origin, 'Start');
    const from = trial.at(-2);
    const leg = from ? await legTo(from, candidate.stop) : null;
    if (from && !leg || leg && Math.ceil(leg.duration / 60) > profile.walk) return null;
    signal?.throwIfAborted();
    const trialLegs = leg ? [...legs, leg] : legs;
    const timing = arrivalTimes(trial, trialLegs, start).at(-1);
    if (timing.reason || timing.late > 0 || timing.departure > end || timing.waiting > 60) return null;
    const hours = candidate.stop.type === 'place' ? visitOpeningState(candidate.stop.hours, timing.arrival, timing.departure, timeZone).state : 'event';
    if (!['fits', 'unknown', 'event'].includes(hours)) return null;
    let back;
    if (destination) {
      if (timing.departure > returnDeadline) return null;
      const returnLeg = await legTo(candidate.stop, destination);
      signal?.throwIfAborted();
      if (!returnLeg || Math.ceil(returnLeg.duration / 60) > profile.walk) return null;
      const arrival = timing.departure + Math.ceil(returnLeg.duration / 60) * 60000;
      if (arrival > returnDeadline) return null;
      back = { stop: destination, leg: returnLeg, arrival, deadline: returnDeadline, bufferMinutes: returnTrip.bufferMinutes };
    }
    const walking = leg ? Math.ceil(leg.duration / 60) : 0;
    const variety = !categories.has(candidate.category);
    const score = (hours === 'fits' ? 12 : hours === 'event' ? 24 : 0) + (candidate.interests.length ? 12 : 0) + (variety ? 5 : 0) - walking * .2 - timing.waiting * .15 - candidate.order * .01;
    return { candidate, leg, timing, hours, walking, variety, score, back };
  }
  while (stops.length < profile.stops && pool.length) {
    signal?.throwIfAborted();
    const point = stops.at(-1)?.location || origin;
    const now = entries.at(-1)?.departure || start;
    const ranked = pool.filter(c => c.stop.type !== 'event' || c.stop.start >= now).map(c => ({ candidate: c,
      priority: (c.stop.type === 'event' ? 18 - (c.stop.start - now) / 600000 :
        visitOpeningState(c.stop.hours, now, now + c.stop.duration * 60000, timeZone).state === 'fits' ? 10 : 0) -
        distance(point, c.stop.location) * 2 + (c.interests.length ? 12 : 0) + (!categories.has(c.category) ? 2 : 0) }))
      .sort((a,b) => b.priority - a.priority || a.candidate.order - b.candidate.order).map(c => c.candidate);
    let chosen;
    for (let offset = 0; offset < ranked.length && !chosen; offset += 4) {
      const options = (await Promise.all(ranked.slice(offset, offset + 4).map(evaluate))).filter(Boolean);
      chosen = options.sort((a,b) => b.score - a.score)[0];
    }
    if (!chosen) break;
    stops.push(chosen.candidate.stop);
    if (chosen.leg) legs.push(chosen.leg);
    finalReturn = chosen.back;
    entries.push({ stop: chosen.candidate.stop, ...chosen.timing, hours: chosen.hours, walkingMinutes: chosen.walking, variety: chosen.variety, interests: chosen.candidate.interests });
    categories.add(chosen.candidate.category);
    pool.splice(pool.indexOf(chosen.candidate), 1);
    onProgress({ stops: stops.length, routeChecks: checks });
  }
  signal?.throwIfAborted();
  const routeLegs = finalReturn ? [...legs, finalReturn.leg] : legs;
  return { stops, entries, legs: routeLegs, start, end, finish: finalReturn?.arrival ?? entries.at(-1)?.departure ?? start,
    ...(returnTrip && { returnTrip: finalReturn ?? null }),
    walkingMinutes: routeLegs.reduce((sum, leg) => sum + Math.ceil(leg.duration / 60), 0),
    interests, failedRoutes, limited, skippedEvents, unverifiedHours: entries.filter(entry => entry.hours === 'unknown').length };
}
