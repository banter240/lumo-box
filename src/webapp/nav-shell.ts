/**
 * Shared chrome for the docked tamer sidebar, rendered on both sides of
 * the proxy. The bar lives in a shadow DOM (open root, guarded mount):
 * host page styles cannot leak in, so both hosts render it identical.
 * One mount script, one stylesheet, one item list; theme colors ride the
 * host's CSS custom properties, which do inherit through the boundary.
 *
 * The bar also owns the server actions that used to live in the page
 * headers (theme, updates, auth state, restart, shutdown, lock): markup
 * and bindings are defined once here, and each host enables them via the
 * host div's data-actions list, so the tamer pages and the proxied app
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

const GITHUB_URL = "https://github.com/banter240/lumo-tamer";

/** Server actions per host. The tamer pages enable everything (lock only
 * when served to a remote browser); the web app gets the safe subset. */
function actionsMarkup(actions: NavAction[]): string {
  const parts: string[] = [];
  if (actions.includes("updates")) {
    parts.push(
      '<button type="button" class="tamer-nav-item tamer-nav-chip" id="updateChip">Updates</button>',
    );
  }
  if (actions.includes("authstatus")) {
    parts.push(
      '<button type="button" class="tamer-nav-item tamer-nav-chip" id="authChip" hidden>…</button>',
    );
  }
  parts.push(
    `<a class="tamer-nav-item" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">${NAV_ICON_GITHUB}<span class="tamer-nav-label">GitHub</span></a>`,
  );
  if (actions.includes("theme")) {
    parts.push(
      '<button type="button" class="tamer-nav-item" id="themeToggle" aria-label="Toggle theme"></button>',
    );
  }
  if (actions.includes("restart")) {
    parts.push(
      `<button type="button" class="tamer-nav-item" id="uiRestartBtn" aria-label="Restart server" title="Restart server">${NAV_ICON_RESTART}<span class="tamer-nav-label">Restart</span></button>`,
    );
  }
  if (actions.includes("shutdown")) {
    parts.push(
      `<button type="button" class="tamer-nav-item tamer-nav-danger" id="uiShutdownBtn" aria-label="Shut down server" title="Shut down server">${NAV_ICON_POWER}<span class="tamer-nav-label">Shutdown</span></button>`,
    );
  }
  if (actions.includes("lock")) {
    parts.push(
      `<button type="button" class="tamer-nav-item" id="uiLockBtn" aria-label="Lock web UI" title="Lock web UI (clear the unlock cookie)">${NAV_ICON_LOCK}<span class="tamer-nav-label">Lock</span></button>`,
    );
  }
  return parts.join("\n  ");
}

function buildMarkup(actions: NavAction[]): string {
  return `<nav id="tamer-nav" aria-label="Tamer navigation">
  <button type="button" id="tamer-nav-toggle" aria-label="Toggle navigation"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg><span class="tamer-nav-label">Tamer</span></button>
  ${NAV_ITEMS.map(
    (item) =>
      `<a class="tamer-nav-item" data-id="${item.id}" href="${item.href}">${item.icon}<span class="tamer-nav-label">${item.label}</span></a>`,
  ).join("\n  ")}
  <div class="tamer-nav-sep"></div>
  ${actionsMarkup(actions)}
</nav>`;
}

const NAV_SHADOW_CSS = `
:host { position: fixed; left: 0; top: 0; bottom: 0; z-index: 900;
  width: 52px; display: flex; flex-direction: column; gap: 2px; padding: 10px 8px;
  box-sizing: border-box; overflow: hidden; transition: width .16s ease;
  background: var(--card, #1d1a26); border-right: 1px solid var(--line, #3b364a);
  font-family: system-ui, sans-serif; font-size: 14px; }
:host(.expanded) { width: 200px; }
nav { display: contents; }
.tamer-nav-item, #tamer-nav-toggle {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px;
  border: 0; background: none; color: var(--muted, #a39eb8); text-decoration: none;
  font: 500 14px/1.2 system-ui, sans-serif; white-space: nowrap; cursor: pointer; text-align: left; }
.tamer-nav-item:hover, #tamer-nav-toggle:hover { background: var(--purple-soft, rgba(139,124,255,.18)); color: var(--purple, #8b7cff); }
.tamer-nav-item.active { background: var(--purple-soft, rgba(139,124,255,.18)); color: var(--purple, #8b7cff); }
.tamer-nav-item.tamer-nav-danger:hover { background: rgba(255,80,80,.18); color: #ff6b6b; }
.tamer-nav-chip { justify-content: center; font-size: 12px; padding: 8px 10px; overflow: hidden; text-overflow: ellipsis; }
.tamer-nav-chip.ready { color: var(--purple, #8b7cff); }
.tamer-nav-chip.err { color: #ff6b6b; }
svg { width: 18px; height: 18px; flex: none; }
.tamer-nav-label { opacity: 0; transition: opacity .12s; font: inherit; }
:host(.expanded) .tamer-nav-label { opacity: 1; }
#tamer-nav-toggle svg { transition: transform .16s ease; }
:host(.expanded) #tamer-nav-toggle svg { transform: rotate(180deg); }
.tamer-nav-sep { height: 1px; margin: 6px 4px; background: var(--line, #3b364a); flex: none; }
button.tamer-nav-item { width: 100%; }
`;

