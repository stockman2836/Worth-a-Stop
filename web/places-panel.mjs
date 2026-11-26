import { loadPlaces } from './saved-places.mjs';
import { placesMap } from './places-map.mjs';
import { openingState, localClock, localInstant } from './opening-hours.mjs';
import { eventState } from './event-state.mjs';
import { todayIn } from './day-agenda.mjs';

const copy = {
  ru: { title: 'Места рядом', loading: 'Ищем места…', empty: 'В радиусе 2 км подходящих мест не найдено.',
    scope: 'До 2 км от центра по прямой', error: 'Не удалось загрузить места.', retry: 'Попробовать снова',
    hours: 'Часы работы', museum: 'Музей', gallery: 'Галерея', viewpoint: 'Смотровая площадка',
    park: 'Парк', garden: 'Сад', marketplace: 'Рынок', map: 'Карта мест',
    zoomIn: 'Приблизить', zoomOut: 'Отдалить', unknown: 'Часы работы не указаны',
    tilesError: 'Не удалось загрузить часть карты.', saved: 'Источник недоступен. Показана сохранённая подборка от',
    source: 'Открыть в OpenStreetMap', legend: 'Круги — места · ромбы — события выбранного дня',
    date: 'Дата проверки', time: 'Местное время', open: 'Открыто', closed: 'Закрыто', uncertain: 'Время работы неизвестно',
    origin: 'Точка старта', pickHint: 'Нажмите на карту для выбора старта. С клавиатуры перемещайте карту стрелками и нажмите Enter. Escape отменяет выбор.', cancelPick: 'Отменить выбор старта',
    timeline: 'Время на карте', available: 'Доступно сейчас', ongoing: 'Идёт', soon: 'Начнётся в течение часа',
    upcoming: 'Позже', ended: 'Завершилось', eventUnknown: 'Время события неизвестно',
    filtered: (places, events) => `Доступно мест — ${places}, событий — ${events}. Неизвестное расписание скрыто.` },
  en: { title: 'Nearby places', loading: 'Looking for places…', empty: 'No matching places within 2 km.',
    scope: 'Within 2 km of the centre, straight-line distance', error: 'Could not load places.', retry: 'Try again',
    hours: 'Opening hours', museum: 'Museum', gallery: 'Gallery', viewpoint: 'Viewpoint',
    park: 'Park', garden: 'Garden', marketplace: 'Market', map: 'Map of places',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', unknown: 'Opening hours unspecified',
    tilesError: 'Some map tiles could not be loaded.', saved: 'Source unavailable. Showing places saved on',
    source: 'Open in OpenStreetMap', legend: 'Circles — places · diamonds — events for the selected day',
    date: 'Check date', time: 'Local time', open: 'Open', closed: 'Closed', uncertain: 'Opening hours unknown',
    origin: 'Starting point', pickHint: 'Click the map to choose a start. With the keyboard, pan using arrow keys and press Enter. Escape cancels.', cancelPick: 'Cancel start selection',
    timeline: 'Map time', available: 'Available now', ongoing: 'Ongoing', soon: 'Starts within an hour',
    upcoming: 'Later', ended: 'Ended', eventUnknown: 'Event time unknown',
    filtered: (places, events) => `Available places — ${places}, events — ${events}. Unknown schedules are hidden.` },
};

