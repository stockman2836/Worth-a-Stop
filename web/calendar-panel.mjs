import { findSources } from './sources.mjs';
import { findGuide } from './guides.mjs';

export function calendarsPanel(city, open, language, text, storage) {
  const details = document.createElement('details');
  details.name = 'nearby-calendars';
  details.dataset.cityId = String(city.id);
  const summary = document.createElement('summary');
  summary.textContent = text.calendars;
  summary.setAttribute('aria-label', `${text.calendars} · ${city.name}`);
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
  details.append(summary, message, list, guideBox, refresh);

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

  async function load(force) {
    refresh.disabled = true;
    message.textContent = text.looking;
    const guideRequest = loadGuide();
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
    if (details.open && !message.textContent) load(false);
  });
  refresh.addEventListener('click', () => load(true));
  details.open = open;
  return details;
}
