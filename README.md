# GoFun - Go & Find 命令面板

一个 Chrome / Edge 浏览器扩展，提供 **Apple Spotlight 风格**的命令面板搜索体验。名字 **GoFun** 谐音 **Go & Find**，寓意「快速去找到你想要的」。

## 功能

- **默认搜索打开的 Tab 页**：输入关键字快速切换标签页，关键字在标题和 URL 中高亮显示。
- **搜索浏览历史**：按标题或 URL 搜索最近 90 天的历史记录。
- **搜索书签**：快速打开书签。
- **10 条内置命令**：新建/关闭/复制标签页、前进后退、刷新、打开设置/扩展/书签管理器/历史记录。
- **范围限定前缀**：全称 `/tabs` `/history` `/bookmarks` `/commands`，缩写 `/t` `/h` `/b` `/c` 快速切换搜索范围。
- **命令缩写**：`/n`（新建）`/w`（关闭）`/r`（刷新）`/ext`（扩展）`/set`（设置）等单字母命令。
- **中英文搜索**：命令同时支持中文、英文关键词和缩写。
- **流畅体验**：
  - 三阶段渐进渲染（命令快照 0ms → Tab 缓存 1ms → SW 实时查询 ~100ms）
  - 搜索请求自动去重（竞态序号避免新结果被覆盖）
  - 空查询只显示 Tab + 命令，秒开
  - 面板淡入入场动画，暗/浅色自动适配

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

在输入框中使用以下前缀可限定搜索范围（全称和缩写等价）：

| 全称 | 缩写 | 说明 |
|------|------|------|
| `/tabs` | `/t` | 仅搜索当前窗口打开的标签页 |
| `/history` | `/h` | 仅搜索浏览历史 |
| `/bookmarks` | `/b` | 仅搜索书签 |
| `/commands` | `/c` | 仅搜索内置命令 |

> 提示：输入 `/` 但不匹配任何前缀时，会自动落入 `/commands` 命令搜索模式。

## 命令缩写（GoFun 内置命令）

| 命令 | 缩写 | 浏览器原生快捷键 | 英文搜索关键词 |
|---|---|---|---|
| 新建标签页 | `/n` | Ctrl T | new, tab, newtab, open |
| 关闭当前标签页 | `/w` | Ctrl W | close, closetab, remove |
| 复制当前标签页 | `/dup` | — | duplicate, copy, clone |
| 重新加载当前页 | `/r` | Ctrl R | reload, refresh, f5 |
| 后退 | `/back` | Alt ← | back, goback, previous |
| 前进 | `/fwd` | Alt → | forward, next, goforward |
| 管理扩展 | `/ext` | — | extensions, ext, addon, plugin |
| 浏览器设置 | `/set` | — | settings, config, preferences, setup |
| 书签管理器 | `/bm` | Ctrl Shift O | bookmarks, bookmark, fav, star |
| 历史记录 | `/his` | Ctrl H | history, recent, visited |

## 安装方法

### 开发者模式加载（推荐测试）

1. 打开 Chrome / Edge 浏览器，进入扩展管理页面：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本文件夹 `gofun`。
5. 点击扩展图标（小狗头像），或按 `Ctrl+P` / `Cmd+P`（普通网页）/ `Ctrl+Shift+P` / `Cmd+Shift+P`（全页面）呼出面板。

### 打包为 .zip / .crx

可将本文件夹压缩为 `.zip`，然后上传到 Chrome Web Store 开发者后台进行发布。

```bash
zip -r gofun.zip gofun
```

## 文件结构

```
gofun/
├── manifest.json      # 扩展清单（MV3，最低 Chrome 105）
├── background.js      # Service Worker：搜索、命令、Tab 缓存、onInstalled 注入
├── content.js         # 内容脚本：命令面板 UI、键盘/鼠标交互、渲染
├── palette.css        # 面板样式（Spotlight 风格，暗/浅色 + 窄屏响应式）
├── icons/             # 扩展图标（小狗头像 SVG + PNG 四档）
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── README.md          # 本文件（用户说明）
└── AGENTS.md          # AI/开发者交接文档（架构、坑、数据结构）
```

## 自定义命令

如需添加更多内置命令，按以下步骤：

1. 在 `background.js` 的 `COMMANDS` 数组添加一项（含 `action` 函数）
2. 在 `content.js` 的 `COMMAND_SNAPSHOT` 数组添加同样的项（不含 `action`/`keywords`）
3. 若用了新图标 key，在 `content.js` 的 `ICONS` 对象加 SVG
4. 命令 id 必须以 `cmd.` 开头

## 注意事项

- 扩展需要 `tabs`、`history`、`bookmarks`、`scripting`、`storage` 等权限才能读取对应数据、写 Tab 快照缓存、在受限页面动态注入脚本。
- 扩展安装/更新后会自动向所有已打开的 http(s) 标签页注入内容脚本；若遇个别页面仍无效，刷新该页面即可。
- Chrome 内置页面（`chrome://`、`edge://` 等）无法注入内容脚本：按快捷键 / 点图标会自动跳转新标签页并打开面板。
- 搜索历史限定最近 90 天；空查询不搜历史/书签，仅显示 Tab 和命令以确保秒开。
- favicon 采用双源策略（Google + favicon.im），国内网络环境下加载更稳定。
- 最低支持 Chrome 105（用到 `:has()` CSS 选择器 + `backdrop-filter`）。
