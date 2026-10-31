// Dependency-free checks for the pure helpers behind the card-click heuristics, the README
// fetcher and the docked panel. Run with `node --test test/*.test.mjs`.
// Importing client.js only registers its module definition; the factory body is pure until
// `apply(ctx)` runs, so no DOM, network or DSH runtime is needed here.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../client.js'

const definition = globalThis.__dshMarketPeek
const helpers = definition.factory().__test

test('module definition and test seam', () => {
  assert.equal(definition.id, 'dsh-market-peek')
  assert.equal(typeof definition.factory, 'function')
  assert.equal(typeof definition.factory().apply, 'function')
  for (const name of ['esc', 'parseRepo', 'readmeSources', 'renderMarkdown', 'readmeDocument', 'normalizeMode', 'readMode', 'readWidth', 'clampWidthTo']) {
    assert.equal(typeof helpers[name], 'function', `${name} is exposed`)
  }
})

test('parseRepo accepts GitHub repository and tree URLs', () => {
  assert.deepEqual(helpers.parseRepo('https://github.com/LyuYuxin/dsh-market-peek'), { owner: 'LyuYuxin', repo: 'dsh-market-peek', ref: '', dir: '', url: 'https://github.com/LyuYuxin/dsh-market-peek' })
  assert.deepEqual(
    helpers.parseRepo('https://github.com/LyuYuxin/dsh-market-peek/tree/main/'),
    { owner: 'LyuYuxin', repo: 'dsh-market-peek', ref: 'main', dir: '', url: 'https://github.com/LyuYuxin/dsh-market-peek/tree/main' },
  )
  assert.deepEqual(
    helpers.parseRepo('https://github.com/owner/repo/tree/v1.2.3/packages/plugin'),
    { owner: 'owner', repo: 'repo', ref: 'v1.2.3', dir: 'packages/plugin', url: 'https://github.com/owner/repo/tree/v1.2.3/packages/plugin' },
  )
  // A branch name that itself contains a slash is read as ref + sub directory (GitHub's own ambiguity).
  assert.deepEqual(helpers.parseRepo('https://github.com/owner/repo/tree/feat/branch/dir').ref, 'feat')
  assert.equal(helpers.parseRepo('https://github.com/owner/repo/tree/feat/branch/dir').dir, 'branch/dir')
  assert.equal(helpers.parseRepo('https://github.com/owner/repo.git').repo, 'repo')
  assert.equal(helpers.parseRepo('https://www.github.com/owner/repo').url, 'https://github.com/owner/repo')
  // Query and fragment are not part of the preview URL.
  assert.equal(helpers.parseRepo('https://github.com/owner/repo?tab=readme#install').url, 'https://github.com/owner/repo')
  // Paths below the repository (issues, blob, ...) still mean the repository root.
  assert.equal(helpers.parseRepo('https://github.com/owner/repo/issues/12').url, 'https://github.com/owner/repo')
  assert.equal(helpers.parseRepo('https://github.com/owner/repo/blob/main/README.md').dir, '')
  // An http address is accepted but normalised to https.
  assert.equal(helpers.parseRepo('http://github.com/owner/repo').url, 'https://github.com/owner/repo')
  // The URL parser resolves dot segments before the tree path is read.
  assert.equal(helpers.parseRepo('https://github.com/owner/repo/tree/..').url, 'https://github.com/owner/repo')
})

test('parseRepo rejects everything that is not a plain GitHub repository', () => {
  const rejected = [
    '',
    'not a url',
    'mailto:someone@example.com',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/repo',
    'https://gitlab.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://evil.example/github.com/owner/repo',
    'https://user:token@github.com/owner/repo',
    'https://github.com:8443/owner/repo',
    'https://github.com/owner',
    'https://github.com/owner/..',
    'https://github.com/./repo',
    'https://github.com/owner/re%20po',
  ]
  for (const href of rejected) assert.equal(helpers.parseRepo(href), null, `rejected: ${href}`)
  // Encoded dot segments are already resolved away by the URL parser, so they degrade to the repo root.
  assert.equal(helpers.parseRepo('https://github.com/owner/repo/tree/main/%2e%2e').url, 'https://github.com/owner/repo')
})

