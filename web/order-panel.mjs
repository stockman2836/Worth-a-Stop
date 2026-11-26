import { compareStopOrder } from './stop-order.mjs';
import { planSignature } from './alternatives.mjs';

const copy = {
  ru: { title: 'Сравнить порядок со следующим местом', loading: 'Проверяем перестановку и пешие переходы…',
    current: 'Сейчас', proposed: 'После перестановки', metric: 'Показатель', stop: 'Остановка',
    walking: 'Пешком по оценке', finish: 'Завершение', conflicts: 'Конфликты', unknowns: 'Требует проверки',
    apply: 'Применить порядок', retry: 'Проверить ещё раз', changed: 'План изменился. Повторите сравнение.',
    error: 'Не удалось проверить перестановку.', valid: 'Вариант проверен для изменившихся посещений и событий.',
    unsafe: 'Вариант содержит конфликт или непроверенное посещение. Исправьте план перед применением.',
    start: 'Старт — у первой остановки выбранного порядка.', waiting: 'Ожидание', late: 'Опоздание',
    unknown: 'Время неизвестно', hours: { fits: 'Открыто весь визит', 'closed-arrival': 'Закрыто по прибытии',
      'closes-during': 'Закроется во время визита', break: 'Перерыв', unknown: 'Часы требуют проверки', 'unknown-time': 'Время визита неизвестно' },
    reasons: { pair: 'Для сравнения нужны два соседних места.', duration: 'Укажите длительность обоих посещений.',
      arrival: 'Задайте старт и рассчитайте прибытие.', route: 'Не удалось подтвердить все изменённые переходы.' } },
  en: { title: 'Compare order with the next place', loading: 'Checking the order and walking legs…',
    current: 'Current', proposed: 'After swapping', metric: 'Metric', stop: 'Stop',
    walking: 'Estimated walking', finish: 'Finish', conflicts: 'Conflicts', unknowns: 'Needs checking',
    apply: 'Apply this order', retry: 'Check again', changed: 'The plan changed. Compare again.',
    error: 'Could not check this order.', valid: 'Changed visits and events have been checked.',
    unsafe: 'This order has a conflict or an unverified visit. Resolve it before applying.',
    start: 'The walk starts at the first stop in the chosen order.', waiting: 'Waiting', late: 'Late',
    unknown: 'Time unknown', hours: { fits: 'Open throughout visit', 'closed-arrival': 'Closed on arrival',
      'closes-during': 'Closes during visit', break: 'Break', unknown: 'Hours need checking', 'unknown-time': 'Visit time unknown' },
    reasons: { pair: 'Two adjacent places are required.', duration: 'Enter both visit durations.',
      arrival: 'Choose a start time and calculate arrival.', route: 'Some changed walking legs could not be verified.' } },
};

export function orderPanel(id, language, timeZone, getContext, apply, signal) {
  const text = copy[language];
  const element = document.createElement('details');
  element.className = 'order-comparison';
  const summary = document.createElement('summary');
  summary.textContent = text.title;
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const results = document.createElement('div');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = text.retry;
  retry.hidden = true;
  element.append(summary, message, results, retry);
  const when = new Intl.DateTimeFormat(language, { timeZone: timeZone || 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = new Intl.NumberFormat(language, { style: 'unit', unit: 'minute', maximumFractionDigits: 0 });
  let controller;
  let signature;
  function key(context) { return JSON.stringify([context.day, planSignature(context.stops, context.start, context.legs)]); }
  function changed() {
    if (signature === undefined || signature === key(getContext())) return false;
    controller?.abort();
    results.replaceChildren();
    message.textContent = text.changed;
    retry.hidden = false;
    return true;
  }
  function table(firstHeading, rows) {
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const title of [firstHeading, text.current, text.proposed]) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = title;
      head.append(cell);
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const [index, value] of row.entries()) {
        const cell = document.createElement(index ? 'td' : 'th');
        if (!index) cell.scope = 'row';
        cell.textContent = value;
        tr.append(cell);
      }
    }
    return table;
  }
  function visitText(visit) {
    return [visit.arrival === null ? text.unknown : when.format(visit.arrival),
      visit.departure !== null && when.format(visit.departure), text.hours[visit.hours],
      visit.waiting > 0 && text.waiting + ' ' + minutes.format(visit.waiting),
      visit.late > 0 && text.late + ' ' + minutes.format(visit.late)].filter(Boolean).join(' · ');
  }
  async function compare() {
    controller?.abort();
    controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const context = getContext();
    signature = key(context);
    results.replaceChildren();
    retry.hidden = true;
    message.textContent = text.loading;
    try {
      const result = await compareStopOrder(context.stops, id, context.legs, context.start, timeZone, { signal: combined });
      if (combined.aborted || changed()) return;
      retry.hidden = false;
      if (result.reason) { message.textContent = text.reasons[result.reason]; return; }
      message.textContent = result.applicable ? text.valid : text.unsafe;
      const { before, after } = result;
      const name = stop => stop.names[language] || stop.title;
      const order = document.createElement('ol');
      order.className = 'compared-order';
      for (const visit of after.visits) {
        const item = document.createElement('li');
        item.textContent = name(visit.stop);
        order.append(item);
      }
      const hint = document.createElement('p');
      hint.textContent = text.start;
      const metrics = table(text.metric, [
        [text.walking, before.walkingMinutes === null ? text.unknown : minutes.format(before.walkingMinutes),
          after.walkingMinutes === null ? text.unknown : minutes.format(after.walkingMinutes)],
        [text.finish, before.finish == null ? text.unknown : when.format(before.finish), after.finish == null ? text.unknown : when.format(after.finish)],
        [text.conflicts, before.conflicts, after.conflicts], [text.unknowns, before.unknown, after.unknown],
      ]);
      const proposed = new Map(after.visits.map(visit => [visit.stop.id, visit]));
      const visits = table(text.stop, before.visits.map(visit =>
        [name(visit.stop), visitText(visit), visitText(proposed.get(visit.stop.id))]));
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'apply-order';
      choose.textContent = text.apply;
      choose.disabled = !result.applicable;
      choose.addEventListener('click', () => {
        if (changed()) return;
        try { apply(context, id); }
        catch { results.replaceChildren(); message.textContent = text.changed; retry.hidden = false; }
      });
      results.append(order, hint, metrics, visits, choose);
    } catch {
      if (combined.aborted) return;
      message.textContent = text.error;
      retry.hidden = false;
    }
  }
  element.addEventListener('toggle', () => {
    if (element.open && signature === undefined) compare();
    if (!element.open) { controller?.abort(); signature = undefined; }
  });
  retry.addEventListener('click', compare);
  return { element, check: changed };
}
