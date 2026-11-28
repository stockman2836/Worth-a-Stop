import { itineraryStop, itineraryStore } from './itinerary.mjs';
import { placeName } from './place-name.mjs';
import { nextDate, todayIn } from './day-agenda.mjs';
import { walkingPanel } from './walking-panel.mjs';
import { arrivalTimes } from './arrival-times.mjs';
import { localInstant, visitOpeningState } from './opening-hours.mjs';
import { territoryLabel } from './territory.mjs';
import { alternativesPanel } from './alternatives-panel.mjs';
import { orderPanel } from './order-panel.mjs';
import { startingPointStore } from './starting-point.mjs';
import { checkTripWindow } from './trip-window.mjs';
import { timeMemory as unsavedTimes } from './city-plan-state.mjs';
import { icon, iconLabel } from './icons.mjs';
import { returnTripPanel } from './return-trip-panel.mjs';
import { withTripEndpoints } from './return-trip.mjs';

const copy = {
  ru: { title: 'План дня', date: 'Дата плана', add: 'Добавить в план', empty: 'Добавьте места и события из подборки.',
    required: 'Обязательно посетить', requiredHint: 'Автоплан сохранит это место. Чтобы предложить замену, сначала сними закрепление.',
    pauseMinutes: 'Длительность паузы, мин', pauseStart: 'Начало паузы', pauseLate: 'Окончание позже окна на',
    pauseNote: 'Резерв времени рядом с отмеченной точкой. Место для паузы не подобрано; поиск и дополнительные переходы не рассчитаны.',
    pauseWindow: 'Окно паузы',
    mealNote: 'Обед в выбранном заведении. Данные и часы работы — из OpenStreetMap; проверьте их перед поездкой.',
    mealUnknown: 'Часы заведения требуют проверки по источнику.',
    saved: 'План сохранён на этом устройстве.', temporary: 'Не удалось сохранить план. Изменения доступны в текущей вкладке.',
    added: 'Остановка добавлена в план.', duplicate: 'Эта остановка уже в плане.', up: 'Выше', down: 'Ниже', remove: 'Убрать',
    minutes: 'Время посещения, мин', unknown: 'Время события не указано', invalid: 'Укажите от 1 до 1440 минут.',
    fixed: 'Время организатора', invalidDate: 'Выберите дату плана.',
    start: 'Время начала прогулки', arrival: 'Прибытие', departure: 'Уход', waiting: 'Ожидание',
    end: 'Закончить до', settings: 'Настройки старта', walking: 'Переходы и расстояния',
    begin: 'Составь свой день', beginHint: 'Добавь интересное место или событие. Здесь появятся остановки и время прогулки.', explore: 'Посмотреть места',
    count: n => `Остановок: ${n}`, windowFits: n => `До выбранного окончания остаётся ${n} мин.`,
    windowOverrun: n => `План заканчивается на ${n} мин. позже выбранного времени.`,
    windowUnknown: 'Чтобы проверить время окончания, завершите расчёт остановок.',
    windowInvalid: 'Окончание должно быть позже старта в тот же день.', windowStart: 'Укажите время начала прогулки.',
    windowTime: 'Это местное время неоднозначно или не существует. Выберите другое.', windowUnsaved: 'Время окончания доступно в текущей вкладке.',
    origin: 'Точка старта', pickOrigin: 'Выбрать старт на карте', resetOrigin: 'Старт у первой остановки',
    firstOrigin: 'Старт — у первой остановки.', picking: 'Выберите точку на карте.',
    originUnsaved: 'Точка старта доступна в текущей вкладке.',
    late: 'Опоздание к началу', chooseStart: 'Укажите местное время начала прогулки.',
    invalidStart: 'Это местное время не удалось определить. Выберите другое время.',
    partial: 'Расчёт неполный. Проверьте отмеченные остановки.', finish: 'Ожидаемое завершение',
    startUnsaved: 'Время старта доступно в текущей вкладке.',
    hours: 'Сохранённое расписание', fits: 'Место открыто на всё время посещения.',
    closedArrival: 'Место закрыто к моменту прибытия.',
    closes: 'Закрытие до ухода', remaining: 'Доступное время до закрытия', break: 'Перерыв во время посещения',
    hoursUnknown: 'Расписание требует проверки по источнику. Добавьте место повторно, чтобы обновить сохранённые часы.',
    visitUnknown: 'Для проверки часов работы нужно рассчитать время посещения.',
    conflicts: count => `Конфликтов с часами работы — ${count}.`,
    replaced: 'Остановка заменена. Переходы и расписание пересчитываются.',
    reordered: 'Порядок применён. Переходы и расписание пересчитываются.',
    reasons: { 'pause-window': 'Пауза не помещается в выбранное окно времени.', 'pause-duration': 'Укажите длительность паузы от 5 до 180 минут.', 'start-time': 'Не задано время старта.', 'previous-stop': 'Неизвестно время ухода с предыдущей остановки.',
      'walking-leg': 'Нужен рассчитанный пеший переход.', 'visit-duration': 'Укажите длительность посещения.',
      'event-time': 'Время начала события неизвестно.', 'event-end': 'Время окончания события неизвестно.',
      'event-ended': 'Событие закончится до прибытия. Проверьте план.' } },
  en: { title: 'Daily itinerary', date: 'Plan date', add: 'Add to plan', empty: 'Add places and events from the suggestions.',
    required: 'Must visit', requiredHint: 'Auto planning will keep this place. Unpin it first to suggest a replacement.',
    pauseMinutes: 'Break duration, min', pauseStart: 'Break starts', pauseLate: 'Break ends beyond its window by',
    pauseNote: 'Time reserved near the marked point. No venue is selected; finding one and extra walking are not calculated.',
    pauseWindow: 'Break window',
    mealNote: 'Meal at the selected venue. Data and opening hours come from OpenStreetMap; check them before travelling.',
    mealUnknown: 'Check the venue opening hours with the source.',
    saved: 'Plan saved on this device.', temporary: 'Could not save the plan. Changes are available in this tab.',
    added: 'Stop added to the plan.', duplicate: 'This stop is already in the plan.', up: 'Move up', down: 'Move down', remove: 'Remove',
    minutes: 'Visit duration, min', unknown: 'Event time unspecified', invalid: 'Enter 1 to 1440 minutes.',
    fixed: 'Publisher time', invalidDate: 'Choose a plan date.',
    start: 'Walking start time', arrival: 'Arrival', departure: 'Departure', waiting: 'Waiting',
    end: 'Finish by', settings: 'Starting point settings', walking: 'Walking legs and distances',
    begin: 'Make this day yours', beginHint: 'Add a place or an event. Your stops and walking schedule will appear here.', explore: 'Explore places',
    count: n => `Stops: ${n}`, windowFits: n => `${n} min remain before your selected finish time.`,
    windowOverrun: n => `The plan finishes ${n} min after your selected finish time.`,
    windowUnknown: 'Complete the stop timings to check the finish time.',
    windowInvalid: 'Finish time must be later than the start on the same day.', windowStart: 'Choose a walking start time.',
    windowTime: 'This local time is ambiguous or does not exist. Choose another.', windowUnsaved: 'Finish time is available in this tab.',
    origin: 'Starting point', pickOrigin: 'Choose start on map', resetOrigin: 'Start at the first stop',
    firstOrigin: 'The walk starts at the first stop.', picking: 'Choose a point on the map.',
    originUnsaved: 'Starting point is available in this tab.',
    late: 'Late for the start', chooseStart: 'Choose a local walking start time.',
    invalidStart: 'This local time could not be resolved. Choose another time.',
    partial: 'The schedule is incomplete. Check the marked stops.', finish: 'Estimated finish',
    startUnsaved: 'Start time is available in this tab.',
    hours: 'Saved opening hours', fits: 'Open throughout the visit.',
    closedArrival: 'The place is closed on arrival.',
    closes: 'Closes before departure', remaining: 'Available time before closing', break: 'Break during the visit',
    hoursUnknown: 'Check the schedule with the source. Add the place again to refresh its saved hours.',
    visitUnknown: 'Calculate the visit times to check opening hours.',
    conflicts: count => `Opening-hour conflicts — ${count}.`,
    replaced: 'Stop replaced. Recalculating walking legs and schedule.',
    reordered: 'Order applied. Recalculating walking legs and schedule.',
    reasons: { 'pause-window': 'The break does not fit its selected time window.', 'pause-duration': 'Choose a break duration from 5 to 180 minutes.', 'start-time': 'Start time unspecified.', 'previous-stop': 'Previous departure time is unknown.',
      'walking-leg': 'A calculated walking leg is needed.', 'visit-duration': 'Enter the visit duration.',
      'event-time': 'Event start time is unknown.', 'event-end': 'Event end time is unknown.',
      'event-ended': 'The event ends before arrival. Check the plan.' } },
};

