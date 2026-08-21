# AGENTS.md — GoFun 项目交接文档

> 本文档面向后续接手的 AI 与开发者，帮助快速理解项目架构、数据结构、关键约定和已踩过的坑。

---

## 项目是什么

**GoFun**（谐音 Go & Find）是一个 Chrome/Edge Manifest V3 浏览器扩展，功能类似 VSCode `Ctrl+Shift+P` 命令面板，对标 TabCmdr（含其付费功能的免费替代）：
- 按快捷键呼出悬浮面板
- 模糊搜索**所有窗口**的 Tab（当前窗口/活跃优先，跨窗口带「其他窗口」badge）、浏览历史、书签、最近关闭的标签页、下载记录，并可执行 51 条内置命令
- 支持范围前缀（`/tabs` `/t` `/history` `/h` `/bookmarks` `/b` `/commands` `/c` `/closed` `/cl` `/downloads` `/d`）、命令缩写（`/n` `/w` `/r` 等）和 TabCmdr 风格冒号前缀（`:t` `:b` `:cl`…）
- 页面工具：区域截图、屏幕取色器、像素尺子、页面媒体控制、二维码、复制标题/链接/Markdown/选中文本
- 14 套主题（跟随系统/浅色/深色/Dracula/Nord/Catppuccin/Tokyo Night/Gruvbox/Solarized/Rosé Pine/One Dark/Monokai/Ayu Dark/Palenight/Everforest）+ 紧凑模式 + 面板位置（居中/靠上/靠下/刘海 notch/四角），配置存 `chrome.storage.sync`
- Apple Spotlight 风格毛玻璃 UI，无构建依赖，纯原生 JS/CSS

---

## 文件结构

```
e:\Dev\gofun\
├── manifest.json       # MV3 配置：权限、快捷键、content script、图标、options 页
├── background.js       # Service Worker：搜索逻辑、51 条命令、消息路由、Tab 缓存、区域截图
├── content.js          # 注入到页面的 UI：面板 DOM、键盘/鼠标交互、渲染、主题应用
├── palette.css         # 面板全部样式（CSS 变量主题系统 + 紧凑模式 + 位置 + 窄屏响应式）
├── options.html        # 设置页（主题卡片、位置、紧凑模式、历史天数）
├── options.js          # 设置页逻辑（读写 chrome.storage.sync 的 gofun_settings）
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
┌─────────────────────────────────────────────────────────────┐
│                       Chrome 浏览器                          │
│                                                             │
│  ┌──────────────┐  commands API    ┌─────────────────────┐  │
│  │ 快捷键/图标  │ ───────────────► │  background.js       │  │
│  │ Ctrl+Shift+P │                  │ (Service Worker)     │  │
│  │ action click │ ◄────OPEN_PALETTE┤                      │  │
│  └──────┬───────┘  message         └──────────┬───────────┘  │
│         │                                   │ SEARCH/       │
│         │ Ctrl+P (window capture)           │ EXECUTE/      │
│         │                           message │ GET_TAB_CACHE  │
│  ┌──────┴───────┐                          ▼               │
│  │  content.js  │ ◄──────────────────────────┘              │
│  │ (注入到页面) │  面板 UI / 键盘 / 鼠标 / 渲染               │
│  │ palette.css  │                                            │
│  └──────────────┘                                            │
│         ▲                                                    │
│         │ chrome.storage.local (Tab 快照缓存)                │
│         └──────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────────────┘
```

### 三端职责

| 模块 | 运行环境 | 职责 |
|---|---|---|
| **manifest.json** | Chrome 解析 | 声明权限（tabs/history/bookmarks/activeTab/scripting/storage/sessions/downloads/tabGroups）、快捷键绑定、资源入口、options 页 |
| **background.js** | Service Worker | ① 接收 `SEARCH`/`EXECUTE`/`PING` 消息 ② 调 chrome.* API 搜索 tabs/history/bookmarks/sessions/downloads ③ 打分排序 ④ 执行命令 action ⑤ 处理 chrome:// 受限页 fallback 注入 ⑥ 监听 Tab 事件写 `chrome.storage.local` 缓存 ⑦ `onInstalled` 时主动注入所有已打开标签页 |
| **content.js** | 网页上下文 | ① 创建/销毁面板 DOM ② 在 `window` capture 阶段捕获键盘事件 ③ 60ms debounce 触发搜索 ④ 渲染结果列表、高亮、favicon ⑤ 鼠标 hover/键盘选择 ⑥ 执行选中项时发 `EXECUTE` 消息 ⑦ 打开面板时先读 `chrome.storage.local` 缓存秒显 Tab 列表 ⑧ 应用主题/紧凑/位置设置（`chrome.storage.onChanged` 实时生效）⑨ 执行 client 命令（复制/滚动/打印/全屏/二维码） |
| **options.html/js** | 设置页 | 读写 `chrome.storage.sync` 的 `gofun_settings`，主题卡片选择、面板位置、紧凑模式、历史天数配置 |

