# dsh-market-peek

[中文](README.md) · English

[![npm version](https://img.shields.io/npm/v/dsh-market-peek.svg)](https://www.npmjs.com/package/dsh-market-peek)
[![npm downloads](https://img.shields.io/npm/dm/dsh-market-peek.svg)](https://www.npmjs.com/package/dsh-market-peek)
[![test](https://github.com/LyuYuxin/dsh-market-peek/actions/workflows/test.yml/badge.svg)](https://github.com/LyuYuxin/dsh-market-peek/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.3-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)

Keep "reading a plugin's repository and README" inside DeepSeek Harness: while a right Sidebar is visible, the repository opens in DSH's own browser tab there; otherwise a README panel docks beside the market. Install, favourite, comment and screenshot buttons keep their original behaviour, and the market page itself is not replaced.

## What problem does this plugin solve?

- **A card click leaves DSH.** In the community `dshmarket` market the card title usually opens the GitHub page in an external browser; DSH's built-in experimental market shows source, version and install facts in its detail view but no README. Judging whether a plugin is worth installing means switching between DSH and the browser, or copying the repository URL by hand.
- **Coming back, the previous state is gone.** Tabs opened to compare READMEs, a panel width you dragged, a right Sidebar you expanded — none of that is restored after leaving the market, so the next card click means arranging it again.
- **The market itself should not be changed.** Installing, favouriting, commenting and viewing screenshots belong to the market. This plugin only takes over the "open the repository / README" step: it does not replace the market page and does not intercept the market's own buttons.

It adds no new market page and changes no market data; it only decides where the repository or README is shown when a card is clicked, and restores the previous state when you leave.

## What it does (follow the screenshots)

1. **Open the plugin market and click a plugin title or a blank part of a card.** Install, favourite, comment and screenshot buttons still do what they did before; Ctrl / Cmd / Shift / Alt-click opens the external browser for that one click.
   ![Community dshmarket: the README panel docked on the right of the market](https://raw.githubusercontent.com/LyuYuxin/dsh-market-peek/v0.2.1/assets/screenshot-1.png)
   Above: after opening a plugin in the community `dshmarket` market, the README panel is docked on the right and the market has narrowed to make room; the panel footer shows the source (for example `raw.githubusercontent.com`) and the current click behaviour.
2. **On a conversation page with a visible right Sidebar: open the repository in DSH's built-in browser.** Consecutive card clicks reuse the same preview tab instead of piling up tabs; a right Sidebar that was collapsed expands first and collapses again when you leave.
3. **On a full-page market without a visible right Sidebar: dock the README panel.** Drag its left edge to resize (remembered), use the footer to switch the click behaviour to **External browser**, and close it with Esc or ×.
   ![DSH's built-in experimental market: its detail view still opens and the README panel is docked on the right of the Plugins page](https://raw.githubusercontent.com/LyuYuxin/dsh-market-peek/v0.2.1/assets/screenshot-2.png)
   Above: after opening a plugin in DSH's built-in experimental market, the market's own detail view still opens (source, version and install facts remain usable) and the README panel is docked on the right of the Plugins page; its header shows the repository and owner name, and its body is that plugin's README.
4. **Leaving the market restores everything.** The panel closes, the market gets its width back, the preview tab is closed and a right Sidebar that was collapsed collapses again; the parsed README cache is cleared as well, so the next open fetches it again.

Both screenshots are real E2E captures: the first from the community `dshmarket` market, the second from DSH's built-in experimental market.

## Features

- **Preview from a card click.** Click the plugin title or a blank part of the card; install, favourite, comment and screenshot buttons keep their original behaviour. Ctrl / Cmd / Shift / Alt-click still opens the external browser.
- **Two ways to expand.** When a conversation's right Sidebar is available, the repository opens in DSH's built-in browser (one reused preview tab). On a full-page market without a visible right Sidebar, a README panel docks on the right and the market moves aside.
- **Restored on leave.** Switching page, conversation or market closes the panel, restores the market width and closes the preview tab; a collapsed right Sidebar collapses again.
- **Resizable panel.** Drag its left edge; the width is remembered in `localStorage` (`dsh-market-peek:width`). Close with Esc or ×.
- **Switchable click behaviour.** The panel footer picks **Expand here** (default) or **External browser**, remembered in `dsh-market-peek:mode`.
- **README fallback chain.** Tries GitHub's rendered API response, then four README filenames on `raw.githubusercontent.com`, then the jsDelivr mirror; moves on when a source fails.
- **Follows DSH theme and language.** The panel uses `--dsw-alias-*` theme tokens, so light/dark follow automatically, and its copy follows DSH's current language (Chinese / English).
- **Own icon and localized metadata.** The plugin manager shows a dedicated icon, title and description (`locale/en.json`, `locale/zh.json`).

## Supported markets

| Market | Verified version | Trigger | Notes |
|---|---|---|---|
| `dshmarket` (community market, primary target) | 1.73.3 | card title or blank card area | Recognised through `[data-dsh-market-root]`, `*_card` and `*_nmLink`; the stable `data-dsh-market-root` marker is used first |
| `@deepseek-ai/dsh-client-ui-plugin-market` (DSH's built-in experimental market) | 0.2.1-rc.3 | card (title or blank area) | Cards carry no repository URL, so the adapter resolves it through the market's own `remote.pluginMarket` client service; it **does not intercept the market's own click**, so the detail view still opens |
| Anything else / older markets | — | not intercepted | When no repository link can be found, clicks are left completely untouched |

## How it works

### How it detects the market

- **Community market (`dshmarket`):** a card is an element whose CSS-module class ends with `*_card`; its title is an anchor whose class ends with `*_nmLink` and whose `href` is the GitHub repository. The page root comes from `[data-dsh-market-root]`; if absent, the `<prefix>_root` class is derived from the `*_nmLink` token, then `[class*="_root"]` is tried. Blank-card clicks ignore buttons, inputs, images, menus and active text selections.
- **Built-in market:** cards carry `data-market-entry="<package name>"` and the Discover tab is `[data-plugin-tab="discover"]`. The adapter does not read the repository URL from the DOM: it reads the Client service through `ctx.get('remote').pluginMarket` (so no `inject` declaration is needed), calls `listIndexes()`, matches the exact entry name with a relevance search plus a bounded paged-scan fallback, and parses `repository.url` (including `repository.directory` for monorepo packages) / `homepage`. The panel docks beside the `[data-plugin-panel]` Plugins-page root (which survives the list → detail navigation); only leaving the whole Plugins page closes it. When the service is absent or resolution fails, the adapter does nothing and the market is untouched.
- **Right Sidebar:** DSH's official `ctx.sidebarRight` service (`openTab` / `tabsIn` / `close` / `closeIn` / `active` / `mounted` / `isExpanded` / `toggleExpanded`) opens and closes the preview tab; visibility is checked with `[data-sidebar-right-session]`. When no Sidebar can be detected, the plugin falls back to the docked panel.

### How the README is loaded

1. `https://api.github.com/repos/<owner>/<repo>/readme` with `Accept: application/vnd.github.html+json` (HTML rendered by GitHub, relative links resolved).
2. `README.md`, `readme.md`, `README_ZH.md`, `Readme.md` from `raw.githubusercontent.com` (rendered by the built-in Markdown renderer).
3. The jsDelivr mirror `https://cdn.jsdelivr.net/gh/<owner>/<repo>[@ref]/README.md`.

Each request times out after 12 s, the body is capped at 2 MiB, closing the panel aborts pending requests, and parsed results are cached per repository for 5 minutes (at most 24 entries); the cache is cleared when the panel closes or the market page is left.

## Install

Requirements: DeepSeek Harness `>= 0.2.1-rc.3` (Desktop or `dsh web`), with a plugin market enabled (the community `dshmarket` plugin or DSH's built-in experimental market).

**From npm (recommended):**

```sh
dsh plugin --profile desktop add dsh-market-peek
```

**From GitHub:**

```sh
dsh plugin --profile desktop add github:LyuYuxin/dsh-market-peek
```

**Local development:** link the checkout into the profile, or install the directory with `plugin_manager`'s `install_bundle` (see `cordis-plugin-development`). Client-plugin changes apply after a page refresh.

Then open the plugin market and click any plugin card.

## Settings

| Setting | Stored in | Default | Meaning |
|---|---|---|---|
| Click behaviour | `localStorage`, `dsh-market-peek:mode` | `here` (expand here) | Switch in the panel footer; `external` sends card clicks to the system browser |
| Panel width | `localStorage`, `dsh-market-peek:width` | 40% of the window | At least 360 px and always leaves 320 px to the market; updated by dragging the left edge |

Shortcuts:

- `Esc` closes the panel.
- `Ctrl` / `Cmd` / `Shift` / `Alt` + card click opens the external browser once, without changing the setting.

## Known limitations

- **The market DOM is the dependency.** Card detection relies on `dshmarket`'s CSS-module conventions (`*_card`, `*_nmLink`, `<prefix>_root`). A market redesign or a different market plugin can break it; the plugin then falls back to "do not intercept" and never breaks the market itself. `data-dsh-market-root` is a marker the market uses itself and is preferred.
- **The built-in market resolves asynchronously.** Its cards carry no repository URL, so the first click on a given card waits for one local service round trip (indexes are cached by the Host, so this is usually fast) before the preview appears. The market's own detail view also opens — deliberately, so the market's click is never swallowed. The panel docks beside the Plugins-page root, so the list → detail navigation does not close it; only leaving the Plugins page restores everything. In "external browser" mode the adapter leaves the built-in market alone (the detail view keeps handling the click), because an asynchronous `window.open` would be popup-blocked. On a Host without `remote.pluginMarket` (older DSH or no market plugin), the built-in market is completely unaffected; on a resolution failure the console prints one `[dsh-market-peek] official market preview skipped for ...` warning per package name, distinguishing a missing service from an index entry without a repository URL.
- **GitHub only.** Only `github.com` / `www.github.com` https repository addresses are accepted (http is normalised to https); other hosts, credentials and ports are ignored. GitLab, Gitee and similar repositories never trigger a preview.
- **GitHub API rate limits.** Unauthenticated GitHub API allows 60 requests per hour; after that the plugin falls back to raw / jsDelivr. READMEs of private repositories cannot be read.
- **Simplified Markdown.** The raw fallback uses a small renderer (headings, lists, tables, quotes, code blocks, inline formatting, links and images); advanced extensions can look less complete than on GitHub.
- **The panel overlays the window's right side.** Docked mode adds `margin-right` to the market to make room; on a page with a fixed width that cannot reflow, the panel may sit close to the content — drag it narrower or use the built-in browser mode.

## Security

- The README is shown in an iframe **without script permission**: `sandbox="allow-popups allow-popups-to-escape-sandbox"`, with neither `allow-scripts` nor `allow-same-origin`. Scripts in a README never execute.
- The README document also carries a strict CSP: `default-src 'none'`, `script-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `connect-src 'none'`, `form-action 'none'`; only https images, inline styles and https fonts are allowed; `base-uri` is limited to GitHub hosts. It also sends `<meta name="referrer" content="no-referrer">`.
- Repository addresses are limited to ordinary `github.com` repository/`tree` paths; other protocols, credentials, ports, `..` segments and illegal characters are rejected. READMEs are fetched only from `api.github.com`, `raw.githubusercontent.com` and `cdn.jsdelivr.net`.
- Requests have a 12 s timeout, a 2 MiB cap and are aborted when the panel closes; the cache expires after 5 minutes, is capped at 24 entries and is cleared when the panel closes or the market page is left, so it cannot leak, grow without bound, or show stale content.
- **Accepted risk:** READMEs come from third-party repositories and may contain HTML (badges) and arbitrary https images. That content renders in the sandboxed iframe without script permission, so scripts cannot run; image requests still expose your IP to the image host (Referer is suppressed), and links may take the user to external sites (only when clicked). This is inherent to displaying third-party READMEs; the plugin never executes their code.
- The plugin makes no network requests other than the README/market calls above, reads no conversation content, and writes no files.

## Tests

```sh
node --check index.js
node --check client.js
node --test test/*.test.mjs
```

The tests have no third-party dependencies and cover GitHub URL parsing (`tree`/ref/sub-directory, dangerous addresses rejected), the README source fallback order, Markdown rendering and escaping, CSP document generation, mode persistence, width clamping, and the official-market adapter reading services only through `ctx.get`, resolving repositories (including monorepo directories) and re-pinning its dock root across the list/detail navigation. `client.js` exposes these functions through a `__test` property on the module object; runtime behaviour is unchanged. CI runs the same checks on Ubuntu and Windows with Node 22/24 (`.github/workflows/test.yml`).

## FAQ

**Clicking a card does nothing?** Check that the market is one of the "Supported markets" and that it links to a `github.com` repository. The built-in market needs the `remote.pluginMarket` service; on older DSH the plugin leaves the market untouched. If a market just launched a redesign, please open an issue.

**Why does the repository open in the right Sidebar instead of the panel?** On a conversation page with a visible right Sidebar, DSH's built-in browser is preferred (consecutive card clicks reuse the same tab). The panel is used when there is no Sidebar or it is covered by a full-page view.

**How do I get the external browser by default again?** In the panel footer, change "On card click" to "External browser". Ctrl/Cmd/Shift/Alt-click does it for a single click.

**The README looks stale?** A parsed result is cached for 5 minutes and cleared when the panel closes or the market page is left, so reopening it fetches fresh content.

**Are GitLab / Gitee repositories supported?** No, only `github.com`.

**Do you execute scripts in README files?** No — see "Security".

## Version

Current version `0.2.1`; see [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
