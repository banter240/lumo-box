import { tauriInvoke } from '../shared/tauri';

(function () {
  if (window.top !== window) return;
  let host: HTMLDivElement | undefined;
  const queue: Parameters<NonNullable<Window['__lumoDownloadFeedback']>>[0][] = [];

  function show(result: typeof queue[number]) {
    if (!document.body) {
      queue.push(result);
      return;
    }
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:calc(100vw - 48px)';
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        section { display:flex; flex-direction:column; gap:8px; }
        article { box-sizing:border-box; width:360px; max-width:calc(100vw - 48px); padding:16px;
          border:1px solid var(--border-norm, #7775); border-radius:12px; background:var(--background-norm, #fff);
          color:var(--text-norm, #222); box-shadow:0 6px 24px #0003; font:14px/1.5 system-ui,sans-serif; }
        p { margin:0 0 8px; overflow-wrap:anywhere; }
        nav { display:flex; align-items:center; gap:12px; }
        button { font:inherit; cursor:pointer; border:0; border-radius:5px; padding:4px 8px;
          color:inherit; background:var(--background-weak, #efedf7); }
        button:focus-visible { outline:2px solid var(--interaction-norm, #9b81ff); outline-offset:2px; }
        .dismiss { margin-left:auto; }
      `;
      const container = document.createElement('section');
      root.append(style, container);
      append = (element) => {
        while (container.children.length >= 3) container.firstElementChild?.dispatchEvent(new Event('dismiss'));
        container.append(element);
      };
      document.body.append(host);
    }

    const toast = document.createElement('article');
    toast.setAttribute('role', result.success ? 'status' : 'alert');
    toast.setAttribute('aria-live', result.success ? 'polite' : 'assertive');
    const message = document.createElement('p');
    message.textContent = result.success
      ? (result.name ? `Downloaded ${result.name}` : 'File downloaded')
      : 'Couldn’t download the file. Please try again.';
    const actions = document.createElement('nav');
    if (result.success && result.id) {
      const reveal = document.createElement('button');
      reveal.textContent = result.mac ? 'Show in Finder' : 'Show in folder';
      reveal.onclick = async () => {
        reveal.disabled = true;
        try {
          await tauriInvoke('reveal_download', { id: result.id });
          dismiss();
        } catch {
          message.textContent = 'Couldn’t find the file. It may have moved or been removed.';
          reveal.disabled = false;
        }
      };
      actions.append(reveal);
    }
    const close = document.createElement('button');
    close.className = 'dismiss';
    close.textContent = 'Dismiss';
    actions.append(close);
    toast.append(message, actions);
    let timer: ReturnType<typeof setTimeout>;
    const pause = () => clearTimeout(timer);
    const resume = () => { pause(); timer = setTimeout(dismiss, 8000); };
    function dismiss() { pause(); toast.remove(); }
    close.onclick = dismiss;
    toast.addEventListener('dismiss', dismiss);
    toast.onmouseenter = pause;
    toast.onmouseleave = () => { if (!toast.matches(':focus-within')) resume(); };
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', () => { if (!toast.matches(':hover')) resume(); });
    append(toast);
    resume();
  }
  let append: (element: HTMLElement) => void;
  window.__lumoDownloadFeedback = show;
  document.addEventListener('DOMContentLoaded', () => queue.splice(0).forEach(show), { once: true });
})();