---

## 消息协议（content ↔ background）

所有消息通过 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` 传递。

### content → background

| type | 字段 | 响应 |
|---|---|---|
| `PING` | 无 | `{ pong: true }`（用于预热 SW） |
| `SEARCH` | `{ query: string }` | `{ results: ResultItem[] }` |
| `EXECUTE` | `{ item: ResultItem, tabAction?: string }` | `{ success: boolean, error?: string, refresh?: boolean }`（tabAction='close' 时关闭对应 Tab 并要求面板刷新，Alt+Enter 触发） |
| `GET_TAB_CACHE` | 无 | `{ tabs: ResultItem[] }`（从 storage 读取，SW 无需活跃） |
| `SCREENSHOT_AREA` | `{ rect: {x,y,width,height,dpr} }` | `{ success, error? }`（区域截图：captureVisibleTab 全屏 → ImageBitmap 裁剪 → dataURL 下载） |

### background → content

| type | 字段 | 触发场景 |
|---|---|---|
| `OPEN_PALETTE` | 无 | 用户按快捷键/点图标，background 请求当前 tab 打开面板 |

> **重要**：`OPEN_PALETTE` 消息在面板已可见时会**关闭面板**（toggle 行为）。这是为了防止 content keydown 和 chrome.commands 双重触发导致的开关竞态。

### 消息协议详解

每条消息的完整生命周期和边界条件：

**PING** — SW 预热
- 触发时机：content script 注入后立即发送（`injectContentScript` 末尾）
- 目的：用户按快捷键前 SW 通常已活跃，消除首次打开面板的冷启动延迟
- 容错：不检查响应，失败静默（SW 可能还没注册）

**SEARCH** — 核心搜索
- 触发：content.js `performSearch()` 60ms debounce 后发送
- 响应：`{ results: ResultItem[] }`，每项已剥离 `action`/`keywords` 等内部字段
- 竞态防护：content 端维护 `searchSeq` 自增序号，过期响应（seq < 当前）直接丢弃
- 错误处理：SW 异常返回空数组，content 显示"未找到结果"

**EXECUTE** — 执行选中项
- 触发：Enter / 点击结果项 / Tab 行操作按钮 / Alt+Enter
- `tabAction` 字段：对 tab 类型的修饰操作（close/pin/mute/reload/duplicate/move/group/popout）
- `refresh` 响应：close/pin 等 Tab 行操作后返回 `{ refresh: true }`，content 调用 `refreshResults()` 重搜并保留选中项位置
- client 命令不到 background：content.js 直接执行（复制/滚动/打印/全屏/二维码/媒体控制）

**GET_TAB_CACHE** — 秒显 Tab 列表
- 触发：`openPalette()` 同步阶段
- 实现：直接读 `chrome.storage.local.cachedTabs`，不经过 SW
- 目的：Phase 2 渐进渲染，SW 冷启动时也能秒出 Tab 列表

**SCREENSHOT_AREA** — 区域截图
- 触发：content.js 选框结束后发送矩形坐标
- 流程：`captureVisibleTab` 截全屏 → `createImageBitmap` 裁剪 → canvas 转 dataURL → `chrome.downloads.download` 下载
- 限制：只能截当前激活窗口的可视区域，chrome:// 页面失败

**OPEN_PALETTE** — 打开/切换面板
- 触发：chrome.commands 快捷键 / 扩展图标点击
- 方向：background → 当前激活 tab 的 content script
- toggle 逻辑：content 收到时若面板已开则关闭，防止双重触发竞态
- chrome:// 页面 fallback：检测到受限协议时开新标签页再注入

---

## 数据流与渲染流程

### 面板打开的完整时序（三阶段渐进渲染）

```
用户按 Ctrl+P / Ctrl+Shift+P
        │
        ▼
  content.js keydown 捕获
        │
        ├─ Phase 1 (0ms, 同步)：渲染 COMMAND_SNAPSHOT（51 条命令）
        │     · createOverlay() 首次创建 DOM
        │     · renderResults(COMMAND_SNAPSHOT, '')
        │     · 输入框聚焦，面板入场动画
        │
        ├─ Phase 2 (~1ms)：读 chrome.storage.local.cachedTabs
        │     · GET_TAB_CACHE 直接读存储，不依赖 SW
        │     · 合并命令 + 缓存 Tab，覆盖 Phase 1 结果
        │     · 用户此时已能看到 Tab 列表
        │
        └─ Phase 3 (~50-200ms)：发 SEARCH 消息给 SW
              · SW 调 chrome.tabs.query 拿最新数据
              · 按打分排序后返回
              · content 收到后覆盖 Phase 2 缓存结果
              · 若 120ms 内返回则不显示 loading
