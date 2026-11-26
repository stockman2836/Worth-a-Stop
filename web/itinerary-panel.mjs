import { itineraryStop, itineraryStore } from './itinerary.mjs';
import { nextDate, todayIn } from './day-agenda.mjs';
import { walkingPanel } from './walking-panel.mjs';
import { arrivalTimes } from './arrival-times.mjs';
import { localInstant, visitOpeningState } from './opening-hours.mjs';
import { alternativesPanel } from './alternatives-panel.mjs';

const unsavedStarts = new Map();

const copy = {
  ru: { title: 'План дня', date: 'Дата плана', add: 'Добавить в план', empty: 'Добавьте места и события из подборки.',
    saved: 'План сохранён на этом устройстве.', temporary: 'Не удалось сохранить план. Изменения доступны в текущей вкладке.',
    added: 'Остановка добавлена в план.', duplicate: 'Эта остановка уже в плане.', up: 'Выше', down: 'Ниже', remove: 'Убрать',
    minutes: 'Время посещения, мин', unknown: 'Время события не указано', invalid: 'Укажите от 1 до 1440 минут.',
    fixed: 'Время организатора', invalidDate: 'Выберите дату плана.',
    start: 'Старт у первой остановки', arrival: 'Прибытие', departure: 'Уход', waiting: 'Ожидание',
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
    reasons: { 'start-time': 'Не задано время старта.', 'previous-stop': 'Неизвестно время ухода с предыдущей остановки.',
      'walking-leg': 'Нужен рассчитанный пеший переход.', 'visit-duration': 'Укажите длительность посещения.',
      'event-time': 'Время начала события неизвестно.', 'event-end': 'Время окончания события неизвестно.',
      'event-ended': 'Событие закончится до прибытия. Проверьте план.' } },
  en: { title: 'Daily itinerary', date: 'Plan date', add: 'Add to plan', empty: 'Add places and events from the suggestions.',
    saved: 'Plan saved on this device.', temporary: 'Could not save the plan. Changes are available in this tab.',
    added: 'Stop added to the plan.', duplicate: 'This stop is already in the plan.', up: 'Move up', down: 'Move down', remove: 'Remove',
    minutes: 'Visit duration, min', unknown: 'Event time unspecified', invalid: 'Enter 1 to 1440 minutes.',
    fixed: 'Publisher time', invalidDate: 'Choose a plan date.',
    start: 'Start at the first stop', arrival: 'Arrival', departure: 'Departure', waiting: 'Waiting',
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
    reasons: { 'start-time': 'Start time unspecified.', 'previous-stop': 'Previous departure time is unknown.',
      'walking-leg': 'A calculated walking leg is needed.', 'visit-duration': 'Enter the visit duration.',
      'event-time': 'Event start time is unknown.', 'event-end': 'Event end time is unknown.',
      'event-ended': 'The event ends before arrival. Check the plan.' } },
};