/** Bindings for the action buttons, run inside the shadow root. Theme is
 * global (documentElement), so its store/apply stays host-document-wide;
 * the chips and power actions talk to the same endpoints the old page
 * header buttons used, so no server code changed for them. */
const ACTION_BINDINGS = `(function(sr){
function $(id){return sr.getElementById(id);}
var toast=function(msg,ok){var c=document.getElementById('toast-container');if(!c){ok?console.log(msg):console.warn(msg);return;}var el=document.createElement('div');el.className='toast '+(ok?'ok':'err');el.textContent=msg;el.title='Click to copy, then close';var gone=false;function bye(){if(gone)return;gone=true;el.style.opacity='0';el.style.transform='translateX(100%)';setTimeout(function(){el.remove();},300);}el.addEventListener('click',function(){try{navigator.clipboard.writeText(msg);}catch(e){}bye();});c.appendChild(el);if(ok)setTimeout(bye,4500);};window.__ltToast=window.__ltToast||toast;
(function(){var btn=$('themeToggle');if(!btn)return;btn.innerHTML='${THEME_SUN}${THEME_MOON}';function paint(){var dark=document.documentElement.getAttribute('data-theme')==='dark';var sun=btn.querySelector('.theme-icon-sun');var moon=btn.querySelector('.theme-icon-moon');if(sun)sun.style.display=dark?'none':'';if(moon)moon.style.display=dark?'':'none';btn.setAttribute('aria-label',dark?'Dark mode':'Light mode');btn.title=dark?'Dark mode':'Light mode';}paint();btn.addEventListener('click',function(){var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('lumo-tamer-theme',next);}catch(e){}paint();});})();
(function(){var btn=$('uiLockBtn');if(!btn)return;btn.addEventListener('click',function(){var f=document.createElement('form');f.method='post';f.action='/ui-logout';document.body.appendChild(f);f.submit();});})();
(function(){var btn=$('uiRestartBtn');if(!btn)return;btn.addEventListener('click',function(){if(btn.disabled)return;if(!confirm('Restart the server now?'))return;btn.disabled=true;btn.style.opacity='0.5';fetch('/v1/restart',{method:'POST'}).catch(function(){}).then(function(){var tries=0;(function poll(){tries++;if(tries>60){alert('Server did not come back. Docker should restart it; if you started it by hand, start it again, then press F5.');return;}setTimeout(function(){fetch('/health',{cache:'no-store'}).then(function(r){if(r.ok){location.reload();}else{poll();}}).catch(function(){poll();});},500);})();});});})();
(function(){var btn=$('uiShutdownBtn');if(!btn)return;btn.addEventListener('click',function(){if(btn.disabled)return;if(!confirm('Shut the server down NOW?\\nIt will NOT come back on its own: no process respawns, scheduled runs stop, and the web app goes offline until you start tamer again by hand (or Docker recreates the container).'))return;btn.disabled=true;btn.style.opacity='0.5';toast('Shutting down…',true);fetch('/v1/shutdown',{method:'POST'}).catch(function(){}).then(function(){var tries=0;(function poll(){tries++;if(tries>8){document.title='(offline) '+document.title;alert('Server is down. Start tamer again to use it, then reload this page.');return;}setTimeout(function(){fetch('/health',{cache:'no-store'}).then(function(){poll();}).catch(function(){poll();});},750);})();});});})();
(function(){var chip=$('authChip');if(!chip)return;chip.hidden=false;chip.addEventListener('click',function(){location.href='/auth';});var was=null;function poll(){fetch('/health',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){var valid=!!(d&&d.auth&&d.auth.valid);chip.textContent=valid?'Signed in':'Not signed in';chip.title=valid?'Signed in to Proton':'Waiting for authentication — click to open /auth';chip.classList.toggle('ready',valid);chip.classList.toggle('err',!valid);if(was===true&&!valid)toast('Signed out — waiting for authentication',false);was=valid;}).catch(function(){chip.textContent='No server';chip.classList.add('err');chip.classList.remove('ready');});}poll();setInterval(poll,5000);})();
(function(){var chip=$('updateChip');if(!chip)return;var info=null;var busy=false;function paint(){chip.disabled=busy;chip.classList.toggle('ready',!!(info&&info.available));if(busy){chip.textContent='Checking…';return;}if(info&&info.available){var verb=info.action==='update'?'Update to ':'Switch to ';chip.textContent=verb+(info.latest||'');chip.title=info.canApply?(info.applyHint||'Apply the update'):(info.applyHint||'Cannot apply from this page');return;}if(info&&info.error){chip.textContent='Updates';chip.title=info.error+' — click to check again';return;}chip.textContent='Up to date';chip.title=(info&&info.current?'Running '+info.current+'. ':'')+'Click to check again';}function check(force){if(busy)return;busy=true;paint();var url=force?'/v1/update?refresh=1':'/v1/update';fetch(url,{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){info=d;busy=false;paint();if(force&&info&&!info.available&&!info.error)toast('Up to date ('+(info.current||'?')+')',true);if(force&&info&&info.error)toast(info.error,false);}).catch(function(err){busy=false;info={error:err.message||'Update check failed'};paint();if(force)toast(info.error,false);});}function apply(){var latest=(info&&info.latest)||'the new image';if(!confirm('Update to '+latest+' and restart this server now? Chat pauses until it is back.'))return;busy=true;chip.textContent='Updating…';chip.disabled=true;fetch('/v1/update',{method:'POST'}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.message||d.error||'Update failed');return d;});}).then(function(){var tries=0;(function poll(){tries++;if(tries>360){location.reload();return;}setTimeout(function(){fetch('/health',{cache:'no-store'}).then(function(r){if(r.ok){location.reload();}else{poll();}}).catch(function(){poll();});},500);})();}).catch(function(err){toast(err.message||'Update failed',false);busy=false;paint();});}chip.addEventListener('click',function(ev){if(busy)return;if(ev.shiftKey){check(true);return;}if(info&&info.available&&info.canApply)apply();else if(info&&info.available)toast(info.applyHint||'Cannot apply from this page',false);else check(true);});check(false);})();
})(sr);`;