```

### 搜索输入的数据流

```
用户输入字符
    │
    ▼
input event → debounce(60ms) → scheduleLoading()
    │                              │
    │                              └─ 不清空现有结果，120ms 后仍无新结果才显示 loading
    ▼
performSearch(query)
    │
    ├─ searchSeq++（竞态序号）
    ├─ 解析 scope（/tabs /h :t 等前缀）
    ├─ chrome.runtime.sendMessage({ type: 'SEARCH', query })
    │
    ▼
background.js performSearch()
    │
    ├─ parseQuery() 解析 scope
    ├─ 空查询：Promise.all([tabs, commands]) → mergeUniqueResults
    ├─ 有查询：Promise.all([tabs, commands, history, bookmarks, closed, downloads])
    │           → mergeUniqueResults（按 GROUP_ORDER 去重合并）
    │           → 加 openurl / websearch 兜底
    └─ 返回 results（剥离 action/keywords）
    │
    ▼
content.js 收到响应
    │
    ├─ 检查 searchSeq，过期则丢弃
    ├─ cancelLoading()
    ├─ results = resp.results
    ├─ selectedIndex = 0（重置选中）
    └─ renderResults(results, query)
           │
           ├─ 按 type 分组（GROUP_ORDER 顺序）
           ├─ 每项 highlight() 高亮匹配字符
           ├─ Map 记录 item→index（O(1) 查找）
           └─ 事件委托（click / mouseover 统一挂 resultsEl）
```

### 渲染流程细节

`renderResults(items, highlightQuery)` 执行步骤：
1. 空结果 → 显示"未找到结果"占位，return
2. 建 `grouped` 对象按 type 分组 + `indexOfItem` Map 存 item→index 映射
3. 清空 `resultsEl.innerHTML`
4. 按 `GROUP_ORDER` 顺序遍历分组：
   - 创建 `.qp-group` 容器 + `.qp-group-label` 分类名
   - 遍历组内每项：
     - 创建 `.qp-item`，设 `data-index`，选中项加 `.qp-selected`
     - 拼 icon / title（含 badge）/ subtitle / 右侧操作区的 HTML 字符串
     - `el.innerHTML = ...` 一次性写入
     - append 到 groupEl
5. groupEl append 到 resultsEl

**选中态更新**（`updateSelectionClass`）：只移动 `.qp-selected` class，不重建 DOM，避免 mouseenter 与键盘导航的循环触发。

---

## 数据结构

### ResultItem（搜索结果项）

核心四种类型，通过 `type` 字段区分：

```js
// Tab（跨窗口搜索：otherWindow 标识非当前窗口，UI 显示「其他窗口」badge）
{ type: 'tab',      id: 'tab-<id>',  tabId: number, title, url, active: boolean, otherWindow?: boolean, icon: 'tab' }
// History
{ type: 'history',  id: 'history-<url>-<lastVisitTime>', title, url, lastVisitTime, icon: 'clock' }
// Bookmark
{ type: 'bookmark', id: 'bookmark-<id>', title, url, icon: 'bookmark' }
// Command
{ type: 'command',  id: 'cmd.xxx',  title, subtitle, icon: '<iconKey>',
  alias: string[],       // GoFun 命令缩写，如 ['/n']，参与搜索 + UI 右侧蓝色胶囊
  browserKbd?: string,   // 浏览器原生快捷键，如 'Ctrl T'，UI 右侧灰色淡显
  keywords?: string[],   // 英文搜索关键词（不显示在 UI 上）
  client?: boolean,      // true = 由 content.js 本地执行（复制/滚动/打印/全屏/二维码）
  setScope?: string,     // 执行后不关面板，把输入框切换为该范围前缀
  action: Function       // 仅 background 有，content 中被剥离
}
// 最近关闭（chrome.sessions）
{ type: 'closed',   id: 'closed-<sessionId>', title, url, sessionId, icon: 'restore' }
// 下载记录
{ type: 'download', id: 'download-<id>', downloadId: number, title, url, icon: 'download' }
// URL 直达 / 网页搜索兜底
{ type: 'openurl',    id: 'openurl-<url>', title, url, icon: 'link' }
{ type: 'websearch',  id: 'websearch-<q>', title, url, icon: 'search' }
```

content.js 的 `GROUP_ORDER` 决定分组渲染顺序：`tab → command → closed → download → history → bookmark → openurl → websearch`。

### Command 定义（background COMMANDS 数组，共 51 条）

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
  client: true,              // 可选，由 content.js 本地执行（页面级操作）
  setScope: '/tabs ',        // 可选，执行后切换输入框范围而不关面板
  action: () => { ... }      // 执行函数，返回 Promise 或直接调用 chrome API
}
```

