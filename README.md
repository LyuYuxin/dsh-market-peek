# dsh-market-peek

[English](README_EN.md) · 中文

在 DeepSeek Harness 插件市场里点插件卡片时，**不再跳到外部浏览器**，直接在 DSH 里看插件详情。

![预览](assets/screenshot-1.webp)

## 功能

- **整页插件市场**：点卡片后，市场右侧停靠一个面板，显示该插件的 README。面板不遮挡市场，市场会自动让出位置。
- **会话页面里的插件市场**（有右侧栏时）：用 DSH 内置浏览器在右侧栏打开插件的 GitHub 仓库页；连续点多个插件只复用同一个页签。
- **离开插件市场自动恢复**：切到别的页面或会话后，面板关闭、市场恢复原宽度、预览页签关闭；右侧栏原本是收起的会重新收起。
- 点击插件标题或卡片空白处都会触发；安装、收藏、评论等按钮保持原来的功能。
- 面板右下角可切换点击行为：**此处展开**（默认）或 **外部浏览器**。
- 按住 Ctrl / Cmd / Shift / Alt 点击，仍然用外部浏览器打开。
- 面板左边缘可拖动调宽度（会记住），按 Esc 或 × 关闭。

## 安装

在 DSH 插件市场搜索 `dsh-market-peek`，点击“安装”。

或者用命令行：

```sh
dsh plugin add github:LyuYuxin/dsh-market-peek
```

## 说明

- README 依次从 GitHub API（渲染版）、raw.githubusercontent.com、jsDelivr 镜像读取，网络不通时会自动换下一个。
- README 显示在没有脚本权限的沙箱 iframe 里，只展示内容，不执行其中的代码。
- 插件通过插件市场卡片的样式类名识别卡片；如果插件市场改版导致点击没反应，请提 issue。

## 许可证

MIT
