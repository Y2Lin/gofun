# AGENTS.md — GoFun 项目交接文档

> 本文档面向后续接手的 AI 与开发者，帮助快速理解项目架构、数据结构、关键约定和已踩过的坑。

---

## 项目是什么

**GoFun**（谐音 Go & Find）是一个 Chrome/Edge Manifest V3 浏览器扩展，功能类似 VSCode `Ctrl+Shift+P` 命令面板：
- 按快捷键呼出悬浮面板
- 模糊搜索当前窗口的 Tab、浏览历史、书签，并可执行内置命令
- 支持范围前缀（`/t` `/h` `/b` `/c`）和命令缩写（`/n` `/w` `/r` 等）
- Apple Spotlight 风格毛玻璃 UI，无构建依赖，纯原生 JS/CSS

---

## 文件结构

```
e:\Dev\gofun\
├── manifest.json       # MV3 配置：权限、快捷键、content script、图标
├── background.js       # Service Worker：搜索逻辑、命令执行、消息路由
├── content.js          # 注入到页面的 UI：面板 DOM、键盘/鼠标交互、渲染
├── palette.css         # 面板全部样式（浅/深色模式 + 窄屏响应式）
├── README.md           # 用户使用说明
├── AGENTS.md           # 本文件（AI/开发者交接文档）
└── icons/
    ├── icon.svg        # 小狗图标矢量源文件
    ├── icon16.png      # 工具栏/扩展管理 16px
    ├── icon32.png      # Windows 工具栏常用 32px
    ├── icon48.png      # 扩展管理页 48px
    └── icon128.png     # Chrome 网上应用店/安装时 128px
```

**零依赖、零构建**：直接在 `chrome://extensions/` 开启开发者模式，点"加载已解压扩展"选本目录即可运行。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                     Chrome 浏览器                        │
│                                                         │
│  ┌──────────────┐  commands API    ┌─────────────────┐  │
│  │ 快捷键/图标  │ ───────────────► │  background.js  │  │
│  │ Ctrl+Shift+P │                  │ (Service Worker)│  │
│  │ action click │ ◄────OPEN_PALETTE┤                 │  │
│  └──────────────┘  message         └────────┬────────┘  │
│         ▲                                   │ SEARCH/   │
│         │ 注入/动态注入                      │ EXECUTE   │
│         │                           message │           │
│  ┌──────┴───────┐                          ▼           │
│  │  content.js  │ ◄──────────────────────────┘         │
│  │ (注入到页面) │  面板 UI / 键盘 / 鼠标 / 渲染          │
│  │ palette.css  │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### 三端职责

| 模块 | 运行环境 | 职责 |
|---|---|---|
| **manifest.json** | Chrome 解析 | 声明权限、快捷键绑定、资源入口 |
| **background.js** | Service Worker | ① 接收 `SEARCH`/`EXECUTE`/`PING` 消息 ② 调 chrome.* API 搜索 tabs/history/bookmarks ③ 打分排序 ④ 执行命令 action ⑤ 处理 chrome:// 受限页 fallback 注入 |
| **content.js** | 网页上下文 | ① 创建/销毁面板 DOM ② 捕获键盘事件 ③ 60ms debounce 触发搜索 ④ 渲染结果列表、高亮、favicon ⑤ 鼠标 hover/键盘选择 ⑥ 执行选中项时发 `EXECUTE` 消息 |

---

## 消息协议（content ↔ background）

