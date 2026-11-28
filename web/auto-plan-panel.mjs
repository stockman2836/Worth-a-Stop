import { generateDayPlan } from './auto-plan.mjs';
import { placeName } from './place-name.mjs';
import { loadPlanCandidates } from './plan-candidates.mjs';
import { localInstant } from './opening-hours.mjs';
import { validReturnTrip, withTripEndpoints } from './return-trip.mjs';
import { iconLabel } from './icons.mjs';
import { interestIds, interestKey, normalizeInterests, readInterests, saveInterests } from './travel-interests.mjs';
import { pauseControls } from './pause-controls.mjs';
import { pauseWindow } from './planned-pause.mjs';
import { mealOptionsPanel } from './meal-options-panel.mjs';

const copy = {
  ru: { pace: 'Темп прогулки', paces: { relaxed: 'Спокойный', balanced: 'Обычный', active: 'Насыщенный' },
    requiredHint: 'Добавь места в план дня и отметь «Обязательно посетить». Автоплан сохранит их и подберёт остальные остановки.',
    requiredCount: n => `Обязательных мест: ${n}. Порядок подберёт автоплан; заданная длительность посещений сохранится.`,
    requiredBadge: 'Обязательно посетить',
    requiredConflict: 'Не удалось подтвердить маршрут через все обязательные места. Текущий план сохранён.',
    requiredReasons: { location: 'Нет координат для расчёта перехода.', route: 'Не удалось подтвердить пеший переход. Попробуй позже или измени точку старта.',
      'walk-limit': 'Переход превышает лимит выбранного темпа. Измени темп или точку старта.',
      'closed-arrival': 'В проверенном варианте место закрыто к прибытию. Попробуй другое время начала прогулки.',
      'closes-during': 'В проверенном варианте место закрывается до окончания посещения. Измени время или длительность.',
      break: 'В проверенном варианте посещение пересекает перерыв. Измени время или длительность.',
      'unknown-time': 'Не удалось проверить время посещения.', time: 'В проверенном варианте не хватает времени на посещения. Увеличь окно прогулки или сократи длительность.',
      return: 'В проверенном варианте не успеть к сроку возвращения с запасом. Измени время или точку возвращения.',
      pause: 'В проверенном варианте не помещается обязательная пауза. Измени её окно или длительность.',
      'search-limit': 'Достигнут лимит проверки вариантов; это не означает, что маршрут невозможен. Попробуй другую точку старта или окно времени.' },
    pauseInvalid: 'Пауза должна целиком помещаться в выбранное окно и оставлять время до окончания прогулки или возвращения.',
    pauseEmpty: 'Не удалось собрать прогулку с паузой в указанное время и соблюдением срока возвращения. Измени окно, длительность или время поездки.',
    pauseNote: 'Пауза — резерв времени рядом с отмеченной точкой. Заведение, его часы работы, поиск и дополнительные переходы не проверены.',
    pauseDuration: n => `Пауза: ${n} мин`,
    mealNote: 'Заведение выбрано по данным OpenStreetMap. Переходы, окно обеда и возвращение проверены; часы показаны по опубликованным данным.',
    returnPoint: 'Выбери точку возвращения: точку старта или другую точку на карте.',
    returnBuffer: 'Укажи запас от 0 до 120 минут и оставь время на прогулку до отправления.',
    returnTitle: 'Возвращение', returnEmpty: 'Не удалось подобрать прогулку с подтверждённым возвращением вовремя. Измени время или точку возвращения.',
    returnNote: (arrival, by, buffer) => `Возвращение: ${arrival} · Прибыть не позже ${by} · Запас до отправления: ${buffer} мин.`,
    interests: 'Что тебе интересно?', interestNames: { history: 'История', architecture: 'Архитектура', museums: 'Музеи', nature: 'Природа', art: 'Искусство' },
    interestHint: 'Можно выбрать несколько. Без выбора — сбалансированный маршрут. Время работы и переходы проверяются в любом случае.',
    interestUnsaved: 'Выбор доступен в этой вкладке, но сохранить его на устройстве не удалось.', clearInterests: 'Снять выбор',
    interestMatch: 'По твоим интересам', noInterestMatches: 'В выполнимом маршруте не нашлось мест по выбранным интересам. Показаны другие варианты.',
    generate: 'Составить день', again: 'Пересчитать', cancel: 'Отменить', title: 'Предложение для твоего дня',
    gathering: 'Собираю места и события…', checking: n => `Проверяю переходы и расписания. Выбрано остановок: ${n}.`,
    validation: 'Укажи дату, время начала и более позднее время окончания в тот же день.',
    zone: 'Для автоплана нужен известный часовой пояс города.', error: 'Не удалось составить план. Попробуй ещё раз.',
    timeout: 'Проверка заняла слишком много времени. Попробуй ещё раз.', empty: 'Подходящую прогулку собрать не удалось. Попробуй другое время или темп.',
    changed: 'Параметры или ручной план изменились. Составь новое предложение.', cancelled: 'Подбор отменён. Текущий план не изменён.',
    apply: 'Применить план', replace: 'Заменить текущий план', applied: 'Предложение применено. План дня обновлён.',
    unchanged: 'Текущий план ещё не изменён. Применение заменит его остановки этим предложением.',
    estimates: 'Время посещения — оценка по выбранному темпу. Переходы рассчитаны пешим маршрутизатором.',
    firstStop: 'Без выбранной точки старта прогулка начинается у первой остановки.',
    partial: 'Часть источников или маршрутов не удалось проверить. Подборка может быть неполной.',
    stale: 'Использована сохранённая подборка мест.', unknown: 'Часы работы требуют проверки', verified: 'Открыто на всё посещение',
    event: 'Опубликованный сеанс', variety: 'Добавляет разнообразие прогулке', origin: 'Точка старта',
    summary: (n, walk, time) => `Остановок: ${n} · Пешком: ${walk} мин · Завершение: ${time}`,
    duration: n => `Посещение ≈ ${n} мин`, walk: n => `Переход ≈ ${n} мин`, wait: n => `Ожидание: ${n} мин`,
    arrive: time => `Прибытие: ${time}`,
    skipped: 'Некоторые события пропущены: неподходящее время, отсутствие данных или недоступный сеанс.',
    map: 'Предложение на карте', mapHint: 'Пунктир и оранжевые номера на карте — предлагаемый маршрут.', stops: 'Остановки предложения' },
  en: { pace: 'Walking pace', paces: { relaxed: 'Relaxed', balanced: 'Balanced', active: 'Active' },
    requiredHint: 'Add places to the daily itinerary and mark them Must visit. Auto planning keeps them and suggests other stops.',
    requiredCount: n => `Must-visit places: ${n}. Auto planning chooses their order and preserves your visit durations.`,
    requiredBadge: 'Must visit',
    requiredConflict: 'Could not confirm a route through every must-visit place. Your current itinerary is preserved.',
    requiredReasons: { location: 'Coordinates are missing for a walking route.', route: 'The walking route could not be verified. Try later or change the starting point.',
      'walk-limit': 'A walk exceeds the selected pace limit. Change the pace or starting point.',
      'closed-arrival': 'The place is closed on arrival in the checked option. Try a different walking start time.',
      'closes-during': 'The place closes before the visit ends in the checked option. Change the time or duration.',
      break: 'The visit crosses a closure in the checked option. Change the time or duration.',
      'unknown-time': 'The visit time could not be checked.', time: 'The checked option leaves too little time for visits. Extend the day or reduce visit durations.',
      return: 'The checked option misses the return deadline including the buffer. Change the return time or point.',
      pause: 'The required break does not fit the checked option. Change its window or duration.',
      'search-limit': 'The search reached its check limit; this does not mean the route is impossible. Try another starting point or time window.' },
    pauseInvalid: 'The entire break must fit its window and leave time before the walk ends or the required return.',
    pauseEmpty: 'No walk fits the requested break and return deadline. Change the break window, duration or trip times.',
    pauseNote: 'The break reserves time at the marked point. A venue, its opening hours, the search and any extra walking are not verified.',
    pauseDuration: n => `Break: ${n} min`,
    mealNote: 'The venue comes from OpenStreetMap. Walking, the meal window and return are checked; opening hours use published data.',
    returnPoint: 'Choose a return point: your starting point or another point on the map.',
    returnBuffer: 'Choose a buffer from 0 to 120 minutes and leave time for the walk before departure.',
    returnTitle: 'Return', returnEmpty: 'No walk with a verified return before the deadline could be built. Change the time or return point.',
    returnNote: (arrival, by, buffer) => `Return: ${arrival} · Arrive no later than ${by} · Buffer before departure: ${buffer} min.`,
    interests: 'Your interests', interestNames: { history: 'History', architecture: 'Architecture', museums: 'Museums', nature: 'Nature', art: 'Art' },
    interestHint: 'Choose any combination. Leave empty for a balanced walk. Opening hours and walking times are checked in every case.',
    interestUnsaved: 'Your choice is available in this tab but could not be saved on this device.', clearInterests: 'Clear selection',
    interestMatch: 'Matches your interests', noInterestMatches: 'No places matching your interests fit the feasible route. Showing other options.',
    generate: 'Plan my day', again: 'Recalculate', cancel: 'Cancel', title: 'A suggestion for your day',
    gathering: 'Gathering places and events…', checking: n => `Checking walks and schedules. Stops selected: ${n}.`,
    validation: 'Choose a date, a start time and a later finish time on the same day.',
    zone: 'Auto planning needs a known city time zone.', error: 'Could not build the plan. Please try again.',
    timeout: 'The checks took too long. Please try again.', empty: 'No suitable walk could be built. Try another time window or pace.',
    changed: 'The settings or manual itinerary changed. Build a new suggestion.', cancelled: 'Planning cancelled. Your current itinerary is preserved.',
    apply: 'Apply plan', replace: 'Replace current itinerary', applied: 'Suggestion applied. Your daily itinerary is updated.',
    unchanged: 'Your current itinerary is unchanged. Applying replaces its stops with this suggestion.',
    estimates: 'Visit durations are estimates for your selected pace. Walking legs use the foot router.',
    firstStop: 'Without a selected starting point, the walk begins at the first stop.',
    partial: 'Some sources or routes could not be checked. Suggestions may be incomplete.',
    stale: 'Saved place suggestions were used.', unknown: 'Opening hours need checking', verified: 'Open throughout the visit',
    event: 'Published session', variety: 'Adds variety to the walk', origin: 'Starting point',
    summary: (n, walk, time) => `Stops: ${n} · Walking: ${walk} min · Finish: ${time}`,
    duration: n => `Visit ≈ ${n} min`, walk: n => `Walk ≈ ${n} min`, wait: n => `Waiting: ${n} min`,
    arrive: time => `Arrive: ${time}`,
    skipped: 'Some events were skipped because of unsuitable times, missing data or unavailable sessions.',
    map: 'Preview on map', mapHint: 'Dashed paths and orange numbers show the proposed route.', stops: 'Suggested stops' },
};