export function itineraryPanel(city, language, timeline, storage, signal) {
  const text = copy[language];
  const store = itineraryStore(city.id, storage);
  const element = document.createElement('section');
  element.className = 'itinerary';
  const title = document.createElement('h2');
  title.textContent = text.title;
  const label = document.createElement('label');
  label.className = 'day-picker';
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
  const timingStatus = document.createElement('p');
  timingStatus.className = 'timing-status';
  timingStatus.setAttribute('role', 'status');
  element.append(title, label, startLabel, zone, timingStatus, list, status);
  let currentStops = [];
  let routeLegs = [];
  let replacementController;
  let alternativePanels = [];
  function startKey() { return `worth-a-stop.itinerary.start.v1.${city.id}.${activeDay}`; }
  function readStart() {
    const key = startKey();
    if (unsavedStarts.has(key)) return unsavedStarts.get(key);
    try { return storage?.getItem(key) || ''; } catch { return ''; }
  }
  startInput.value = readStart();
  const walking = walkingPanel(language, timeline, signal, legs => {
    routeLegs = legs;
    updateArrivals();
  });
  element.append(walking.element);
  const when = new Intl.DateTimeFormat(language, { timeZone: city.timezone || 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = new Intl.NumberFormat(language, { style: 'unit', unit: 'minute', maximumFractionDigits: 0 });
  function replacementContext() {
    return { day: activeDay, stops: store.read(activeDay).stops, legs: routeLegs,
      start: localInstant(activeDay, startInput.value, city.timezone || 'UTC') };
  }

  function updateArrivals() {
    const start = localInstant(activeDay, startInput.value, city.timezone || 'UTC');
    const times = arrivalTimes(currentStops, routeLegs, start);
    let conflicts = 0;
    for (const [index, item] of [...list.children].entries()) {
      const time = times[index];
      const info = item.querySelector('.stop-timing');
      info.dataset.reason = time.reason || '';
      info.textContent = [time.arrival !== null && text.arrival + ' · ' + when.format(time.arrival),
        time.departure !== null && text.departure + ' · ' + when.format(time.departure),
        time.waiting > 0 && text.waiting + ' · ' + minutes.format(time.waiting),
        time.late > 0 && text.late + ' · ' + minutes.format(time.late),
        time.reason && text.reasons[time.reason]].filter(Boolean).join(' · ');
      if (currentStops[index].type === 'place') {
        const check = visitOpeningState(currentStops[index].hours, time.arrival, time.departure, city.timezone);
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
        } else warning.textContent = check.state === 'unknown-time' ? text.visitUnknown : text.hoursUnknown;
      }
    }
    const finish = times.at(-1)?.departure;
    timingStatus.textContent = [!startInput.value ? text.chooseStart : start === undefined ? text.invalidStart :
      times.some(time => time.reason) ? text.partial : finish != null ? text.finish + ' · ' + when.format(finish) : '',
      conflicts > 0 && text.conflicts(conflicts),
      unsavedStarts.has(startKey()) && text.startUnsaved].filter(Boolean).join(' ');
    for (const panel of alternativePanels) panel.check();
  }
  startInput.addEventListener('change', () => {
    const key = startKey();
    try {
      if (!storage) throw Error('Storage unavailable');
      storage.setItem(key, startInput.value);
      unsavedStarts.delete(key);
    } catch { unsavedStarts.set(key, startInput.value); }
    updateArrivals();
  });

  function button(labelText, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    button.addEventListener('click', action);
    return button;
  }
  function render(result = store.read(activeDay), feedback = '') {
    timeline.clearAlternative();
    replacementController?.abort();
    replacementController = new AbortController();
    alternativePanels = [];
    currentStops = result.stops;
    list.replaceChildren();
    for (const [index, stop] of result.stops.entries()) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = stop.url;
      link.textContent = stop.names?.[language] || stop.title;
      item.append(link);
      const timing = document.createElement('p');
      timing.className = 'stop-timing';
      item.append(timing);
      if (stop.type === 'event') {
        const time = document.createElement('p');
        time.textContent = stop.start === null ? text.unknown : text.fixed + ' · ' + when.format(stop.start) +
          (stop.end === null ? '' : ' – ' + when.format(stop.end));
        item.append(time);
      } else {
        const hours = document.createElement('p');
        hours.className = 'saved-hours';
        hours.textContent = stop.hours ? text.hours + ' · ' + stop.hours : '';
        const warning = document.createElement('p');
        warning.className = 'visit-hours';
        item.append(hours, warning);
        const label = document.createElement('label');
        label.className = 'day-picker';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '1440';
        input.step = '1';
        input.value = stop.duration ?? '';
        label.append(text.minutes, input);
        input.addEventListener('change', () => {
          if (!input.validity.valid) { status.textContent = text.invalid; return; }
          render(store.duration(activeDay, stop.id, input.value ? Number(input.value) : null));
        });
        item.append(label);
        const alternatives = alternativesPanel(stop, language, city.timezone, replacementContext,
          (context, id, replacement) => {
            if (context.day !== activeDay || readStart() !== startInput.value) throw Error('Plan changed');
            render(store.replace(activeDay, id, replacement, context.stops), text.replaced);
          }, timeline, storage, AbortSignal.any([signal, replacementController.signal]));
        alternativePanels.push(alternatives);
        item.append(alternatives.element);
      }
      const actions = document.createElement('div');
      actions.className = 'itinerary-actions';
      const up = button(text.up, () => render(store.move(activeDay, stop.id, -1)));
      up.disabled = index === 0;
      const down = button(text.down, () => render(store.move(activeDay, stop.id, 1)));
      down.disabled = index === result.stops.length - 1;
      actions.append(up, down, button(text.remove, () => render(store.remove(activeDay, stop.id))));
      item.append(actions);
      list.append(item);
    }
    status.textContent = [feedback, !result.stops.length && text.empty, result.saved ? text.saved : text.temporary].filter(Boolean).join(' ');
    walking.update(result.stops);
    updateArrivals();
  }
  function setDay(day) {
    try { nextDate(day); } catch { return; }
    date.value = day;
    activeDay = day;
    startInput.value = readStart();
    try { storage?.setItem(preference, day); } catch { /* The plan can still be edited. */ }
    render();
  }
  date.addEventListener('change', () => {
    if (date.value && date.validity.valid) timeline.setDay(date.value);
    else date.value = activeDay;
  });
  timeline.onDayChange(setDay);
  window.addEventListener('storage', () => { startInput.value = readStart(); render(); }, { signal });
  render();
  return {
    element,
    button(item, type) {
      const add = button(text.add, () => {
        try { nextDate(timeline.getDay()); } catch { status.textContent = text.invalidDate; return; }
        setDay(timeline.getDay());
        const stop = itineraryStop(item, type);
        const exists = store.read(activeDay).stops.some(s => s.id === stop.id);
        render(store.add(activeDay, stop), exists ? text.duplicate : text.added);
      });
      add.className = 'add-to-plan';
      add.setAttribute('aria-label', text.add + ' · ' + (item.title || item.names?.[language] || item.name));
      return add;
    },
  };
}
