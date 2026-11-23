/**
 * Shared chrome for the docked lumo_box sidebar, rendered on both sides of
 * the proxy. The bar lives in a shadow DOM (open root, guarded mount):
 * host page styles cannot leak in, so both hosts render it identical.
 * One mount script, one stylesheet, one item list; theme colors ride the
 * host's CSS custom properties, which do inherit through the boundary.
 *
 * The bar also owns the server actions that used to live in the page
 * headers (theme, updates, auth state, restart, shutdown, lock): markup
 * and bindings are defined once here, and each host enables them via the
 * host div's data-actions list, so the lumo_box pages and the proxied app
 * carry the same controls from this single source.
 */

const svg = (paths: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const NAV_ICON_LUMO = svg(
  '<circle cx="12" cy="13.5" r="6.5"/><path d="M6.8 9 5 3.5 9.8 6.8"/><path d="M17.2 9 19 3.5 14.2 6.8"/>',
);
export const NAV_ICON_ACCOUNT = svg(
  '<circle cx="12" cy="8" r="3.5"/><path d="M5 19.5c.8-3.2 3.5-5 7-5s6.2 1.8 7 5"/>',
);
export const NAV_ICON_SETTINGS = svg(
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 .33-1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
);
export const NAV_ICON_LOGS = svg(
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
);
const NAV_ICON_RESTART = svg(
  '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/>',
);
const NAV_ICON_POWER = svg(
  '<path d="M12 3v8"/><path d="M6.3 6.5a8 8 0 1 0 11.4 0"/>',
);
const NAV_ICON_LOCK = svg(
  '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
);
const NAV_ICON_GITHUB = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.54 9.54 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>`;

export type NavAction =
  "theme" | "updates" | "authstatus" | "restart" | "shutdown" | "lock";

export const NAV_ITEMS = [
  { id: "lumo", label: "Lumo webapp", href: "/", icon: NAV_ICON_LUMO },
  { id: "auth", label: "Account", href: "/auth", icon: NAV_ICON_ACCOUNT },
  { id: "config", label: "Settings", href: "/config", icon: NAV_ICON_SETTINGS },
  { id: "logs", label: "Logs", href: "/logs", icon: NAV_ICON_LOGS },
] as const;

export type NavActive = (typeof NAV_ITEMS)[number]["id"];

const THEME_SUN =
  '<svg class="theme-icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const THEME_MOON =
  '<svg class="theme-icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 14.3A8.4 8.4 0 1 1 9.7 3 7 7 0 0 0 21 14.3z"/></svg>';
const THEME_MONITOR =
  '<svg class="theme-icon-monitor" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';

const GITHUB_URL = "https://github.com/banter240/lumo-box";

/** Refresh/update icon for the update chip. */
const NAV_ICON_UPDATE = svg(
  '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/><path d="M9 17V9"/><path d="M13 17v-4"/><path d="M17 17v-2"/>',
);

/** Server actions per host. Every host gets the SAME set — the sidebar has
 * exactly one state on all pages; only the active item is highlighted. */
function actionsMarkup(actions: NavAction[]): string {
  const parts: string[] = [];
  if (actions.includes("updates")) {
    parts.push(
      `<button type="button" class="box-nav-item box-nav-chip" id="updateChip" aria-label="Updates" title="Updates">${NAV_ICON_UPDATE}<span class="box-nav-label">Updates</span></button>`,
    );
  }
  if (actions.includes("authstatus")) {
    // Binding updates the SPAN (textContent would wipe the icon).
    parts.push(
      `<button type="button" class="box-nav-item box-nav-chip" id="authChip" hidden aria-label="Account" title="Account">${NAV_ICON_ACCOUNT}<span class="box-nav-label">…</span></button>`,
    );
  }
  parts.push(
    `<a class="box-nav-item" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">${NAV_ICON_GITHUB}<span class="box-nav-label">GitHub</span></a>`,
  );
  if (actions.includes("theme")) {
    parts.push(
      '<button type="button" class="box-nav-item" id="themeToggle" aria-label="Toggle theme"></button>',
    ); // label comes from the theme binding
  }
  if (actions.includes("restart")) {
    parts.push(
      `<button type="button" class="box-nav-item" id="uiRestartBtn" aria-label="Restart server" title="Restart server">${NAV_ICON_RESTART}<span class="box-nav-label">Restart</span></button>`,
    );
  }
  if (actions.includes("shutdown")) {
    parts.push(
      `<button type="button" class="box-nav-item box-nav-danger" id="uiShutdownBtn" aria-label="Shut down server" title="Shut down server">${NAV_ICON_POWER}<span class="box-nav-label">Shutdown</span></button>`,
    );
  }
  if (actions.includes("lock")) {
    parts.push(
      `<button type="button" class="box-nav-item" id="uiLockBtn" aria-label="Lock web UI" title="Lock web UI (clear the unlock cookie)">${NAV_ICON_LOCK}<span class="box-nav-label">Lock</span></button>`,
    );
  }
  return parts.join("\n  ");
}

