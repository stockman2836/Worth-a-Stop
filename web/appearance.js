(() => {
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'worth-a-stop.theme';
  let preference;
  try { const saved = localStorage.getItem(key); if (['light', 'dark'].includes(saved)) preference = saved; } catch { /* Theme works without storage. */ }
  root.dataset.theme = preference || (system.matches ? 'dark' : 'light');

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('#theme-toggle');
    function label() {
      const dark = root.dataset.theme === 'dark';
      const ru = root.lang === 'ru';
      const action = ru ? dark ? 'Включить светлую тему' : 'Включить тёмную тему' : dark ? 'Switch to light theme' : 'Switch to dark theme';
      button.setAttribute('aria-label', action);
      button.setAttribute('aria-pressed', String(dark));
      button.title = action;
      button.querySelector('span').textContent = ru ? dark ? 'Светлая' : 'Тёмная' : dark ? 'Light' : 'Dark';
    }
    button.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = preference;
      try { localStorage.setItem(key, preference); } catch { /* Keep the choice in this tab. */ }
      label();
    });
    system.addEventListener('change', () => {
      if (!preference) { root.dataset.theme = system.matches ? 'dark' : 'light'; label(); }
    });
    window.addEventListener('storage', event => {
      if (event.key !== key && event.key !== null) return;
      preference = ['light', 'dark'].includes(event.newValue) ? event.newValue : undefined;
      root.dataset.theme = preference || (system.matches ? 'dark' : 'light');
      label();
    });
    new MutationObserver(label).observe(root, { attributes: true, attributeFilter: ['lang'] });
    document.addEventListener('click', event => {
      const add = event.target instanceof Element ? event.target.closest('.add-to-plan') : null;
      if (!add || add.disabled || motion.matches) return;
      add.animate([{ transform: 'scale(1)' }, { transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      add.classList.add('just-added');
      setTimeout(() => add.classList.remove('just-added'), 1100);
    });
    label();
  }, { once: true });
})();