**51 条命令分组**（alias 详见代码）：

- **标签页基础**：新建/关闭/复制/重载/硬重载/后退/前进
- **标签页整理**（对标 TabCmdr）：固定、静音、关闭重复 `/dedup`、关闭其他 `/co`、关闭右侧 `/cr`、关闭左侧 `/cll`、收藏当前页 `/fav`、按标题排序 `/sort`、按域名分组 `/group`、取消所有分组 `/ungroup`、合并所有窗口 `/merge`、挂起其他标签页 `/sus`、移到新窗口 `/mv`、分屏视图 `/split`、恢复关闭 `/undo`
- **窗口**：新建窗口 `/win`、无痕窗口 `/inc`
- **缩放与页面**：放大/缩小/重置缩放、查看源代码、截图 `/ss`、区域截图 `/ssa`（client）、屏幕取色器 `/pick`（client）、像素尺子 `/ruler`（client）、复制标题、复制链接、复制 Markdown 链接、复制选中文本 `/cs`（client）、生成二维码、滚动到顶/底、打印、全屏
- **页面媒体**（client）：播放/暂停 `/pp`、静音 `/mm`、快进 `/mf`、快退 `/mb`
- **系统页面**：管理扩展 `/ext`、浏览器设置 `/set`、书签管理器 `/bm`、历史记录 `/his`、下载记录 `/dlp`、GoFun 设置页 `/opt`

**新增命令的步骤**：
1. 在 `background.js` 的 `COMMANDS` 数组添加一项（含 `action`）
2. 在 `content.js` 的 `COMMAND_SNAPSHOT` 数组添加同样的项（不含 `action`/`keywords`）
3. 若用了新图标 key，在 `content.js` 的 `ICONS` 对象加 SVG
4. 命令 id 必须以 `cmd.` 开头
5. 若是页面级操作（复制/滚动等），标 `client: true` 并在 content.js 的 `executeClientCommand()` 加分支

### SCOPE_PREFIXES（范围前缀）

background 和 content **各自维护一份同结构定义**，必须保持同步：

```js
{ scope: 'tabs',      full: '/tabs',      short: '/t'  }
{ scope: 'history',   full: '/history',   short: '/h'  }
{ scope: 'bookmarks', full: '/bookmarks', short: '/b'  }
{ scope: 'commands',  full: '/commands',  short: '/c'  }
{ scope: 'closed',    full: '/closed',    short: '/cl' }
{ scope: 'downloads', full: '/downloads', short: '/d'  }
```

**匹配顺序必须"先长后短"**（full 在前，short 在后），否则 `/tabs` 会被 `/t` 抢先匹配。

**冒号前缀别名（TabCmdr 风格）**：background 和 content 各维护一份 `COLON_ALIASES`（如 `:t`→`/tabs`、`:cl`→`/closed`），在 scope 解析前先做 `normalizeColonPrefix()` 归一化为 `/` 前缀，再走正常匹配。添加新 scope 时三处（SCOPE_PREFIXES × 2 + COLON_ALIASES × 2）都要改。

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
- URL 形式的输入生成 `openurl` 直达项；无结果时兜底 `websearch`（Google 搜索）
- Promise.all 并行搜 Tab(8) + 命令(6) + 历史(6) + 书签(4) + 最近关闭(3) + 下载(4)
- 历史记录限制：默认最近 90 天（设置页可改 `historyDays`）、最多 100 条候选（避免遍历全部历史）
- 按 `GROUP_ORDER` 顺序合并去重
- 范围前缀（如 `/t foo`）只搜对应数据源

### Tab 缓存机制（三阶段渐进渲染）

| 阶段 | 延迟 | 数据来源 | 内容 |
|---|---|---|---|
| Phase 1 | 0ms | 内置 `COMMAND_SNAPSHOT` | 51 条命令立即出现 |
| Phase 2 | ~1ms | `chrome.storage.local` 缓存 | Tab 列表从本地存储读出，无需 SW |
| Phase 3 | ~50-200ms | SW `chrome.tabs.query` | 最新结果覆盖缓存 |

- background 启动时立即写一次缓存
- 监听 `onCreated`/`onUpdated`/`onRemoved`/`onActivated` 四个事件，100ms 防抖写入
- SW 休眠后 storage 数据依然在，打开面板秒读

---

## 快捷键体系

### 双层设计（解决 Chrome 内置快捷键冲突）

