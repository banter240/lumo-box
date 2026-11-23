/**
 * Lumo desktop: light/dark mode for the bundled pages (settings, search, login).
 *
 * Follows the hosted web app's theme as reported through `theme-reporter.ts`, and the OS
 * preference until the web app has reported. Loaded from <head> so `data-theme` is set before
 * first paint.
 */
import { tauriInvoke } from '../shared/tauri';

type Theme = 'light' | 'dark';

(function () {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let webTheme: Theme | null = null;

  const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

  const apply = () => {
    document.documentElement.dataset.theme = webTheme ?? (media.matches ? 'dark' : 'light');
  };

  apply();
  media.addEventListener('change', apply);

  tauriInvoke<Theme | null>('get_web_theme')
    .then((theme) => {
      if (isTheme(theme)) {
        webTheme = theme;
        apply();
      }
    })
    .catch(() => {});

  const listen = window.__TAURI__?.event?.listen || window.__TAURI_INTERNALS__?.event?.listen;
  void listen?.('web-theme:changed', (event) => {
    if (isTheme(event.payload)) {
      webTheme = event.payload;
      apply();
    }
  }).catch(() => {});
})();
