import OpeningHours from 'opening_hours';

export function localClock(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

export function localInstant(day, time, timeZone) {
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  try {
    const [year, month, date] = day.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const wall = Date.UTC(year, month - 1, date, hour, minute);
    if (new Date(wall).toISOString().slice(0, 10) !== day) return undefined;
    // Verify that the requested wall time exists in the destination's time zone.
    const offsets = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' });
    const dates = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
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
