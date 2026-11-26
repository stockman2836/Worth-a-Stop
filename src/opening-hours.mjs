import OpeningHours from 'opening_hours';

const formatters = new Map();
function formats(timeZone) {
  if (!formatters.has(timeZone)) {
    if (formatters.size >= 30) formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone, {
      clock: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      dates: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
      offsets: new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }),
    });
  }
  return formatters.get(timeZone);
}

export function localClock(timeZone, now = new Date()) {
  return formats(timeZone).clock.format(now);
}

export function localInstant(day, time, timeZone) {
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  try {
    const [year, month, date] = day.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const wall = Date.UTC(year, month - 1, date, hour, minute);
    if (new Date(wall).toISOString().slice(0, 10) !== day) return undefined;
    // Verify that the requested wall time exists in the destination's time zone.
    const { offsets, dates } = formats(timeZone);
    const candidates = new Set();
    for (const delta of [-86400000, 0, 86400000]) {
      const zone = offsets.formatToParts(wall + delta).find(part => part.type === 'timeZoneName').value.slice(3) || '+00:00';
      const instant = Date.parse(day + 'T' + time + zone);
      if (dates.format(instant) === day && localClock(timeZone, new Date(instant)) === time) candidates.add(instant);
    }
    return candidates.size === 1 ? [...candidates][0] : undefined;
  } catch { return undefined; }
}

export function openingState(hours, day, time, timeZone) {
  if (typeof hours !== 'string' || !hours.trim() || hours.length > 2000 ||
      /\b(PH|SH|sunrise|sunset|dawn|dusk|easter)\b/.test(hours)) return 'unknown';
  if (localInstant(day, time, timeZone) === undefined) return 'unknown';
  try {
    const [year, month, date] = day.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    // The parser evaluates native Date fields, so pass the selected civil fields explicitly.
    const local = new Date(year, month - 1, date, hour, minute);
    if (local.getHours() !== hour || local.getMinutes() !== minute) return 'unknown';
    const schedule = new OpeningHours(hours);
    if (schedule.getUnknown(local)) return 'unknown';
    return schedule.getState(local) ? 'open' : 'closed';
  } catch {
    return 'unknown';
  }
}

export function visitOpeningState(hours, arrival, departure, timeZone) {
  if (!Number.isFinite(arrival) || !Number.isFinite(departure) || departure <= arrival ||
      departure - arrival > 86400000) return { state: 'unknown-time' };
  if (typeof hours !== 'string' || !hours.trim() || hours.length > 2000 ||
      /\b(PH|SH|sunrise|sunset|dawn|dusk|easter)\b/.test(hours) || !timeZone) return { state: 'unknown' };
  try {
    const schedule = new OpeningHours(hours);
    const civil = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    function at(instant) {
      const parts = Object.fromEntries(civil.formatToParts(instant).map(part => [part.type, part.value]));
      const day = parts.year + '-' + parts.month + '-' + parts.day;
      if (localInstant(day, parts.hour + ':' + parts.minute, timeZone) === undefined) return 'unknown';
      const date = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      if (date.getHours() !== Number(parts.hour) || date.getMinutes() !== Number(parts.minute) ||
          date.getDate() !== Number(parts.day) || schedule.getUnknown(date)) return 'unknown';
      return schedule.getState(date) ? 'open' : 'closed';
    }
    const initial = at(arrival);
    if (initial === 'unknown') return { state: 'unknown' };
    if (initial === 'closed') return { state: 'closed-arrival' };
    let closedAt;
    // opening_hours has minute precision. Inspect every boundary in [arrival, departure).
    for (let instant = Math.floor(arrival / 60000) * 60000 + 60000; instant < departure; instant += 60000) {
      const state = at(instant);
      if (state === 'unknown') return { state: 'unknown' };
      if (state === 'closed' && closedAt === undefined) closedAt = instant;
      if (state === 'open' && closedAt !== undefined) {
        return { state: 'break', closedAt, reopensAt: instant, availableMinutes: Math.floor((closedAt - arrival) / 60000) };
      }
    }
    if (closedAt !== undefined) return { state: 'closes-during', closedAt, availableMinutes: Math.floor((closedAt - arrival) / 60000) };
    return { state: 'fits' };
  } catch { return { state: 'unknown' }; }
}