test('readmeSources keeps the documented fallback order', () => {
  const sources = helpers.readmeSources({ owner: 'owner', repo: 'repo', ref: 'main', dir: 'sub' })
  assert.deepEqual(sources, [
    { kind: 'html', source: 'api.github.com', url: 'https://api.github.com/repos/owner/repo/readme/sub?ref=main' },
    { kind: 'md', source: 'raw.githubusercontent.com', url: 'https://raw.githubusercontent.com/owner/repo/main/sub/README.md' },
    { kind: 'md', source: 'raw.githubusercontent.com', url: 'https://raw.githubusercontent.com/owner/repo/main/sub/readme.md' },
    { kind: 'md', source: 'raw.githubusercontent.com', url: 'https://raw.githubusercontent.com/owner/repo/main/sub/README_ZH.md' },
    { kind: 'md', source: 'raw.githubusercontent.com', url: 'https://raw.githubusercontent.com/owner/repo/main/sub/Readme.md' },
    { kind: 'md', source: 'cdn.jsdelivr.net', url: 'https://cdn.jsdelivr.net/gh/owner/repo@main/sub/README.md' },
  ])
})

test('readmeSources falls back to HEAD without a ref', () => {
  const sources = helpers.readmeSources({ owner: 'owner', repo: 'repo', ref: '', dir: '' })
  assert.equal(sources[0].url, 'https://api.github.com/repos/owner/repo/readme')
  for (const source of sources.slice(1, 5)) assert.match(source.url, /\/HEAD\/README/i)
  assert.equal(sources.at(-1).url, 'https://cdn.jsdelivr.net/gh/owner/repo/README.md')
})

test('renderMarkdown escapes untrusted text and refuses active URL schemes', () => {
  assert.equal(helpers.renderMarkdown('`<b>`'), '<p><code>&lt;b&gt;</code></p>')
  assert.equal(helpers.renderMarkdown('```\n<script>alert(1)</script>\n```'), '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>')

  const link = helpers.renderMarkdown('[<img src=x onerror=alert(1)>](javascript:alert(1))')
  assert.match(link, /href="#"/)
  assert.ok(!link.includes('javascript:'), 'javascript: href removed')
  assert.ok(!link.includes('<img'), 'link label escaped, not injected as markup')

  const image = helpers.renderMarkdown('![<x>](javascript:alert)')
  assert.equal(image, '<p>&lt;x&gt;</p>', 'unsafe image source degrades to escaped alt text')

  const safeImage = helpers.renderMarkdown('![alt](https://example.com/a.png)')
  assert.match(safeImage, /<img alt="alt" src="https:\/\/example.com\/a.png" loading="lazy">/)

  assert.match(helpers.renderMarkdown('[docs](https://example.com/x)'), /<a href="https:\/\/example.com\/x">docs<\/a>/)
  assert.match(helpers.renderMarkdown('**<b>** and *<i>* and ~~<x>~~'), /<strong>&lt;b&gt;<\/strong> and <em>&lt;i&gt;<\/em> and <del>&lt;x&gt;<\/del>/)
  assert.match(helpers.renderMarkdown('see https://example.com'), /<a href="https:\/\/example.com">https:\/\/example.com<\/a>/)
})

test('renderMarkdown keeps raw inline HTML as text (accepted, sandboxed risk)', () => {
  // README badges are commonly inline HTML. It stays markup, but the preview iframe has no script
  // permission and the document CSP is `default-src 'none'`, so it cannot execute.
  assert.equal(helpers.renderMarkdown('text <kbd>x</kbd>'), '<p>text <kbd>x</kbd></p>')
})

test('renderMarkdown renders tables, lists and quotes', () => {
  const table = helpers.renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
  assert.match(table, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/)
  assert.match(helpers.renderMarkdown('- one\n- two'), /<ul><li>one<\/li><li>two<\/li><\/ul>/)
  assert.match(helpers.renderMarkdown('1. one\n2. two'), /<ol><li>one<\/li><li>two<\/li><\/ol>/)
  assert.match(helpers.renderMarkdown('> quoted'), /<blockquote><p>quoted<\/p><\/blockquote>/)
  // Raw block HTML from a README is kept as-is by design; the frame cannot run it (sandbox + CSP).
  assert.match(helpers.renderMarkdown('<div align="center">badge</div>'), /^<div align="center">badge<\/div>$/)
})

