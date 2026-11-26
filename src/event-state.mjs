export function eventState(event, instant) {
  if (!Number.isFinite(instant) || !Number.isFinite(event.start)) return 'unknown';
  if (instant < event.start) return event.start - instant <= 3600000 ? 'soon' : 'upcoming';
  if (!Number.isFinite(event.end)) return 'unknown';
  return instant < event.end ? 'ongoing' : 'ended';
}
