import { findMealOptions } from './meal-options.mjs';
import { placeName } from './place-name.mjs';
import { diagnostic } from './diagnostics.mjs';

const copy = {
  ru: { title: 'Где пообедать', loading: 'Подбираем места в пределах 1 км от паузы и проверяем переходы…',
    ready: 'Выбери вариант для предложения. Сохранённый план изменится только после применения.',
    empty: 'В источнике не найдено мест для обеда рядом с паузой. Можно оставить обычную паузу.',
    noFit: 'Проверенные варианты не вписываются в расписание или возвращение. Обычная пауза сохранена.',
    unavailable: 'Источник заведений или переходы временно недоступны. Обычная пауза сохранена.',
    partial: 'Проверена только часть вариантов. Подборка может быть неполной.',
    source: 'Источник OSM', open: 'Открыто на всё время обеда', unknown: 'Часы требуют проверки', noHours: 'Часы работы не опубликованы',
    onWay: 'По пути', least: 'Минимальный крюк', extra: n => `Дополнительно пешком: ${n} мин`,
    keep: 'Оставить паузу без заведения', retry: 'Повторить подбор' },
  en: { title: 'Where to eat', loading: 'Finding venues within 1 km of the break and checking walking legs…',
    ready: 'Choose a venue for this suggestion. Your saved itinerary changes only after applying.',
    empty: 'No meal venues were found near the break in the source. You can keep the ordinary break.',
    noFit: 'The checked venues do not fit the schedule or return deadline. The ordinary break is retained.',
    unavailable: 'Venue sources or walking routes are temporarily unavailable. The ordinary break is retained.',
    partial: 'Only some options could be checked. Suggestions may be incomplete.',
    source: 'OSM source', open: 'Open throughout the meal', unknown: 'Opening hours need checking', noHours: 'Opening hours not published',
    onWay: 'On the way', least: 'Smallest detour', extra: n => `Extra walking: ${n} min`,
    keep: 'Keep the break without a venue', retry: 'Retry venue search' },
};

export function mealOptionsPanel(language, signal, onSelect) {
  const text = copy[language], element = document.createElement('section'); element.className = 'meal-options'; element.hidden = true;
  const heading = document.createElement('h3'); heading.textContent = text.title;
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const list = document.createElement('ul'); list.className = 'meal-options-list';
  const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'keep-meal-break'; keep.textContent = text.keep;
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = text.retry; retry.hidden = true;
  element.append(heading, status, list, keep, retry);
  let controller, retryTimer, generation = 0, base, context;
  function clear() {
    generation++; controller?.abort(); clearTimeout(retryTimer); base = context = undefined;
    list.replaceChildren(); status.textContent = ''; status.removeAttribute('aria-busy'); element.hidden = true;
  }
  function select(plan, button) {
    if (signal.aborted || onSelect(plan) === false) return;
    for (const item of element.querySelectorAll('[aria-pressed]')) item.setAttribute('aria-pressed', String(item === button));
  }
  async function start(plan, options) {
    clear();
    if (signal.aborted || !plan.pause || plan.pause.pauseKind !== 'meal') return;
    base = plan; context = options;
    const current = generation; controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(60000)]);
    const active = () => !signal.aborted && generation === current;
    element.hidden = false; status.textContent = text.loading; status.setAttribute('aria-busy', 'true');
    keep.setAttribute('aria-pressed', 'true'); retry.hidden = true;
    let result;
    try { result = await findMealOptions(plan, options, { signal: combined }); }
    catch { if (!active()) return; result = { state: 'unavailable', options: [], retryAt: Date.now() + 60000 }; }
    if (!active()) return;
    diagnostic('meals', 'options', { state: result.state, count: result.options.length, incomplete: Boolean(result.incomplete), retryAt: result.retryAt });
    status.removeAttribute('aria-busy');
    status.textContent = [text[result.state] || text.unavailable, result.incomplete && text.partial].filter(Boolean).join(' ');
    for (const option of result.options) {
      const item = document.createElement('li'), choose = document.createElement('button');
      choose.type = 'button'; choose.className = 'choose-meal-venue'; choose.textContent = placeName(option.venue, language); choose.setAttribute('aria-pressed', 'false');
      choose.addEventListener('click', () => select(option.plan, choose));
      const reason = document.createElement('p'); reason.className = 'meal-option-reasons'; reason.dataset.hours = option.hours;
      reason.textContent = [option.hours === 'fits' ? text.open : text.unknown, option.onWay && text.onWay, option.leastDetour && text.least,
        text.extra(option.extraWalkingMinutes)].filter(Boolean).join(' · ');
      const hours = document.createElement('p'); hours.textContent = option.venue.hours || text.noHours;
      const source = document.createElement('a'); source.href = option.venue.url; source.textContent = text.source;
      item.append(choose, reason, hours, source); list.append(item);
    }
    retry.hidden = result.state !== 'unavailable' && !result.incomplete;
    retry.disabled = Number.isFinite(result.retryAt) && result.retryAt > Date.now();
    if (retry.disabled) retryTimer = setTimeout(() => { if (active()) retry.disabled = false; }, Math.min(60000, result.retryAt - Date.now()));
  }
  keep.addEventListener('click', () => { if (base) select(base, keep); });
  retry.addEventListener('click', () => { if (base) start(base, context); });
  signal.addEventListener('abort', clear, { once: true });
  return { element, clear, start };
}