| 快捷键 | 处理方 | 场景 |
|---|---|---|
| `Ctrl+Shift+P` / `Cmd+Shift+P` | Chrome `commands` API（manifest 注册） | 官方保底，所有页面（含 chrome://）可用 |
| `Ctrl+P` / `Cmd+P`、`Ctrl+K` / `Cmd+K` | content.js `window` 捕获阶段 keydown | 普通 http(s) 页面拦截，阻止打印对话框/浏览器地址栏搜索（Ctrl+K 对标 TabCmdr 默认快捷键） |

**为什么分两层**：Chrome 不允许扩展覆盖 `Ctrl+P`（打印是保留快捷键）。manifest 里只能绑 `Ctrl+Shift+P`，`Ctrl+P` 靠页面 keydown 在 capture 阶段 `preventDefault()`。chrome:// 页面 content script 无法注入，所以 `Ctrl+P` 在这些页面会触发打印；`Ctrl+Shift+P` 始终可用。

### content.js 键盘处理

- **keydown 挂在 `window` 而非 `document`**：部分大站（如淘宝）在 `window` capture 阶段 `stopPropagation()`，挂在 `document` 上会收不到事件。`window` 是 capture 链最前端，任何网站的 handler 都无法抢在前面。
- **全局导航**（`handleGlobalNav`）：面板可见时，`↑↓` `Tab` `Enter` `Esc` `PgUp/PgDn` `Ctrl+Home/End` 统一处理，焦点在哪都生效
- **面板内结果操作快捷键**：`Ctrl/Cmd+W` 或 `Alt+Enter` 关闭选中的 Tab 结果（面板保持打开并刷新列表）；`Tab`/`Shift+Tab` 在顶部分类间循环切换
- **Ctrl 组合键放行**：除了 `Ctrl+Home/End` 和面板内对 Tab 结果的 `Ctrl/Cmd+W`，其他 Ctrl/Cmd 组合键（`Ctrl+T` `Ctrl+Tab` 等）一律不拦截，让浏览器原生快捷键工作
- **可编辑元素保护**：页面的 `<input>` `<textarea>` `contentEditable` 内按 `Ctrl+P` 不触发面板
- **面板内 Ctrl+P**：关闭面板

### ⚠️ 不要在 content.js 的 keydown 里再额外拦截 Ctrl+Shift+P
这会导致双重触发竞态（manifest command 异步发消息 vs keydown 同步开面板，消息到达时面板已开又被关）。Ctrl+Shift+P 在 content 中**只阻止默认行为（在面板 input 内）但不执行开/关**。

---

## 性能优化点

1. **SW 冷启动预热**：content script 注入后立即发 `PING` 消息唤醒 SW，用户按快捷键时 SW 通常已活跃
2. **命令快照即时渲染**：`openPalette()` 同步渲染 `COMMAND_SNAPSHOT`（51 条内置命令），不等 SW 响应
3. **Tab 缓存秒显**：`chrome.storage.local` 存储 Tab 快照，打开面板时 ~1ms 读出，无需等 SW
4. **延迟 Loading**：结果 120ms 内返回则不显示"搜索中…"，避免闪烁
5. **60ms debounce**：输入时防抖，避免每次按键都发搜索
6. **竞态序号 searchSeq**：快速输入时过期响应静默丢弃
7. **空查询只搜 Tab+命令**：不碰历史/书签 API
8. **历史记录 90 天限制**：避免遍历全部历史
9. **选中态 class 切换不重建 DOM**：`updateSelectionClass()` 只移动 `.qp-selected` class，避免 mouseenter 与键盘导航冲突；`Ctrl+Home/End` 也用轻量切换而非全量 `renderResults`
10. **onInstalled 主动注入**：扩展安装/更新时向所有已打开的 http(s) 标签页注入 content script，避免"老页面快捷键无效"
11. **渲染索引用 Map**：`renderResults` 用 `Map` 记录 item→index，避免循环里 `indexOf` 的 O(n²)
12. **Tab 操作后保留选中项**：`refreshResults`（close/pin 等 Tab 行操作后刷新）按 id 匹配保留用户当前选中项，不强制跳回顶部

---

## UI 渲染约定

### CSS 命名空间

所有 class/id 以 `qp-` 或 `quick-palette-` 前缀，避免与宿主页面冲突：
- 顶层：`#quick-palette-overlay`、`#quick-palette-container`、`#quick-palette-input`、`#quick-palette-results`、`#quick-palette-footer`
- 条目：`.qp-item`、`.qp-selected`、`.qp-icon`、`.qp-content`、`.qp-title`、`.qp-title-text`、`.qp-subtitle`
- 特殊：`.qp-badge`（"当前"标签）、`.qp-match`（高亮）、`.qp-favicon`、`.qp-alias`、`.qp-browser-kbd`、`.qp-loading-dots`
- 挂在 body 的浮层（自含字体，不走命名空间）：`#gofun-toast`、`#gofun-qr-overlay`
- **标题省略号**：`.qp-title` 是 flex 容器（放 badge），真正的截断在内层 `.qp-title-text`（`min-width:0 + ellipsis`）。不要把文本直接放在 flex 容器里用 `inline-flex`——ellipsis 会失效

