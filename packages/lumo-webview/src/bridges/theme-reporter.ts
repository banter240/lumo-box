/**
 * Lumo desktop: tell Rust whether the hosted web app is rendering light or dark.
 *
 * Injected into the main Lumo webview. The web app's theme is a user setting (light, dark or
 * auto) stored on its own origin, so the bundled pages (settings, search, login) cannot read it.
 * `LumoThemeProvider` renders the active palette as `<style id="lumo-dark-theme">` or
 * `<style id="lumo-light-theme">`; that element is the resolved theme, auto mode included.
 * Pages without it (account sign-in) leave the last reported theme in place.
 */
import { logError } from '../shared/logger';
import { tauriInvoke } from '../shared/tauri';

(function () {
  let reported: 'light' | 'dark' | null = null;
  let scheduled = false;

  const check = () => {
    scheduled = false;
    const theme = document.getElementById('lumo-dark-theme')
      ? 'dark'
      : document.getElementById('lumo-light-theme')
        ? 'light'
        : null;
    if (!theme || theme === reported) return;
    reported = theme;
    tauriInvoke('report_web_theme', { theme }).catch((err) => logError('report_web_theme failed', err));
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(check);
  };

  // React may keep the same <style> node and only swap its id, so watch attributes as well.
  new MutationObserver(schedule).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id'],
  });
  schedule();
})();
