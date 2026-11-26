import { walkingLegs } from './walking-legs.mjs';

const copy = {
  ru: { title: 'Пешие переходы', need: 'Добавьте места или события для расчёта переходов.',
    loading: 'Рассчитываем пеший маршрут…', missing: 'Не хватает координат. Добавьте остановку повторно из актуальной подборки.',
    noRoute: 'Пеший путь не найден.', error: 'Не удалось рассчитать этот переход.', retry: 'Повторить расчёт',
    map: 'Маршрут на карте', total: 'Всего пешком по оценке маршрутизатора', partial: 'Рассчитанные участки',
    estimate: 'Оценка времени' },
  en: { title: 'Walking between stops', need: 'Add places or events to calculate walking legs.',
    loading: 'Calculating the walking route…', missing: 'Coordinates missing. Add the stop again from the current suggestions.',
    noRoute: 'No walking path found.', error: 'Could not calculate this leg.', retry: 'Try again',
    map: 'Show route on map', total: 'Estimated walking total', partial: 'Calculated legs',
    estimate: 'Estimated time' },
};

export function walkingPanel(language, timeline, signal, onRoutes = () => {}) {
  const text = copy[language];
  const element = document.createElement('section');
  element.className = 'walking-plan';
  const heading = document.createElement('h3');
  heading.textContent = text.title;
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const list = document.createElement('ol');
  const show = document.createElement('button');
  show.type = 'button';
  show.textContent = text.map;
  show.addEventListener('click', () => timeline.showRoute());
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = text.retry;
  const credit = document.createElement('p');
  const provider = document.createElement('a');
  provider.href = 'https://routing.openstreetmap.de/about.html';
  provider.textContent = 'OSRM · FOSSGIS · © OpenStreetMap contributors';
  const report = document.createElement('a');
  report.href = 'https://www.openstreetmap.org/fixthemap';
  report.textContent = language === 'ru' ? 'Сообщить об ошибке карты' : 'Report a map issue';
  credit.append(provider, ' · ', report);
  element.append(heading, message, list, show, retry, credit);
  const metres = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  const kilometres = new Intl.NumberFormat(language, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  const minutes = new Intl.NumberFormat(language, { style: 'unit', unit: 'minute', maximumFractionDigits: 0 });
  let signature;
  let controller;
  let stops = [];
  function distance(value) { return value < 1000 ? metres.format(value) : kilometres.format(value / 1000); }
  function render(legs, loading) {
    list.replaceChildren();
    for (const leg of legs) {
      const item = document.createElement('li');
      const title = document.createElement('span');
      title.textContent = leg.from.title + ' — ' + leg.to.title;
      const info = document.createElement('p');
      info.textContent = leg.status === 'ok' ? distance(leg.distance) + ' · ' + text.estimate + ' ' + minutes.format(Math.ceil(leg.duration / 60))
        : leg.status === 'missing-location' ? text.missing : leg.status === 'no-route' ? text.noRoute : text.error;
      item.append(title, info);
      list.append(item);
    }
    const known = legs.filter(leg => leg.status === 'ok');
    const total = known.reduce((sum, leg) => ({ distance: sum.distance + leg.distance, duration: sum.duration + leg.duration }), { distance: 0, duration: 0 });
    message.textContent = loading ? text.loading : stops.length < 2 ? text.need :
      (known.length === stops.length - 1 ? text.total : text.partial) + ' · ' + distance(total.distance) +
      ' · ' + minutes.format(Math.ceil(total.duration / 60));
    retry.hidden = loading || !legs.some(leg => leg.status === 'unavailable');
    show.hidden = !stops.some(stop => stop.location);
    timeline.setRoute(legs, stops);
    onRoutes(legs, stops);
  }
  async function calculate() {
    controller?.abort();
    controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    render([], stops.length >= 2);
    try {
      const legs = await walkingLegs(stops, { signal: combined, onProgress: legs => render(legs, true) });
      if (!combined.aborted) render(legs, false);
    } catch { /* A new date or stop order owns the next result. */ }
  }
  retry.addEventListener('click', calculate);
  return {
    element,
    update(value) {
      const next = JSON.stringify(value.map(stop => [stop.id, stop.location]));
      if (signature === next) return;
      signature = next;
      stops = value;
      calculate();
    },
  };
}
