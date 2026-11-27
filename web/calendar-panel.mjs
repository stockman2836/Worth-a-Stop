import { findSources } from './sources.mjs';
import { findGuide } from './guides.mjs';
import { dayPanel } from './day-panel.mjs';

export function calendarsPanel(city, open, language, text, storage, initialDate, signal, eventMap) {
  const details = document.createElement('details');
  details.name = 'nearby-calendars';
  details.dataset.cityId = String(city.id);
  const summary = document.createElement('summary');
  summary.textContent = text.day;
  summary.setAttribute('aria-label', `${text.day} · ${city.name}`);
  const sources = document.createElement('details');
  const sourcesTitle = document.createElement('summary');
  sourcesTitle.textContent = text.calendars;
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'calendars';
  const guideBox = document.createElement('div');
  guideBox.className = 'guide-links';
  guideBox.setAttribute('aria-live', 'polite');
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = text.refresh;
  const official = document.createElement('p');
  official.setAttribute('role', 'status');
  sources.append(sourcesTitle, official, message, list, guideBox, refresh);
  details.append(summary, sources);

  async function loadGuide() {
    guideBox.textContent = text.guideWait;
    try {
      const guide = await findGuide(city, language);
      guideBox.replaceChildren();
      if (!guide) return;
      const article = document.createElement('a');
      article.href = guide.url;
      article.textContent = `${text.guide} · ${guide.title} (${guide.language.toUpperCase()})`;
      guideBox.append(article);
      if (guide.links.length) {
        const heading = document.createElement('p');
        heading.textContent = text.guideLinks;
        const sites = document.createElement('ul');
        for (const link of guide.links) {
          const item = document.createElement('li');
          const anchor = document.createElement('a');
          anchor.href = link.url;
          anchor.textContent = link.label;
          item.append(anchor);
          sites.append(item);
        }
        guideBox.append(heading, sites);
      }
    } catch {
      guideBox.textContent = text.guideError;
    }
  }

  async function loadOfficial(force) {
    official.textContent = text.officialWait;
    try {
      const response = await fetch('/api/official-calendars/' + city.id + (force ? '?refresh=1' : ''), { signal, cache: force ? 'reload' : 'default' });
      if (!response.ok) throw Error();
      const links = await response.json();
      official.textContent = links.length ? '' : text.officialEmpty;
      for (const url of links) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = text.official + ' · ' + new URL(url).hostname;
        official.append(link, document.createElement('br'));
      }
    } catch {
      official.textContent = text.officialError;
    }
  }

  async function load(force) {
    refresh.disabled = true;
    message.textContent = text.looking;
    const guideRequest = Promise.all([loadGuide(), loadOfficial(force)]);
    try {
      const { sources, stale, checkedAt, radiusKm } = await findSources(city, { storage, refresh: force });
      list.replaceChildren(...sources.map(source => {
        const item = document.createElement('li');
        const page = document.createElement('a');
        page.href = source.pageUrl;
        page.textContent = source.venue === source.agenda ? source.venue : `${source.venue} · ${source.agenda}`;
        const feed = document.createElement('a');
        feed.href = source.calendarUrl;
        feed.textContent = text.feed;
        item.append(page, feed);
        return item;
      }));
      const when = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(checkedAt);
      message.textContent = [stale && text.saved, sources.length ? text.nearby(radiusKm) : text.none(radiusKm), `${text.checked} ${when}`]
        .filter(Boolean).join(' · ');
    } catch {
      message.textContent = text.unavailable;
    } finally {
      await guideRequest;
      refresh.disabled = false;
    }
  }
  details.addEventListener('toggle', () => {
    if (details.open && !details.querySelector('.day-agenda')) {
      sources.before(dayPanel(city, language, initialDate, signal, eventMap));
    }
  });
  sources.addEventListener('toggle', () => {
    if (sources.open && !message.textContent) load(false);
  });
  refresh.addEventListener('click', () => load(true));
  details.open = open;
  return details;
}
