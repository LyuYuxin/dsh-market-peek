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
 *
 * The card DOM this plugin recognises belongs to the community "dshmarket" plugin's Plugin Market
 * page: a card is an element whose CSS-module class ends with `_card`, its title is an anchor whose
 * class ends with `_nmLink` and whose href is the repository URL, and the page root is marked with
 * `[data-dsh-market-root]` (falling back to `<prefix>_root`, where `<prefix>` comes from the
 * `_nmLink` token). The built-in @deepseek-ai market has no repository URL in its card DOM, so a
 * separate adapter resolves the repository through that market's own `remote.pluginMarket` client
 * service instead of scraping it; see the README.
 */
var dshMarketPeekModule = {
  id: 'dsh-market-peek',
  factory() {
    const LS_MODE = 'dsh-market-peek:mode';
    const LS_WIDTH = 'dsh-market-peek:width';
    const NS = 'dsh-market-peek';
    const MIN_W = 360;
    const RESERVE_W = 320;
    const README_TIMEOUT_MS = 12000;
    const README_MAX_BYTES = 2 * 1024 * 1024;
    const CACHE_LIMIT = 24;
    const README_CACHE_TTL_MS = 5 * 60 * 1000;
    const README_FILES = ['README.md', 'readme.md', 'README_ZH.md', 'Readme.md'];
    const COPY = {
      zh: { external: '外部浏览器', close: '关闭', loading: '正在读取 README…', failed: '读不到 README。', modeHere: '此处展开', modeTitle: '点击插件卡片时', source: '来源' },
      en: { external: 'External browser', close: 'Close', loading: 'Loading README…', failed: 'README could not be loaded.', modeHere: 'Expand here', modeTitle: 'On card click', source: 'Source' },
    };
    /**
     * The language DSH itself is showing — the same value the market reads (`ctx.locale` active
     * language). The browser's own language is only a last resort: a Chinese Windows running an
     * English DSH must get English here, like the market around it. Read on every use, so switching
     * DSH's language applies to the next panel without a reload. When the Client locale service is
     * available, `apply` registers the copy above and `boundT` takes over; this function stays as
     * the fallback for a profile without it.
     */
    function lang() {
      let active;
      // `ctx.get(name)` works without declaring the service in the plugin's `inject`; direct
      // `ctx.<service>` access throws in cordis 4 unless it is declared.
      try { active = service('locale')?.getSnapshot?.()?.active; } catch { active = undefined; }
      if (typeof active !== 'string' || active === '') active = document.documentElement.lang || navigator.language || 'en';
      return /^zh/i.test(active) ? 'zh' : 'en';
    }
    let boundT = null;
    const T = new Proxy({}, {
      get: (_, key) => {
        const translated = safe(() => boundT?.(key), undefined);
        if (typeof translated === 'string' && translated !== key) return translated;
        return COPY[lang()][key] ?? COPY.en[key] ?? '';
      },
    });

    let appCtx;

    // ---------------------------------------------------------------- helpers
    /** 'here' (default: expand in place) or 'external'; values from older versions read as 'here'. */
    function normalizeMode(value) {
      return value === 'external' ? 'external' : 'here';
    }
    function readMode(storage) {
      try { return normalizeMode(storage?.getItem?.(LS_MODE)); } catch { return 'here'; }
    }
    function readWidth(storage, viewport, left, min = MIN_W, reserve = RESERVE_W) {
      let saved;
      try { saved = Number(storage?.getItem?.(LS_WIDTH)); } catch { saved = NaN; }
      const fallback = Math.round(viewport * 0.4);
      const width = Number.isFinite(saved) && saved > 0 ? saved : fallback;
      return clampWidthTo(width, viewport, left, min, reserve);
    }
    function clampWidthTo(width, viewport, left, min = MIN_W, reserve = RESERVE_W) {
      // Keep at least `reserve` px of the market visible beside the panel.
      return Math.max(min, Math.min(width, viewport - left - reserve));
    }
    const getMode = () => readMode(localStorage);
    const setMode = (value) => {
      try { localStorage.setItem(LS_MODE, normalizeMode(value)); } catch { /* storage may be unavailable */ }
    };
    const service = (name) => {
      try { return appCtx?.get?.(name); } catch { return undefined; }
    };
    function safe(fn, fallback) {
      try { return fn(); } catch { return fallback; }
    }
    function hasClassToken(el, suffix) {
      if (!(el instanceof Element)) return false;
      for (const token of el.classList) if (token.endsWith(suffix)) return true;
      return false;
    }
    const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const isShown = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
    const viewRight = () => document.documentElement.clientWidth || window.innerWidth;

    // ----------------------------------------------------------- URL parsing
    const OWNER_PART = /^[A-Za-z0-9_.-]+$/;
    const hasUnsafePath = (value) => value === '' || value === '.' || value === '..' || /[\s\\]/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..');

    function decodePart(part) {
      try { return decodeURIComponent(part); } catch { return null; }
    }

    /** owner/repo (+ optional ref and sub directory) of a github.com URL, or null. */
    function parseRepo(href) {
      let url;
      try { url = new URL(String(href)); } catch { return null; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.username !== '' || url.password !== '' || url.port !== '') return null;
      if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const owner = decodePart(parts[0]);
      const repoName = decodePart(parts[1]);
      if (owner === null || repoName === null) return null;
      const repo = repoName.replace(/\.git$/, '');
      if (!OWNER_PART.test(owner) || !OWNER_PART.test(repo)) return null;
      if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
      let ref = '';
      let dir = '';
      if (parts[2] === 'tree' && parts.length >= 4) {
        ref = decodePart(parts[3]) ?? '';
        if (ref === '' || hasUnsafePath(ref)) return null;
        dir = parts.slice(4).map(decodePart).join('/');
        if (dir !== '' && hasUnsafePath(dir)) return null;
      }
      const refPath = ref === '' ? '' : `/tree/${ref.split('/').map(encodeURIComponent).join('/')}${dir === '' ? '' : '/' + dir.split('/').map(encodeURIComponent).join('/')}`;
      return { owner, repo, ref, dir, url: `https://github.com/${owner}/${repo}${refPath}` };
    }

    /**
     * The README source attempts, in fallback order, as plain data so the order can be tested
     * without network access. `kind` is how the response must be interpreted: GitHub's rendered
     * HTML for the API, raw Markdown for the file mirrors.
     */
    function readmeSources(repo) {
      const ref = repo.ref || 'HEAD';
      const refPath = ref.split('/').map(encodeURIComponent).join('/');
      const dirPart = repo.dir ? '/' + repo.dir.split('/').map(encodeURIComponent).join('/') : '';
      const refQuery = repo.ref ? `?ref=${encodeURIComponent(repo.ref)}` : '';
      const rawBase = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${refPath}${dirPart}`;
      const sources = [{
        kind: 'html',
        source: 'api.github.com',
        url: `https://api.github.com/repos/${repo.owner}/${repo.repo}/readme${dirPart}${refQuery}`,
      }];
      for (const file of README_FILES) sources.push({ kind: 'md', source: 'raw.githubusercontent.com', url: `${rawBase}/${file}` });
      // Mirror for networks where raw.githubusercontent.com is unreachable.
      sources.push({ kind: 'md', source: 'cdn.jsdelivr.net', url: `https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.repo}${repo.ref ? '@' + refPath : ''}${dirPart}/README.md` });
      return sources;
    }

    // -------------------------------------------------------- market heuristic
    const githubLinkIn = (element) => {
      for (const anchor of element.querySelectorAll('a[href]')) {
        if (parseRepo(anchor.href)) return anchor;
      }
      return null;
    };
    /** The repository link of a market card: the `_nmLink` title anchor, else its first GitHub anchor. */
    function repoLinkInCard(card) {
      if (!(card instanceof Element)) return null;
      for (const anchor of card.querySelectorAll('a[href]')) {
        if (hasClassToken(anchor, '_nmLink') && parseRepo(anchor.href)) return anchor;
      }
      return githubLinkIn(card);
    }
    /** The market card an element lives in: the closest ancestor with an exact `*_card` class token that holds a repository link. */
    function marketCardOf(el) {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (!(node instanceof Element)) continue;
        for (const token of node.classList) {
          if (/_card$/.test(token)) return repoLinkInCard(node) ? node : null;
        }
      }
      return null;
    }
    /** The closest `*_card` ancestor, without demanding a repository link (used to classify anchors). */
    function cardAncestorOf(el) {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (!(node instanceof Element)) continue;
        for (const token of node.classList) if (/_card$/.test(token)) return node;
      }
      return null;
    }
    /** Whether an anchor is a market card's repository link (strict `_nmLink`, or the card's first GitHub link if the class is renamed). */
    function isTitleLink(anchor) {
      if (!(anchor instanceof Element) || !parseRepo(anchor.href)) return false;
      if (hasClassToken(anchor, '_nmLink')) return true;
      const card = cardAncestorOf(anchor);
      return !!card && repoLinkInCard(card) === anchor;
    }
    /**
     * The market page root a link belongs to. `[data-dsh-market-root]` is the stable marker the
     * market itself uses; `<prefix>_root` (derived from the link's own CSS-module token) and
     * `[class*="_root"]` are fallbacks for older/newer builds.
     */
    function marketRootOf(link) {
      const marked = link.closest('[data-dsh-market-root]');
      if (marked) return marked;
      for (const token of link.classList) {
        if (token.endsWith('_nmLink')) {
          const prefix = token.slice(0, token.length - 'nmLink'.length);
          const root = safe(() => link.closest('.' + CSS.escape(prefix + 'root')), null);
          if (root) return root;
        }
      }
      return link.closest('[class*="_root"]') || link.closest('[data-market-root]') || link.parentElement;
    }

    // ------------------------------------------------- built-in market adapter
    /**
     * The built-in `@deepseek-ai/dsh-client-ui-plugin-market` cards carry the entry name but no
     * repository URL (their title button opens an in-page detail view). The repository is read
     * from the Client's `remote.pluginMarket` service instead of the DOM, so a card click can
     * still preview its README. The market keeps its own behaviour: this adapter never calls
     * preventDefault/stopPropagation, it only opens the preview after a successful resolution and
     * stays a no-op when the service is absent.
     */
    const OFFICIAL_DISCOVER = '[data-plugin-tab="discover"]';
    const OFFICIAL_CACHE_LIMIT = 64;
    const officialRepos = new Map();
    const officialPending = new Map();

    function officialCardOf(target) {
      const card = target.closest(OFFICIAL_DISCOVER + ' [data-market-entry]');
      if (!card) return null;
      // Only the card title button and the blank card surface: never take over Install/menu controls.
      const control = target.closest('button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [contenteditable="true"]');
      if (control && !hasClassToken(control, '_cardOpen')) return null;
      return card;
    }

    function officialMarket() {
      // The service lookup must go through `ctx.get`: cordis only allows direct `ctx.remote`
      // access for services declared in the plugin's `inject`, and this plugin declares none.
      // Prefer the namespace the market itself injects (`remote.pluginMarket`), then its parent.
      const namespace = safe(() => service('remote.pluginMarket'), undefined);
      if (namespace) return namespace;
      return safe(() => service('remote')?.pluginMarket, undefined);
    }

    /** `owner/repo` of a built-in market entry; `repository.directory` selects a monorepo package. */
    function repoOfOfficialEntry(entry) {
      if (entry === undefined || entry === null) return null;
      const repository = entry.repository;
      if (repository !== undefined && repository !== null) {
        const base = parseRepo(repository.url);
        if (base) return repoWithDirectory(base, repository.directory);
      }
      return parseRepo(entry.homepage);
    }

    /** Point a repository at a sub directory when the market entry lives in a monorepo. */
    function repoWithDirectory(repo, directory) {
      if (typeof directory !== 'string') return repo;
      const dir = directory.replace(/^\/+|\/+$/g, '');
      if (dir === '' || repo.ref !== '' || hasUnsafePath(dir)) return repo;
      const encoded = dir.split('/').map(encodeURIComponent).join('/');
      return { ...repo, dir, url: `${repo.url}/tree/HEAD/${encoded}` };
    }

    /** One entry of one index: exact name match, then a bounded paged scan when text search misses. */
    async function findOfficialEntry(market, indexUrl, name) {
      const ranked = await market.search(indexUrl, { text: name, sort: { kind: 'relevance' }, offset: 0, limit: 100 });
      if (ranked?.ok === true) {
        const found = (ranked.value?.entries ?? []).find((item) => item.name === name);
        if (found !== undefined) return found;
      }
      let offset = 0;
      for (let page = 0; page < 20; page++) {
        const answer = await market.search(indexUrl, { sort: { kind: 'index' }, offset, limit: 100 });
        if (answer?.ok !== true) return undefined;
        const entries = answer.value?.entries ?? [];
        const found = entries.find((item) => item.name === name);
        if (found !== undefined) return found;
        const next = answer.value?.nextOffset;
        if (typeof next !== 'number' || next <= offset || entries.length === 0) return undefined;
        offset = next;
      }
      return undefined;
    }

    /** Resolve `owner/repo` for a built-in market entry name through the remote service, with per-index caching. */
    async function resolveOfficialRepo(name) {
      const market = officialMarket();
      if (!market || typeof market.listIndexes !== 'function' || typeof market.search !== 'function') return null;
      let indexes;
      try {
        indexes = await market.listIndexes();
      } catch (error) {
        console.warn('[dsh-market-peek] could not list plugin market indexes:', error);
        return null;
      }
      const list = indexes?.ok === true && Array.isArray(indexes.value) ? indexes.value : [];
      for (const index of list) {
        if (typeof index?.url !== 'string' || index.error !== undefined) continue;
        const key = `${index.url}|${name}`;
        if (officialRepos.has(key)) return officialRepos.get(key);
        let pending = officialPending.get(key);
        if (pending === undefined) {
          pending = (async () => {
            try {
              const repo = repoOfOfficialEntry(await findOfficialEntry(market, index.url, name));
              // Only success is cached: a failed first attempt may be a market that is still loading.
              if (repo) {
                if (officialRepos.size >= OFFICIAL_CACHE_LIMIT) officialRepos.delete(officialRepos.keys().next().value);
                officialRepos.set(key, repo);
              }
              return repo;
            } catch (error) {
              console.warn('[dsh-market-peek] could not resolve the market entry:', error);
              return null;
            } finally {
              officialPending.delete(key);
            }
          })();
          officialPending.set(key, pending);
        }
        const repo = await pending;
        if (repo) return repo;
      }
      return null;
    }

    /** Warn at most once per entry name so a broken market does not flood the console. */
    const officialWarned = new Set();
    function warnOfficialFailure(name, reason) {
      if (officialWarned.has(name)) return;
      officialWarned.add(name);
      console.warn(`[dsh-market-peek] official market preview skipped for "${name}": ${reason}`);
    }

    /**
     * The Plugin Manager page root that survives the built-in market's list -> detail navigation.
     * The card itself is unmounted when the detail view replaces the list, and the Discover section
     * can be replaced too, so both are unusable as a long-lived dock root; `[data-plugin-panel]` is
     * the page around them and unmounts only when the user leaves the Plugins page.
     */
    function officialRootCandidates() {
      const roots = [];
      if (typeof document.querySelectorAll !== 'function') return roots;
      for (const panel of document.querySelectorAll('[data-plugin-panel]')) roots.push(panel);
      for (const tab of document.querySelectorAll('[data-plugin-tab]')) {
        const panel = tab.closest?.('[data-plugin-panel]') ?? tab;
        if (!roots.includes(panel)) roots.push(panel);
      }
      return roots;
    }

    /** Re-pin decision: keep the current root while it is visible, else the first visible candidate. */
    function nextOfficialRoot(pinned, candidates, visible) {
      if (pinned && visible(pinned)) return pinned;
      for (const node of candidates) if (node && visible(node)) return node;
      return null;
    }

    function officialPageRoot() {
      return nextOfficialRoot(null, officialRootCandidates(), isShown);
    }

    /** Preview a built-in market entry without disturbing the market's own click handling. */
    function previewOfficialCard(card) {
      const name = card.getAttribute('data-market-entry');
      if (!name) return false;
      // In "external browser" mode the market's own detail view is the better target: a window.open
      // after the asynchronous resolution would not be tied to the click gesture (popup blocked).
      if (getMode() === 'external') return false;
      if (!officialMarket()) {
        warnOfficialFailure(name, 'the remote.pluginMarket client service is unavailable');
        return false;
      }
      resolveOfficialRepo(name).then((repo) => {
        if (!repo) {
          warnOfficialFailure(name, 'no GitHub repository was resolved from the configured market index');
          return;
        }
        // The card is usually gone by now (the market has already opened its detail view); dock to
        // the Plugins page root instead of the card's market section.
        const root = officialPageRoot();
        if (!root) {
          warnOfficialFailure(name, 'the Plugins page root is not on screen');
          return;
        }
        openRepoPreview(repo, root, name, 'official');
      }).catch(() => {});
      return true;
    }

    // ----------------------------------------------------- page-leave watcher
    /** The market root the current preview belongs to; when it leaves the screen everything is restored. */
    let market = null;
    /** 'community' (dshmarket) or 'official' (the built-in market); controls re-pinning. */
    let marketKind = 'community';
    let watchTimer = 0;

    function startWatch() {
      if (!watchTimer) watchTimer = setInterval(tick, 400);
    }
    function stopWatch() {
      if (watchTimer) clearInterval(watchTimer);
      watchTimer = 0;
    }
    function tick() {
      if (market && !isShown(market)) {
        // The built-in market navigates from its list to an in-page detail view; if the pinned root
        // was replaced internally, move the dock to the still-visible Plugins page instead of
        // closing the panel. Only a missing page root (user left Plugins) restores everything.
        if (marketKind === 'official') {
          const next = nextOfficialRoot(null, officialRootCandidates(), isShown);
          if (next) {
            market = next;
            if (drawer) {
              applyDock(drawer.getBoundingClientRect().width || currentWidth());
              placeDrawer();
            }
            return;
          }
        }
        restoreAll();
        return;
      }
      placeDrawer();
    }
    /** Back to the original state: no panel, market at its own width, preview tab closed. */
    function restoreAll() {
      closeBrowserTab();
      closeDrawer();
      marketKind = 'community';
      // Leaving the market must not leave a stale README behind: the next visit refetches.
      cache.clear();
    }
    function maybeStop() {
      if (!drawer && !browserTab) {
        market = null;
        marketKind = 'community';
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
      if (typeof document.elementFromPoint !== 'function') return seat.hasAttribute('data-sidebar-right-open');
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 200));
      if (hit === null) return seat.hasAttribute('data-sidebar-right-open');
      return seat.contains(hit) || !!hit.closest?.('webview');
    }

    /** Whether the built-in browser kind is registered (an absent registry cannot be checked). */
    function browserTabRegistered(right) {
      const viaRight = safe(() => right.tabs?.get?.('browser'), undefined);
      if (viaRight !== undefined) return true;
      const tabs = service('sidebarRightTabs');
      if (!tabs || typeof tabs.get !== 'function') return true;
      return safe(() => tabs.get('browser') !== undefined, true);
    }

    function rightSeat() {
      const right = service('sidebarRight');
      if (!right || typeof right.openTab !== 'function') return null;
      if (!browserTabRegistered(right)) return null;
      const sessionId = safe(() => right.mounted?.getSnapshot?.(), undefined);
      if (typeof sessionId !== 'string' || sessionId === '') return null;
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
      return openRepoPreview(repo, marketRootOf(link), link.getAttribute('title') || link.textContent || '');
    }

    function openRepoPreview(repo, root, name, kind = 'community') {
      if (!root) return false;
      if (market && market !== root) restoreAll();
      market = root;
      marketKind = kind;
      startWatch();
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
      // Built-in market cards are resolved through the remote service; the market's own detail view
      // keeps opening (no preventDefault here).
      const officialCard = officialCardOf(target);
      if (officialCard) {
        previewOfficialCard(officialCard);
        return;
      }
      const anchor = target.closest('a[href]');
      let link = null;
      if (anchor) {
        if (!isTitleLink(anchor)) return; // only a market card's repository title link
        link = anchor;
      } else {
        // A click on a blank part of a card: ignore controls, images and text selections.
        if (target.closest('button, input, select, textarea, label, img, video, [role="button"], [role="menu"], [role="menuitem"], [contenteditable="true"]')) return;
        if (String(window.getSelection?.() ?? '') !== '') return;
        const card = marketCardOf(target);
        if (!card) return;
        link = repoLinkInCard(card);
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
      const left = market ? market.getBoundingClientRect().left : 0;
      return readWidth(localStorage, viewRight(), left);
    }
    function clampWidth(w) {
      const left = market ? market.getBoundingClientRect().left : 0;
      return clampWidthTo(w, viewRight(), left);
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
      if (current?.repo) cache.delete(readmeCacheKey(current.repo));
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
      mode.addEventListener('change', () => setMode(mode.value));
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
          try { localStorage.setItem(LS_WIDTH, String(Math.round(width))); } catch { /* storage may be unavailable */ }
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
      else drawer.classList.toggle('dmp-dark', themeIsDark()); // the theme may have changed since build
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
        // No allow-scripts / allow-same-origin: README HTML is shown, never executed. The document
        // itself also carries a restrictive CSP (see readmeDocument).
        frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.title = `${repo.owner}/${repo.repo} README`;
        frame.srcdoc = readmeDocument(repo, result, drawer.classList.contains('dmp-dark'));
        body.replaceChildren(frame);
      }).catch((error) => {
        if (current?.abort !== abort || !drawer || abort.signal.aborted) return;
        body.innerHTML = `<div class="dmp-state">${esc(T.failed)}<br><small>${esc(error?.message ?? error)}</small></div>`;
      });
    }

    // ------------------------------------------------------------------ README
    /** Abort on the caller's signal or the timeout, whichever comes first. */
    function combinedSignal(signal, timeoutMs) {
      if (AbortSignal.timeout && AbortSignal.any) return { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), dispose: () => {} };
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      return {
        signal: controller.signal,
        dispose: () => {
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
        },
      };
    }

    /** Read a response body, refusing to buffer more than `limit` bytes. */
    async function readBodyLimited(response, limit) {
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > limit) throw new Error(`README is too large (${declared} bytes)`);
      if (!response.body?.getReader) {
        const text = await response.text();
        if (text.length > limit) throw new Error(`README is too large (${text.length} chars)`);
        return text;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limit) {
          await reader.cancel().catch(() => {});
          throw new Error(`README is too large (>${limit} bytes)`);
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(merged);
    }

    async function fetchText(url, signal, headers) {
      const combined = combinedSignal(signal, README_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: combined.signal, headers, referrerPolicy: 'no-referrer', credentials: 'omit' });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return await readBodyLimited(res, README_MAX_BYTES);
      } finally {
        combined.dispose();
      }
    }

    /** Cache key of a README result; also the key cleared when the panel closes. */
    const readmeCacheKey = (repo) => `${repo.owner}/${repo.repo}#${repo.ref}:${repo.dir}`;

    async function loadReadme(repo, signal) {
      const key = readmeCacheKey(repo);
      const cached = cache.get(key);
      if (cached) {
        if (Date.now() - cached.at < README_CACHE_TTL_MS) return cached.result;
        cache.delete(key);
      }
      const errors = [];
      for (const source of readmeSources(repo)) {
        if (signal?.aborted) throw new Error('aborted');
        try {
          const headers = source.kind === 'html' ? { Accept: 'application/vnd.github.html+json' } : undefined;
          const text = await fetchText(source.url, signal, headers);
          const result = { kind: source.kind, source: source.source, text };
          if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
          cache.set(key, { result, at: Date.now() });
          return result;
        } catch (error) {
          errors.push(error?.message ?? String(error));
        }
      }
      throw new Error(errors.join(' · '));
    }

    function safeLinkUrl(raw) {
      const value = String(raw ?? '').trim();
      if (value === '') return '#';
      if (value.startsWith('#')) return value;
      // Browsers ignore ASCII whitespace/control characters inside a scheme (`java\tscript:`), so
      // classify the compacted form and only emit the original when that scheme is allowed.
      const scheme = value.replace(/[\u0000-\u0020]/g, '').match(/^([a-z][a-z0-9+.-]*):/i);
      if (scheme === null) return value; // relative path: resolved against <base>
      const name = scheme[1].toLowerCase();
      return name === 'http' || name === 'https' || name === 'mailto' ? value : '#';
    }
    function safeImageUrl(raw) {
      const value = String(raw ?? '').trim();
      if (value === '') return null;
      if (/^https:/i.test(value)) return value;
      if (/^data:image\//i.test(value)) return value;
      const compact = value.replace(/[\u0000-\u0020]/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(compact)) return null;
      return value; // relative path: resolved against <base>
    }

    function readmeDocument(repo, result, dark = false) {
      const ref = repo.ref || 'HEAD';
      // Percent-encode both segments of the raw path: a legal ref may contain `#`/`?`, which would
      // otherwise truncate the `<base>` URL.
      const refPath = ref.split('/').map(encodeURIComponent).join('/');
      const dirPath = repo.dir ? repo.dir.split('/').map(encodeURIComponent).join('/') + '/' : '';
      const html = result.kind === 'html' ? result.text : renderMarkdown(result.text);
      return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; media-src https:; base-uri https://raw.githubusercontent.com https://github.com; form-action 'none'">
<base href="https://raw.githubusercontent.com/${esc(repo.owner)}/${esc(repo.repo)}/${esc(refPath)}/${esc(dirPath)}" target="_blank">
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
      const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
      const out = [];
      const isBlockStart = (l) => /^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+|<\w)/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
      const inline = (text) => text.split(/(`+[^`]*?`+)/).map((part, i) => {
        if (i % 2 === 1) return `<code>${esc(part.replace(/^`+|`+$/g, ''))}</code>`;
        return part
          .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, alt, src) => {
            const safeSrc = safeImageUrl(src);
            return safeSrc === null ? esc(alt) : `<img alt="${esc(alt)}" src="${esc(safeSrc)}" loading="lazy">`;
          })
          .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, label, href) => `<a href="${esc(safeLinkUrl(href))}">${esc(label)}</a>`)
          .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${esc(safeLinkUrl(url))}">${esc(url)}</a>`)
          .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${esc(a ?? b)}</strong>`)
          .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, (_, pre, body) => `${pre}<em>${esc(body)}</em>`)
          .replace(/~~([^~]+)~~/g, (_, body) => `<del>${esc(body)}</del>`);
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
          // Raw HTML block from a README: kept as-is, but the frame is sandboxed without scripts
          // and the document CSP is `default-src 'none'`. See README "Accepted risk".
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

    /** Copy for the panel lives in the Client locale service when the profile provides it. */
    function registerCopy() {
      let localeDispose = null;
      try {
        // `ctx.get('locale')`: direct `ctx.locale` access needs a declared `inject` and throws otherwise.
        const locale = service('locale');
        if (typeof locale?.register === 'function') localeDispose = locale.register(NS, { zh: COPY.zh, en: COPY.en });
        if (typeof locale?.bind === 'function') boundT = locale.bind(NS);
      } catch (error) {
        console.warn('[dsh-market-peek] locale service unavailable:', error);
      }
      return localeDispose;
    }

    return {
      apply(ctx) {
        appCtx = ctx;
        const localeDispose = registerCopy();
        install();
        const dispose = () => {
          if (appCtx === ctx) {
            try { localeDispose?.(); } catch (error) { console.warn('[dsh-market-peek] locale cleanup failed:', error); }
            boundT = null;
            uninstall();
            appCtx = undefined;
          }
        };
        if (typeof ctx.effect === 'function') ctx.effect(() => dispose);
        else ctx.on?.('dispose', dispose);
      },
      // Test seam for `node --test`: pure helpers plus the service-backed official-market resolver,
      // which reads its dependencies through `ctx.get` only. Runtime behaviour is unchanged.
      __test: {
        esc, parseRepo, readmeSources, renderMarkdown, readmeDocument, safeLinkUrl, safeImageUrl,
        normalizeMode, readMode, readWidth, clampWidthTo, officialMarket, resolveOfficialRepo, repoOfOfficialEntry,
        nextOfficialRoot,
      },
    };
  },
};

if (typeof window !== 'undefined' && window.__ModuleLoader__) window.__ModuleLoader__.load(dshMarketPeekModule);
else globalThis.__dshMarketPeek = dshMarketPeekModule;
