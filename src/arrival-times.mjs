export function arrivalTimes(stops, legs, start) {
  let departure = Number.isFinite(start) ? start : null;
  return stops.map((stop, index) => {
    let arrival = departure;
    let reason = arrival === null ? 'previous-stop' : null;
    if (!index && arrival === null) reason = 'start-time';
    if (index) {
      const leg = legs[index - 1];
      if (!leg || leg.from.id !== stops[index - 1].id || leg.to.id !== stop.id ||
          leg.status !== 'ok' || !Number.isFinite(leg.duration) || leg.duration < 0) {
        arrival = null;
        reason = 'walking-leg';
      } else if (arrival !== null) {
        arrival += Math.ceil(leg.duration / 60) * 60000;
      }
    }
    let visitStart = arrival;
    let waiting = 0;
    let late = 0;
    departure = null;
    if (arrival !== null) {
      if (stop.type === 'origin') departure = arrival;
      else if (stop.type === 'place') {
        if (Number.isInteger(stop.duration) && stop.duration >= 1 && stop.duration <= 1440) {
          departure = arrival + stop.duration * 60000;
        } else reason = 'visit-duration';
      } else if (!Number.isFinite(stop.start)) {
        reason = 'event-time';
      } else {
        visitStart = Math.max(arrival, stop.start);
        waiting = Math.ceil(Math.max(0, stop.start - arrival) / 60000);
        late = Math.ceil(Math.max(0, arrival - stop.start) / 60000);
        if (!Number.isFinite(stop.end) || stop.end < stop.start) reason = 'event-end';
        else if (arrival >= stop.end) reason = 'event-ended';
        else departure = stop.end;
      }
    }
    return { arrival, visitStart, departure, waiting, late, reason };
  });
}
