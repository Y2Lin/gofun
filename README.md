# GoFun - Go & Find 命令面板

一个 Chrome / Edge 浏览器扩展，提供类似 VSCode 命令面板的快速搜索体验。名字 **GoFun** 谐音 **Go & Find**，寓意「快速去找到你想要的」。功能对标 TabCmdr（含其付费功能的免费替代）。

## 功能

- **跨窗口搜索 Tab 页**：搜索所有窗口的标签页并快速切换，当前窗口/活跃标签优先，关键字在标题和 URL 中高亮，跨窗口结果带「其他窗口」标识。
- **搜索浏览历史 / 书签 / 最近关闭 / 下载记录**：按标题或 URL 模糊搜索。
- **51 条内置命令**：新建/关闭/复制/固定/静音标签页、关闭重复/其他/左侧/右侧、按标题排序、按域名分组、合并窗口、挂起其他页、分屏视图、恢复关闭、收藏当前页、缩放、截图、二维码、复制标题/链接/Markdown 等。
- **页面工具**：区域截图（拖框选）、屏幕取色器（复制 HEX/RGB）、像素尺子（拖拽测距）、复制选中文本、页面媒体控制（播放/暂停/静音/快进快退）。
- **范围限定**：前缀 `/tabs` `/history` `/bookmarks` `/commands` `/closed` `/downloads` 及缩写 `/t` `/h` `/b` `/c` 等；也支持 TabCmdr 风格冒号前缀（`:t`、`:b`、`:cl`…）。
- **14 套主题**：跟随系统/浅色/深色/Dracula/Nord/Catppuccin/Tokyo Night/Gruvbox/Solarized/Rosé Pine/One Dark/Monokai/Ayu Dark/Palenight/Everforest，另有紧凑模式、面板位置（居中/靠上/靠下/刘海/四角）设置。
- **流畅体验**：Tab 缓存秒开、命令快照即时渲染、搜索防抖与竞态丢弃、暗/浅色自动适配。

## 快捷键

GoFun 提供**双层快捷键**，普通网页「零配置」即可上手，内置页也有官方保底：

- **日常页面推荐**：`Ctrl + P` / `Ctrl + K`（Windows / Linux）或 `Cmd + P` / `Cmd + K`（macOS）
  普通 http(s) 页面会**直接拦截**并打开面板，无需手动设置（`Ctrl+K` 对标 TabCmdr 默认快捷键）。
- **全页面保底**：`Ctrl + Shift + P`（Windows / Linux）或 `Cmd + Shift + P`（macOS）
  在 `chrome://`、`edge://` 等无法注入脚本的页面里，官方快捷键一定可用。
- **关闭面板**：`Esc`（或再次按下 `Ctrl+P`）
- **选择**：`↑` / `↓`
- **翻页**：`PgUp` / `PgDn`
- **跳到首 / 尾**：`Ctrl+Home` / `Ctrl+End`（macOS 为 `Cmd+Home` / `Cmd+End`）
- **确认**：`Enter`
- **关闭选中标签页**：`Ctrl + W`（Mac 为 `Cmd + W`）或 `Alt + Enter`（对 Tab 结果直接关闭，面板保持打开）
- **切换分类**：`Tab` / `Shift + Tab`（在顶部分类标签间循环）

> 为什么要有两套？因为 Chrome 把 `Ctrl+P` 硬编码为打印快捷键，扩展无法自动替换它；
> 但普通网页里 GoFun 会在页面层直接拦截 `Ctrl+P`，因此**绝大多数使用场景下你直接按 `Ctrl+P` 就行**。

## 搜索范围前缀

在输入框中使用以下前缀可限定搜索范围（`/` 与 `:` 两种风格均可）：

| 前缀 | 缩写 | 说明 |
|------|------|------|
| `/tabs` | `/t` | 仅搜索所有窗口打开的标签页 |
| `/history` | `/h` | 仅搜索浏览历史 |
| `/bookmarks` | `/b` | 仅搜索书签 |
| `/commands` | `/c` | 仅搜索内置命令 |
| `/closed` | `/cl` | 仅搜索最近关闭的标签页 |
| `/downloads` | `/d` | 仅搜索下载记录 |

> 提示：输入 `/` 但不匹配任何前缀时，会自动落入 `/commands` 命令搜索模式。

## 安装方法

### 开发者模式加载（推荐测试）

1. 打开 Chrome / Edge 浏览器，进入扩展管理页面：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本文件夹 `gofun`。
5. 点击扩展图标（小狗头像），或按 `Ctrl+P` / `Ctrl+K`（普通网页） / `Ctrl+Shift+P`（全页面）呼出面板。

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
├── palette.css        # 面板样式（主题系统 / 位置 / 紧凑模式）
├── options.html       # 设置页
├── options.js         # 设置页逻辑
├── icons/             # 扩展图标（小狗头像，16/32/48/128）
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 设置

面板内输入 `/opt` 打开设置页，可配置：主题、紧凑模式、面板位置、历史记录天数。所有设置存 `chrome.storage.sync`，跨设备同步。

## 自定义命令

如需添加更多内置命令，请编辑 `background.js` 中的 `COMMANDS` 数组（含 `action`），并在 `content.js` 的 `COMMAND_SNAPSHOT` 中添加对应快照项（不含 `action`）。

## 注意事项

- 扩展需要 `tabs`、`history`、`bookmarks`、`scripting` 等权限才能读取对应数据和在受限页面动态注入脚本。
- 首次安装时若某些页面已打开，点击扩展图标或按快捷键会自动注入内容脚本；如遇异常，可刷新页面后重试。
- Chrome 内置页面（如 `chrome://extensions`、`edge://`）无法注入内容脚本：在这些页面按快捷键 / 点图标，会自动跳转新标签页并打开面板。
- 历史记录 / 书签的数据量可能非常大；默认在空查询时不拉取历史和书签以确保秒开。输入关键字后会立即加入搜索。
- 取色器依赖 EyeDropper API（Chrome 95+）；区域截图依赖 `activeTab` 权限，仅能截取当前可视区域。