export function placesPanel(city, language, signal, open, selection) {
  const text = copy[language];
  const details = document.createElement('details');
  details.dataset.placesId = city.id;
  const summary = document.createElement('summary');
  summary.textContent = text.title;
  summary.setAttribute('aria-label', text.title + ' · ' + city.name);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'places';
  const mapBox = document.createElement('div');
  mapBox.className = 'places-map';
  mapBox.setAttribute('role', 'region');
  mapBox.setAttribute('aria-label', text.map + ' · ' + city.name);
  mapBox.hidden = true;
  let map;
  let events = [];
  let selectedEvent;
  let alternative;
  let route = { legs: [], stops: [] };
  let origin = null;
  let startSelection;
  function cancelStartSelection() {
    const action = startSelection;
    startSelection = undefined;
    pickerBox.hidden = true;
    map?.cancelStart();
    action?.cancel();
  }
  function configureOrigin() {
    map.setOrigin(origin, text.origin);
    if (startSelection) map.pickStart(point => {
      const action = startSelection;
      startSelection = undefined;
      pickerBox.hidden = true;
      action?.pick(point);
    }, cancelStartSelection);
  }
  const dayListeners = new Set();
  let itinerary;
  let onTimeChange;
  let loadedPlaces = [];
  const zone = city.timezone || 'UTC';
  const controls = document.createElement('div');
  controls.className = 'day-controls place-time-controls';
  function field(type, labelText, value) {
    const label = document.createElement('label');
    label.className = 'day-picker';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    input.required = true;
    label.append(caption, input);
    controls.append(label);
    return input;
  }
  const day = field('date', text.date, selection?.date ?? todayIn(zone));
  const clock = field('time', text.time, selection?.time ?? localClock(zone));
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'time-slider';
  slider.min = '0';
  slider.max = '1439';
  slider.step = '1';
  slider.setAttribute('aria-label', text.timeline);
  const filterLabel = document.createElement('label');
  filterLabel.className = 'availability-filter';
  const filter = document.createElement('input');
  filter.type = 'checkbox';
  filter.checked = selection?.available ?? false;
  filterLabel.append(filter, text.available);
  const filterMessage = document.createElement('p');
  filterMessage.className = 'filter-message';
  filterMessage.setAttribute('role', 'status');
  const zoneLabel = document.createElement('span');
  zoneLabel.textContent = zone;
  controls.append(zoneLabel);
  let selectedInstant;
  function eventInfo(event) {
    const state = eventState(event, selectedInstant);
    return { state, label: state === 'unknown' ? text.eventUnknown : text[state],
      available: state === 'ongoing' && event.status !== 5 };
  }
  function updateHours() {
    selectedInstant = city.timezone ? localInstant(day.value, clock.value, zone) : undefined;
    slider.disabled = !clock.value;
    if (clock.value) {
      const [hour, minute] = clock.value.split(':').map(Number);
      slider.value = hour * 60 + minute;
      slider.setAttribute('aria-valuetext', clock.value + ' · ' + zone);
    }
    const states = loadedPlaces.map(place => {
      const state = city.timezone ? openingState(place.hours, day.value, clock.value, zone) : 'unknown';
      return { state, label: state === 'unknown' ? text.uncertain : text[state] };
    });
    for (const [i, item] of [...list.children].entries()) {
      const badge = item.querySelector('.opening-state');
      badge.textContent = states[i].label;
      badge.dataset.state = states[i].state;
      item.hidden = filter.checked && states[i].state !== 'open';
    }
    map?.setStates(states, filter.checked);
    map?.setEventStates(new Map(events.map(event => [event, eventInfo(event)])), filter.checked);
    filterMessage.textContent = filter.checked
      ? text.filtered(states.filter(info => info.state === 'open').length, events.filter(event => eventInfo(event).available).length) : '';
    onTimeChange?.();
  }
  function setDay(value) {
    day.value = value;
    updateHours();
    for (const listener of dayListeners) listener(value);
  }
  day.addEventListener('change', () => setDay(day.value));
  clock.addEventListener('input', updateHours);
  clock.addEventListener('change', updateHours);
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    clock.value = String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
    updateHours();
  });
  filter.addEventListener('change', updateHours);
  function ensureMap() {
    if (map || !details.open || signal.aborted) return;
    mapBox.hidden = false;
    map = placesMap(mapBox, city, [], { ...text, name: place => place.names[language] || place.name }, () => {});
    map.setEvents(events);
    map.setRoute(route.legs, route.stops, route.focused);
    configureOrigin();
    updateHours();
  }
  let storage;
  try { storage = window.localStorage; } catch { /* Optional saved results. */ }
  signal.addEventListener('abort', () => map?.destroy(), { once: true });
  const credit = document.createElement('a');
  credit.href = 'https://www.openstreetmap.org/copyright';
  credit.textContent = '© OpenStreetMap contributors';
  const retry = document.createElement('button');
  retry.textContent = text.retry;
  retry.type = 'button';
  retry.hidden = true;
  const legend = document.createElement('p');
  legend.textContent = text.legend;
  const pickerBox = document.createElement('div');
  pickerBox.className = 'start-picker';
  pickerBox.hidden = true;
  const pickHint = document.createElement('p');
  pickHint.textContent = text.pickHint;
  const cancelPick = document.createElement('button');
  cancelPick.type = 'button';
  cancelPick.textContent = text.cancelPick;
  cancelPick.addEventListener('click', cancelStartSelection);
  pickerBox.append(pickHint, cancelPick);
  details.append(summary, controls, slider, filterLabel, filterMessage, status, retry, mapBox, pickerBox, legend, list, credit);
  const km = new Intl.NumberFormat(language, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  const metres = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  async function load() {
    retry.hidden = true;
    status.textContent = text.loading;
    try {
      const { places, stale, checkedAt } = await loadPlaces(city, { signal, storage });
      if (signal.aborted) return;
      map?.destroy();
      map = undefined;
      list.replaceChildren();
      mapBox.hidden = false;
      function select(index) {
        for (const [i, item] of [...list.children].entries()) {
          item.classList.toggle('selected', i === index);
          item.querySelector('button').setAttribute('aria-pressed', String(i === index));
        }
      }
      map = placesMap(mapBox, city, places, { ...text, name: place => place.names[language] || place.name }, select);
      map.setEvents(events);
      map.setRoute(route.legs, route.stops, route.focused);
      configureOrigin();
      for (const [index, place] of places.entries()) {
        const item = document.createElement('li');
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'show-place';
        show.textContent = place.names[language] || place.name;
        show.setAttribute('aria-pressed', 'false');
        show.addEventListener('click', () => { route.focused = false; map.select(index); });
        const link = document.createElement('a');
        link.href = place.url;
        link.textContent = text.source;
        const info = document.createElement('span');
        info.className = 'event-venue';
        const distance = place.km < 1 ? metres.format(place.km * 1000) : km.format(place.km);
        info.textContent = [text[place.category], distance, place.hours && text.hours + ' · ' + place.hours].filter(Boolean).join(' · ');
        const badge = document.createElement('span');
        badge.className = 'opening-state';
        item.append(show, badge, info, link, itinerary.button(place, 'place'));
        list.append(item);
      }
      loadedPlaces = places;
      updateHours();
      if (selectedEvent && events.includes(selectedEvent)) map.selectEvent(selectedEvent);
      if (alternative) map.previewPlace(alternative);
      const date = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(checkedAt);
      status.textContent = [places.length ? text.scope : text.empty, stale && text.saved + ' ' + date].filter(Boolean).join(' · ');
      retry.hidden = !stale;
    } catch {
      if (signal.aborted) return;
      status.textContent = text.error;
      retry.hidden = false;
    }
  }
  details.addEventListener('toggle', () => {
    if (details.open) { ensureMap(); if (!status.textContent) load(); }
  });
  retry.addEventListener('click', load);
  details.open = open;
  updateHours();
  return {
    element: details,
    setDay,
    getDay() { return day.value; },
    onDayChange(listener) { dayListeners.add(listener); },
    setItinerary(value) { itinerary = value; },
    setOrigin(point) { origin = point; map?.setOrigin(point, text.origin); },
    cancelStartSelection,
    pickStart(pick, cancel) {
      startSelection = { pick, cancel };
      pickerBox.hidden = false;
      details.open = true;
      ensureMap();
      configureOrigin();
      mapBox.scrollIntoView({ block: 'center', behavior: 'auto' });
    },
    clearAlternative() { alternative = undefined; map?.clearPreview(); },
    showAlternative(stop) {
      alternative = { ...stop, title: stop.names[language] || stop.title };
      route.focused = false;
      details.open = true;
      ensureMap();
      map?.previewPlace(alternative);
      mapBox.scrollIntoView({ block: 'center', behavior: 'auto' });
    },
    setRoute(legs, stops) { route = { legs, stops, focused: route.focused }; map?.setRoute(legs, stops, route.focused); },
    showRoute() {
      route.focused = true;
      details.open = true;
      ensureMap();
      map?.setRoute(route.legs, route.stops, true);
      mapBox.scrollIntoView({ block: 'center', behavior: 'auto' });
    },
    planButton(item, type) { return itinerary.button(item, type); },
    onTimeChange(listener) { onTimeChange = listener; },
    eventInfo,
    eventVisible(event) { return !filter.checked || eventInfo(event).available; },
    setEvents(value) { events = value; selectedEvent = undefined; map?.setEvents(events); updateHours(); },
    selectEvent(event) {
      route.focused = false;
      selectedEvent = event;
      if (filter.checked && !eventInfo(event).available) { filter.checked = false; updateHours(); }
      details.open = true;
      ensureMap();
      map?.selectEvent(event);
      mapBox.scrollIntoView({ block: 'center', behavior: 'auto' });
    },
  };
}