test('safeLinkUrl and safeImageUrl only admit passive schemes', () => {
  assert.equal(helpers.safeLinkUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(helpers.safeLinkUrl('mailto:a@example.com'), 'mailto:a@example.com')
  assert.equal(helpers.safeLinkUrl('docs/README.md'), 'docs/README.md')
  assert.equal(helpers.safeLinkUrl('#anchor'), '#anchor')
  assert.equal(helpers.safeLinkUrl('javascript:alert(1)'), '#')
  assert.equal(helpers.safeLinkUrl('java\tscript:alert(1)'), '#', 'whitespace inside a scheme is ignored like browsers do')
  assert.equal(helpers.safeLinkUrl('data:text/html,x'), '#')
  assert.equal(helpers.safeLinkUrl(''), '#')
  assert.equal(helpers.safeImageUrl('https://example.com/a.png'), 'https://example.com/a.png')
  assert.equal(helpers.safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(helpers.safeImageUrl('images/a.png'), 'images/a.png')
  assert.equal(helpers.safeImageUrl('javascript:alert(1)'), null)
  assert.equal(helpers.safeImageUrl('data:text/html,x'), null)
  assert.equal(helpers.safeImageUrl(''), null)
})

test('readmeDocument is a sandboxed-friendly document with a restrictive CSP', () => {
  const doc = helpers.readmeDocument(
    { owner: 'owner', repo: 'repo', ref: 'main', dir: 'sub' },
    { kind: 'md', source: 'raw.githubusercontent.com', text: '# Title' },
  )
  assert.match(doc, /^<!doctype html>/)
  assert.match(doc, /<meta name="referrer" content="no-referrer">/)
  assert.match(doc, /default-src 'none'/)
  assert.match(doc, /script-src 'none'/)
  assert.match(doc, /base-uri https:\/\/raw\.githubusercontent\.com https:\/\/github\.com/)
  assert.match(doc, /<base href="https:\/\/raw\.githubusercontent\.com\/owner\/repo\/main\/sub\/"/)
  assert.match(doc, /<h1>Title<\/h1>/)
  assert.match(doc, /color-scheme:light/)
  const dark = helpers.readmeDocument({ owner: 'o', repo: 'r', ref: '', dir: '' }, { kind: 'md', text: 'x' }, true)
  assert.match(dark, /color-scheme:dark/)
})

test('readmeDocument never lets repository fields break the base element', () => {
  const doc = helpers.readmeDocument({ owner: 'o', repo: 'r', ref: 'main" onload="x', dir: 'a"b' }, { kind: 'md', text: 'x' })
  const href = doc.match(/<base href="([^"]*)"/)[1]
  assert.ok(!href.includes('"'), 'no raw quote escapes the href attribute')
  assert.ok(href.includes('main%22%20onload%3D%22x'), 'ref characters are percent-encoded')
  assert.ok(href.includes('a%22b/'), 'directory characters are percent-encoded')
  // Legal refs may contain `#`/`?`; the raw path must percent-encode them or the URL would truncate.
  const encoded = helpers.readmeDocument({ owner: 'o', repo: 'r', ref: 'main#x', dir: 'dir with space' }, { kind: 'md', text: 'x' })
  assert.match(encoded, /<base href="https:\/\/raw\.githubusercontent\.com\/o\/r\/main%23x\/dir%20with%20space\/"/)
})

test('official adapter reads services through ctx.get and resolves entries (no inject)', async () => {
  const savedWindow = globalThis.window
  const savedDocument = globalThis.document
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200,
    innerHeight: 800,
  }
  globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    documentElement: { clientWidth: 1200 },
    body: {},
  }
  try {
    const disposers = []
    const searches = []
    const pluginMarket = {
      async listIndexes() {
        return { ok: true, value: [{ url: 'https://index.example/a.json' }, { url: 'https://index.example/b.json', error: 'unreadable' }] }
      },
      async search(url, query) {
        searches.push({ url, query })
        // A relevance search that misses the exact name exercises the text-less paged fallback.
        if (query.text !== undefined) return { ok: true, value: { entries: [{ name: 'not-the-plugin' }], nextOffset: null } }
        return {
          ok: true,
          value: {
            entries: [{
              name: '@scope/plugin',
              repository: { url: 'https://github.com/owner/repo', directory: 'packages/plugin' },
              homepage: 'https://example.com',
            }],
            nextOffset: null,
          },
        }
      },
    }
    const services = { remote: { pluginMarket } }
    const ctx = {
      get: (name) => services[name],
      effect(fn) { const dispose = fn(); disposers.push(dispose); return () => {} },
    }
    // Reproduce cordis 4: direct `ctx.<service>` access without a declared inject throws.
    for (const name of ['remote', 'locale']) {
      Object.defineProperty(ctx, name, {
        configurable: true,
        get() { throw new Error(`cannot get property "${name}" without inject`) },
      })
    }
    const instance = definition.factory()
    instance.apply(ctx)
    assert.equal(instance.__test.officialMarket(), pluginMarket)
    const repo = await instance.__test.resolveOfficialRepo('@scope/plugin')
    assert.equal(repo.owner, 'owner')
    assert.equal(repo.repo, 'repo')
    assert.equal(repo.dir, 'packages/plugin', 'repository.directory is honoured for monorepos')
    assert.equal(repo.url, 'https://github.com/owner/repo/tree/HEAD/packages/plugin')
    assert.equal(searches[0].query.sort.kind, 'relevance', 'exact-name search uses relevance')
    assert.equal(searches[0].query.limit, 100)
    assert.ok(searches.some((call) => call.query.text === undefined), 'falls back to a text-less paged scan')
    const before = searches.length
    const cached = await instance.__test.resolveOfficialRepo('@scope/plugin')
    assert.equal(cached.url, repo.url, 'result is cached per index + name')
    assert.equal(searches.length, before, 'cache avoids another search')
    for (const dispose of disposers.reverse()) dispose?.()
  } finally {
    globalThis.window = savedWindow
    globalThis.document = savedDocument
  }
})

