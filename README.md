# GoFun - Go & Find 命令面板

一个 Chrome / Edge 浏览器扩展，提供类似 VSCode 命令面板的快速搜索体验。名字 **GoFun** 谐音 **Go & Find**，寓意「快速去找到你想要的」。

## 功能

- **默认搜索打开的 Tab 页**：输入关键字快速切换标签页，关键字会在标题和 URL 中高亮显示。
- **搜索浏览历史**：按标题或 URL 搜索历史记录。
- **搜索书签**：快速打开书签。
- **内置命令**：新建/关闭/复制标签页、前进后退、刷新、打开设置/扩展/下载/历史页面等。
- **范围限定**：使用前缀 `/tabs`、`/history`、`/bookmarks`、`/commands` 快速切换搜索范围。
- **流畅体验**：搜索请求自动去重（避免竞态覆盖新结果）、空查询只显示 Tab + 常用命令、面板淡入入场动画、暗/浅色自动适配。

## 快捷键

GoFun 提供**双层快捷键**，普通网页「零配置」即可上手，内置页也有官方保底：

- **日常页面推荐**：`Ctrl + P`（Windows / Linux）或 `Cmd + P`（macOS）
  普通 http(s) 页面会**直接拦截打印**并打开面板，无需手动设置。
- **全页面保底**：`Ctrl + Shift + P`（Windows / Linux）或 `Cmd + Shift + P`（macOS）
  在 `chrome://`、`edge://` 等无法注入脚本的页面里，官方快捷键一定可用。
- **关闭面板**：`Esc`（或再次按下 `Ctrl+P`）
- **选择**：`↑` / `↓` / `Tab` / `Shift+Tab`
- **翻页**：`PgUp` / `PgDn`
- **跳到首 / 尾**：`Ctrl+Home` / `Ctrl+End`（macOS 为 `Cmd+Home` / `Cmd+End`）
- **确认**：`Enter`

> 为什么要有两套？因为 Chrome 把 `Ctrl+P` 硬编码为打印快捷键，扩展无法自动替换它；
> 但普通网页里 GoFun 会在页面层直接拦截 `Ctrl+P`，因此**绝大多数使用场景下你直接按 `Ctrl+P` 就行**。

## 搜索范围前缀

在输入框中使用以下前缀可限定搜索范围：

| 前缀 | 说明 |
|------|------|
| `/tabs` | 仅搜索当前窗口打开的标签页 |
| `/history` | 仅搜索浏览历史 |
| `/bookmarks` | 仅搜索书签 |
| `/commands` | 仅搜索内置命令 |

> 提示：输入 `/` 但不匹配任何前缀时，会自动落入 `/commands` 命令搜索模式。

## 安装方法

### 开发者模式加载（推荐测试）

1. 打开 Chrome / Edge 浏览器，进入扩展管理页面：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本文件夹 `gofun`。
5. 点击扩展图标（小狗头像），或按 `Ctrl+P` / `Cmd+P`（普通网页） / `Ctrl+Shift+P` / `Cmd+Shift+P`（全页面）呼出面板。

### 打包为 .zip / .crx

可将本文件夹压缩为 `.zip`，然后上传到 Chrome Web Store 开发者后台进行发布。

```bash
zip -r gofun.zip gofun
```

## 文件结构

```
gofun/
├── manifest.json      # 扩展清单（MV3）
├── background.js      # Service Worker：搜索与动作执行
├── content.js         # 内容脚本：命令面板 UI 与交互
├── palette.css        # 面板样式（暗 / 浅色模式）
├── icons/             # 扩展图标（小狗头像，16/32/48/128）
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 自定义命令

如需添加更多内置命令，请编辑 `background.js` 中的 `COMMANDS` 数组，每个命令包含 `id`、`title`、`subtitle`、`icon` 和 `action` 函数。

## 注意事项

- 扩展需要 `tabs`、`history`、`bookmarks`、`scripting` 等权限才能读取对应数据和在受限页面动态注入脚本。
- 首次安装时若某些页面已打开，点击扩展图标或按快捷键会自动注入内容脚本；如遇异常，可刷新页面后重试。
- Chrome 内置页面（如 `chrome://extensions`、`edge://`）无法注入内容脚本：在这些页面按快捷键 / 点图标，会自动跳转新标签页并打开面板。
- 历史记录 / 书签的数据量可能非常大；默认在空查询时不拉取历史和书签以确保秒开。输入关键字后会立即加入搜索。