function buildMarkup(actions: NavAction[]): string {
  return `<nav id="box-nav" aria-label="Box navigation">
  <button type="button" id="box-nav-toggle" aria-label="Toggle navigation"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg><span class="box-nav-label">Box</span></button>
  ${NAV_ITEMS.map(
    (item) =>
      `<a class="box-nav-item" data-id="${item.id}" href="${item.href}">${item.icon}<span class="box-nav-label">${item.label}</span></a>`,
  ).join("\n  ")}
  <div class="box-nav-sep"></div>
  ${actionsMarkup(actions)}
</nav>`;
}

const NAV_SHADOW_CSS = `
:host { position: fixed; left: 0; top: 0; bottom: 0; z-index: 900;
  width: 52px; display: flex; flex-direction: column; gap: 2px; padding: 10px 8px;
  box-sizing: border-box; overflow: hidden; transition: width .16s ease;
  background: var(--card, #1d1a26); border-right: 1px solid var(--line, #3b364a);
  font-family: system-ui, sans-serif; font-size: 14px; }
/* Webapp host: the app owns the page; the nav follows the app theme via
   data-navtheme set by the observer in buildMountJs (desktop theme.ts
   pattern). Explicit palettes instead of inherited vars, which the app
   page does not define. */
:host([data-navtheme="light"]) { --card: #f5f4f8; --line: #d8d5e0; --muted: #6d6883; --purple: #6d4aff; --purple-soft: rgba(109,74,255,.14); }
:host([data-navtheme="dark"]) { --card: #1d1a26; --line: #3b364a; --muted: #a39eb8; --purple: #8b7cff; --purple-soft: rgba(139,124,255,.18); }
:host(.expanded) { width: 200px; }
nav { display: contents; }
.box-nav-item, #box-nav-toggle {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px;
  border: 0; background: none; color: var(--muted, #a39eb8); text-decoration: none;
  font: 500 14px/1.2 system-ui, sans-serif; white-space: nowrap; cursor: pointer; text-align: left; }
.box-nav-item:hover, #box-nav-toggle:hover { background: var(--purple-soft, rgba(139,124,255,.18)); color: var(--purple, #8b7cff); }
.box-nav-item.active { background: var(--purple-soft, rgba(139,124,255,.18)); color: var(--purple, #8b7cff); }
.box-nav-item.box-nav-danger:hover { background: rgba(255,80,80,.18); color: #ff6b6b; }
.box-nav-chip { font-size: 12px; padding: 8px 10px; overflow: hidden; text-overflow: ellipsis; }
.box-nav-chip .box-nav-label { text-overflow: ellipsis; }
.box-nav-chip.ready { color: var(--purple, #8b7cff); }
.box-nav-chip.err { color: #ff6b6b; }
svg { width: 18px; height: 18px; flex: none; }
.box-nav-label { opacity: 0; transition: opacity .12s; font: inherit; }
:host(.expanded) .box-nav-label { opacity: 1; }
#box-nav-toggle svg { transition: transform .16s ease; }
:host(.expanded) #box-nav-toggle svg { transform: rotate(180deg); }
.box-nav-sep { height: 1px; margin: 6px 4px; background: var(--line, #3b364a); flex: none; }
button.box-nav-item { width: 100%; }
`;

/** Bindings for the action buttons, run inside the shadow root. Theme is
 * global (documentElement), so its store/apply stays host-document-wide;
 * the chips and power actions talk to the same endpoints the old page
 * header buttons used, so no server code changed for them. */