test('normalizeMode and readMode persist only the two known modes', () => {
  assert.equal(helpers.normalizeMode('external'), 'external')
  assert.equal(helpers.normalizeMode('here'), 'here')
  assert.equal(helpers.normalizeMode('EXTERNAL'), 'here')
  assert.equal(helpers.normalizeMode(undefined), 'here')
  assert.equal(helpers.normalizeMode(''), 'here')

  const storage = (value) => ({ getItem: (key) => (key === 'dsh-market-peek:mode' ? value : null) })
  assert.equal(helpers.readMode(storage('external')), 'external')
  assert.equal(helpers.readMode(storage('nonsense')), 'here')
  assert.equal(helpers.readMode(storage(null)), 'here')
  assert.equal(helpers.readMode({ getItem() { throw new Error('denied') } }), 'here')
  assert.equal(helpers.readMode(undefined), 'here')
})

test('width clamping keeps the panel between the minimum and the market reservation', () => {
  assert.equal(helpers.clampWidthTo(500, 1000, 0), 500)
  assert.equal(helpers.clampWidthTo(100, 1000, 0), 360, 'minimum width')
  assert.equal(helpers.clampWidthTo(5000, 1000, 0), 680, 'market keeps 320px')
  assert.equal(helpers.clampWidthTo(5000, 1000, 100), 580, 'market left offset counts')
  assert.equal(helpers.clampWidthTo(100, 500, 0), 360, 'minimum wins over a narrow window')
  assert.equal(helpers.clampWidthTo(500, 1000, 0, 420, 300), 500, 'custom bounds')
})

test('readWidth restores the saved width and falls back to 40% of the viewport', () => {
  const storage = { getItem: (key) => (key === 'dsh-market-peek:width' ? '512' : null) }
  assert.equal(helpers.readWidth(storage, 1000, 0), 512)
  assert.equal(helpers.readWidth({ getItem: () => '99999' }, 1000, 0), 680, 'saved width is clamped')
  assert.equal(helpers.readWidth({ getItem: () => '0' }, 1200, 0), 480, 'invalid saved width falls back to 40%')
  assert.equal(helpers.readWidth({ getItem: () => 'nope' }, 1200, 0), 480)
  assert.equal(helpers.readWidth({ getItem: () => '-10' }, 1200, 0), 480)
  assert.equal(helpers.readWidth({ getItem() { throw new Error('denied') } }, 1200, 0), 480)
})

test('esc escapes the characters used in innerHTML templates', () => {
  assert.equal(helpers.esc('<b>&"'), '&lt;b&gt;&amp;&quot;')
  assert.equal(helpers.esc(undefined), 'undefined')
})
