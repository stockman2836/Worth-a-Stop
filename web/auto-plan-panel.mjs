import { generateDayPlan } from './auto-plan.mjs';
import { loadPlanCandidates } from './plan-candidates.mjs';
import { localInstant } from './opening-hours.mjs';
import { withStartingPoint } from './starting-point.mjs';
import { iconLabel } from './icons.mjs';

const copy = {
  ru: { pace: 'Темп прогулки', paces: { relaxed: 'Спокойный', balanced: 'Обычный', active: 'Насыщенный' },
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

export function autoPlanPanel(city, language, itinerary, timeline, storage, signal, initialPace) {
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
  controls.append(paceLabel, run, cancel);
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
  let active, proposal, expected, signature;
  const fingerprint = () => JSON.stringify([itinerary.context(), pace.value]);
  function clear() {
    active?.abort(); active = undefined; proposal = expected = signature = undefined;
    timeline.clearDraft(); list.replaceChildren(); actions.hidden = true; note.textContent = ''; mapHint.hidden = true;
    message.removeAttribute('aria-busy'); run.disabled = false; iconLabel(run, 'sparkles', text.generate); cancel.hidden = true;
  }
  function invalidate() {
    if (!signature || fingerprint() === signature) return;
    clear(); element.hidden = false; message.textContent = text.changed;
  }
  itinerary.onChange(invalidate);
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
    expected = context; signature = fingerprint();
    const controller = new AbortController(); active = controller;
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(90000)]);
    run.disabled = true; cancel.hidden = false; message.textContent = text.gathering; message.setAttribute('aria-busy', 'true');
    try {
      const candidates = await loadPlanCandidates(city, context.day, { signal: combined, storage });
      const result = await generateDayPlan({ ...context, timeZone: city.timezone, pace: pace.value, ...candidates }, {
        signal: combined, onProgress: progress => { if (active === controller) message.textContent = text.checking(progress.stops); },
      });
      if (active !== controller || signal.aborted) return;
      if (signature !== fingerprint()) { invalidate(); return; }
      proposal = result;
      if (!result.stops.length) {
        message.textContent = text.empty;
        note.textContent = [(candidates.incomplete || result.failedRoutes || result.limited) && text.partial, result.skippedEvents > 0 && text.skipped].filter(Boolean).join(' ');
        return;
      }
      message.textContent = text.summary(result.stops.length, result.walkingMinutes, clock.format(result.finish));
      note.textContent = [text.unchanged, text.estimates, !context.origin && text.firstStop,
        (candidates.incomplete || result.failedRoutes || result.limited) && text.partial,
        candidates.stalePlaces && text.stale, result.unverifiedHours > 0 && text.unknown, result.skippedEvents > 0 && text.skipped].filter(Boolean).join(' ');
      for (const entry of result.entries) {
        const item = document.createElement('li');
        const time = document.createElement('span'); time.className = 'event-time'; time.textContent = clock.format(entry.stop.type === 'event' ? entry.stop.start : entry.arrival) + '–' + clock.format(entry.departure);
        const link = document.createElement('a'); link.href = entry.stop.url; link.textContent = entry.stop.names?.[language] || entry.stop.title;
        const reason = document.createElement('p');
        reason.dataset.hours = entry.hours;
        reason.textContent = [entry.hours === 'event' ? text.event : entry.hours === 'fits' ? text.verified : text.unknown,
          entry.stop.type === 'place' && text.duration(entry.stop.duration), entry.walkingMinutes > 0 && text.walk(entry.walkingMinutes),
          entry.waiting > 0 && text.arrive(clock.format(entry.arrival)), entry.waiting > 0 && text.wait(entry.waiting),
          entry.variety && entry.stop.type === 'place' && text.variety].filter(Boolean).join(' · ');
        item.append(time, link, reason); list.append(item);
      }
      actions.hidden = false; iconLabel(apply, 'check', context.stops.length ? text.replace : text.apply);
      iconLabel(run, 'sparkles', text.again);
    } catch (error) {
      if (active !== controller || signal.aborted) return;
      message.textContent = error.name === 'TimeoutError' ? text.timeout : text.error;
    } finally {
      if (active === controller) { active = undefined; run.disabled = false; message.removeAttribute('aria-busy'); }
    }
  });
  map.addEventListener('click', () => {
    if (!proposal || fingerprint() !== signature) { invalidate(); return; }
    timeline.showDraft(proposal.legs, withStartingPoint(proposal.stops, expected.origin, text.origin)); mapHint.hidden = false;
  });
  apply.addEventListener('click', () => {
    if (!proposal || !proposal.stops.length || fingerprint() !== signature) { invalidate(); return; }
    try {
      itinerary.applyPlan(proposal.stops, expected);
      clear(); message.textContent = text.applied;
      const title = itinerary.element.querySelector('h2'); title.tabIndex = -1; title.focus({ preventScroll: true });
    } catch { clear(); message.textContent = text.changed; }
  });
  return { element, controls, getPace: () => pace.value };
}