### 主题系统（CSS 变量）

- 所有颜色集中在 `#quick-palette-overlay` 的 `--qp-*` CSS 变量（bg/text/dim/faint/icon/accent/accent-bg/accent-soft/hover/scroll/kbd 等）
- **跟随系统**（默认）：浅色变量为默认值，`@media (prefers-color-scheme: dark)` 覆盖为深色变量
- **显式主题**：content.js 给 overlay 加 `qp-theme-<name>` class，变量覆盖媒体查询（class 选择器优先级更高），支持 light/dark/dracula/nord/catppuccin/tokyo-night/gruvbox/solarized/rose-pine/one-dark/monokai/ayu/palenight/everforest
- **紧凑模式**：`qp-compact` class 缩小宽度/字号/间距
- **面板位置**：`qp-pos-center`（默认 12vh）/`qp-pos-top`（4vh）/`qp-pos-bottom`（贴底）/`qp-pos-notch`（刘海贴顶，容器上边缘无圆角、从上方滑入）/四角 `qp-pos-top-left|top-right|bottom-left|bottom-right`
- 新增主题：palette.css 加一个 `qp-theme-x` 变量块 + options.js 的 THEMES 数组加一项 + content.js 的 THEME_LIST 加一项（THEME_LIST 现含 14 套显式主题）
- 新增位置：palette.css 加 `qp-pos-x` 布局 + content.js 的 POSITION_LIST 加一项 + options.html 的 position 下拉加 option

### 图标策略

- **命令类型**：用 `content.js ICONS` 中的内联 SVG，无容器边框，直接 18px 显示，颜色跟 `currentColor`
- **Tab/历史/书签**：优先用网站 favicon（`https://www.google.com/s2/favicons?domain=...&sz=32`），22px 裸显示无包裹，失败时 fallback 到 `.qp-favicon-fallback` 占位色块
- **favicon 容错**：`safeHostname()` 包 try-catch 处理 `chrome://` 等非法 URL

### 视觉风格

- **Apple Spotlight 纯净风**：纯白毛玻璃 `rgba(255,255,255,0.92)` + `blur(40px) saturate(180%)`，1px 极淡描边，单层阴影 `0 24px 80px rgba(0,0,0,0.16)`，圆角 16px
- **主色**：Apple 系统蓝 `#007aff`（浅色）/ `#0a84ff`（深色）
- **选中态**：`rgba(0, 122, 255, 0.1)` 浅蓝半透明背景，文字保持深色不反白，图标变蓝；背景 0.12s 过渡
- **hover 态**：`rgba(0, 0, 0, 0.04)` 极淡灰
- **匹配高亮**：`#007aff` 蓝色文字 + `font-weight: 500`，选中态加粗到 600
- **图标**：命令类 SVG 统一 `stroke-width:1.8` + `stroke-linecap/join: round`，选中态 `color` 过渡到主色；搜索图标 20px/1.8
- **分类 Tab 激活态**：主色文字 + `--qp-accent-soft` 浅蓝底（与 hover 的灰底区分），一眼可辨当前作用域
- **Tab 行工具栏**：默认整行淡出（opacity 0→1 过渡），hover/选中时淡入；按钮 `:active` 有 scale(0.9) 按压反馈，关闭按钮 hover 变红；命令/历史等非 Tab 行右侧快捷键始终可见
- **按钮按压反馈**：ESC、设置、Tab 操作按钮均有 `:active { transform: scale(0.9~0.95) }`
- **深色模式**：`rgba(40, 40, 42, 0.92)` 柔和深灰（不用纯黑），选中态 `rgba(10, 132, 255, 0.18)`
- **响应式**：`@media (max-width: 560px)` 缩小间距和字号，窄屏隐藏 move/group/popout 三个低频 Tab 操作按钮，footer 只保留前 3 个提示
- **动画**：入场 `translateY(-8px) scale(0.99)` → 0，200ms `cubic-bezier(0.22, 1, 0.36, 1)`
- **入场 class 时机**：先 appendChild 到 DOM，强制 `overlay.offsetHeight` 回流，再加 `.qp-visible` class，确保 transition 生效
- **滚动条**：8px 宽，`background-clip: content-box` 留白，hover 时加深

---

## 已知坑与注意事项