const ACTION_BINDINGS = `(function(sr,h){
function $(id){return sr.getElementById(id);}
var toast=function(msg,ok){var c=document.getElementById('toast-container');if(!c){ok?console.log(msg):console.warn(msg);return;}var el=document.createElement('div');el.className='toast '+(ok?'ok':'err');el.textContent=msg;el.title='Click to copy, then close';var gone=false;function bye(){if(gone)return;gone=true;el.style.opacity='0';el.style.transform='translateX(100%)';setTimeout(function(){el.remove();},300);}el.addEventListener('click',function(){try{navigator.clipboard.writeText(msg);}catch(e){}bye();});c.appendChild(el);if(ok)setTimeout(bye,4500);};window.__ltToast=window.__ltToast||toast;
(function(){var btn=$('themeToggle');if(!btn)return;btn.innerHTML='${THEME_SUN}${THEME_MOON}${THEME_MONITOR}<span class="box-nav-label">Theme</span>';var isAppHost=h.getAttribute('data-active')==='lumo';function appKey(){try{var seg=location.pathname.split('/');for(var i=0;i<seg.length;i++){if(seg[i]==='u'&&seg[i+1]){return 'lumo-settings:'+seg[i+1];}}return 'lumo-settings';}catch(e){return 'lumo-settings';}}function readApp(){try{var raw=localStorage.getItem(appKey());return raw?JSON.parse(raw):{};}catch(e){return {};}}function writeApp(o){try{localStorage.setItem(appKey(),JSON.stringify(o));}catch(e){}}function icons(mode){var sun=btn.querySelector('.theme-icon-sun');var moon=btn.querySelector('.theme-icon-moon');var mon=btn.querySelector('.theme-icon-monitor');if(sun)sun.style.display=mode==='light'?'':'none';if(moon)moon.style.display=mode==='dark'?'':'none';if(mon)mon.style.display=mode==='system'?'':'none';}if(isAppHost){/* The app owns its theme via its E2E-encrypted SERVER user
settings. Drive them through the lumo_box bridge (same write path as the
app's own Appearance UI: decrypt -> patch theme -> encrypt -> PUT),
then reload — the app boots with the new server-side mode.
Two-state light<->dark on purpose: 'system' resolves like the current
mode whenever the OS matches (a felt no-op); it stays settable in the
app's own Appearance settings. */
function paintApp(){var o=readApp();var cur=o.mode===1?'dark':(o.mode===2?'light':'system');/* Icon of what clicking switches TO (GitHub-style): light -> dark -> system, so every step is visibly different even when 'system' resolves to the current palette. */var order=['light','dark','system'];var target=order[(order.indexOf(cur)+1)%3];icons(target);var txt=target==='light'?'Switch to light mode':(target==='dark'?'Switch to dark mode':'Theme: follow system');btn.setAttribute('aria-label',txt);btn.title=txt;}paintApp();btn.addEventListener('click',function(){var o=readApp();var cur=o.mode===1?'dark':(o.mode===2?'light':'system');var order=['light','dark','system'];var next=order[(order.indexOf(cur)+1)%3];btn.disabled=true;btn.style.opacity='0.5';var inv=window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke;var call=inv?window.__TAURI_INTERNALS__.invoke('set_web_theme',{mode:next}):Promise.reject(new Error('no bridge'));call.then(function(){location.reload();}).catch(function(e){btn.disabled=false;btn.style.opacity='';var t=window.__ltToast;t&&t('Theme change failed: are you signed in?',false);});});return;}var LS_KEY='lumo-box-mode';function modeKey(v){return v==='light'||v==='dark'||v==='system'?v:null;}function readMode(){try{var v=localStorage.getItem(LS_KEY);return modeKey(v)||'system';}catch(e){return 'system';}}function sysDark(){try{return matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){return false;}}function resolve(m){return m==='system'?(sysDark()?'dark':'light'):m;}function paint(){var mode=readMode();icons(mode);var txt=mode==='light'?'Light mode':(mode==='dark'?'Dark mode':'Theme: follow system');btn.setAttribute('aria-label',txt);btn.title=txt;}function apply(mode,persist){document.documentElement.setAttribute('data-theme',resolve(mode));if(persist!==false){try{localStorage.setItem(LS_KEY,mode);}catch(e){}}paint();}var cur=readMode();if(document.documentElement.getAttribute('data-theme')!==resolve(cur)){document.documentElement.setAttribute('data-theme',resolve(cur));}paint();try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){if(readMode()==='system')apply('system',false);});}catch(e){}btn.addEventListener('click',function(){var order=['light','dark','system'];var next=order[(order.indexOf(readMode())+1)%3];apply(next);});})();
(function(){var btn=$('uiLockBtn');if(!btn)return;btn.addEventListener('click',function(){var f=document.createElement('form');f.method='post';f.action='/ui-logout';document.body.appendChild(f);f.submit();});})();
(function(){var btn=$('uiRestartBtn');if(!btn)return;btn.addEventListener('click',function(){if(btn.disabled)return;if(!confirm('Restart the server now?'))return;btn.disabled=true;btn.style.opacity='0.5';fetch('/v1/restart',{method:'POST'}).catch(function(){}).then(function(){var tries=0;(function poll(){tries++;if(tries>60){alert('Server did not come back. Docker should restart it; if you started it by hand, start it again, then press F5.');return;}setTimeout(function(){fetch('/health',{cache:'no-store'}).then(function(r){if(r.ok){location.reload();}else{poll();}}).catch(function(){poll();});},500);})();});});})();
(function(){var btn=$('uiShutdownBtn');if(!btn)return;btn.addEventListener('click',function(){if(btn.disabled)return;if(!confirm('Shut the server down NOW?\\nIt will NOT come back on its own: no process respawns, scheduled runs stop, and the web app goes offline until you start lumo_box again by hand (or Docker recreates the container).'))return;btn.disabled=true;btn.style.opacity='0.5';toast('Shutting down…',true);fetch('/v1/shutdown',{method:'POST'}).catch(function(){}).then(function(){var tries=0;(function poll(){tries++;if(tries>8){document.title='(offline) '+document.title;alert('Server is down. Start lumo_box again to use it, then reload this page.');return;}setTimeout(function(){fetch('/health',{cache:'no-store'}).then(function(){poll();}).catch(function(){poll();});},750);})();});});})();
(function(){var chip=$('authChip');if(!chip)return;chip.hidden=false;chip.addEventListener('click',function(){location.href='/auth';});var label=chip.querySelector('.box-nav-label');function setText(t){chip.title=t;if(label){label.textContent=t;}else{chip.textContent=t;}}var was=null;function poll(){fetch('/health',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){var valid=!!(d&&d.auth&&d.auth.valid);setText(valid?'Signed in':'Not signed in');chip.classList.toggle('ready',valid);chip.classList.toggle('err',!valid);if(was===true&&!valid)toast('Signed out — waiting for authentication',false);was=valid;}).catch(function(){setText('No server');chip.classList.add('err');chip.classList.remove('ready');});}poll();setInterval(poll,5000);})();
(function(){var chip=$('updateChip');if(!chip)return;var label=chip.querySelector('.box-nav-label');function setText(t){if(label){label.textContent=t;}else{chip.textContent=t;}}var info=null;var busy=false;function paint(){chip.disabled=busy;chip.classList.toggle('ready',!!(info&&info.available));if(busy){setText('Checking…');return;}if(info&&info.available){var verb=info.action==='update'?'Update to ':'Switch to ';setText(verb+(info.latest||''));chip.title=info.canApply?(info.applyHint||'Apply the update'):(info.applyHint||'Cannot apply from this page');return;}if(info&&info.error){setText('Updates');chip.title=info.error+' — click to check again';return;}setText('Up to date');chip.title=(info&&info.current?'Running '+info.current+'. ':'')+'Click to check again';}function check(force){if(busy)return;busy=true;paint();var url=force?'/v1/update?refresh=1':'/v1/update';fetch(url,{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){info=d;busy=false;paint();if(force&&info&&!info.available&&!info.error)toast('Up to date ('+(info.current||'?')+')',true);if(force&&info&&info.error)toast(info.error,false);}).catch(function(err){busy=false;info={error:err.message||'Update check failed'};paint();if(force)toast(info.error,false);});}function apply(){var latest=(info&&info.latest)||'the new image';if(!confirm('Update to '+latest+' and restart this server now? Chat pauses until it is back.'))return;busy=true;setText('Updating…');chip.disabled=true;fetch('/v1/update',{method:'POST'}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.message||d.error||'Update failed');return d;});}).then(function(){var tries=0;(function poll(){tries++;if(tries>360){location.reload();return;}setTimeout(function(){fetch('/health',{cache:'no-store'}).then(function(r){if(r.ok){location.reload();}else{poll();}}).catch(function(){poll();});},500);})();}).catch(function(err){toast(err.message||'Update failed',false);busy=false;paint();});}chip.addEventListener('click',function(ev){if(busy)return;if(ev.shiftKey){check(true);return;}if(info&&info.available&&info.canApply)apply();else if(info&&info.available)toast(info.applyHint||'Cannot apply from this page',false);else check(true);});check(false);})();
})(sr,h);`;

