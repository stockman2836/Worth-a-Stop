import { loadPlaces } from './saved-places.mjs';
import { placesMap } from './places-map.mjs';
import { openingState, localClock, localInstant } from './opening-hours.mjs';
import { eventState } from './event-state.mjs';
import { todayIn } from './day-agenda.mjs';
import { iconLabel } from './icons.mjs';
import { updateLegend } from './map-symbols.mjs';
import { placeList } from './place-list.mjs';

const copy = {
  ru: { moreLoading: 'Загружаем остальные районы… Найденные места уже можно смотреть.', partial: 'Часть районов пока недоступна. Загруженные места показаны; повторите через минуту.', title: 'Места города', loading: 'Ищем границу города и интересные места…', empty: 'В границах города подходящих мест не найдено.',
    scope: 'Места по всему городу', boundary: 'Граница поиска', boundaryError: 'Не удалось подтвердить границу выбранного города. Поиск по всему городу недоступен.', sourceError: 'Источники мест временно недоступны. Попробуйте снова через минуту.', error: 'Не удалось загрузить места.', retry: 'Попробовать снова',
    pages: 'Страницы мест', previous: 'Назад', next: 'Дальше', pageRange: (first, last, total) => `Показаны ${first}–${last} из ${total}`,
    placeSelection: 'В списке', highlights: 'Главное', allPlaces: 'Все места',
    noHighlights: 'В источнике недостаточно признаков значимости для главной подборки. Остальные места доступны во вкладке «Все места».',
    noOpenHighlights: 'Среди главных мест нет подтверждённо открытых сейчас. Отключите фильтр доступности или откройте все места.',
    prominenceReasons: { documented: 'Есть справочные ссылки', multilingual: 'Название на нескольких языках', heritage: 'Охранный статус', international: 'Отмечено международное значение' },
    mapGuide: 'Главные места показаны сразу. Дополнительные появляются при приближении.', mapEvents: 'События на карте',
    clusterCount: (places, events) => `Места: ${places}, события: ${events}. Приблизьте карту или выберите объект в группе.`,
    clusterKinds: (places, events) => [places && `М:${places}`, events && `С:${events}`].filter(Boolean).join(' · '),
    clusterMore: 'Показать ещё', legendCluster: 'Группа: М — места, С — события',
    hours: 'Часы работы', museum: 'Музей', gallery: 'Галерея', artwork: 'Арт-объект', theatre: 'Театр', viewpoint: 'Смотровая площадка',
    attraction: 'Достопримечательность', castle: 'Замок', monument: 'Памятник', ruins: 'Руины',
    archaeological_site: 'Археологический памятник', city_gate: 'Городские ворота', cathedral: 'Собор',
    amphitheatre: 'Амфитеатр', fort: 'Крепость', palace: 'Дворец', basilica: 'Базилика', church: 'Церковь', temple: 'Храм', monastery: 'Монастырь',
    park: 'Парк', garden: 'Сад', marketplace: 'Рынок', map: 'Карта мест',
    zoomIn: 'Приблизить', zoomOut: 'Отдалить', unknown: 'Часы работы не указаны',
    tilesError: 'Не удалось загрузить часть карты.', saved: 'Источник недоступен. Показана сохранённая подборка от',
    source: 'Открыть в OpenStreetMap', legend: 'Условные обозначения карты',
    legendMuseums: 'Музеи', legendArt: 'Галереи и арт-объекты', legendHistoric: 'Исторические места', legendWorship: 'Храмы',
    legendNature: 'Парки и сады', legendEvents: 'События выбранного дня', legendRoute: 'Номер остановки в маршруте',
    date: 'Дата проверки', time: 'Местное время', open: 'Открыто', closed: 'Закрыто', uncertain: 'Время работы неизвестно',
    origin: 'Точка старта', pickHint: 'Нажмите на карту для выбора старта. С клавиатуры перемещайте карту стрелками и нажмите Enter. Escape отменяет выбор.', cancelPick: 'Отменить выбор старта',
    timeline: 'Время на карте', available: 'Доступно сейчас', ongoing: 'Идёт', soon: 'Начнётся в течение часа',
    upcoming: 'Позже', ended: 'Завершилось', eventUnknown: 'Время события неизвестно',
    filtered: (places, events) => `Доступно мест — ${places}, событий — ${events}. Неизвестное расписание скрыто.` },
  en: { moreLoading: 'Loading the remaining areas… You can already explore the places found.', partial: 'Some areas are temporarily unavailable. Showing loaded places; try again in a minute.', title: 'City places', loading: 'Looking for the city boundary and places…', empty: 'No matching places within the city boundary.',
    scope: 'Places across the city', boundary: 'Search boundary', boundaryError: 'Could not confirm the selected city boundary. Citywide search is unavailable.', sourceError: 'Place sources are temporarily unavailable. Try again in a minute.', error: 'Could not load places.', retry: 'Try again',
    pages: 'Place pages', previous: 'Previous', next: 'Next', pageRange: (first, last, total) => `Showing ${first}–${last} of ${total}`,
    placeSelection: 'In the list', highlights: 'Highlights', allPlaces: 'All places',
    noHighlights: 'The source lacks enough prominence annotations for a highlights selection. Other places remain available under All places.',
    noOpenHighlights: 'No highlights are verified open now. Turn off the availability filter or explore all places.',
    prominenceReasons: { documented: 'Reference links available', multilingual: 'Named in several languages', heritage: 'Heritage designation', international: 'Marked as internationally significant' },
    mapGuide: 'Highlights are shown immediately. More places appear as you zoom in.', mapEvents: 'Events on the map',
    clusterCount: (places, events) => `Places: ${places}, events: ${events}. Zoom in or choose an item in the group.`,
    clusterKinds: (places, events) => [places && `P:${places}`, events && `E:${events}`].filter(Boolean).join(' · '),
    clusterMore: 'Show more', legendCluster: 'Group: P — places, E — events',
    hours: 'Opening hours', museum: 'Museum', gallery: 'Gallery', artwork: 'Public artwork', theatre: 'Theatre', viewpoint: 'Viewpoint',
    attraction: 'Attraction', castle: 'Castle', monument: 'Monument', ruins: 'Ruins',
    archaeological_site: 'Archaeological site', city_gate: 'City gate', cathedral: 'Cathedral',
    amphitheatre: 'Amphitheatre', fort: 'Fort', palace: 'Palace', basilica: 'Basilica', church: 'Church', temple: 'Temple', monastery: 'Monastery',
    park: 'Park', garden: 'Garden', marketplace: 'Market', map: 'Map of places',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', unknown: 'Opening hours unspecified',
    tilesError: 'Some map tiles could not be loaded.', saved: 'Source unavailable. Showing places saved on',
    source: 'Open in OpenStreetMap', legend: 'Map legend',
    legendMuseums: 'Museums', legendArt: 'Galleries and public art', legendHistoric: 'Historic places', legendWorship: 'Places of worship',
    legendNature: 'Parks and gardens', legendEvents: 'Events on the selected day', legendRoute: 'Stop number in your route',
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
  const listView = placeList(language, text, () => itinerary, index => { route.focused = false; map?.select(index); }, selection?.placePage, selection?.allPlaces);
  const list = listView.element;
  const mapBox = document.createElement('div');
  mapBox.className = 'places-map';
  mapBox.setAttribute('role', 'region');
  mapBox.setAttribute('aria-label', text.map + ' · ' + city.name);
  mapBox.hidden = true;
  let map;
  let events = [];
  let selectedEvent;
  let alternative;
  let draft;
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
  const mapControls = document.createElement('div'); mapControls.className = 'map-discovery-controls';
  const guide = document.createElement('p'); guide.textContent = text.mapGuide;
  const eventToggle = document.createElement('input'); eventToggle.type = 'checkbox'; eventToggle.checked = selection?.mapEvents ?? false;
  const eventLabel = document.createElement('label'); eventLabel.append(eventToggle, document.createTextNode(text.mapEvents));
  eventToggle.addEventListener('change', () => map?.setEventsVisible(eventToggle.checked));
  mapControls.append(guide, eventLabel);
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
  day.parentElement.classList.add('map-date');
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
    listView.update(loadedPlaces, states, filter.checked);
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
    map = placesMap(mapBox, city, [], { ...text, name: place => place.names[language] || place.name }, () => {}, selection?.mapView);
    map.setEvents(events);
    map.setEventsVisible(eventToggle.checked);
    map.setRoute(route.legs, route.stops, route.focused);
    configureOrigin();
    updateHours();
    if (draft) map.previewPlan(draft.legs, draft.stops);
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
  const legend = document.createElement('ul'); legend.className = 'map-legend';
  updateLegend(legend, [], text);
  const pickerBox = document.createElement('div');
  pickerBox.className = 'start-picker';
  pickerBox.hidden = true;
  const pickHint = document.createElement('p');
  pickHint.textContent = text.pickHint;
  const cancelPick = document.createElement('button');
  cancelPick.type = 'button';
  iconLabel(cancelPick, 'x', text.cancelPick);
  cancelPick.addEventListener('click', cancelStartSelection);
  pickerBox.append(pickHint, cancelPick);
  details.append(summary, controls, slider, filterLabel, filterMessage, status, retry, mapControls, mapBox, pickerBox, legend, listView.filters, listView.empty, list, listView.pagination, credit);
  let refreshTimer, retryTimer, renderedAt, busy = false;
  signal.addEventListener('abort', () => { clearTimeout(refreshTimer); clearTimeout(retryTimer); }, { once: true });
  function unlockRetry(retryAt) {
    clearTimeout(retryTimer);
    const seconds = Math.max(0, Math.ceil(((retryAt || 0) - Date.now()) / 1000));
    retry.disabled = seconds > 0;
    retry.textContent = seconds ? (language === 'ru' ? `Повторить через ${seconds} с` : `Try again in ${seconds}s`) : text.retry;
    if (seconds) retryTimer = setTimeout(() => unlockRetry(retryAt), 1000);
  }
  async function load() {
    if (busy || signal.aborted) return;
    busy = true;
    clearTimeout(refreshTimer);
    clearTimeout(retryTimer);
    retry.disabled = true;
    retry.hidden = true;
    if (!loadedPlaces.length) status.textContent = text.loading;
    try {
      const { places, boundary, stale, checkedAt, incomplete, loading, retryAt } = await loadPlaces(city, { signal, storage });
      if (signal.aborted) return;
      if (loading) refreshTimer = setTimeout(load, 2000);
      if (loading && renderedAt === checkedAt) return;
      renderedAt = checkedAt;
      const view = loadedPlaces.length ? map?.view() : selection?.mapView;
      map?.destroy();
      map = undefined;
      list.replaceChildren();
      mapBox.hidden = false;
      function select(index) {
        listView.select(index);
      }
      map = placesMap(mapBox, city, places, { ...text, name: place => place.names[language] || place.name }, select, view);
      map.setEvents(events);
      map.setEventsVisible(eventToggle.checked);
      map.setRoute(route.legs, route.stops, route.focused);
      configureOrigin();
      loadedPlaces = places;
      updateLegend(legend, places, text);
      updateHours();
      if (selectedEvent && events.includes(selectedEvent)) map.selectEvent(selectedEvent);
      if (alternative) map.previewPlace(alternative);
      if (draft) map.previewPlan(draft.legs, draft.stops);
      const date = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(checkedAt);
      status.textContent = [loading ? text.moreLoading : incomplete ? text.partial : places.length ? text.scope : text.empty, stale && text.saved + ' ' + date].filter(Boolean).join(' · ');
      const boundaryLink = document.createElement('a');
      boundaryLink.href = boundary.url;
      boundaryLink.textContent = `${text.boundary}: ${boundary.name}`;
      status.append(' · ', boundaryLink);
      retry.hidden = loading || !stale && !incomplete;
      if (!retry.hidden) unlockRetry(retryAt);
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error.code === 'CITY_BOUNDARY_UNAVAILABLE' ? text.boundaryError :
        error.code === 'PLACE_SOURCE_UNAVAILABLE' ? text.sourceError : text.error;
      retry.hidden = error.code === 'CITY_BOUNDARY_UNAVAILABLE';
      if (!retry.hidden) unlockRetry(error.retryAt);
    } finally { busy = false; }
  }
  details.addEventListener('toggle', () => {
    if (details.open) { ensureMap(); if (!status.textContent) load(); }
  });
  retry.addEventListener('click', load);
  details.open = open;
  updateHours();
  return {
    element: details,
    mapElements: { controls: mapControls, canvas: mapBox, picker: pickerBox, legend, credit },
    previewElements: { controls, slider, filter: filterLabel, message: filterMessage },
    selection() { return { date: day.value, time: clock.value, available: filter.checked, placePage: listView.getPage(), allPlaces: listView.showsAll(), mapEvents: eventToggle.checked, mapView: map?.view() || selection?.mapView }; },
    setTime(value) { clock.value = value; updateHours(); },
    setDay,
    getDay() { return day.value; },
    onDayChange(listener) { dayListeners.add(listener); },
    setItinerary(value) { itinerary = value; },
    clearDraft() { draft = undefined; map?.clearPreview(); },
    showDraft(legs, stops) {
      draft = { legs, stops };
      details.open = true;
      ensureMap();
      map?.previewPlan(legs, stops);
      mapBox.scrollIntoView({ block: 'center', behavior: 'auto' });
    },
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