/** Runs on both hosts verbatim: builds the shadow root, highlights the
 * active item from the host div's data-active, mounts the action buttons
 * listed in data-actions, and owns the toggle. */
function buildMountJs(markup: string): string {
  return `(function(){var h=document.getElementById('tamer-nav-host');if(!h||h.__tamerNav)return;h.__tamerNav=1;var sr=h.attachShadow({mode:'open'});sr.innerHTML=${JSON.stringify(`<style>${NAV_SHADOW_CSS}</style>${markup}`).replace(/</g, "\\u003c")};var btn=sr.getElementById('tamer-nav-toggle');var active=h.getAttribute('data-active');if(active){var el=sr.querySelector('.tamer-nav-item[data-id="'+active+'"]');if(el)el.classList.add('active');}var expanded=false;try{expanded=localStorage.getItem('tamer-nav-expanded')==='1';}catch(e){}function paint(){h.classList.toggle('expanded',expanded);document.body.classList.toggle('tamer-nav-expanded',expanded);}paint();btn.addEventListener('click',function(){expanded=!expanded;paint();try{localStorage.setItem('tamer-nav-expanded',expanded?'1':'0');}catch(e){}});(function(){var actions=(h.getAttribute('data-actions')||'').split(' ').filter(Boolean);var nodes=sr.querySelectorAll('[id]');for(var i=0;i<nodes.length;i++){var id=nodes[i].id;if(nodes[i].tagName!=='BUTTON')continue;if(id==='tamer-nav-toggle')continue;if(id==='updateChip'&&actions.indexOf('updates')===-1){nodes[i].remove();continue;}if(id==='authChip'&&actions.indexOf('authstatus')===-1){nodes[i].remove();continue;}if(id==='themeToggle'&&actions.indexOf('theme')===-1){nodes[i].remove();continue;}if(id==='uiRestartBtn'&&actions.indexOf('restart')===-1){nodes[i].remove();continue;}if(id==='uiShutdownBtn'&&actions.indexOf('shutdown')===-1){nodes[i].remove();continue;}if(id==='uiLockBtn'&&actions.indexOf('lock')===-1){nodes[i].remove();continue;}}${ACTION_BINDINGS}})();})();`;
}

const FULL_ACTIONS: NavAction[] = [
  "theme",
  "updates",
  "authstatus",
  "restart",
  "shutdown",
  "lock",
];

/** Tamer pages (/auth, /config, /logs): everything, minus lock on loopback. */
export function renderNavHost(active?: NavActive, localUi?: boolean): string {
  const actions = localUi
    ? FULL_ACTIONS.filter((a) => a !== "lock")
    : FULL_ACTIONS;
  return `<div id="tamer-nav-host" data-actions="${actions.join(" ")}"${active ? ` data-active="${active}"` : ""}></div>`;
}

/** The proxied web app: safe subset — no shutdown/restart/lock from there. */
export function renderWebappNavHost(): string {
  return `<div id="tamer-nav-host" data-active="lumo" data-actions="theme authstatus"></div>`;
}

export function navMountJs(): string {
  return buildMountJs(buildMarkup(FULL_ACTIONS));
}

export const NAV_MOUNT_JS = navMountJs();