所有消息通过 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` 传递。

### content → background

| type | 字段 | 响应 |
|---|---|---|
| `PING` | 无 | `{ pong: true }`（用于预热 SW） |
| `SEARCH` | `{ query: string }` | `{ results: ResultItem[] }` |
| `EXECUTE` | `{ item: ResultItem }` | `{ success: boolean, error?: string }` |

### background → content

| type | 字段 | 触发场景 |
|---|---|---|
| `OPEN_PALETTE` | 无 | 用户按快捷键/点图标，background 请求当前 tab 打开面板 |

> **重要**：`OPEN_PALETTE` 消息在面板已可见时会**关闭面板**（toggle 行为）。这是为了防止 content keydown 和 chrome.commands 双重触发导致的开关竞态。

---

## 数据结构

### ResultItem（搜索结果项）

三种类型，通过 `type` 字段区分：

```js
// Tab
{ type: 'tab',      id: 'tab-<id>',  tabId: number, title, url, active: boolean, icon: 'tab' }
// History
{ type: 'history',  id: 'history-<url>-<lastVisitTime>', title, url, lastVisitTime, icon: 'clock' }
// Bookmark
{ type: 'bookmark', id: 'bookmark-<id>', title, url, icon: 'bookmark' }
// Command
{ type: 'command',  id: 'cmd.xxx',  title, subtitle, icon: '<iconKey>',
  alias: string[],       // GoFun 命令缩写，如 ['/n']，参与搜索 + UI 右侧蓝紫色胶囊
  browserKbd?: string,   // 浏览器原生快捷键，如 'Ctrl T'，UI 右侧灰色淡显
  keywords?: string[],   // 英文搜索关键词（不显示在 UI 上）
  action: Function       // 仅 background 有，content 中被剥离
}
```

### Command 定义（background COMMANDS 数组）

```js
{
  id: 'cmd.newtab',          // 唯一 id，executeItem 用它匹配
  type: 'command',
  title: '新建标签页',        // 主文本
  subtitle: '...',           // 副文本
  icon: 'plus',              // ICONS 对象的 key
  alias: ['/n'],             // GoFun 缩写（必须带 / 前缀）
  browserKbd: 'Ctrl T',      // 可选，浏览器原生快捷键提示
  keywords: ['new','tab'],   // 可选，英文搜索词
  action: () => { ... }      // 执行函数，返回 Promise 或直接调用 chrome API
}
```

**新增命令的步骤**：
1. 在 `background.js` 的 `COMMANDS` 数组添加一项（含 `action`）
2. 在 `content.js` 的 `COMMAND_SNAPSHOT` 数组添加同样的项（不含 `action`/`keywords`）
3. 若用了新图标 key，在 `content.js` 的 `ICONS` 对象加 SVG
4. 命令 id 必须以 `cmd.` 开头

### SCOPE_PREFIXES（范围前缀）

background 和 content **各自维护一份同结构定义**，必须保持同步：

```js
{ scope: 'tabs', full: '/tabs', short: '/t' }
{ scope: 'history', full: '/history', short: '/h' }
{ scope: 'bookmarks', full: '/bookmarks', short: '/b' }
{ scope: 'commands', full: '/commands', short: '/c' }
```

**匹配顺序必须"先长后短"**（full 在前，short 在后），否则 `/tabs` 会被 `/t` 抢先匹配。

添加新 scope 时两处都要改。

---

## 搜索与打分

### 打分层级（高 → 低）

| 分数 | 匹配类型 |
|---|---|
| 1100 | alias 精确匹配（去掉 / 后完全相等，如输 `n` 命中 `/n`） |
| 1050 | keyword 精确匹配 |
| 1000 | title 完全相等 |
| 950 | alias 前缀匹配 |
| 920 | keyword 前缀匹配 |
| 900 | title 前缀匹配 |
| 880 | query 以 alias 开头 |
| 850 | title 包含空格+query（单词开头） |
| 820 | alias 包含 query |
| 800 | keyword 包含 / title 包含 |
| 750 | url 完全相等 |
| 700 | url 包含 |
| 500 | title 模糊匹配（子序列） |
| 400 | url 模糊匹配 |
| 0 | 不匹配 |

### 空查询（打开面板时）
- 只搜 Tab（12条）+ 命令（8条），**不搜历史和书签**（冷启动更快）
- Tab 按 score 排，命令也按 score 排，合并去重

### 有查询关键词时
- Promise.all 并行搜 Tab(8) + 命令(6) + 历史(6) + 书签(4)
- 历史记录限制：最近 90 天、最多 100 条候选（避免遍历全部历史）
- 按 tab → command → history → bookmark 顺序合并去重

---

## 快捷键体系

### 双层设计（解决 Chrome 内置快捷键冲突）

| 快捷键 | 处理方 | 场景 |
|---|---|---|
| `Ctrl+Shift+P` / `Cmd+Shift+P` | Chrome `commands` API（manifest 注册） | 官方保底，所有页面（含 chrome://）可用 |
| `Ctrl+P` / `Cmd+P` | content.js `document` 捕获阶段 keydown | 普通 http(s) 页面拦截，阻止打印对话框 |

**为什么分两层**：Chrome 不允许扩展覆盖 `Ctrl+P`（打印是保留快捷键）。manifest 里只能绑 `Ctrl+Shift+P`，`Ctrl+P` 靠页面 keydown 在 capture 阶段 `preventDefault()`。chrome:// 页面 content script 无法注入，所以 `Ctrl+P` 在这些页面会触发打印；`Ctrl+Shift+P` 始终可用。

### content.js 键盘处理

- **全局导航**（`handleGlobalNav`）：面板可见时，`↑↓` `Tab` `Enter` `Esc` `PgUp/PgDn` `Ctrl+Home/End` 在 document 捕获阶段统一处理，焦点在哪都生效
- **Ctrl 组合键放行**：除了 `Ctrl+Home/End`，其他 Ctrl/Cmd 组合键（`Ctrl+T` `Ctrl+W` `Ctrl+Tab` 等）一律不拦截，让浏览器原生快捷键工作
- **可编辑元素保护**：页面的 `<input>` `<textarea>` `contentEditable` 内按 `Ctrl+P` 不触发面板
- **面板内 Ctrl+P**：关闭面板

### ⚠️ 不要在 content.js 的 keydown 里再额外拦截 Ctrl+Shift+P
这会导致双重触发竞态（manifest command 异步发消息 vs keydown 同步开面板，消息到达时面板已开又被关）。Ctrl+Shift+P 在 content 中**只阻止默认行为（在面板 input 内）但不执行开/关**。

---

## 性能优化点

1. **SW 冷启动预热**：content script 注入后立即发 `PING` 消息唤醒 SW，用户按快捷键时 SW 通常已活跃
2. **命令快照即时渲染**：`openPalette()` 同步渲染 `COMMAND_SNAPSHOT`（10条内置命令），不等 SW 响应；真实结果（含 tabs）异步返回后覆盖
3. **延迟 Loading**：结果 120ms 内返回则不显示"搜索中…"，避免闪烁
4. **60ms debounce**：输入时防抖，避免每次按键都发搜索
5. **竞态序号 searchSeq**：快速输入时过期响应静默丢弃
6. **空查询只搜 Tab+命令**：不碰历史/书签 API
7. **历史记录 90 天限制**：避免遍历全部历史
8. **选中态 class 切换不重建 DOM**：`updateSelectionClass()` 只移动 `.qp-selected` class，避免 mouseenter 与键盘导航冲突

---

## UI 渲染约定

### CSS 命名空间

所有 class/id 以 `qp-` 或 `quick-palette-` 前缀，避免与宿主页面冲突：
- 顶层：`#quick-palette-overlay`、`#quick-palette-container`、`#quick-palette-input`、`#quick-palette-results`、`#quick-palette-footer`
- 条目：`.qp-item`、`.qp-selected`、`.qp-icon`、`.qp-content`、`.qp-title`、`.qp-subtitle`
- 特殊：`.qp-badge`（"当前"标签）、`.qp-match`（高亮）、`.qp-favicon`、`.qp-alias`、`.qp-browser-kbd`、`.qp-loading-dots`