/** Runs on both hosts verbatim: builds the shadow root, highlights the
 * active item from the host div's data-active, mounts the action buttons
 * listed in data-actions, and owns the toggle. */
function buildMountJs(markup: string): string {
  return `(function(){var h=document.getElementById('box-nav-host');if(!h||h.__boxNav)return;h.__boxNav=1;var sr=h.attachShadow({mode:'open'});sr.innerHTML=${JSON.stringify(`<style>${NAV_SHADOW_CSS}</style>${markup}`).replace(/</g, "\\u003c")};var btn=sr.getElementById('box-nav-toggle');var active=h.getAttribute('data-active');if(active){var el=sr.querySelector('.box-nav-item[data-id="'+active+'"]');if(el)el.classList.add('active');}(function(){if(h.getAttribute('data-active')!=='lumo')return;function sniff(){var dark=document.getElementById('lumo-dark-theme');var light=document.getElementById('lumo-light-theme');var t=dark?'dark':(light?'light':(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));h.setAttribute('data-navtheme',t);}sniff();new MutationObserver(sniff).observe(document.body,{attributes:true,attributeFilter:['id'],childList:true,subtree:false});})();(function(){if(h.getAttribute('data-webapp')!=='off')return;var link=sr.querySelector('.box-nav-item[data-id="lumo"]');if(!link)return;link.title='The web app is disabled — click to open the settings page and enable it';link.addEventListener('click',function(ev){ev.preventDefault();var toast=window.__ltToast;if(toast)toast('Webapp is disabled — enable it on the settings page',false);location.href='/config';});})();var expanded=false;try{expanded=localStorage.getItem('box-nav-expanded')==='1';}catch(e){}function paint(){h.classList.toggle('expanded',expanded);document.body.classList.toggle('box-nav-expanded',expanded);}paint();btn.addEventListener('click',function(){expanded=!expanded;paint();try{localStorage.setItem('box-nav-expanded',expanded?'1':'0');}catch(e){}});(function(){var actions=(h.getAttribute('data-actions')||'').split(' ').filter(Boolean);var nodes=sr.querySelectorAll('[id]');for(var i=0;i<nodes.length;i++){var id=nodes[i].id;if(nodes[i].tagName!=='BUTTON')continue;if(id==='box-nav-toggle')continue;if(id==='updateChip'&&actions.indexOf('updates')===-1){nodes[i].remove();continue;}if(id==='authChip'&&actions.indexOf('authstatus')===-1){nodes[i].remove();continue;}if(id==='themeToggle'&&actions.indexOf('theme')===-1){nodes[i].remove();continue;}if(id==='uiRestartBtn'&&actions.indexOf('restart')===-1){nodes[i].remove();continue;}if(id==='uiShutdownBtn'&&actions.indexOf('shutdown')===-1){nodes[i].remove();continue;}if(id==='uiLockBtn'&&actions.indexOf('lock')===-1){nodes[i].remove();continue;}}${ACTION_BINDINGS}})();})();`;
}

