import { findDayEvents, nextDate, todayIn } from './day-agenda.mjs';

const copy = {
  ru: {
    today: 'Сегодня', tomorrow: 'Завтра', date: 'Дата поездки', loading: 'Ищем события…',
    empty: 'У OpenAgenda нет событий на этот день', partial: 'Часть расписания не удалось прочитать',
    error: 'Не удалось загрузить расписание OpenAgenda.', retry: 'Попробовать снова', more: 'Ещё события',
    count: n => `Событий в афише — ${n}`, area: km => `До ${km} км от центра`,
    unknown: 'Время не указано', allDay: 'Весь день', until: t => `До ${t}`, from: t => `С ${t}`,
    venue: 'Площадка не указана', status: { 2: 'Новое расписание', 3: 'Онлайн', 5: 'Мест нет' },
  },
  en: {
    today: 'Today', tomorrow: 'Tomorrow', date: 'Trip date', loading: 'Looking up events…',
    empty: 'OpenAgenda lists no events for this day', partial: 'Some listings could not be read',
    error: 'Could not load the OpenAgenda schedule.', retry: 'Try again', more: 'More events',
    count: n => `${n} ${n === 1 ? 'event' : 'events'} listed`, area: km => `Within ${km} km of the centre`,
    unknown: 'Time unspecified', allDay: 'All day', until: t => `Until ${t}`, from: t => `From ${t}`,
    venue: 'Venue unspecified', status: { 2: 'Rescheduled', 3: 'Online', 5: 'Sold out' },
  },
};

function timeLabel(event, clock, text) {
  if (event.start === null) return text.unknown;
  if (event.coversDay) return text.allDay;
  if (event.startsEarlier) return text.until(clock.format(event.end));
  if (event.endsLater) return text.from(clock.format(event.start));
  const start = clock.format(event.start);
  return event.end === null ? start : `${start}–${clock.format(event.end)}`;
}

export function dayPanel(city, language, initialDate, searchSignal) {
  const view = document.querySelector('#day-agenda').content.firstElementChild.cloneNode(true);
  const input = view.querySelector('input');
  const [today, tomorrow] = view.querySelectorAll('[data-day]');
  const message = view.querySelector('.day-status');
  const list = view.querySelector('ul');
  const more = view.querySelector('.more-events');
  const retry = view.querySelector('.retry-events');
  const text = copy[language];
  const zone = city.timezone || 'UTC';
  const clock = new Intl.DateTimeFormat(language, { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  let controller;
  let events = [];

  today.textContent = text.today;
  tomorrow.textContent = text.tomorrow;
  view.querySelector('label span').textContent = text.date;
  more.textContent = text.more;
  retry.textContent = text.retry;
  input.value = initialDate || todayIn(zone);

  function showMore() {
    const offset = list.childElementCount;
    for (const event of events.slice(offset, offset + 20)) {
      const item = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = timeLabel(event, clock, text);
      const info = document.createElement('div');
      const link = document.createElement('a');
      link.href = event.url;
      link.textContent = event.title;
      const venue = document.createElement('span');
      venue.className = 'event-venue';
      venue.textContent = [event.venue || text.venue, text.status[event.status]].filter(Boolean).join(' · ');
      info.append(link, venue);
      item.append(time, info);
      list.append(item);
    }
    more.hidden = list.childElementCount >= events.length;
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, searchSignal]);
    const day = input.value;
    const localToday = todayIn(zone);
    today.setAttribute('aria-pressed', String(day === localToday));
    tomorrow.setAttribute('aria-pressed', String(day === nextDate(localToday)));
    list.replaceChildren();
    more.hidden = retry.hidden = true;
    message.textContent = '';
    if (!day || !input.validity.valid) return;
    message.textContent = text.loading;
    try {
      const result = await findDayEvents(city, day, { signal });
      if (signal.aborted) return;
      events = result.events;
      const summary = events.length ? text.count(events.length) : '';
      message.textContent = [summary || (!result.incomplete && text.empty), result.incomplete && text.partial,
        text.area(result.radiusKm), zone].filter(Boolean).join(' · ');
      retry.hidden = !result.incomplete;
      showMore();
    } catch {
      if (signal.aborted) return;
      message.textContent = text.error;
      retry.hidden = false;
    }
  }
  today.addEventListener('click', () => { input.value = todayIn(zone); load(); });
  tomorrow.addEventListener('click', () => { input.value = nextDate(todayIn(zone)); load(); });
  input.addEventListener('change', load);
  more.addEventListener('click', showMore);
  retry.addEventListener('click', load);
  load();
  return view;
}