export function itineraryPanel(city, language, timeline, storage, signal, onExplore) {
  const listeners = new Set();
  function changed() { for (const listener of listeners) listener(); }
  const text = copy[language];
  const store = itineraryStore(city.id, storage);
  const points = startingPointStore(city.id, storage);
  let origin = null;
  const element = document.createElement('section');
  element.className = 'itinerary';
  const title = document.createElement('h2');
  title.textContent = text.title;
  const label = document.createElement('label');
  label.className = 'day-picker';
  label.classList.add('itinerary-date');
  const caption = document.createElement('span');
  caption.textContent = text.date;
  const date = document.createElement('input');
  date.type = 'date';
  date.required = true;
  const preference = 'worth-a-stop.itinerary.day.' + city.id;
  try {
    const day = storage?.getItem(preference);
    if (day) { nextDate(day); timeline.setDay(day); }
  } catch { /* A previous selection is optional. */ }
  try { nextDate(timeline.getDay()); } catch { timeline.setDay(todayIn(city.timezone || 'UTC')); }
  date.value = timeline.getDay();
  let activeDay = date.value;
  label.append(caption, date);
  const zone = document.createElement('p');
  zone.textContent = city.timezone || 'UTC';
  const list = document.createElement('ol');
  list.className = 'itinerary-stops';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const startLabel = document.createElement('label');
  startLabel.className = 'day-picker itinerary-start';
  const startInput = document.createElement('input');
  startInput.type = 'time';
  startInput.step = '60';
  startLabel.append(text.start, startInput);
  const endLabel = document.createElement('label');
  endLabel.className = 'day-picker itinerary-end';
  const endInput = document.createElement('input');
  endInput.type = 'time';
  endInput.step = '60';
  endLabel.append(text.end, endInput);
  const windowStatus = document.createElement('p');
  windowStatus.className = 'trip-window-status';
  windowStatus.setAttribute('role', 'status');
  const count = document.createElement('span');
  count.className = 'plan-count';
  title.append(count);
  const emptyState = document.createElement('div');
  emptyState.className = 'itinerary-empty';
  const emptyTitle = document.createElement('h3');
  emptyTitle.textContent = text.begin;
  const emptyHint = document.createElement('p');
  emptyHint.textContent = text.beginHint;
  const emptyIcon = document.createElement('div'); emptyIcon.className = 'empty-plan-icon'; emptyIcon.append(icon('route'));
  emptyState.append(emptyIcon, emptyTitle, emptyHint);
  if (onExplore) emptyState.append(button(text.explore, onExplore));
  const originControls = document.createElement('div');
  originControls.className = 'itinerary-actions origin-controls';
  const chooseOrigin = button(text.pickOrigin, () => {
    originStatus.textContent = text.picking;
    timeline.pickStart(point => {
      points.set(activeDay, point);
      render();
    }, showOriginStatus);
  });
  chooseOrigin.className = 'choose-origin';
  const resetOrigin = button(text.resetOrigin, () => { points.set(activeDay, null); render(); });
  iconLabel(chooseOrigin, 'map-pin', text.pickOrigin);
  iconLabel(resetOrigin, 'flag', text.resetOrigin);
  resetOrigin.className = 'reset-origin';
  const originStatus = document.createElement('p');
  originStatus.className = 'origin-status';
  originStatus.setAttribute('role', 'status');
  originControls.append(chooseOrigin, resetOrigin);
  const timingStatus = document.createElement('p');
  timingStatus.className = 'timing-status';
  timingStatus.setAttribute('role', 'status');
  const settings = document.createElement('details');
  settings.className = 'plan-settings';
  const settingsTitle = document.createElement('summary');
  settingsTitle.textContent = text.settings;
  settings.append(settingsTitle, originControls, originStatus, zone);
  element.append(title, label, startLabel, endLabel, emptyState, settings, timingStatus, windowStatus, list, status);
  let currentStops = [];
  let placeNames = new Map();
  const nameLinks = new Map();
  const nameFor = stop => placeName(stop.type === 'event' ? stop : { ...stop, names: { ...stop.names, ...placeNames.get(stop.url) } }, language);
  let routeLegs = [];
  let replacementController;
  let alternativePanels = [];
  function timeKey(kind) { return `worth-a-stop.itinerary.${kind}.v1.${city.id}.${activeDay}`; }
  function readTime(kind) {
    const key = timeKey(kind);
    if (unsavedTimes.has(key)) return unsavedTimes.get(key);
    try { return storage?.getItem(key) || ''; } catch { return ''; }
  }
  const readStart = () => readTime('start');
  startInput.value = readTime('start');
  endInput.value = readTime('end');
  const returning = returnTripPanel(city, language, storage, signal, { getDay: () => activeDay,
    getOrigin: () => points.read(activeDay).point, getStart: () => startInput.value, getEnd: () => endInput.value, timeline,
    onPickOrigin: () => chooseOrigin.click(),
    onChange: rerender => { if (rerender) render(); else { updateArrivals(); changed(); } } });
  endLabel.after(returning.element);
  const routeStops = stops => withTripEndpoints(stops, origin, returning.trip(), {
    originTitle: text.origin, returnTitle: language === 'ru' ? 'Возвращение' : 'Return', deadline: returning.deadline() });
  const walking = walkingPanel(language, timeline, signal, legs => {
    routeLegs = legs;
    updateArrivals();
  });
  const walks = document.createElement('details');
  walks.className = 'walking-details';
  const walksTitle = document.createElement('summary');
  walksTitle.textContent = text.walking;
  walks.append(walksTitle, walking.element);
  element.append(walks);
  const when = new Intl.DateTimeFormat(language, { timeZone: city.timezone || 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = new Intl.NumberFormat(language, { style: 'unit', unit: 'minute', maximumFractionDigits: 0 });
  const coordinate = new Intl.NumberFormat(language, { maximumFractionDigits: 5 });
  function showOriginStatus() {
    const value = points.read(activeDay);
    originStatus.textContent = [value.point ? text.origin + ' · ' + coordinate.format(value.point.latitude) + ' · ' +
      coordinate.format(value.point.longitude) : text.firstOrigin, !value.saved && text.originUnsaved].filter(Boolean).join(' ');
    resetOrigin.disabled = !value.point;
  }
  function replacementContext() {
    const savedStops = store.read(activeDay).stops;
    return { day: activeDay, savedStops, stops: routeStops(savedStops), legs: routeLegs,
      start: localInstant(activeDay, startInput.value, city.timezone || 'UTC') };
  }

  function updateArrivals() {
    const start = localInstant(activeDay, startInput.value, city.timezone || 'UTC');
    const itineraryRoute = routeStops(currentStops);
    const times = arrivalTimes(itineraryRoute, routeLegs, start).slice(origin && currentStops.length ? 1 : 0);
    let conflicts = 0;
    for (const [index, item] of [...list.children].entries()) {
      const time = times[index];
      const info = item.querySelector('.stop-timing');
      info.dataset.reason = time.reason || '';
      info.textContent = [time.arrival !== null && text.arrival + ' · ' + when.format(time.arrival),
        currentStops[index].type === 'pause' && time.visitStart !== null && text.pauseStart + ' · ' + when.format(time.visitStart),
        time.departure !== null && text.departure + ' · ' + when.format(time.departure),
        time.waiting > 0 && text.waiting + ' · ' + minutes.format(time.waiting),
        time.late > 0 && (currentStops[index].type === 'pause' ? text.pauseLate : text.late) + ' · ' + minutes.format(time.late),
        time.reason && !(currentStops[index].type === 'pause' && time.late > 0) && text.reasons[time.reason]].filter(Boolean).join(' · ');
      if (currentStops[index].type === 'place' || currentStops[index].mealVenue) {
        const check = visitOpeningState(currentStops[index].hours, currentStops[index].mealVenue ? time.visitStart : time.arrival, time.departure, city.timezone);
        const warning = item.querySelector('.visit-hours');
        warning.dataset.state = check.state;
        if (check.state === 'fits') warning.textContent = text.fits;
        else if (check.state === 'closed-arrival') { warning.textContent = text.closedArrival; conflicts++; }
        else if (check.state === 'break') {
          warning.textContent = text.break + ' · ' + when.format(check.closedAt) + ' – ' + when.format(check.reopensAt);
          conflicts++;
        } else if (check.state === 'closes-during') {
          warning.textContent = text.closes + ' · ' + when.format(check.closedAt) + ' · ' + text.remaining +
            ' · ' + minutes.format(check.availableMinutes);
          conflicts++;
        } else warning.textContent = check.state === 'unknown-time' ? text.visitUnknown : currentStops[index].mealVenue ? text.mealUnknown : text.hoursUnknown;
      }
    }
    const returnTrip = returning.trip();
    const finish = returnTrip && itineraryRoute.at(-1)?.type !== 'return' ? undefined : times.at(-1)?.departure;
    returning.update(returnTrip ? finish : undefined);
    timingStatus.textContent = [!currentStops.length ? '' : !startInput.value ? text.chooseStart : start === undefined ? text.invalidStart :
      times.some(time => time.reason) ? text.partial : finish != null ? text.finish + ' · ' + when.format(finish) : '',
      conflicts > 0 && text.conflicts(conflicts),
      unsavedTimes.has(timeKey('start')) && text.startUnsaved].filter(Boolean).join(' ');
    const windowCheck = checkTripWindow(activeDay, startInput.value, endInput.value, city.timezone || 'UTC',
      Number.isFinite(finish) ? finish + (returnTrip?.bufferMinutes ?? 0) * 60000 : finish);
    windowStatus.dataset.state = windowCheck.state;
    windowStatus.textContent = [windowCheck.state === 'fits' ? text.windowFits(windowCheck.minutes) :
      windowCheck.state === 'overrun' ? text.windowOverrun(windowCheck.minutes) :
      windowCheck.state === 'missing-start' ? text.windowStart : windowCheck.state === 'invalid-time' ? text.windowTime :
      windowCheck.state === 'end-before-start' ? text.windowInvalid : windowCheck.state === 'unknown-finish' ? text.windowUnknown : '',
      unsavedTimes.has(timeKey('end')) && text.windowUnsaved].filter(Boolean).join(' ');
    endInput.setCustomValidity(['invalid-time', 'end-before-start'].includes(windowCheck.state) ? windowStatus.textContent : '');
    for (const panel of alternativePanels) panel.check();
  }
  function saveTime(kind, input) {
    const key = timeKey(kind);
    try {
      if (!storage) throw Error('Storage unavailable');
      storage.setItem(key, input.value);
      unsavedTimes.delete(key);
    } catch { unsavedTimes.set(key, input.value); }
    updateArrivals();
    changed();
  }
  startInput.addEventListener('change', () => saveTime('start', startInput));
  endInput.addEventListener('change', () => saveTime('end', endInput));

  function button(labelText, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    button.addEventListener('click', action);
    return button;
  }
  function render(result = store.read(activeDay), feedback = '') {
    timeline.cancelStartSelection();
    timeline.clearAlternative();
    replacementController?.abort();
    replacementController = new AbortController();
    alternativePanels = [];
    currentStops = result.stops;
    emptyState.hidden = currentStops.length > 0;
    count.textContent = text.count(currentStops.length);
    origin = points.read(activeDay).point;
    timeline.setOrigin(origin);
    returning.refresh();
    endLabel.firstChild.textContent = returning.trip() ? returning.deadlineLabel : text.end;
    showOriginStatus();
    list.replaceChildren();
    nameLinks.clear();
    for (const [index, stop] of result.stops.entries()) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = stop.url;
      link.textContent = nameFor(stop);
      nameLinks.set(stop.id, { link, stop });
      item.append(link);
      if (stop.type === 'place') {
        const label = document.createElement('label'); label.className = 'required-stop-toggle';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = stop.required === true;
        input.setAttribute('aria-label', text.required + ' · ' + nameFor(stop));
        label.append(input, icon('flag'), document.createTextNode(text.required));
        label.title = text.requiredHint;
        input.addEventListener('change', () => {
          render(store.require(activeDay, stop.id, input.checked));
          list.children[index]?.querySelector('.required-stop-toggle input')?.focus({ preventScroll: true });
        });
        item.append(label);
      }
      if (stop.territory) {
        const territory = document.createElement('a'); territory.className = 'place-territory';
        territory.href = stop.territory.url; territory.textContent = territoryLabel(stop.territory, language);
        item.append(territory);
      }
      const timing = document.createElement('p');
      timing.className = 'stop-timing';
      item.append(timing);
      if (stop.type === 'event') {
        const time = document.createElement('p');
        time.textContent = stop.start === null ? text.unknown : text.fixed + ' · ' + when.format(stop.start) +
          (stop.end === null ? '' : ' – ' + when.format(stop.end));
        item.append(time);
      } else {
        if (stop.type === 'pause') {
          const detail = document.createElement('p'); detail.className = 'pause-description';
          detail.textContent = `${text.pauseWindow}: ${when.format(stop.start)} – ${when.format(stop.end)}. ${stop.mealVenue ? text.mealNote : text.pauseNote}`;
          item.append(detail);
        }
        if (stop.type === 'place' || stop.mealVenue) {
          const hours = document.createElement('p');
          hours.className = 'saved-hours';
          hours.textContent = stop.hours ? text.hours + ' · ' + stop.hours : '';
          const warning = document.createElement('p');
          warning.className = 'visit-hours';
          item.append(hours, warning);
        }
        const label = document.createElement('label');
        label.className = 'day-picker';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = stop.type === 'pause' ? '5' : '1';
        input.max = stop.type === 'pause' ? '180' : '1440';
        input.required = stop.type === 'pause';
        input.step = '1';
        input.value = stop.duration ?? '';
        label.append(stop.type === 'pause' ? text.pauseMinutes : text.minutes, input);
        input.addEventListener('change', () => {
          if (!input.validity.valid) { status.textContent = stop.type === 'pause' ? text.reasons['pause-duration'] : text.invalid; return; }
          render(store.duration(activeDay, stop.id, input.value ? Number(input.value) : null));
        });
        item.append(label);
        if (stop.type === 'place' && !stop.required) {
          const alternatives = alternativesPanel(stop, language, city.timezone, replacementContext,
            (context, id, replacement) => {
              if (context.day !== activeDay || readStart() !== startInput.value) throw Error('Plan changed');
              render(store.replace(activeDay, id, replacement, context.savedStops), text.replaced);
            }, timeline, storage, AbortSignal.any([signal, replacementController.signal]));
          alternativePanels.push(alternatives);
          item.append(alternatives.element);
          if (result.stops[index + 1]?.type === 'place') {
            const order = orderPanel(stop.id, language, city.timezone, replacementContext, (context, id) => {
              if (context.day !== activeDay || readStart() !== startInput.value) throw Error('Plan changed');
              render(store.swapAdjacent(activeDay, id, context.savedStops), text.reordered);
            }, AbortSignal.any([signal, replacementController.signal]));
            alternativePanels.push(order);
            item.append(order.element);
          }
        }
      }
      const actions = document.createElement('div');
      actions.className = 'itinerary-actions';
      const up = button(text.up, () => render(store.move(activeDay, stop.id, -1)));
      iconLabel(up, 'arrow-up', text.up);
      up.disabled = index === 0;
      const down = button(text.down, () => render(store.move(activeDay, stop.id, 1)));
      iconLabel(down, 'arrow-down', text.down);
      down.disabled = index === result.stops.length - 1;
      const remove = button(text.remove, () => render(store.remove(activeDay, stop.id)));
      iconLabel(remove, 'trash-2', text.remove);
      actions.append(up, down, remove);
      item.append(actions);
      list.append(item);
    }
    status.textContent = [feedback, result.saved ? text.saved : text.temporary].filter(Boolean).join(' ');
    walks.hidden = routeStops(result.stops).length < 2;
    walking.update(routeStops(result.stops));
    updateArrivals();
    changed();
  }
  function setDay(day) {
    try { nextDate(day); } catch { return; }
    date.value = day;
    activeDay = day;
    startInput.value = readStart();
    endInput.value = readTime('end');
    try { storage?.setItem(preference, day); } catch { /* The plan can still be edited. */ }
    render();
  }
  date.addEventListener('change', () => {
    if (date.value && date.validity.valid) timeline.setDay(date.value);
    else date.value = activeDay;
  });
  timeline.onDayChange(setDay);
  window.addEventListener('storage', () => { startInput.value = readStart(); endInput.value = readTime('end'); render(); }, { signal });
  function context() {
    return structuredClone({ day: activeDay, startTime: startInput.value, endTime: endInput.value,
      origin: points.read(activeDay).point, returnTrip: returning.trip(), stops: store.read(activeDay).stops });
  }
  render();
  return {
    element,
    controls: { date: label, start: startLabel, end: endLabel, returnTrip: returning.element },
    mapButton: walking.mapButton,
    context,
    setPlaceNames(places) {
      placeNames = new Map(places.map(place => [place.url, Object.fromEntries(Object.entries(place.names ?? {})
        .filter(([, value]) => typeof value === 'string' && value.trim()))]));
      for (const { link, stop } of nameLinks.values()) link.textContent = nameFor(stop);
      walking.setNameResolver(nameFor);
    },
    onChange(listener) { listeners.add(listener); },
    applyPlan(stops, expected) {
      if (JSON.stringify(context()) !== JSON.stringify(expected) || readTime('start') !== startInput.value ||
          readTime('end') !== endInput.value) throw Error('Plan changed');
      render(store.replaceAll(activeDay, stops, expected.stops));
    },
    button(item, type) {
      const add = button(text.add, () => {
        try { nextDate(timeline.getDay()); } catch { status.textContent = text.invalidDate; return; }
        setDay(timeline.getDay());
        const stop = itineraryStop(item, type);
        const exists = store.read(activeDay).stops.some(s => s.id === stop.id);
        render(store.add(activeDay, stop), exists ? text.duplicate : text.added);
      });
      add.className = 'add-to-plan';
      iconLabel(add, 'plus', text.add);
      add.prepend(icon('check'));
      add.setAttribute('aria-label', text.add + ' · ' + nameFor(item));
      return add;
    },
  };
}
