window.__ModuleLoader__.load({
  id: 'dsh-market-peek',
  factory() {
    /*
     * dsh-market-peek — preview plugin-market entries without leaving DSH.
     *
     * A plain click on a market card (its title link, or any blank part of the card) is taken over:
     *   1. When a conversation's right Sidebar is on screen, the repository opens in DSH's OWN
     *      browser tab there (`ctx.sidebarRight.openTab('browser', …)`). One preview tab is reused:
     *      the next card replaces it instead of piling up tabs.
     *   2. Otherwise (the market is a full page, there is no right column) a panel is DOCKED on the
     *      right of the market: the market itself is narrowed to make room, nothing is covered.
     * Leaving the market (switching page/tab) puts everything back: the panel goes away, the market
     * gets its width back, the preview tab is closed and a column that was collapsed collapses again.
     * Ctrl/Cmd/Shift/Alt-click keeps the original behaviour (external browser).
     */
    const LS_MODE = 'dsh-market-peek:mode';
    const LS_WIDTH = 'dsh-market-peek:width';
    const MIN_W = 360;
    const COPY = {
      zh: { external: '外部浏览器', close: '关闭', loading: '正在读取 README…', failed: '读不到 README。', modeHere: '此处展开', modeTitle: '点击插件卡片时', source: '来源' },
      en: { external: 'External browser', close: 'Close', loading: 'Loading README…', failed: 'README could not be loaded.', modeHere: 'Expand here', modeTitle: 'On card click', source: 'Source' },
    };
    /**
     * The language DSH itself is showing — the same value the market reads (`ctx.locale` active
     * language). The browser's own language is only a last resort: a Chinese Windows running an
     * English DSH must get English here, like the market around it. Read on every use, so switching
     * DSH's language applies to the next panel without a reload.
     */
    function lang() {
      let active;
      try { active = appCtx?.locale?.getSnapshot?.()?.active; } catch { active = undefined; }
      if (typeof active !== 'string' || active === '') {
        try { active = appCtx?.get?.('locale')?.getSnapshot?.()?.active; } catch { active = undefined; }
      }
      if (typeof active !== 'string' || active === '') active = document.documentElement.lang || navigator.language || 'en';
      return /^zh/i.test(active) ? 'zh' : 'en';
    }
    const T = new Proxy({}, { get: (_, key) => COPY[lang()][key] ?? COPY.en[key] ?? '' });

    let appCtx;

    // ---------------------------------------------------------------- helpers
    // 'here' (default: expand in place) or 'external'; values from older versions read as 'here'.
    const getMode = () => (localStorage.getItem(LS_MODE) === 'external' ? 'external' : 'here');
    const service = (name) => {
      try { return appCtx?.get?.(name); } catch { return undefined; }
    };
    const safe = (fn, fallback) => {
      try { return fn(); } catch { return fallback; }
    };
    const hasClassToken = (el, suffix) => {
      if (!(el instanceof Element)) return false;
      for (const token of el.classList) if (token.endsWith(suffix)) return true;
      return false;
    };
    const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const isShown = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
    const viewRight = () => document.documentElement.clientWidth || window.innerWidth;

    /** owner/repo (+ optional ref and sub directory) of a github.com URL, or null. */
    function parseRepo(href) {
      let url;
      try { url = new URL(href); } catch { return null; }
      if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/, '');
      let ref = '';
      let dir = '';
      if (parts[2] === 'tree' && parts.length >= 4) {
        ref = parts[3];
        dir = parts.slice(4).join('/');
      }
      return { owner, repo, ref, dir, url: `https://github.com/${owner}/${repo}${ref ? `/tree/${ref}${dir ? '/' + dir : ''}` : ''}` };
    }

    /** The market card an element lives in: the closest ancestor with an exact `*_card` class token that holds a title link. */
    function marketCardOf(el) {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (!(node instanceof Element)) continue;
        for (const token of node.classList) {
          if (/_card$/.test(token)) {
            return node.querySelector('a[class*="_nmLink"]') ? node : null;
          }
        }
      }
      return null;
    }

    /** The market page root of a title link: `<prefix>_root`, where `<prefix>_nmLink` is the link's own CSS-module class. */
    function marketRootOf(link) {
      for (const token of link.classList) {
        if (token.endsWith('_nmLink')) {
          const prefix = token.slice(0, token.length - 'nmLink'.length);
          const root = link.closest('.' + CSS.escape(prefix + 'root'));
          if (root) return root;
        }
      }
      return link.closest('[class*="_root"]') || link.parentElement;
    }

    // ----------------------------------------------------- page-leave watcher
    /** The market root the current preview belongs to; when it leaves the screen everything is restored. */
    let market = null;
    let watchTimer = 0;

    function startWatch() {
      if (!watchTimer) watchTimer = setInterval(tick, 400);
    }
    function stopWatch() {
      if (watchTimer) clearInterval(watchTimer);
      watchTimer = 0;
    }
    function tick() {
      if (!isShown(market)) {
        restoreAll();
        return;
      }
      placeDrawer();
    }
    /** Back to the original state: no panel, market at its own width, preview tab closed. */
    function restoreAll() {
      closeBrowserTab();
      closeDrawer();
    }
    function maybeStop() {
      if (!drawer && !browserTab) {
        market = null;
        stopWatch();
      }
    }

    // ------------------------------------------------- built-in browser route
    /** The preview tab this plugin opened: { sessionId, tabId, wasExpanded }. */
    let browserTab = null;

    /** Visible = laid out AND actually on top at its centre (not under a full-page view). */
    function sidebarVisible() {
      const seat = document.querySelector('[data-sidebar-right-session]');
      if (!seat) return false;
      const r = seat.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 200));
      return hit !== null && (seat.contains(hit) || hit.closest('webview') !== null);
    }

    function rightSeat() {
      const right = service('sidebarRight');
      if (!right || typeof right.openTab !== 'function') return null;
      const tabs = service('sidebarRightTabs');
      if (tabs && typeof tabs.get === 'function' && tabs.get('browser') === undefined) return null;
      const sessionId = safe(() => right.mounted?.getSnapshot?.(), undefined);
      if (sessionId === undefined) return null;
      return { right, sessionId };
    }

    function tabExists(right, sessionId, tabId) {
      if (tabId === undefined) return false;
      return safe(() => typeof right.tabsIn === 'function' && right.tabsIn(sessionId).some((tab) => tab.id === tabId), false);
    }

    /** Open (or re-point) the single preview tab in DSH's right Sidebar; false when there is no seat. */
    function openInBuiltinBrowser(url) {
      const seat = rightSeat();
      if (!seat) return false;
      const { right, sessionId } = seat;
      const same = browserTab !== null && browserTab.sessionId === sessionId;
      const reuse = same && tabExists(right, sessionId, browserTab.tabId) ? browserTab.tabId : undefined;
      const wasExpanded = same ? browserTab.wasExpanded : safe(() => right.isExpanded(), true);
      try {
        right.openTab('browser', { params: { url }, ...(reuse !== undefined ? { replaceTab: reuse } : {}) });
      } catch (error) {
        console.warn('[dsh-market-peek] built-in browser unavailable:', error);
        return false;
      }
      safe(() => { if (!right.isExpanded()) right.toggleExpanded(); });
      const entry = { sessionId, tabId: undefined, wasExpanded };
      browserTab = entry;
      const record = () => {
        if (browserTab !== entry) return;
        const active = safe(() => right.active?.(), undefined);
        if (active && active.kind === 'browser') entry.tabId = active.id;
      };
      record();
      setTimeout(record, 0);
      setTimeout(record, 250);
      return true;
    }

    /** Close the preview tab and put the column back the way it was. */
    function closeBrowserTab() {
      const tab = browserTab;
      browserTab = null;
      if (!tab) return;
      const right = service('sidebarRight');
      if (right) {
        try {
          const onScreen = safe(() => right.mounted.getSnapshot(), undefined) === tab.sessionId;
          if (tabExists(right, tab.sessionId, tab.tabId)) {
            if (onScreen) right.close(tab.tabId);
            else right.closeIn?.(tab.sessionId, tab.tabId);
          }
          if (onScreen && tab.wasExpanded === false && right.isExpanded()) right.toggleExpanded();
        } catch (error) {
          console.warn('[dsh-market-peek] could not restore the right Sidebar:', error);
        }
      }
      maybeStop();
    }

    function openPreview(link) {
      const repo = parseRepo(link.href);
      if (!repo) return false;
      const root = marketRootOf(link);
      if (market && market !== root) restoreAll();
      market = root;
      startWatch();
      const name = link.getAttribute('title') || link.textContent || '';
      if (getMode() === 'external') {
        window.open(repo.url, '_blank', 'noopener,noreferrer');
        return true;
      }
      if (openInBuiltinBrowser(repo.url)) {
        closeDrawer();
        // The seat may exist yet sit under a full-page view: undo the tab and dock the panel instead.
        setTimeout(() => {
          if (sidebarVisible() || market !== root) return;
          closeBrowserTab();
          if (!isShown(root)) return;
          market = root; // closing the tab may have ended the watch; the panel belongs to the same market
          showDrawer(repo, name);
        }, 450);
        return true;
      }
      showDrawer(repo, name);
      return true;
    }

    // ----------------------------------------------------------- click capture
    function onClick(event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('#dsh-market-peek')) return;
      const anchor = target.closest('a[href]');
      let link = null;
      if (anchor) {
        if (!hasClassToken(anchor, '_nmLink')) return; // only the market's repo title link
        link = anchor;
      } else {
        // A click on a blank part of a card: ignore controls, images and text selections.
        if (target.closest('button, input, select, textarea, label, img, video, [role="button"], [role="menu"], [role="menuitem"], [contenteditable="true"]')) return;
        if (String(window.getSelection?.() ?? '') !== '') return;
        const card = marketCardOf(target);
        if (!card) return;
        link = card.querySelector('a[class*="_nmLink"]');
      }
      if (!link) return;
      if (openPreview(link)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function onKey(event) {
      if (event.key === 'Escape' && drawer) closeDrawer();
    }

    function onResize() {
      if (!drawer) return;
      const width = currentWidth();
      drawer.style.width = `${width}px`;
      applyDock(width);
      placeDrawer();
    }

    // ------------------------------------------------------- docked panel
    let drawer = null;
    let current = null;
    /** The market root narrowed for the panel, and its original inline margin. */
    let dock = null;
    const cache = new Map();

    function themeIsDark() {
      const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m || m.length < 3) return matchMedia('(prefers-color-scheme: dark)').matches;
      const [r, g, b] = m.map(Number);
      if (m.length >= 4 && Number(m[3]) === 0) return matchMedia('(prefers-color-scheme: dark)').matches;
      return 0.299 * r + 0.587 * g + 0.114 * b < 128;
    }

    const STYLE = `
#dsh-market-peek{position:fixed;top:0;right:0;bottom:0;z-index:20;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-primary,var(--dsw-alias-background-primary,#fff));color:var(--dsw-alias-label-primary,#1f2328);
  border-left:1px solid var(--dsw-alias-border-primary,rgba(127,127,127,.25));
  font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
#dsh-market-peek.dmp-dark{background:#1e1f22;color:#e6e6e6;border-left-color:#3a3c40}
#dsh-market-peek .dmp-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:ew-resize}
#dsh-market-peek .dmp-grip:hover{background:rgba(79,110,247,.35)}
#dsh-market-peek .dmp-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(127,127,127,.25)}
#dsh-market-peek .dmp-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px}
#dsh-market-peek .dmp-title small{font-weight:400;opacity:.6;margin-left:6px}
#dsh-market-peek button,#dsh-market-peek select{font:inherit;font-size:12px;height:26px;padding:0 8px;border-radius:6px;cursor:pointer;
  border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit}
#dsh-market-peek button:hover{background:rgba(127,127,127,.12)}
#dsh-market-peek .dmp-x{width:26px;padding:0;font-size:16px;line-height:1}
#dsh-market-peek .dmp-note{padding:6px 12px;font-size:12px;color:#b35900;background:rgba(255,170,0,.12)}
#dsh-market-peek .dmp-body{flex:1;min-height:0;position:relative}
#dsh-market-peek iframe{border:0;width:100%;height:100%;display:block;background:transparent}
#dsh-market-peek .dmp-state{padding:24px;opacity:.7}
#dsh-market-peek .dmp-foot{padding:6px 12px;font-size:11px;opacity:.55;border-top:1px solid rgba(127,127,127,.2);display:flex;gap:8px;align-items:center}
#dsh-market-peek .dmp-foot select{height:22px;font-size:11px;padding:0 4px}
`;

    function ensureStyle() {
      if (document.getElementById('dsh-market-peek-style')) return;
      const style = document.createElement('style');
      style.id = 'dsh-market-peek-style';
      style.textContent = STYLE;
      document.head.append(style);
    }

    function currentWidth() {
      const saved = Number(localStorage.getItem(LS_WIDTH));
      const fallback = Math.round(viewRight() * 0.4);
      const w = Number.isFinite(saved) && saved > 0 ? saved : fallback;
      return clampWidth(w);
    }
    function clampWidth(w) {
      const left = market ? market.getBoundingClientRect().left : 0;
      // Keep at least 320px of market visible beside the panel.
      return Math.max(MIN_W, Math.min(w, viewRight() - left - 320));
    }

    /** Narrow the market so the panel sits beside it: free space on its right is used first. */
    function applyDock(width) {
      if (!market) return;
      if (!dock || dock.root !== market) {
        undock();
        dock = { root: market, margin: market.style.marginRight };
      }
      market.style.marginRight = dock.margin;
      const free = viewRight() - market.getBoundingClientRect().right;
      const need = width - free;
      if (need > 0) {
        const base = parseFloat(getComputedStyle(market).marginRight) || 0;
        market.style.marginRight = `${Math.ceil(base + need)}px`;
      }
    }
    function undock() {
      if (!dock) return;
      dock.root.style.marginRight = dock.margin;
      dock = null;
    }

    /** Keep the panel inside the market's own vertical band, flush with the window's right edge. */
    function placeDrawer() {
      if (!drawer || !market) return;
      const r = market.getBoundingClientRect();
      drawer.style.top = `${Math.max(0, r.top)}px`;
      drawer.style.bottom = `${Math.max(0, window.innerHeight - r.bottom)}px`;
      drawer.style.right = `${Math.max(0, window.innerWidth - viewRight())}px`;
    }

    function closeDrawer() {
      current?.abort?.abort();
      current = null;
      drawer?.remove();
      drawer = null;
      undock();
      maybeStop();
    }

    function buildDrawer() {
      ensureStyle();
      const root = document.createElement('aside');
      root.id = 'dsh-market-peek';
      root.setAttribute('role', 'complementary');
      if (themeIsDark()) root.classList.add('dmp-dark');
      root.innerHTML = `
        <div class="dmp-grip" title="drag"></div>
        <div class="dmp-head">
          <div class="dmp-title"></div>
          <button type="button" data-act="external">${esc(T.external)} ↗</button>
          <button type="button" class="dmp-x" data-act="close" title="${esc(T.close)}" aria-label="${esc(T.close)}">×</button>
        </div>
        <div class="dmp-note" hidden></div>
        <div class="dmp-body"></div>
        <div class="dmp-foot">
          <span class="dmp-src"></span><span style="flex:1"></span>
          <label>${esc(T.modeTitle)}
            <select data-act="mode">
              <option value="here">${esc(T.modeHere)}</option>
              <option value="external">${esc(T.external)}</option>
            </select>
          </label>
        </div>`;
      const mode = root.querySelector('select[data-act="mode"]');
      mode.value = getMode();
      mode.addEventListener('change', () => localStorage.setItem(LS_MODE, mode.value));
      root.addEventListener('click', (event) => {
        const act = event.target instanceof Element ? event.target.closest('[data-act]')?.getAttribute('data-act') : null;
        if (!act || !current) return;
        if (act === 'close') closeDrawer();
        else if (act === 'external') window.open(current.repo.url, '_blank', 'noopener,noreferrer');
      });
      // Resize from the left edge; the market reflows with it.
      root.querySelector('.dmp-grip').addEventListener('pointerdown', (down) => {
        down.preventDefault();
        const startX = down.clientX;
        const startW = root.getBoundingClientRect().width;
        const shield = document.createElement('div');
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:ew-resize';
        document.body.append(shield);
        let frame = 0;
        let width = startW;
        const move = (e) => {
          width = clampWidth(startW + (startX - e.clientX));
          root.style.width = `${width}px`;
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; applyDock(width); });
        };
        const up = () => {
          shield.remove();
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          applyDock(width);
          localStorage.setItem(LS_WIDTH, String(Math.round(width)));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      document.body.append(root);
      return root;
    }

    function note(text) {
      const el = drawer?.querySelector('.dmp-note');
      if (!el) return;
      el.textContent = text;
      el.hidden = !text;
    }

    function showDrawer(repo, name) {
      if (!market) return;
      if (!drawer) drawer = buildDrawer();
      const width = currentWidth();
      drawer.style.width = `${width}px`;
      applyDock(width);
      placeDrawer();
      startWatch();
      current?.abort?.abort();
      const abort = new AbortController();
      current = { repo, abort };
      note('');
      drawer.querySelector('.dmp-title').innerHTML = `${esc(name || repo.repo)}<small>${esc(repo.owner)}/${esc(repo.repo)}</small>`;
      drawer.querySelector('.dmp-src').textContent = '';
      const body = drawer.querySelector('.dmp-body');
      body.innerHTML = `<div class="dmp-state">${esc(T.loading)}</div>`;
      loadReadme(repo, abort.signal).then((result) => {
        if (current?.abort !== abort || !drawer) return;
        drawer.querySelector('.dmp-src').textContent = `${T.source}: ${result.source}`;
        const frame = document.createElement('iframe');
        // No allow-scripts / allow-same-origin: README HTML is shown, never executed.
        frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.srcdoc = readmeDocument(repo, result);
        body.replaceChildren(frame);
      }).catch((error) => {
        if (current?.abort !== abort || !drawer || abort.signal.aborted) return;
        body.innerHTML = `<div class="dmp-state">${esc(T.failed)}<br><small>${esc(error?.message ?? error)}</small></div>`;
      });
    }

    // ------------------------------------------------------------------ README
    async function fetchText(url, signal, headers) {
      const timeout = AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined;
      const combined = timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
      const res = await fetch(url, { signal: combined, headers, referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.text();
    }

    async function loadReadme(repo, signal) {
      const key = `${repo.owner}/${repo.repo}#${repo.ref}:${repo.dir}`;
      if (cache.has(key)) return cache.get(key);
      const dirPart = repo.dir ? '/' + repo.dir : '';
      const refQuery = repo.ref ? `?ref=${encodeURIComponent(repo.ref)}` : '';
      const ref = repo.ref || 'HEAD';
      const errors = [];
      const attempts = [
        // GitHub renders the README for us (relative links already resolved, same look as the site).
        async () => ({ kind: 'html', source: 'api.github.com', text: await fetchText(`https://api.github.com/repos/${repo.owner}/${repo.repo}/readme${dirPart}${refQuery}`, signal, { Accept: 'application/vnd.github.html+json' }) }),
        ...['README.md', 'readme.md', 'README_ZH.md', 'Readme.md'].map((file) => async () => ({ kind: 'md', source: 'raw.githubusercontent.com', text: await fetchText(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${ref}${dirPart}/${file}`, signal) })),
        // Mirror for networks where raw.githubusercontent.com is unreachable.
        async () => ({ kind: 'md', source: 'cdn.jsdelivr.net', text: await fetchText(`https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.repo}${repo.ref ? '@' + repo.ref : ''}${dirPart}/README.md`, signal) }),
      ];
      for (const attempt of attempts) {
        if (signal.aborted) throw new Error('aborted');
        try {
          const result = await attempt();
          cache.set(key, result);
          return result;
        } catch (error) {
          errors.push(error?.message ?? String(error));
        }
      }
      throw new Error(errors.join(' · '));
    }

    function readmeDocument(repo, result) {
      const ref = repo.ref || 'HEAD';
      const dir = repo.dir ? repo.dir + '/' : '';
      const dark = drawer?.classList.contains('dmp-dark');
      const html = result.kind === 'html' ? result.text : renderMarkdown(result.text);
      return `<!doctype html><html><head><meta charset="utf-8">
<base href="https://raw.githubusercontent.com/${esc(repo.owner)}/${esc(repo.repo)}/${esc(ref)}/${esc(dir)}" target="_blank">
<meta name="referrer" content="no-referrer">
<style>
:root{color-scheme:${dark ? 'dark' : 'light'}}
body{margin:0;padding:20px 24px 48px;font:14px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
  color:${dark ? '#e6e6e6' : '#1f2328'};background:${dark ? '#1e1f22' : '#fff'};word-wrap:break-word}
a{color:${dark ? '#6ea8fe' : '#0969da'};text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto}
h1,h2{border-bottom:1px solid ${dark ? '#3a3c40' : '#d8dee4'};padding-bottom:.3em}
h1{font-size:1.8em}h2{font-size:1.4em}h3{font-size:1.15em}
code{font:12px/1.5 ui-monospace,Consolas,monospace;background:${dark ? '#2b2d31' : '#f6f8fa'};padding:.15em .35em;border-radius:4px}
pre{background:${dark ? '#2b2d31' : '#f6f8fa'};padding:12px 14px;border-radius:6px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:${dark ? '#a0a4ab' : '#59636e'};border-left:.25em solid ${dark ? '#3a3c40' : '#d1d9e0'}}
table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid ${dark ? '#3a3c40' : '#d1d9e0'};padding:6px 12px}
hr{border:0;border-top:1px solid ${dark ? '#3a3c40' : '#d8dee4'}}
.markdown-heading .anchor,.octicon{display:none}
</style></head><body><article class="markdown-body">${html}</article></body></html>`;
    }

    /** A small GitHub-flavoured Markdown renderer for the raw-file fallbacks (the sandboxed frame never runs scripts). */
    function renderMarkdown(md) {
      const lines = md.replace(/\r\n?/g, '\n').split('\n');
      const out = [];
      const isBlockStart = (l) => /^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+|<\w)/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
      const inline = (text) => text.split(/(`+[^`]*?`+)/).map((part, i) => {
        if (i % 2 === 1) return `<code>${esc(part.replace(/^`+|`+$/g, ''))}</code>`;
        return part
          .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, alt, src) => `<img alt="${esc(alt)}" src="${esc(src)}" loading="lazy">`)
          .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, label, href) => `<a href="${esc(href)}">${label}</a>`)
          .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${esc(url)}">${esc(url)}</a>`)
          .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
          .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
          .replace(/~~([^~]+)~~/g, '<del>$1</del>');
      }).join('');
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        let m;
        if ((m = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/))) {
          const fence = m[1];
          const code = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
          i++;
          out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        } else if ((m = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/))) {
          out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
          i++;
        } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
          out.push('<hr>');
          i++;
        } else if (/^\s*>/.test(line)) {
          const quote = [];
          while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
          out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
        } else if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
          const head = cells(line);
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(cells(lines[i++]));
          out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        } else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+/))) {
          const ordered = /\d/.test(m[1]);
          const items = [];
          while (i < lines.length) {
            const l = lines[i];
            const item = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
            if (item) { items.push(item[2].replace(/^\[( |x)\]\s*/i, (_, x) => (x.trim() ? '☑ ' : '☐ '))); i++; }
            else if (l.trim() !== '' && /^\s{2,}/.test(l) && items.length) { items[items.length - 1] += ' ' + l.trim(); i++; }
            else break;
          }
          const tag = ordered ? 'ol' : 'ul';
          out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
        } else if (/^\s*<\w/.test(line)) {
          const block = [];
          while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
          out.push(block.join('\n'));
        } else if (line.trim() === '') {
          i++;
        } else {
          const para = [];
          while (i < lines.length && lines[i].trim() !== '' && !(para.length && isBlockStart(lines[i]))) para.push(lines[i++]);
          out.push(`<p>${inline(para.join('\n')).replace(/ {2,}\n/g, '<br>')}</p>`);
        }
      }
      return out.join('\n');
    }

    // -------------------------------------------------------------- lifecycle
    let installed = false;
    function install() {
      if (installed) return;
      installed = true;
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onResize);
    }
    function uninstall() {
      installed = false;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      restoreAll();
      stopWatch();
      document.getElementById('dsh-market-peek-style')?.remove();
    }

    return {
      apply(ctx) {
        appCtx = ctx;
        install();
        const dispose = () => {
          if (appCtx === ctx) {
            uninstall();
            appCtx = undefined;
          }
        };
        if (typeof ctx.effect === 'function') ctx.effect(() => dispose);
        else ctx.on?.('dispose', dispose);
      },
    };
  },
});
