# dsh-market-peek

[English](README_EN.md) · 中文

[![npm version](https://img.shields.io/npm/v/dsh-market-peek.svg)](https://www.npmjs.com/package/dsh-market-peek)
[![npm downloads](https://img.shields.io/npm/dm/dsh-market-peek.svg)](https://www.npmjs.com/package/dsh-market-peek)
[![test](https://github.com/LyuYuxin/dsh-market-peek/actions/workflows/test.yml/badge.svg)](https://github.com/LyuYuxin/dsh-market-peek/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.3-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)

在 DeepSeek Harness 的插件市场里，把「看插件仓库和 README」留在 DSH 内部：右侧栏可见时用 DSH 内置浏览器在右侧栏打开仓库，否则在市场旁边停靠一个 README 面板。安装、收藏、评论、截图等按钮保持原行为，市场本身不被替换。

## 这个插件解决什么问题？

- **点卡片就离开 DSH。** 社区 `dshmarket` 市场的卡片标题通常直接跳到外部浏览器里的 GitHub 页面；DSH 内置实验性市场的详情页有来源、版本和安装信息，但不显示 README。判断一个插件值不值得装，往往要在 DSH 和浏览器之间反复切换，或者手动复制仓库地址。
- **看完回来，状态已经变了。** 为对比 README 临时打开的页签、拖宽的面板、展开过的右侧栏，离开市场后不会自动还原，下一次点卡片又要重新摆一遍。
- **市场本身不该被改。** 安装、收藏、评论、截图这些操作属于市场；本插件只接管「打开仓库 / README」这一步，不替换市场页面，也不拦截市场自己的按钮。

它不注入新的市场页面，也不修改市场数据；只在卡片被点击时决定把仓库 / README 展示在哪里，并在离开时恢复原状。

## 它做什么（跟着截图看）

1. **打开插件市场，点插件标题或卡片空白处。** 安装、收藏、评论、截图等按钮仍然执行原来的操作；按住 Ctrl / Cmd / Shift / Alt 点击则这一次走外部浏览器。
   ![社区 dshmarket 市场：README 面板停靠在市场右侧](https://raw.githubusercontent.com/LyuYuxin/dsh-market-peek/v0.2.1/assets/screenshot-1.png)
   上图：社区 `dshmarket` 市场里点开插件后，README 面板停靠在市场右侧，市场自动缩窄让位；面板底部显示来源（如 `raw.githubusercontent.com`）和当前点击行为。
2. **右侧栏可见的会话页面：用 DSH 内置浏览器打开仓库。** 连续点不同插件时复用同一个预览页签，不会堆出一排标签；原本收起的右侧栏会先展开，离开后重新收起。
3. **没有可见右侧栏的整页市场：停靠 README 面板。** 面板可拖左边缘调宽（会记住），右下角可把点击行为切到「外部浏览器」，按 Esc 或 × 关闭。
   ![DSH 内置实验性市场：详情页照常打开，README 面板停靠在插件页右侧](https://raw.githubusercontent.com/LyuYuxin/dsh-market-peek/v0.2.1/assets/screenshot-2.png)
   上图：DSH 内置实验性市场里点开插件后，市场自己的详情页照常打开（来源、版本和安装信息仍可操作），README 面板同时停靠在插件页右侧；面板顶部显示仓库名和所有者，内容为对应插件的 README。
4. **离开市场后恢复。** 面板关闭、市场恢复原宽度、预览页签关闭，原本收起的右侧栏重新收起；解析过的 README 缓存同时清除，下次打开重新读取。

两张截图都来自实机 E2E；第一张是社区 `dshmarket` 市场，第二张是 DSH 内置实验性市场。

## 功能

- **点卡片就能预览。** 点插件标题或卡片空白处都会触发；安装、收藏、评论、截图等按钮保持原来的功能。按住 Ctrl / Cmd / Shift / Alt 点击仍然用外部浏览器打开。
- **两种展开方式。** 会话页面里右侧栏可用时，在 DSH 内置浏览器里打开仓库（复用同一个预览页签）；整页插件市场里没有右侧栏时，在右侧停靠 README 面板，市场自动缩窄让位。
- **离开即恢复。** 切到别的页面、会话或市场后，面板关闭、市场恢复原宽度、预览页签关闭；右侧栏原本收起的会重新收起。
- **面板可调宽度。** 拖左边缘调整，宽度记在 `localStorage` 里（`dsh-market-peek:width`）；按 Esc 或 × 关闭。
- **点击行为可切换。** 面板右下角选择「此处展开」（默认）或「外部浏览器」，记在 `dsh-market-peek:mode`。
- **README 多级回退。** 依次读 GitHub API 渲染版、`raw.githubusercontent.com` 的 4 种 README 文件名、jsDelivr 镜像；网络不通时自动换下一个。
- **跟随 DSH 主题和语言。** 面板使用 `--dsw-alias-*` 主题变量，深浅色主题自动跟随；面板文案跟随 DSH 当前语言（中文 / English）。
- **自带图标和本地化元数据。** 插件管理页显示独立的图标、标题和描述（`locale/zh.json`、`locale/en.json`）。

## 支持的插件市场

| 插件市场 | 已验证版本 | 触发方式 | 说明 |
|---|---|---|---|
| `dshmarket`（社区插件市场，主要目标） | 1.73.3 | 点卡片标题或卡片空白处 | 通过 `[data-dsh-market-root]`、`*_card`、`*_nmLink` 识别；有稳定的 `data-dsh-market-root` 时优先使用它 |
| `@deepseek-ai/dsh-client-ui-plugin-market`（DSH 内置实验市场） | 0.2.1-rc.3 | 点卡片（标题或空白处） | 卡片本身没有仓库 URL，插件通过市场自己的 `remote.pluginMarket` 客户端服务解析仓库；**不拦截市场自己的点击**，详情页照常打开 |
| 其他/更旧的市场 | — | 不接管 | 找不到仓库链接时完全不拦截点击，保持市场原行为 |

## 工作原理

### 如何识别插件市场

- **社区市场 `dshmarket`：** 卡片是带 `*_card` 类名的元素，标题是 `href` 指向 GitHub 仓库、类名以 `*_nmLink` 结尾的链接。页面根优先取 `[data-dsh-market-root]`，取不到时由 `*_nmLink` 的 CSS-module 前缀推导 `<前缀>_root`，再退回 `[class*="_root"]`。点击卡片空白处时会排除按钮、输入框、图片、菜单和正在选中的文本。
- **内置市场：** 卡片带 `data-market-entry="<包名>"`，发现页签是 `[data-plugin-tab="discover"]`。插件不读 DOM 里的仓库地址，而是通过 `ctx.get('remote').pluginMarket` 读取客户端服务（因此不需要声明 `inject`），调用 `listIndexes()`，先用 relevance 搜索并按精确包名匹配、找不到再退化为有界分页扫描，最后用条目里的 `repository.url`（含 monorepo 的 `repository.directory`）/ `homepage` 解析仓库。面板停靠在 `[data-plugin-panel]` 这个插件页根元素旁（从列表切到详情时它仍然存在），只有离开整个插件页才关闭；解析失败或服务不存在时什么都不做，内置市场保持原样。
- **右侧栏：** 通过 DSH 官方的 `ctx.sidebarRight` 服务（`openTab` / `tabsIn` / `close` / `closeIn` / `active` / `mounted` / `isExpanded` / `toggleExpanded`）打开和关闭预览页签；可见性用 `[data-sidebar-right-session]` 判断。检测不到右侧栏时自动退回停靠面板。

### README 怎么加载

1. `https://api.github.com/repos/<owner>/<repo>/readme`（`Accept: application/vnd.github.html+json`，GitHub 渲染好的 HTML，相对链接已解析）。
2. `README.md`、`readme.md`、`README_ZH.md`、`Readme.md`（`raw.githubusercontent.com`，内置 Markdown 渲染）。
3. jsDelivr 镜像 `https://cdn.jsdelivr.net/gh/<owner>/<repo>[@ref]/README.md`。

每次请求 12 秒超时，正文最多 2 MiB，面板关闭时中止未完成的请求；解析结果按仓库缓存 5 分钟（最多 24 条），关闭面板或离开市场时立即清除。

## 安装

要求：DeepSeek Harness `>= 0.2.1-rc.3`（Desktop 或 `dsh web`），并已启用一个插件市场（社区市场 `dshmarket`，或 DSH 内置实验市场）。

**从 npm 安装（推荐）：**

```sh
dsh plugin --profile desktop add dsh-market-peek
```

**从 GitHub 安装：**

```sh
dsh plugin --profile desktop add github:LyuYuxin/dsh-market-peek
```

**本地开发：** 把仓库目录链接进 profile，或按 `cordis-plugin-development` 的方式用 `plugin_manager` 的 `install_bundle` 安装这个目录。客户端插件改动后刷新页面即可生效。

装好后打开插件市场，点任意插件卡片试试。

## 设置

| 设置 | 存在哪里 | 默认 | 说明 |
|---|---|---|---|
| 点击行为 | `localStorage` 的 `dsh-market-peek:mode` | `here`（此处展开） | 面板右下角切换；`external` 时卡片点击改为在系统浏览器打开 |
| 面板宽度 | `localStorage` 的 `dsh-market-peek:width` | 窗口宽度的 40% | 最小 360 px，且至少给市场留 320 px；拖动左边缘更新 |

快捷键：

- `Esc` 关闭面板。
- `Ctrl` / `Cmd` / `Shift` / `Alt` + 点击卡片：本次强制用外部浏览器打开，不改设置。

## 已知限制

- **依赖市场 DOM。** 社区市场的卡片识别依赖 `dshmarket` 的 CSS-module 约定（`*_card`、`*_nmLink`、`<前缀>_root`）。市场改版或换用别的插件市场时可能失效；插件会退回「不拦截」，不会破坏市场本身。`data-dsh-market-root` 是市场自己也在用的稳定标记，优先使用。
- **内置市场是异步解析。** DSH 内置市场的卡片不带仓库地址，第一次点某张卡片要等一次本地服务往返（索引由 Host 缓存，通常很快）才会出现预览；同时市场自己的详情页仍会打开，这是刻意的「不吞点击」设计。面板停靠在插件页根元素旁，从列表进入详情不会关闭，只有离开整个插件页才恢复。选择「外部浏览器」模式时内置市场不做额外接管（仍由市场详情页处理），避免异步 `window.open` 被弹窗拦截。Host 没有提供 `remote.pluginMarket`（更旧的 DSH 或未启用市场）时，内置市场完全不受影响；解析失败时控制台会为每个包名打印一次 `[dsh-market-peek] official market preview skipped for ...` 警告，便于区分「服务缺失」和「索引里没有仓库地址」。
- **只支持 GitHub。** 只接受 `github.com` / `www.github.com` 的 https 仓库地址（http 会规范成 https）；其它域名、带账号密码或端口的地址一律忽略。GitLab、Gitee 等仓库不会触发预览。
- **GitHub API 限流。** 未登录的 GitHub API 每小时 60 次；超限后自动回退到 raw / jsDelivr。私有仓库的 README 读不到。
- **Markdown 是简化渲染。** raw 回退使用内置的小型渲染器（标题、列表、表格、引用、代码块、行内格式、链接和图片）；复杂扩展语法可能显示得不如 GitHub 完整。
- **面板覆盖在窗口右侧。** 停靠模式通过给市场加 `margin-right` 让位；如果某个页面本身是固定宽度或不支持滚动重排，面板可能贴住内容，此时可拖窄面板或改用内置浏览器模式。

## 安全说明

- README 显示在一个**没有脚本权限**的 iframe 里：`sandbox="allow-popups allow-popups-to-escape-sandbox"`，不含 `allow-scripts`、也不含 `allow-same-origin`。README 里的脚本永远不会执行。
- README 文档自带严格的 CSP：`default-src 'none'`、`script-src 'none'`、`object-src 'none'`、`frame-src 'none'`、`connect-src 'none'`、`form-action 'none'`；只允许 https 图片、内联样式和 https 字体；`base-uri` 限定为 GitHub 域名。另有 `<meta name="referrer" content="no-referrer">`。
- 仓库地址只接受 `github.com` 的普通仓库/`tree` 路径；拒绝其它协议、账号密码、端口、`..` 目录路径和非法字符。README 只从 `api.github.com`、`raw.githubusercontent.com`、`cdn.jsdelivr.net` 三个来源读取。
- 请求带 12 秒超时、2 MiB 上限和关闭即中止；缓存 5 分钟过期、最多 24 条，并在关闭面板或离开市场时清除，避免泄漏、无限增长和显示旧内容。
- **已接受的风险：** README 来自第三方仓库，可能包含 HTML（徽章等）和任意 https 图片。这些内容在没有脚本权限的沙箱 iframe 里渲染，脚本不能执行；但图片请求仍会让图片托管方看到你的 IP（Referer 已置空），README 里的链接也可能把用户带到外部站点（需要用户主动点击）。这是显示第三方 README 的固有风险，插件不会执行其中的代码。
- 插件自身不发起除上述 README/市场服务之外的网络请求，不读取会话内容，不写任何文件。

## 测试

```sh
node --check index.js
node --check client.js
node --test test/*.test.mjs
```

测试无第三方依赖，覆盖：GitHub URL 解析（`tree`/ref/子目录、拒绝危险地址）、README 来源回退顺序、Markdown 渲染与转义、CSP 文档生成、模式持久化、宽度夹取，以及官方市场适配器只通过 `ctx.get` 读取服务、解析仓库（含 monorepo 子目录）并在列表/详情切换时重定位停靠根。`client.js` 通过模块对象上的 `__test` 暴露这些函数，运行时行为不受影响。CI 在 Ubuntu 和 Windows 的 Node 22/24 上跑同一组检查（`.github/workflows/test.yml`）。

## 常见问题

**点了卡片没反应？** 先确认用的是「支持的插件市场」表里的市场，并且市场里有指向 `github.com` 的仓库链接。内置市场依赖 `remote.pluginMarket` 服务；更旧的 DSH 上插件会保持市场原样。如果市场刚改版，欢迎提 issue。

**为什么打开的是右侧栏而不是面板？** 会话页面里右侧栏可见时会优先用 DSH 内置浏览器打开仓库（连续点卡片复用同一个页签）；没有右侧栏或右侧栏被页面盖住时才停靠面板。

**怎么改回直接跳外部浏览器？** 面板右下角把「点击插件卡片时」改成「外部浏览器」；或按住 Ctrl/Cmd/Shift/Alt 点卡片只对这一次生效。

**README 显示旧内容？** 解析结果缓存 5 分钟，关闭面板或离开市场后会立即清除，重新打开就会重新读取。

**支持 GitLab / Gitee 仓库吗？** 不支持，只接受 `github.com`。

**插件会执行 README 里的脚本吗？** 不会，见「安全说明」。

## 版本

当前版本 `0.2.1`，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)