### 图标策略

- **命令类型**：用 `content.js ICONS` 中的内联 SVG，放在 `.qp-icon` 灰底圆角方形容器里
- **Tab/历史/书签**：优先用网站 favicon（`https://www.google.com/s2/favicons?domain=...&sz=32`），容器自动去掉灰底（`:has(.qp-favicon)` 选择器），失败时 fallback 到内置 SVG
- **favicon 容错**：`safeHostname()` 包 try-catch 处理 `chrome://` 等非法 URL；img onerror 替换为 `.qp-favicon-fallback` 占位

### 视觉风格

- **Apple 毛玻璃风**：`backdrop-filter: blur(30px) saturate(180%)`、0.5px hairline 描边、三层克制阴影
- **深色模式**：通过 `@media (prefers-color-scheme: dark)` 切换，不用纯黑，用奶茶灰紫（#2a2e42 系）
- **响应式**：`@media (max-width: 560px)` 缩小间距和字号，适配手机
- **动画**：入场 `translateY(-6px) scale(0.992)` → 0 弹性回弹，160ms fade；结果切换无动画
- **入场 class 时机**：先 appendChild 到 DOM，强制 `overlay.offsetHeight` 回流，再加 `.qp-visible` class，确保 transition 生效

### 选中态（.qp-selected）
- 蓝紫渐变背景（#6b7aff → #8b6eff）
- title/subtitle/match/shortcut 全部反色
- 不重建 DOM，只切 class

