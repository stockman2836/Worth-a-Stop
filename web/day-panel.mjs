import { findDayEvents, mergeListings, officialOnDay, nextDate, todayIn } from './day-agenda.mjs';

const copy = {
  ru: {
    today: 'Сегодня', tomorrow: 'Завтра', date: 'Дата поездки', loading: 'Ищем события…',
    empty: 'В проверенных афишах нет событий на этот день', partial: 'Показаны результаты из доступной части афиш',
    official: 'Городская афиша', waiting: 'Проверяем остальные источники…',
    showMap: 'Показать на карте', noLocation: 'Точное расположение не указано',
    error: 'Не удалось загрузить расписания.', retry: 'Попробовать снова', more: 'Ещё события',
    count: n => `Событий в афише — ${n}`, area: km => `До ${km} км от центра`,
    unknown: 'Время не указано', allDay: 'Весь день', until: t => `До ${t}`, from: t => `С ${t}`,
    venue: 'Площадка не указана', status: { 2: 'Новое расписание', 3: 'Онлайн', 5: 'Мест нет' },
  },
  en: {
    today: 'Today', tomorrow: 'Tomorrow', date: 'Trip date', loading: 'Looking up events…',
    empty: 'No events found for this day in the listings checked', partial: 'Only part of the listings could be checked',
    official: 'City calendar', waiting: 'Checking the remaining sources…',
    showMap: 'Show on map', noLocation: 'Exact location unspecified',
    error: 'Could not load the schedules.', retry: 'Try again', more: 'More events',
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

export function dayPanel(city, language, initialDate, searchSignal, eventMap) {
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
  input.value = initialDate || eventMap.getDay() || todayIn(zone);

  function showMore(count = 20) {
    const visibleEvents = events.filter(eventMap.eventVisible);
    const offset = list.childElementCount;
    for (const event of visibleEvents.slice(offset, offset + count)) {
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
      venue.textContent = [event.venue || text.venue, text.status[event.status], event.begin && text.official].filter(Boolean).join(' · ');
      info.append(link, venue);
      const phase = document.createElement('span');
      phase.className = 'event-state';
      const state = eventMap.eventInfo(event);
      phase.textContent = state.label;
      phase.dataset.state = state.state;
      info.append(phase);
      if (event.location) {
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'show-event';
        show.textContent = text.showMap;
        show.addEventListener('click', () => eventMap.selectEvent(event));
        info.append(show);
      } else {
        const unknown = document.createElement('span');
        unknown.className = 'event-venue';
        unknown.textContent = text.noLocation;
        info.append(unknown);
      }
      item.append(time, info);
      list.append(item);
    }
    more.hidden = list.childElementCount >= visibleEvents.length;
  }
  function renderEvents() {
    const count = Math.max(20, list.childElementCount);
    list.replaceChildren();
    showMore(count);
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, searchSignal]);
    const day = input.value;
    events = [];
    eventMap.setDay(day);
    const localToday = todayIn(zone);
    today.setAttribute('aria-pressed', String(day === localToday));
    tomorrow.setAttribute('aria-pressed', String(day === nextDate(localToday)));
    list.replaceChildren();
    eventMap.setEvents([]);
    more.hidden = retry.hidden = true;
    message.textContent = '';
    if (!day || !input.validity.valid) return;
    message.textContent = text.loading;
    const results = [];
    let finished = 0;
    async function receive(request) {
      try { results.push(await request); } catch { /* The other source can still provide listings. */ }
      if (signal.aborted) return;
      finished++;
      events = mergeListings(results.flatMap(r => r.events));
      for (const event of events) event.mapLabel = timeLabel(event, clock, text);
      eventMap.setEvents(events);
      const incomplete = results.some(r => r.incomplete) || finished > results.length;
      const area = results.find(r => r.radiusKm)?.radiusKm;
      message.textContent = [events.length ? text.count(events.length) : finished === 2 && results.length && text.empty,
        finished < 2 && text.waiting, !results.length && finished === 2 ? text.error : incomplete && text.partial,
        area && 'OpenAgenda · ' + text.area(area), zone].filter(Boolean).join(' · ');
      const visibleCount = Math.max(20, list.childElementCount);
      list.replaceChildren();
      retry.hidden = !incomplete;
      showMore(visibleCount);
    }
    receive(findDayEvents(city, day, { signal }));
    receive(fetch('/api/official-events/' + city.id, { signal }).then(async response => {
      if (!response.ok) throw Error('City calendar unavailable');
      return officialOnDay(await response.json(), day, zone);
    }));
  }
  today.addEventListener('click', () => { input.value = todayIn(zone); load(); });
  tomorrow.addEventListener('click', () => { input.value = nextDate(todayIn(zone)); load(); });
  input.addEventListener('change', load);
  more.addEventListener('click', () => showMore());
  retry.addEventListener('click', load);
  eventMap.onDayChange(value => { input.value = value; load(); });
  eventMap.onTimeChange(renderEvents);
  load();
  return view;
}
