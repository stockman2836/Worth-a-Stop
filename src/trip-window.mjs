import { localInstant } from './opening-hours.mjs';

export function checkTripWindow(day, startTime, endTime, zone, finish) {
  if (!endTime) return { state: 'unset' };
  if (!startTime) return { state: 'missing-start' };
  const start = localInstant(day, startTime, zone);
  const end = localInstant(day, endTime, zone);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { state: 'invalid-time' };
  if (end <= start) return { state: 'end-before-start' };
  if (!Number.isFinite(finish)) return { state: 'unknown-finish' };
  return finish > end ? { state: 'overrun', minutes: Math.ceil((finish - end) / 60000) } :
    { state: 'fits', minutes: Math.floor((end - finish) / 60000) };
}