1. **Service Worker 会休眠**：不能在 SW 里用全局变量存状态（会丢失），所有状态要么从 chrome.* API 实时取，要么用 `chrome.storage.local`
2. **chrome:// 页面不能注入 content script**：`openPaletteInTab()` 检测到受限协议时，开新标签页（`chrome://newtab`）再尝试注入
3. **content script 重复注入防护**：`window.__GOFUN_INJECTED__` 守卫；`injectContentScript()` 函数在动态注入前先执行 `window.__GOFUN_INJECTED__ = false` 清除旧守卫（扩展重载后旧 context 已死但守卫仍为 true）
4. **onInstalled 主动注入**：扩展安装/更新后，已打开的页面没有 content script，`onInstalled` 监听器会向所有 http(s) 标签页注入。若用户手动 reload 扩展后某些页面仍无效，刷新该页面即可
5. **keydown 必须挂 window**：大站（淘宝等）在 `window` capture 阶段 `stopPropagation()`，挂在 `document` 上会收不到事件
6. **mouseenter 与键盘冲突**：不能在 mouseenter 里调用 renderResults（会重建 DOM 触发新的 mouseenter），只能调 `updateSelectionClass()` 移 class
7. **上下键跳格问题**：只在 window 捕获阶段绑一次 `handleGlobalNav`，不要再在 input 上绑 keydown 转发（会执行两次）
8. **favicon 外部依赖**：用了 google.com/s2/favicons，国内网络可能需要换备用源（如 `https://favicon.im/` 或本地无图 fallback）
9. **Chrome 图标缓存**：更换 icons/ 下 PNG 后必须在 `chrome://extensions` 点刷新按钮，工具栏图标才更新
10. **Ctrl/Cmd 统一判断**：所有跨平台判断用 `e.ctrlKey || e.metaKey`，`e.metaKey` 在 Mac 上是 Cmd
11. **消息回调必须检查 chrome.runtime.lastError**：content script 发消息时 SW 可能已休眠或不存在，不检查会报 "Unchecked runtime.lastError"
12. **SVG 图标必须 fill:none stroke:currentColor**：ICONS 里的 SVG 用 `stroke="currentColor"` 不硬编码颜色，选中态通过 CSS `color` 属性变色
13. **storage 权限**：manifest 声明了 `storage` 权限，用于 `chrome.storage.local` 存储 Tab 快照缓存，`chrome.storage.sync` 存用户设置。不是无用权限
14. **history.search startTime:0** 空查询时传 0 是为了拿最近访问（Chrome 自身按 lastVisit 排）；有查询时限 90 天是性能优化
15. **settings 存 sync 不是 local**：`gofun_settings`（主题/位置/紧凑/历史天数）存 `chrome.storage.sync` 可跨设备同步
16. **截图命令的权限**：`captureVisibleTab` 需要 `activeTab` 权限且只能截当前激活窗口可视区域，chrome:// 页面会失败
17. **二维码/favicon 外部依赖**：二维码用 api.qrserver.com，favicon 用 google.com/s2/favicons，国内网络受限时会走 onerror fallback

---

## 扩展建议（未来可做）

- **最近使用命令**：执行命令后存 frequency，排序时加权
- **自定义 alias**：允许用户绑定自己的缩写
- **工作区/窗口切换**：`chrome.windows.getAll()` 切换不同窗口
- **favicon 缓存**：用 `chrome://favicon/` 内部 URL（需声明 `favicon` permission）替代外部服务
- **搜索结果分组折叠/展开**
- **会话保存/恢复**：把当前窗口所有 Tab 存为命名会话，一键恢复（TabCmdr 付费功能之一）

---

## 调试技巧

- **background.js**：`chrome://extensions/` → GoFun → "Service Worker" 链接打开 DevTools
- **content.js**：在任意页面按 F12，Console/Sources 里能看到 content.js 日志和断点
- **扩展重新加载**：改完代码在 `chrome://extensions/` 点刷新按钮（圆形箭头），不需要重新"加载已解压扩展"
- **快捷键冲突**：`chrome://extensions/shortcuts` 可查看和修改所有扩展快捷键绑定
- **图标不更新**：清除浏览器缓存或重启 Chrome，扩展图标缓存比较顽固
- **某页面快捷键无效**：① 确认是 http(s) 页面（chrome:// 不支持 Ctrl+P）② 刷新该页面（扩展重载后旧页面可能没有 content script）③ 检查 F12 Console 是否有 __GOFUN_INJECTED__ 相关错误
- **设置页**：`chrome://extensions/` → GoFun → 详情 → 扩展程序选项，或面板内执行 `/opt`
- **主题预览**：设置页点主题卡片即时生效（storage.onChanged 实时同步到已打开的面板）

---

## 测试体系

### 目录结构