---

## 已知坑与注意事项

1. **Service Worker 会休眠**：不能在 SW 里用全局变量存状态（会丢失），所有状态要么从 chrome.* API 实时取，要么用 `chrome.storage`
2. **chrome:// 页面不能注入 content script**：`openPaletteInTab()` 检测到受限协议时，开新标签页（`chrome://newtab`）再尝试注入，失败则动态 `chrome.scripting.executeScript` 注入
3. **content script 重复注入防护**：`window.__GOFUN_INJECTED__` 守卫，`chrome.scripting.executeScript` 动态注入时不会叠加
4. **mouseenter 与键盘冲突**：不能在 mouseenter 里调用 renderResults（会重建 DOM 触发新的 mouseenter），只能调 `updateSelectionClass()` 移 class
5. **上下键跳格问题**：只在 document 捕获阶段绑一次 `handleGlobalNav`，不要再在 input 上绑 keydown 转发（会执行两次）
6. **favicon 外部依赖**：用了 google.com/s2/favicons，国内网络可能需要换备用源（如 `https://favicon.im/` 或本地无图 fallback）
7. **Chrome 图标缓存**：更换 icons/ 下 PNG 后必须在 `chrome://extensions` 点刷新按钮，工具栏图标才更新
8. **Ctrl/Cmd 统一判断**：所有跨平台判断用 `e.ctrlKey || e.metaKey`，`e.metaKey` 在 Mac 上是 Cmd
9. **消息回调必须检查 chrome.runtime.lastError**：content script 发消息时 SW 可能已休眠或不存在，不检查会报 "Unchecked runtime.lastError"
10. **SVG 图标必须 fill:none stroke:currentColor**：ICONS 里的 SVG 用 `stroke="currentColor"` 不硬编码颜色，选中态通过 CSS `color` 属性反色
11. **manifest 权限中的 storage 未使用**：声明了但代码里没用到，未来若加持久化设置可以直接用；要精简权限可删除
12. **history.search startTime:0** 空查询时传 0 是为了拿最近访问（Chrome 自身按 lastVisit 排）；有查询时限 90 天是性能优化

---

## 扩展建议（未来可做）

- **持久化设置**：用 `chrome.storage.sync` 存用户偏好（默认 scope、是否显示浏览器快捷键等）
- **最近使用命令**：执行命令后存 frequency，排序时加权
- **关闭其他标签页/关闭右侧标签页**等更多标签操作命令
- **自定义 alias**：允许用户绑定自己的缩写
- **工作区/窗口切换**：`chrome.windows.getAll()` 切换不同窗口
- **favicon 缓存**：用 `chrome://favicon/` 内部 URL（需声明 `favicon` permission）替代外部服务
- **搜索结果分组折叠/展开**

---

## 调试技巧

- **background.js**：`chrome://extensions/` → GoFun → "Service Worker" 链接打开 DevTools
- **content.js**：在任意页面按 F12，Console/Sources 里能看到 content.js 日志和断点
- **扩展重新加载**：改完代码在 `chrome://extensions/` 点刷新按钮（圆形箭头），不需要重新"加载已解压扩展"
- **快捷键冲突**：`chrome://extensions/shortcuts` 可查看和修改所有扩展快捷键绑定
- **图标不更新**：清除浏览器缓存或重启 Chrome，扩展图标缓存比较顽固