export function autoPlanPanel(city, language, itinerary, timeline, storage, signal, initialPace, initialInterests) {
  const text = copy[language];
  const controls = document.createElement('div');
  controls.className = 'auto-plan-controls';
  const paceLabel = document.createElement('label');
  const pace = document.createElement('select');
  for (const [value, label] of Object.entries(text.paces)) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; pace.append(option);
  }
  const preference = 'worth-a-stop.auto-plan.pace.' + city.id;
  let saved;
  try { saved = storage?.getItem(preference); } catch { /* Optional preference. */ }
  pace.value = Object.hasOwn(text.paces, initialPace || saved) ? initialPace || saved : 'balanced';
  paceLabel.append(text.pace, pace);
  const run = document.createElement('button'); run.type = 'button'; run.className = 'generate-day'; iconLabel(run, 'sparkles', text.generate);
  const cancel = document.createElement('button'); cancel.type = 'button'; iconLabel(cancel, 'x', text.cancel); cancel.hidden = true;
  const interestsBox = document.createElement('fieldset'); interestsBox.className = 'auto-plan-interests';
  const legend = document.createElement('legend'); legend.textContent = text.interests;
  const choices = document.createElement('div'); choices.className = 'interest-choices';
  const interestNote = document.createElement('p'); interestNote.className = 'interest-hint'; interestNote.setAttribute('role', 'status');
  const checkboxes = new Map();
  let preferences = readInterests(storage);
  const selected = normalizeInterests(initialInterests ?? preferences.interests);
  for (const id of interestIds) {
    const label = document.createElement('label'); label.className = 'interest-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = id; input.checked = selected.includes(id);
    label.append(input, document.createTextNode(text.interestNames[id])); choices.append(label); checkboxes.set(id, input);
  }
  const getInterests = () => interestIds.filter(id => checkboxes.get(id).checked);
  const resetInterests = document.createElement('button'); resetInterests.type = 'button'; resetInterests.className = 'clear-interests'; resetInterests.textContent = text.clearInterests;
  choices.append(resetInterests); interestsBox.append(legend, choices, interestNote);
  function showInterestNote() {
    interestNote.textContent = [text.interestHint, !preferences.saved && text.interestUnsaved].filter(Boolean).join(' ');
    resetInterests.disabled = !getInterests().length;
  }
  showInterestNote();
  const requiredNote = document.createElement('p'); requiredNote.className = 'required-stops-note';
  function showRequiredNote() {
    const count = itinerary.context().stops.filter(stop => stop.type === 'place' && stop.required).length;
    requiredNote.textContent = [text.requiredHint, count && text.requiredCount(count)].filter(Boolean).join(' ');
  }
  showRequiredNote();
  const pause = pauseControls(city, language, storage, signal, () => itinerary.context().day, invalidate);
  controls.append(interestsBox, requiredNote, pause.element, paceLabel, run, cancel);
  const element = document.createElement('section'); element.className = 'auto-plan-preview'; element.hidden = true;
  const heading = document.createElement('h2'); heading.textContent = text.title;
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  const note = document.createElement('p'); note.className = 'auto-plan-note';
  const list = document.createElement('ol'); list.className = 'auto-plan-stops'; list.tabIndex = 0; list.setAttribute('aria-label', text.stops);
  const actions = document.createElement('div'); actions.className = 'itinerary-actions';
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'apply-auto-plan';
  const map = document.createElement('button'); map.type = 'button'; map.textContent = text.map;
  const mapHint = document.createElement('p'); mapHint.className = 'auto-plan-note'; mapHint.hidden = true; mapHint.textContent = text.mapHint;
  actions.append(apply, map); actions.hidden = true;
  element.append(heading, message, note, list, actions, mapHint);
  const clock = new Intl.DateTimeFormat(language, { timeZone: city.timezone || 'UTC', hour: '2-digit', minute: '2-digit' });
  let active, proposal, expected, signature, renderSuggestion;
  const meals = mealOptionsPanel(language, signal, result => {
    if (!renderSuggestion || fingerprint() !== signature) { invalidate(); return false; }
    timeline.clearDraft(); mapHint.hidden = true; renderSuggestion(result); return true;
  });
  note.after(meals.element);
  const fingerprint = () => JSON.stringify([itinerary.context(), pace.value, getInterests(), pause.value()]);
  function clear() {
    active?.abort(); active = undefined; proposal = expected = signature = renderSuggestion = undefined;
    meals.clear();
    timeline.clearDraft(); list.replaceChildren(); actions.hidden = true; note.textContent = ''; mapHint.hidden = true;
    message.removeAttribute('aria-busy'); run.disabled = false; iconLabel(run, 'sparkles', text.generate); cancel.hidden = true;
  }
  function invalidate() {
    if (!signature || fingerprint() === signature) return;
    clear(); element.hidden = false; message.textContent = text.changed;
  }
  itinerary.onChange(() => { pause.refreshDay(); showRequiredNote(); invalidate(); });
  function changeInterests() { preferences = saveInterests(getInterests(), storage); showInterestNote(); invalidate(); }
  for (const input of checkboxes.values()) input.addEventListener('change', changeInterests);
  resetInterests.addEventListener('click', () => { for (const input of checkboxes.values()) input.checked = false; changeInterests(); });
  window.addEventListener('storage', event => {
    if (event.key !== interestKey && event.key !== null) return;
    preferences = readInterests(storage);
    for (const [id, input] of checkboxes) input.checked = preferences.interests.includes(id);
    showInterestNote(); invalidate();
  }, { signal });
  pace.addEventListener('change', () => {
    try { storage?.setItem(preference, pace.value); } catch { /* Keep the choice in this view. */ }
    invalidate();
  });
  cancel.addEventListener('click', () => { clear(); message.textContent = text.cancelled; });
  signal.addEventListener('abort', clear, { once: true });
  run.addEventListener('click', async () => {
    clear(); element.hidden = false;
    const context = itinerary.context();
    const start = city.timezone && localInstant(context.day, context.startTime, city.timezone);
    const end = city.timezone && localInstant(context.day, context.endTime, city.timezone);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      message.textContent = city.timezone ? text.validation : text.zone;
      itinerary.controls[!context.startTime ? 'start' : 'end'].querySelector('input').focus();
      return;
    }
    if (!validReturnTrip(context.returnTrip ?? null) || context.returnTrip && end - context.returnTrip.bufferMinutes * 60000 <= start) {
      message.textContent = context.returnTrip?.point ? text.returnBuffer : text.returnPoint;
      itinerary.controls.returnTrip?.querySelector(context.returnTrip?.point ? '.return-buffer' : '.return-mode')?.focus();
      return;
    }
    const interests = getInterests();
    const pauseSettings = pause.value();
    try { pauseWindow(pauseSettings, context.day, city.timezone, start, end - (context.returnTrip?.bufferMinutes || 0) * 60000); }
    catch { message.textContent = text.pauseInvalid; pause.focus(); return; }
    expected = context; signature = fingerprint();
    const controller = new AbortController(); active = controller;
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(90000)]);
    run.disabled = true; cancel.hidden = false; message.textContent = text.gathering; message.setAttribute('aria-busy', 'true');
    try {
      const candidates = await loadPlanCandidates(city, context.day, { signal: combined, storage });
      const result = await generateDayPlan({ ...context, timeZone: city.timezone, pace: pace.value, interests, pause: pauseSettings,
        ...candidates, required: context.stops.filter(stop => stop.type === 'place' && stop.required) }, {
        signal: combined, onProgress: progress => { if (active === controller) message.textContent = text.checking(progress.stops); },
      });
      if (active !== controller || signal.aborted) return;
      if (signature !== fingerprint()) { invalidate(); return; }
      renderSuggestion = result => {
        proposal = result; list.replaceChildren();
        if (result.requiredConflict) {
          const { code, stop } = result.requiredConflict;
          message.textContent = text.requiredConflict;
          note.textContent = [stop && (stop.type === 'return' ? text.returnTitle : placeName(stop, language)), text.requiredReasons[code],
            (candidates.incomplete || result.failedRoutes || result.limited) && text.partial].filter(Boolean).join(' ');
          return;
        }
        if (!result.stops.length) {
          message.textContent = pauseSettings ? text.pauseEmpty : context.returnTrip ? text.returnEmpty : text.empty;
          note.textContent = [(candidates.incomplete || result.failedRoutes || result.limited) && text.partial, result.skippedEvents > 0 && text.skipped].filter(Boolean).join(' ');
          return;
        }
        message.textContent = text.summary(result.stops.length, result.walkingMinutes, clock.format(result.finish));
        note.textContent = [text.unchanged, text.estimates, !context.origin && text.firstStop,
          result.pause && (result.pause.mealVenue ? text.mealNote : text.pauseNote),
          result.returnTrip && text.returnNote(clock.format(result.returnTrip.arrival), clock.format(result.returnTrip.deadline), result.returnTrip.bufferMinutes),
          (candidates.incomplete || result.failedRoutes || result.limited) && text.partial,
          candidates.stalePlaces && text.stale, result.unverifiedHours > 0 && text.unknown, result.skippedEvents > 0 && text.skipped,
          interests.length && !result.entries.some(entry => entry.interests.length) && text.noInterestMatches].filter(Boolean).join(' ');
        for (const entry of result.entries) {
          const item = document.createElement('li');
          const time = document.createElement('span'); time.className = 'event-time'; time.textContent = clock.format(entry.stop.type === 'event' ? entry.stop.start : entry.stop.type === 'pause' ? entry.visitStart : entry.arrival) + '–' + clock.format(entry.departure);
          const link = document.createElement('a'); link.href = entry.stop.url; link.textContent = placeName(entry.stop, language);
          const reason = document.createElement('p');
          reason.dataset.hours = entry.hours;
          reason.textContent = [entry.hours === 'pause' ? text.pauseDuration(entry.stop.duration) : entry.hours === 'event' ? text.event : entry.hours === 'fits' ? text.verified : text.unknown,
            entry.stop.required && text.requiredBadge,
            entry.stop.mealVenue && (entry.venueHours === 'fits' ? text.verified : text.unknown),
            entry.stop.type === 'place' && text.duration(entry.stop.duration), entry.walkingMinutes > 0 && text.walk(entry.walkingMinutes),
            entry.waiting > 0 && text.arrive(clock.format(entry.arrival)), entry.waiting > 0 && text.wait(entry.waiting),
            entry.variety && entry.stop.type === 'place' && text.variety,
            entry.interests.length && text.interestMatch + ': ' + entry.interests.map(id => text.interestNames[id]).join(', ')].filter(Boolean).join(' · ');
          item.append(time, link, reason); list.append(item);
        }
        if (result.returnTrip) {
          const item = document.createElement('li'); item.className = 'auto-plan-return';
          const time = document.createElement('span'); time.className = 'event-time'; time.textContent = clock.format(result.returnTrip.arrival);
          const link = document.createElement('a'); link.href = result.returnTrip.stop.url; link.textContent = text.returnTitle;
          const reason = document.createElement('p'); reason.textContent = text.walk(Math.ceil(result.returnTrip.leg.duration / 60));
          item.append(time, link, reason); list.append(item);
        }
        actions.hidden = false; iconLabel(apply, 'check', context.stops.length ? text.replace : text.apply);
        iconLabel(run, 'sparkles', text.again);
      };
      renderSuggestion(result);
      if (!result.requiredConflict) meals.start(result, { origin: context.origin, returnTrip: context.returnTrip, timeZone: city.timezone });
    } catch (error) {
      if (active !== controller || signal.aborted) return;
      message.textContent = error.name === 'TimeoutError' ? text.timeout : text.error;
    } finally {
      if (active === controller) { active = undefined; run.disabled = false; message.removeAttribute('aria-busy'); }
    }
  });
  map.addEventListener('click', () => {
    if (!proposal || fingerprint() !== signature) { invalidate(); return; }
    timeline.showDraft(proposal.legs, withTripEndpoints(proposal.stops, expected.origin, expected.returnTrip, {
      originTitle: text.origin, returnTitle: text.returnTitle, deadline: proposal.returnTrip?.deadline })); mapHint.hidden = false;
  });
  apply.addEventListener('click', () => {
    if (!proposal || !proposal.stops.length || fingerprint() !== signature) { invalidate(); return; }
    try {
      itinerary.applyPlan(proposal.stops, expected);
      clear(); message.textContent = text.applied;
      const title = itinerary.element.querySelector('h2'); title.tabIndex = -1; title.focus({ preventScroll: true });
    } catch { clear(); message.textContent = text.changed; }
  });
  return { element, controls, getPace: () => pace.value, getInterests };
}