```
tests/
├── unit/                    # 单元测试（Node 内置 test runner，零浏览器依赖）
│   ├── extract.js           # 从 bg/ct 源码提取纯函数的工具（VM 沙箱 + 正则切片）
│   ├── background.test.js   # background 纯函数：safeHostname / fuzzyMatch / score* / formatSize / tryOpenUrl
│   ├── content.test.js      # content 纯函数：parseScope / stripScope / escapeHtml / highlight / categoryFromQuery / getGroupLabel
│   ├── scope.test.js        # scope 解析 + 冒号前缀归一化 + 双端 SCOPE/COLON 一致性
│   └── sync.test.js         # 双端一致性：51 条命令 id/client 标记 / manifest 权限 / 文档数字
└── e2e/                     # Playwright E2E 测试（真实 Chromium + 扩展加载）
    ├── helpers.js           # launchExtension / injectContentScript / openPalette 等辅助函数
    ├── palette.spec.js      # 面板交互用例（基础/搜索/范围前缀/键盘导航/执行，共 21 条）
    └── fixture.html         # 本地静态测试页（沙箱无外网）
```

### 运行命令

```bash
npm test          # 单元测试（~150ms）
npm run test:e2e  # E2E 测试（~15s，需下载 Chromium）
npm run test:all  # 全部
```

### 单元测试原理

扩展代码是 IIFE 且依赖 `chrome.*` API / DOM，无法直接 `require`。
[`tests/unit/extract.js`](file:///E:/Dev/gofun/tests/unit/extract.js) 用以下方法解耦：

1. **正则定位**：`findDecl(src, name)` 找到 `const NAME` / `function name` 声明位置
2. **大括号配平**：`extractBalanced()` 从声明开始按 `{}` / `[]` 配平提取完整代码块
3. **const → var**：VM 沙箱中 `const`/`let` 不会挂到全局对象，替换为 `var` 使 sandbox 可访问
4. **注入桩**：`document`（极简 mock，支持 `textContent`/`innerHTML` 转义）、`URL`（Node 原生 URL 构造函数）
5. **VM 执行**：`vm.runInContext(code, sandbox)` 在隔离上下文执行

跨 VM 对象比较用 `JSON.stringify(actual) === JSON.stringify(expected)` 而非 `deepStrictEqual`（原型链不同会判不等）。

### E2E 测试原理

**为什么手动注入 content script？** Playwright/Chromium 在 Windows 自动化模式下，即使通过 `--load-extension` 加载了扩展，也不会自动向 http(s) 页面注入 content script（与真实用户使用行为不同）。因此 E2E 采用以下策略：

1. **启动扩展**：`chromium.launchPersistentContext` + `--load-extension`，确保 Service Worker 注册、扩展 ID 可用
2. **本地 fixture**：`http.createServer` 提供静态 `fixture.html`（沙箱无外网）
3. **手动注入**：`page.addStyleTag({ path: 'palette.css' })` + `page.addScriptTag({ path: 'content.js' })`
4. **Mock chrome API**：注入前先写入 `window.chrome.runtime` / `window.chrome.storage` mock，模拟 SEARCH/EXECUTE/PING 消息响应
5. **测试钩子**：`content.js` 末尾暴露 `window.__GOFUN_TEST__ = { openPalette, closePalette, isVisible }`，E2E 直接调用而非模拟快捷键（快捷键在自动化环境中不可靠）

### 覆盖范围

| 层级 | 用例数 | 覆盖内容 |
|---|---|---|
| 单元 | 87 | 打分（14 级）、scope 解析（先长后短）、冒号前缀归一化、HTML 转义、匹配高亮、分类推断、分组标签、双端命令一致性（51 条）、client 标记一致性、manifest 完整性、文档数字同步 |
| E2E | 21 | 面板开关/toggle、首屏渲染、7 分类 Tab 顺序、搜索/空状态/缩写匹配、匹配高亮、输入同步、5 种 scope 切换、Tab 点击切换、ArrowUp/Down 选中态、Tab/Shift+Tab 分类切换、命令执行+新标签页、options 页加载、执行后面板关闭 |

### 新增测试的约定

- 单元测试文件名：`*.test.js`，放在 `tests/unit/`
- E2E 测试文件名：`*.spec.js`，放在 `tests/e2e/`
- 新增纯函数测试：在 `extract.js` 的 `loadBackgroundPure` / `loadContentPure` 中加一行 `extractByName(src, '函数名')`，再写对应 `.test.js`
- 新增 E2E 用例：优先用 `page.evaluate(() => window.__GOFUN_TEST__...)` 驱动面板状态，避免依赖浏览器级快捷键
- E2E mock 搜索数据在 `helpers.js` 的 `mockSearch()` 函数中维护