const FULL_ACTIONS: NavAction[] = [
  "theme",
  "updates",
  "authstatus",
  "restart",
  "shutdown",
  "lock",
];

/** Box pages (/auth, /config, /logs): everything, minus lock on loopback.
 * `webappOn` reflects the live config so the nav can route the webapp item
 * to the settings page (with a hint toast) while it is disabled. */
export function renderNavHost(
  active?: NavActive,
  localUi?: boolean,
  webappOn?: boolean,
): string {
  const actions = localUi
    ? FULL_ACTIONS.filter((a) => a !== "lock")
    : FULL_ACTIONS;
  return `<div id="box-nav-host" data-actions="${actions.join(" ")}"${active ? ` data-active="${active}"` : ""} data-webapp="${webappOn === false ? "off" : "on"}"></div>`;
}

/** The proxied web app: same bar as the lumo_box pages minus `lock` (always
 * a local session). The theme toggle writes the app's E2E-encrypted
 * SERVER user settings via the bridge command (set_web_theme) — same
 * authority as the app's own Appearance UI, survives every reload. */
export function renderWebappNavHost(): string {
  const actions = FULL_ACTIONS.filter((a) => a !== "lock");
  return `<div id="box-nav-host" data-active="lumo" data-actions="${actions.join(" ")}"></div>`;
}

export function navMountJs(): string {
  return buildMountJs(buildMarkup(FULL_ACTIONS));
}

export const NAV_MOUNT_JS = navMountJs();
