# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-11-01

Documentation and storefront-only release. No runtime or behaviour change: `client.js`,
`index.js`, the cordis patch and the plugin metadata are unchanged from 0.2.0. The module is
still dependency-free, and the suite is still the same 17 tests.

### Added

- Bilingual "What problem does this plugin solve?" and "What it does (follow the
  screenshots)" sections in `README.md` / `README_EN.md`: the problem, the step-by-step flow
  with captioned screenshots, and the existing supported-markets, settings, limitations and
  security sections kept in sync.
- `assets/screenshot-2.png`, a real E2E capture of the DSH built-in market's detail page with
  the plugin's README panel docked beside the Plugins page. `screenshots.json` now lists
  `screenshot-1.png` and `screenshot-2.png`.
- Both READMEs reference the screenshots through the `v0.2.1` raw URL; a
  `.github/release-notes/v0.2.1.md` note is provided for the tag-push release workflow.

### Documentation

- Corrected the README wording that implied every card click always opens the right
  Sidebar: the built-in browser is used only while a right Sidebar is visible, and the
  docked README panel is the fallback. The new flow also states which market each screenshot
  comes from (community `dshmarket` vs DSH's built-in experimental market).
- Version references, screenshot tag URLs and the current-version footer were updated from
  `0.2.0` to `0.2.1`.

[0.2.1]: https://github.com/LyuYuxin/dsh-market-peek/releases/tag/v0.2.1

## [0.2.0] - 2026-10-31

Release-quality pass for DSH 0.2.1-rc.3. The card-click interaction is unchanged in
behaviour, but the selectors and the sidebar/browser contract are now the ones shipped in
DSH 0.2.1-rc.3 and in the community `dshmarket` 1.73.x plugin market, which this plugin
targets.

### Added

- Plugin display metadata: original `icon.svg`, `locale/en.json` and `locale/zh.json` with
  `meta.title` / `meta.description`, so the plugin manager shows a localized title,
  description and icon. New `./icon` and `./locale/*.json` exports, updated `files`, and a
  `publishConfig` for public npm publishing.
- Built-in market adapter: cards of `@deepseek-ai/dsh-client-ui-plugin-market` carry only
  `data-market-entry`, so the adapter resolves the repository through the market's own
  `remote.pluginMarket` client service instead of scraping the DOM. It matches the exact
  entry name (relevance query, then a bounded text-less paged scan), honours
  `repository.directory` for monorepo packages, and caches per index + name. It never calls
  `preventDefault`/`stopPropagation`, so the market's own detail view still opens; when the
  service is absent the built-in market is left untouched.
- Dependency-free test suite (`node --test test/*.test.mjs`) for the pure helpers: GitHub
  URL parsing (`tree`/ref/sub-directory and dangerous addresses), README source fallback
  order, Markdown rendering/escaping, CSP document generation, mode persistence and width
  clamping. A regression test applies the plugin to a fake context whose direct
  `ctx.remote`/`ctx.locale` access throws (cordis 4 without `inject`) and checks that the
  adapter still resolves a repository through `ctx.get`. `client.js` exposes the helpers
  through a `__test` property on its module object without changing runtime behaviour.
- GitHub Actions workflow (`.github/workflows/test.yml`): `node --check` plus the test
  suite on `ubuntu-latest` and `windows-latest`, Node 22 and 24.
- README badges, a "supported markets / verified versions" table, a "how it detects the
  market" section, settings, limitations, security notes, FAQ and a test section; full
  English parity in `README_EN.md`.
- A stable test-seam module definition: `client.js` still registers the same module id in
  the browser, but can also be imported by Node for tests.

### Changed

- Market root detection prefers the market's own `[data-dsh-market-root]` marker, with the
  `<prefix>_root` CSS-module fallback (derived from `*_nmLink`) and `[class*="_root"]` after
  it. Card detection keeps the `*_card` + `*_nmLink` conventions and additionally accepts
  the card's first GitHub anchor if the title class is renamed.
- `parseRepo` now only accepts plain `https`/`http` `github.com` URLs (http is normalised
  to https), rejects credentials, ports, encoded whitespace and `.`/`..` path segments,
  validates the owner/repo characters and correctly encodes `tree` refs and sub-directory
  paths.
- README sources are built by a pure `readmeSources()` helper (same order: GitHub rendered
  API, four raw filenames, jsDelivr) so the fallback order is tested.
- Panel copy is registered with the Client locale service when available, and still falls
  back to the market's active language when it is not.
- Every plugin service (`locale`, `remote.pluginMarket`, `sidebarRight`,
  `sidebarRightTabs`) is looked up through `ctx.get(name)` instead of direct
  `ctx.<service>` access, which cordis 4 only permits for services declared in the plugin's
  `inject`. The built-in-market adapter therefore works without adding inject declarations
  (covered by the new regression test).
- `engines.dsh` is now `>= 0.2.1-rc.3`, the version the sidebar/browser contract was
  verified against.

### Fixed

- `assets/screenshot-1.webp` was a PNG file with the wrong extension, so browsers and
  image decoders that trust the MIME type rejected it. Renamed to
  `assets/screenshot-1.png`; `screenshots.json` and both READMEs point at the new file and
  the `v0.2.0` tag.
- Preview tab bookkeeping now checks the tab kind through the sidebar's own tab registry
  (`right.tabs.get('browser')`) before opening, with the `sidebarRightTabs` service as a
  fallback, and tolerates a missing `closeIn`/`mounted` implementation.
- The README iframe `<base href>` now percent-encodes the `ref` and sub-directory path, so a
  legal ref containing `#` or `?` no longer truncates it.
- Parsed READMEs expire after 5 minutes and are cleared when the panel closes or the market
  page is left, so reopening always fetches fresh content; the panel also re-evaluates the
  dark/light theme on every open instead of only when it is first built.
- Built-in-market previews no longer disappear when the market navigates from its list to
  its in-page detail view: the dock is pinned to the `[data-plugin-panel]` Plugins-page root
  (which survives the transition) and re-pinned on the watcher tick if that root is replaced.
  Only leaving the whole Plugins page restores everything. A single `console.warn` per entry
  name now reports a failed adapter resolution, so E2E logs can distinguish a missing
  `remote.pluginMarket` service from an index entry without a repository URL.

### Security

- The README iframe keeps its no-script sandbox (`allow-popups
  allow-popups-to-escape-sandbox`, no `allow-scripts`, no `allow-same-origin`) and the
  rendered document now also sends a strict CSP: `default-src 'none'`, `script-src 'none'`,
  `object-src 'none'`, `frame-src 'none'`, `connect-src 'none'`, `form-action 'none'`,
  `base-uri` limited to GitHub hosts, plus a `no-referrer` policy.
- Markdown rendering no longer emits active URL schemes: link labels/alt text are escaped
  and `javascript:`, `data:` and other non-http(s)/mailto links are replaced with `#`.
- README fetches are isolated per request with a 12 s abort timeout and a 2 MiB body limit
  (streamed), cached results are capped at 24 entries, and the request carries
  `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.
- Documented the accepted risk of rendering third-party README HTML and images (no script
  execution; image hosts still see the client IP; links require a user click).

### Documentation

- README/README_EN rewritten with install paths (npm and GitHub), settings, limitations,
  the official-market rationale and FAQ; new `CHANGELOG.md`.

[0.2.0]: https://github.com/LyuYuxin/dsh-market-peek/releases/tag/v0.2.0

## [0.1.0] - 2026-10-28

### Added

- Initial release: card-click preview of plugin-market entries, opening the repository in
  DSH's right-Sidebar browser tab or in a README panel docked beside the market.

[0.1.0]: https://github.com/LyuYuxin/dsh-market-peek/releases/tag/v0.1.0
