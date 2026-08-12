// background.js - 处理搜索与动作执行
// GoFun 对标 TabCmdr：Tab/历史/书签/最近关闭/下载 搜索 + 40+ 命令 + 即时答案 + Emoji/待办/天气/RSS/AI

// emoji 数据集（全局变量 GOFUN_EMOJI_DATA）
try { importScripts('emoji-data.js'); } catch (e) { console.warn('emoji-data 加载失败', e); }

const DEFAULT_RESULTS_LIMIT = 20;

// ========= 设置 =========
const SETTINGS_KEY = 'gofun_settings';
const DEFAULT_SETTINGS = {
  theme: 'system',
  compact: false,
  position: 'center',
  historyDays: 90,
  weatherCity: '',
  rssFeeds: [],
  aiProvider: 'openai',
  aiApiKey: '',
  aiModel: '',
  aiBaseUrl: '',
  searchEngines: [],   // [{ key: 'g', url: 'https://www.google.com/search?q=%s' }]
  calendarFeeds: []    // ICS 订阅地址
};
async function getSettings() {
  try {
    const obj = await chrome.storage.sync.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(obj[SETTINGS_KEY] || {}) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

// ========= 命令列表 =========
// alias:       GoFun 命令缩写（如 /n），参与搜索匹配 + UI 右侧高亮显示
// browserKbd:  浏览器原生快捷键（如 Ctrl+T），仅 UI 灰色提示，不参与搜索
// keywords:    搜索匹配用的英文关键词（不显示在 UI 上），让用户输英文也能搜到
// client:      true 表示由 content.js 本地执行（复制/滚动/打印等页面级操作）
// setScope:    执行后不关闭面板，而是把输入框切换为指定范围前缀（如 /emoji ）
const COMMANDS = [
  // ---- 标签页基础 ----
  {
    id: 'cmd.newtab', type: 'command', title: '新建标签页', subtitle: '在当前窗口打开新的标签页',
    icon: 'plus', alias: ['/n'], browserKbd: 'Ctrl T', keywords: ['new', 'tab', 'newtab', 'open'],
    action: () => chrome.tabs.create({})
  },
  {
    id: 'cmd.closetab', type: 'command', title: '关闭当前标签页', subtitle: '关闭当前激活的标签页',
    icon: 'x', alias: ['/w'], browserKbd: 'Ctrl W', keywords: ['close', 'closetab', 'remove'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.remove(tab.id);
    }
  },
  {
    id: 'cmd.duplicatetab', type: 'command', title: '复制当前标签页', subtitle: '复制当前标签页',
    icon: 'copy', alias: ['/dup'], keywords: ['duplicate', 'copy', 'clone'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.duplicate(tab.id);
    }
  },
  {
    id: 'cmd.reload', type: 'command', title: '重新加载当前页', subtitle: '刷新当前标签页',
    icon: 'refresh', alias: ['/r'], browserKbd: 'Ctrl R', keywords: ['reload', 'refresh', 'f5'],
    action: () => chrome.tabs.reload()
  },
  {
    id: 'cmd.hardreload', type: 'command', title: '硬性重新加载', subtitle: '清除缓存并刷新当前页',
    icon: 'refresh', alias: ['/hr'], keywords: ['hard', 'reload', 'cache', 'force'],
    action: () => chrome.tabs.reload({ bypassCache: true })
  },
  {
    id: 'cmd.goback', type: 'command', title: '后退', subtitle: '在历史记录中后退',
    icon: 'arrow-left', alias: ['/back'], browserKbd: 'Alt ←', keywords: ['back', 'goback', 'previous'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.goBack(tab.id);
    }
  },
  {
    id: 'cmd.goforward', type: 'command', title: '前进', subtitle: '在历史记录中前进',
    icon: 'arrow-right', alias: ['/fwd'], browserKbd: 'Alt →', keywords: ['forward', 'next', 'goforward'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.goForward(tab.id);
    }
  },

  // ---- 标签页整理（对标 TabCmdr）----
  {
    id: 'cmd.pin', type: 'command', title: '固定 / 取消固定标签页', subtitle: '切换当前标签页的固定状态',
    icon: 'pin', alias: ['/pin'], keywords: ['pin', 'unpin', 'fixed'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    }
  },
  {
    id: 'cmd.mute', type: 'command', title: '静音 / 取消静音标签页', subtitle: '切换当前标签页的静音状态',
    icon: 'mute', alias: ['/mute'], keywords: ['mute', 'unmute', 'silent', 'audio'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
    }
  },
  {
    id: 'cmd.closedupes', type: 'command', title: '关闭重复标签页', subtitle: '找出并关闭当前窗口中 URL 重复的标签页',
    icon: 'dedup', alias: ['/dedup'], keywords: ['duplicate', 'close', 'dedup', 'same'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const seen = new Set();
      const dupIds = [];
      for (const t of tabs) {
        if (!t.url) continue;
        if (seen.has(t.url)) dupIds.push(t.id);
        else seen.add(t.url);
      }
      if (dupIds.length) await chrome.tabs.remove(dupIds);
    }
  },
  {
    id: 'cmd.closeothers', type: 'command', title: '关闭其他标签页', subtitle: '保留当前页，关闭窗口内其余标签页',
    icon: 'x-circle', alias: ['/co'], keywords: ['close', 'others', 'only'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ids = tabs.filter(t => !t.active && !t.pinned).map(t => t.id);
      if (ids.length) await chrome.tabs.remove(ids);
    }
  },
  {
    id: 'cmd.closeright', type: 'command', title: '关闭右侧标签页', subtitle: '关闭当前页右侧的所有标签页',
    icon: 'arrow-right-circle', alias: ['/cr'], keywords: ['close', 'right', 'tabs'],
    action: async () => {
      const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!cur) return;
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ids = tabs.filter(t => t.index > cur.index && !t.pinned).map(t => t.id);
      if (ids.length) await chrome.tabs.remove(ids);
    }
  },
  {
    id: 'cmd.closeleft', type: 'command', title: '关闭左侧标签页', subtitle: '关闭当前页左侧的所有标签页',
    icon: 'arrow-left-circle', alias: ['/cll'], keywords: ['close', 'left', 'tabs'],
    action: async () => {
      const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!cur) return;
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ids = tabs.filter(t => t.index < cur.index && !t.pinned).map(t => t.id);
      if (ids.length) await chrome.tabs.remove(ids);
    }
  },
  {
    id: 'cmd.bookmarkadd', type: 'command', title: '收藏当前页', subtitle: '把当前标签页加入书签',
    icon: 'bookmark', alias: ['/fav'], browserKbd: 'Ctrl D', keywords: ['bookmark', 'favorite', 'star', 'save'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && /^https?:\/\//.test(tab.url || '')) {
        await chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
      }
    }
  },
  {
    id: 'cmd.sorttabs', type: 'command', title: '按标题排序标签页', subtitle: '整理当前窗口，固定标签页保持不动',
    icon: 'sort', alias: ['/sort'], keywords: ['sort', 'order', 'arrange', 'alphabetical'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const pinnedCount = tabs.filter(t => t.pinned).length;
      const unpinned = tabs.filter(t => !t.pinned)
        .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      let idx = pinnedCount;
      for (const t of unpinned) {
        await chrome.tabs.move(t.id, { index: idx++ }).catch(() => {});
      }
    }
  },
  {
    id: 'cmd.groupdomain', type: 'command', title: '按域名分组标签页', subtitle: '把同域名的标签页归入一个标签组',
    icon: 'group', alias: ['/group'], keywords: ['group', 'domain', 'tabgroups', 'organize'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const byHost = new Map();
      for (const t of tabs) {
        const h = safeHostname(t.url);
        if (!h) continue;
        if (!byHost.has(h)) byHost.set(h, []);
        byHost.get(h).push(t.id);
      }
      for (const [host, ids] of byHost) {
        if (ids.length < 2) continue;
        try {
          const gid = await chrome.tabs.group({ tabIds: ids });
          await chrome.tabGroups.update(gid, { title: host });
        } catch (_) { /* 单个分组失败不影响其余 */ }
      }
    }
  },
  {
    id: 'cmd.ungroupall', type: 'command', title: '取消所有标签分组', subtitle: '解散当前窗口的全部标签组',
    icon: 'ungroup', alias: ['/ungroup'], keywords: ['ungroup', 'dissolve', 'tabgroups'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ids = tabs.filter(t => t.groupId !== -1).map(t => t.id);
      if (ids.length) await chrome.tabs.ungroup(ids);
    }
  },
  {
    id: 'cmd.mergewindows', type: 'command', title: '合并所有窗口', subtitle: '把所有浏览器窗口的标签页合并到当前窗口',
    icon: 'merge', alias: ['/merge'], keywords: ['merge', 'windows', 'combine', 'join'],
    action: async () => {
      const cur = await chrome.windows.getCurrent();
      const others = await chrome.tabs.query({ currentWindow: false });
      // 固定标签页跨窗口移动会报错，跳过
      const ids = others.filter(t => !t.pinned).map(t => t.id);
      if (ids.length) await chrome.tabs.move(ids, { windowId: cur.id, index: -1 });
    }
  },
  {
    id: 'cmd.suspendothers', type: 'command', title: '挂起其他标签页', subtitle: '休眠未使用的标签页以释放内存',
    icon: 'moon', alias: ['/sus'], keywords: ['suspend', 'discard', 'sleep', 'memory', 'hibernate'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      for (const t of tabs) {
        if (t.active || t.discarded || !/^https?:\/\//.test(t.url || '')) continue;
        chrome.tabs.discard(t.id).catch(() => {});
      }
    }
  },
  {
    id: 'cmd.movetowindow', type: 'command', title: '移动到新窗口', subtitle: '把当前标签页移到独立的新窗口',
    icon: 'window', alias: ['/mv'], keywords: ['move', 'window', 'detach'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.windows.create({ tabId: tab.id });
    }
  },
  {
    id: 'cmd.splitview', type: 'command', title: '分屏视图', subtitle: '当前页居左、下一标签页居右并排显示',
    icon: 'split', alias: ['/split'], keywords: ['split', 'view', 'side', 'tile', 'arrange'],
    action: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const cur = tabs.find(t => t.active);
      if (!cur) return;
      // 找相邻标签页（优先右侧，其次左侧），没有则用当前页复制一个
      let other = tabs.find(t => t.index === cur.index + 1) || tabs.find(t => t.index === cur.index - 1);
      if (!other) {
        other = await chrome.tabs.duplicate(cur.id);
      }
      const curWin = await chrome.windows.get(cur.windowId);
      let screenW = (curWin.left || 0) + (curWin.width || 1280);
      let screenH = (curWin.top || 0) + (curWin.height || 800);
      let originL = 0, originT = 0;
      try {
        const displays = await chrome.system.display.getInfo();
        const d = displays.find(x => x.isPrimary) || displays[0];
        if (d) {
          screenW = d.workArea.width; screenH = d.workArea.height;
          originL = d.workArea.left; originT = d.workArea.top;
        }
      } catch (_) { /* 无 system.display 权限时用窗口估算 */ }
      const halfW = Math.floor(screenW / 2);
      // 当前窗口缩到左半屏，另一标签页移到新窗口放右半屏
      await chrome.windows.update(cur.windowId, {
        state: 'normal', left: originL, top: originT, width: halfW, height: screenH
      });
      const rightWin = await chrome.windows.create({
        tabId: other.id, left: originL + halfW, top: originT, width: screenW - halfW, height: screenH
      });
      await chrome.windows.update(rightWin.id, { focused: true });
    }
  },
  {
    id: 'cmd.restoreclosed', type: 'command', title: '恢复最近关闭的标签页', subtitle: '重新打开刚刚关闭的标签页',
    icon: 'restore', alias: ['/undo'], browserKbd: 'Ctrl Shift T', keywords: ['restore', 'reopen', 'undo', 'closed'],
    action: () => chrome.sessions.restore()
  },

  // ---- 窗口 ----
  {
    id: 'cmd.newwindow', type: 'command', title: '新建窗口', subtitle: '打开一个新的浏览器窗口',
    icon: 'window', alias: ['/win'], browserKbd: 'Ctrl N', keywords: ['new', 'window'],
    action: () => chrome.windows.create({})
  },
  {
    id: 'cmd.incognito', type: 'command', title: '新建无痕窗口', subtitle: '打开一个新的无痕/隐私窗口',
    icon: 'incognito', alias: ['/inc'], browserKbd: 'Ctrl Shift N', keywords: ['incognito', 'private', 'window'],
    action: () => chrome.windows.create({ incognito: true })
  },

  // ---- 缩放与页面 ----
  {
    id: 'cmd.zoomin', type: 'command', title: '放大页面', subtitle: '当前页缩放比例 +20%',
    icon: 'zoom-in', alias: ['/zi'], keywords: ['zoom', 'in', 'bigger'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const z = await chrome.tabs.getZoom(tab.id);
      await chrome.tabs.setZoom(tab.id, Math.min(z * 1.2, 5));
    }
  },
  {
    id: 'cmd.zoomout', type: 'command', title: '缩小页面', subtitle: '当前页缩放比例 -20%',
    icon: 'zoom-out', alias: ['/zo'], keywords: ['zoom', 'out', 'smaller'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const z = await chrome.tabs.getZoom(tab.id);
      await chrome.tabs.setZoom(tab.id, Math.max(z / 1.2, 0.25));
    }
  },
  {
    id: 'cmd.zoomreset', type: 'command', title: '重置缩放', subtitle: '恢复当前页 100% 缩放',
    icon: 'zoom-reset', alias: ['/zr'], keywords: ['zoom', 'reset', '100'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.setZoom(tab.id, 1);
    }
  },
  {
    id: 'cmd.viewsource', type: 'command', title: '查看网页源代码', subtitle: '在新标签页打开当前页源代码',
    icon: 'code', alias: ['/src'], keywords: ['view', 'source', 'html', 'code'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && /^https?:\/\//.test(tab.url || '')) {
        await chrome.tabs.create({ url: 'view-source:' + tab.url });
      }
    }
  },
  {
    id: 'cmd.screenshot', type: 'command', title: '截图当前页面', subtitle: '截取可见区域并保存为 PNG 到下载目录',
    icon: 'camera', alias: ['/ss'], keywords: ['screenshot', 'capture', 'snap'],
    action: async () => {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      await chrome.downloads.download({
        url: dataUrl,
        filename: `gofun-screenshot-${Date.now()}.png`,
        saveAs: false
      });
    }
  },

  // ---- 客户端命令（由 content.js 本地执行）----
  { id: 'cmd.screenshotarea', type: 'command', title: '区域截图', subtitle: '拖动框选页面区域，保存为 PNG', icon: 'crop', alias: ['/ssa'], keywords: ['screenshot', 'area', 'region', 'crop', 'snip'], client: true },
  { id: 'cmd.colorpicker', type: 'command', title: '屏幕取色器', subtitle: '从页面任意位置取色，复制 HEX/RGB/HSL', icon: 'dropper', alias: ['/pick'], keywords: ['color', 'picker', 'eyedropper', 'dropper'], client: true },
  { id: 'cmd.ruler', type: 'command', title: '像素尺子', subtitle: '在页面上拖拽测量元素间距与尺寸', icon: 'ruler', alias: ['/ruler'], keywords: ['ruler', 'measure', 'pixel', 'size', 'inspect'], client: true },
  { id: 'cmd.copyurl',   type: 'command', title: '复制当前页网址',       subtitle: '复制当前标签页的 URL 到剪贴板',      icon: 'link',      alias: ['/cu'],  keywords: ['copy', 'url', 'link'],      client: true },
  { id: 'cmd.copytitle', type: 'command', title: '复制当前页标题',       subtitle: '复制当前标签页的标题到剪贴板',       icon: 'copy',      alias: ['/ct'],  keywords: ['copy', 'title'],            client: true },
  { id: 'cmd.copymd',    type: 'command', title: '复制 Markdown 链接',   subtitle: '复制 [标题](网址) 格式到剪贴板',     icon: 'markdown',  alias: ['/md'],  keywords: ['copy', 'markdown', 'link'], client: true },
  { id: 'cmd.qr',        type: 'command', title: '当前页二维码',         subtitle: '生成当前页 URL 的二维码',            icon: 'qr',        alias: ['/qr'],  keywords: ['qr', 'qrcode', 'share'],    client: true },
  { id: 'cmd.scrolltop', type: 'command', title: '滚动到顶部',           subtitle: '回到页面最上方',                      icon: 'arrow-up',  alias: ['/top'], keywords: ['scroll', 'top'],            client: true },
  { id: 'cmd.scrollbottom', type: 'command', title: '滚动到底部',        subtitle: '跳到页面最下方',                      icon: 'arrow-down', alias: ['/btm'], keywords: ['scroll', 'bottom'],         client: true },
  { id: 'cmd.print',     type: 'command', title: '打印页面',             subtitle: '调用浏览器打印当前页',                icon: 'printer',   alias: ['/print'], browserKbd: 'Ctrl P', keywords: ['print'], client: true },
  { id: 'cmd.fullscreen', type: 'command', title: '切换全屏',            subtitle: '进入 / 退出页面全屏',                 icon: 'fullscreen', alias: ['/fs'],  keywords: ['fullscreen', 'f11'],       client: true },
  { id: 'cmd.copyselection', type: 'command', title: '复制选中文本',     subtitle: '复制页面上当前选中的文本',            icon: 'copy',      alias: ['/cs'],  keywords: ['copy', 'selection', 'selected', 'text'], client: true },

  // ---- 站点媒体控制（YouTube 等 HTML5 播放器，对标 TabCmdr Site Shortcuts）----
  { id: 'cmd.mediaplaypause', type: 'command', title: '播放 / 暂停',     subtitle: '切换页面中视频或音频的播放状态',      icon: 'play',      alias: ['/pp'],  keywords: ['play', 'pause', 'video', 'youtube', 'media'], client: true },
  { id: 'cmd.mediamute',   type: 'command', title: '视频静音 / 取消静音', subtitle: '切换页面媒体的静音状态',             icon: 'mute',      alias: ['/mm'],  keywords: ['mute', 'unmute', 'video', 'audio', 'volume'], client: true },
  { id: 'cmd.mediaforward', type: 'command', title: '快进 10 秒',        subtitle: '页面视频快进 10 秒',                  icon: 'forward',   alias: ['/mf'],  keywords: ['forward', 'seek', 'skip', 'video'], client: true },
  { id: 'cmd.mediaback',   type: 'command', title: '快退 10 秒',         subtitle: '页面视频快退 10 秒',                  icon: 'rewind',    alias: ['/mb'],  keywords: ['back', 'rewind', 'seek', 'video'], client: true },

  // ---- 工具入口（切换范围）----
  { id: 'cmd.emoji',   type: 'command', title: 'Emoji 搜索',   subtitle: '模糊搜索 Emoji，回车复制',       icon: 'smile',    alias: ['/e'],     keywords: ['emoji', 'emoticon', 'smile'], setScope: '/emoji ' },
  { id: 'cmd.todo',    type: 'command', title: '待办事项',     subtitle: '快速管理你的待办清单',           icon: 'check',    alias: ['/todo'], keywords: ['todo', 'task', 'checklist'], setScope: '/todo ' },
  { id: 'cmd.weather', type: 'command', title: '天气查询',     subtitle: '查看城市当前天气与三天预报',     icon: 'cloud',    alias: ['/wx'],    keywords: ['weather', 'forecast'],        setScope: '/wx ' },
  { id: 'cmd.ai',      type: 'command', title: 'AI 助手',      subtitle: '与 AI 对话，@page 可携带当前页内容', icon: 'sparkles', alias: ['/ai'], keywords: ['ai', 'chat', 'gpt', 'claude', 'gemini'], setScope: '/ai ' },
  { id: 'cmd.rss',     type: 'command', title: 'RSS 阅读器',   subtitle: '阅读设置的订阅源或输入 feed 地址', icon: 'rss',      alias: ['/rss'],  keywords: ['rss', 'feed', 'subscribe'],  setScope: '/rss ' },
  { id: 'cmd.calendar', type: 'command', title: '日历日程',    subtitle: '查看即将开始的日程，一键加入会议',  icon: 'calendar', alias: ['/cal'], keywords: ['calendar', 'event', 'meeting', 'schedule'], setScope: '/cal ' },

  // ---- 系统页面 ----
  {
    id: 'cmd.extensions', type: 'command', title: '管理扩展', subtitle: '打开扩展管理页面',
    icon: 'grid', alias: ['/ext'], keywords: ['extensions', 'ext', 'addon', 'plugin'],
    action: () => chrome.tabs.create({ url: 'chrome://extensions/' })
  },
  {
    id: 'cmd.settings', type: 'command', title: '浏览器设置', subtitle: '打开设置页面',
    icon: 'settings', alias: ['/set'], keywords: ['settings', 'config', 'preferences', 'setup'],
    action: () => chrome.tabs.create({ url: 'chrome://settings/' })
  },
  {
    id: 'cmd.bookmarks', type: 'command', title: '书签管理器', subtitle: '打开书签管理器',
    icon: 'bookmark', alias: ['/bm'], browserKbd: 'Ctrl Shift O', keywords: ['bookmarks', 'bookmark', 'fav', 'star'],
    action: () => chrome.tabs.create({ url: 'chrome://bookmarks/' })
  },
  {
    id: 'cmd.history', type: 'command', title: '历史记录', subtitle: '打开历史记录页面',
    icon: 'clock', alias: ['/his'], browserKbd: 'Ctrl H', keywords: ['history', 'recent', 'visited'],
    action: () => chrome.tabs.create({ url: 'chrome://history/' })
  },
  {
    id: 'cmd.downloadspage', type: 'command', title: '下载内容', subtitle: '打开下载管理页面',
    icon: 'download', alias: ['/dlp'], browserKbd: 'Ctrl J', keywords: ['downloads', 'files'],
    action: () => chrome.tabs.create({ url: 'chrome://downloads/' })
  },
  {
    id: 'cmd.options', type: 'command', title: 'GoFun 设置', subtitle: '主题、位置、天气城市、AI Key 等配置',
    icon: 'settings', alias: ['/opt'], keywords: ['options', 'gofun', 'config', 'theme'],
    action: () => chrome.runtime.openOptionsPage()
  },
];

// 支持的范围前缀，含全称和缩写，按 "先长后短" 匹配，避免 /tabs 被 /t 抢先
const SCOPE_PREFIXES = [
  { scope: 'tabs',      full: '/tabs',      short: '/t' },
  { scope: 'history',   full: '/history',   short: '/h' },
  { scope: 'bookmarks', full: '/bookmarks', short: '/b' },
  { scope: 'commands',  full: '/commands',  short: '/c' },
  { scope: 'closed',    full: '/closed',    short: '/cl' },
  { scope: 'downloads', full: '/downloads', short: '/d' },
  { scope: 'emoji',     full: '/emoji',     short: '/e' },
  { scope: 'todo',      full: '/todo',      short: null },
  { scope: 'weather',   full: '/weather',   short: '/wx' },
  { scope: 'rss',       full: '/rss',       short: null },
  { scope: 'calendar',  full: '/cal',       short: null },
  { scope: 'ai',        full: '/ai',        short: null }
];

// TabCmdr 风格的冒号前缀别名（:b foo 等价于 /b foo），仅在输入以冒号开头时生效
const COLON_ALIASES = {
  ':t': '/tabs', ':tabs': '/tabs',
  ':h': '/history', ':history': '/history',
  ':b': '/bookmarks', ':bookmarks': '/bookmarks',
  ':c': '/commands', ':commands': '/commands',
  ':cl': '/closed', ':closed': '/closed',
  ':d': '/downloads', ':downloads': '/downloads',
  ':e': '/emoji', ':em': '/emoji', ':emoji': '/emoji',
  ':todo': '/todo',
  ':wx': '/weather', ':weather': '/weather',
  ':rss': '/rss',
  ':cal': '/cal', ':calendar': '/cal',
  ':ai': '/ai'
};
// 把开头的冒号前缀（如 ":b foo"）规范化为斜杠前缀（"/b foo"），不匹配则原样返回
function normalizeColonPrefix(trimmed) {
  if (!trimmed.startsWith(':')) return trimmed;
  const m = /^:(\w+)(?:\s+(.*))?$/.exec(trimmed);
  if (!m) return trimmed;
  const target = COLON_ALIASES[':' + m[1].toLowerCase()];
  if (!target) return trimmed;
  return m[2] != null ? `${target} ${m[2]}` : target;
}

// ========= 工具函数 =========
function safeHostname(url) {
  try { return new URL(url).hostname; } catch (_) { return null; }
}

function fuzzyMatch(text, query) {
  if (!query) return true;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) qi++;
  }
  return qi === lowerQuery.length;
}

function scoreResult(item, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const title = (item.title || '').toLowerCase();
  const url = (item.url || '').toLowerCase();

  if (title === q) return 1000;
  if (title.startsWith(q)) return 900;
  if (title.includes(' ' + q)) return 850;
  if (title.includes(q)) return 800;
  if (url === q) return 750;
  if (url.includes(q)) return 700;
  if (fuzzyMatch(title, query)) return 500;
  if (fuzzyMatch(url, query)) return 400;
  return 0;
}

// 针对"命令"场景的打分：alias + keywords + title/subtitle 综合匹配
function scoreCommand(cmd, query) {
  const baseScore = scoreResult({ title: cmd.title, subtitle: cmd.subtitle }, query);
  if (!query) return baseScore;
  const q = query.toLowerCase();

  const alias = cmd.alias || [];
  for (const a of alias) {
    const norm = a.toLowerCase().replace(/\s+/g, '').replace(/^\//, '');
    if (norm === q) return Math.max(baseScore, 1100);
    if (norm.startsWith(q)) return Math.max(baseScore, 950);
    if (q.startsWith(norm)) return Math.max(baseScore, 880);
    if (norm.includes(q)) return Math.max(baseScore, 820);
  }

  const keywords = cmd.keywords || [];
  for (const kw of keywords) {
    const norm = kw.toLowerCase();
    if (norm === q) return Math.max(baseScore, 1050);
    if (norm.startsWith(q)) return Math.max(baseScore, 920);
    if (norm.includes(q)) return Math.max(baseScore, 800);
  }

  return baseScore;
}

// ========= 搜索源 =========
// 搜索 Tab（跨所有窗口，对标 TabCmdr；当前窗口/活跃标签优先）
async function searchTabs(query, limit) {
  const tabs = await chrome.tabs.query({});
  const curWin = await chrome.windows.getCurrent().catch(() => null);
  const scored = tabs
    .map(tab => ({
      ...tab,
      type: 'tab',
      displayTitle: tab.title || tab.url || '无标题',
      score: scoreResult({ title: tab.title, url: tab.url }, query)
    }))
    .filter(t => !query || t.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同分：当前窗口优先，活跃标签优先
      const aCur = curWin && a.windowId === curWin.id ? 1 : 0;
      const bCur = curWin && b.windowId === curWin.id ? 1 : 0;
      if (bCur !== aCur) return bCur - aCur;
      return (b.active ? 1 : 0) - (a.active ? 1 : 0);
    });

  return scored.slice(0, limit).map(t => ({
    id: `tab-${t.id}`,
    type: 'tab',
    title: t.displayTitle,
    subtitle: t.url,
    url: t.url,
    tabId: t.id,
    active: t.active,
    otherWindow: curWin ? t.windowId !== curWin.id : false,
    icon: 'tab'
  }));
}

// 搜索历史
async function searchHistory(query, limit) {
  const settings = await getSettings();
  const now = Date.now();
  const days = settings.historyDays;
  const startTime = query ? (days > 0 ? now - days * 24 * 60 * 60 * 1000 : 0) : 0;
  const historyItems = await chrome.history.search({
    text: query || '',
    maxResults: query ? Math.min(limit * 4, 100) : 50,
    startTime
  });

  const scored = historyItems
    .map(h => ({
      ...h,
      type: 'history',
      score: scoreResult({ title: h.title, url: h.url }, query)
    }))
    .filter(h => !query || h.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.lastVisitTime || 0) - (a.lastVisitTime || 0);
    });

  return scored.slice(0, limit).map(h => ({
    id: `history-${h.url}-${h.lastVisitTime}`,
    type: 'history',
    title: h.title || h.url,
    subtitle: h.url,
    url: h.url,
    lastVisitTime: h.lastVisitTime,
    icon: 'clock'
  }));
}

// 搜索书签
async function searchBookmarks(query, limit) {
  const bookmarkTree = await chrome.bookmarks.search(query || '');
  const scored = bookmarkTree
    .filter(b => b.url)
    .map(b => ({
      ...b,
      type: 'bookmark',
      score: scoreResult({ title: b.title, url: b.url }, query)
    }))
    .filter(b => !query || b.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.dateAdded || 0) - (b.dateAdded || 0);
    });

  return scored.slice(0, limit).map(b => ({
    id: `bookmark-${b.id}`,
    type: 'bookmark',
    title: b.title || b.url,
    subtitle: b.url,
    url: b.url,
    icon: 'bookmark'
  }));
}

// 搜索命令
function searchCommands(query, limit) {
  const scored = COMMANDS.map(cmd => ({
    ...cmd,
    score: scoreCommand(cmd, query)
  }))
    .filter(cmd => !query || cmd.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ score, action: _action, keywords: _kw, ...rest }) => rest);
  // rest 里保留 alias / browserKbd / client / setScope 供前端使用
}

// 搜索最近关闭的标签页
async function searchClosed(query, limit) {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  const items = sessions.filter(s => s.tab).map(s => s.tab);
  const scored = items
    .map(t => ({
      ...t,
      score: scoreResult({ title: t.title, url: t.url }, query)
    }))
    .filter(t => !query || t.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(t => ({
    id: `closed-${t.sessionId}`,
    type: 'closed',
    title: t.title || t.url || '无标题',
    subtitle: t.url,
    url: t.url,
    sessionId: t.sessionId,
    icon: 'restore'
  }));
}

// 搜索下载记录
async function searchDownloads(query, limit) {
  const items = await chrome.downloads.search({
    query: query ? [query] : [],
    limit: Math.max(limit * 2, 20),
    orderBy: ['-startTime']
  });

  const scored = items
    .map(d => {
      const filename = (d.filename || '').split(/[\\/]/).pop() || d.url || '未知文件';
      return { ...d, filename, score: scoreResult({ title: filename, url: d.url }, query) };
    })
    .filter(d => !query || d.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.startTime || '').localeCompare(a.startTime || '');
    });

  return scored.slice(0, limit).map(d => ({
    id: `download-${d.id}`,
    type: 'download',
    title: d.filename,
    subtitle: `${downloadStateLabel(d)} · ${d.url || ''}`,
    url: d.url,
    downloadId: d.id,
    state: d.state,
    icon: 'download'
  }));
}

function downloadStateLabel(d) {
  if (d.state === 'in_progress') return '下载中';
  if (d.state === 'interrupted') return '已中断';
  if (d.state === 'complete') return formatSize(d.fileSize || d.totalBytes);
  return d.state || '';
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

// 搜索 Emoji（中英文模糊匹配）
function searchEmoji(query, limit) {
  const data = globalThis.GOFUN_EMOJI_DATA || [];
  if (!query) {
    return data.slice(0, limit).map(emojiItem);
  }
  const q = query.toLowerCase();
  const scored = data.map(item => {
    let score = 0;
    const name = item.n;
    if (name === q) score = 1000;
    else if (name.startsWith(q)) score = 900;
    else if (name.includes(q)) score = 800;
    else {
      for (const kw of item.k) {
        const lk = kw.toLowerCase();
        if (lk === q) { score = Math.max(score, 950); break; }
        if (lk.startsWith(q)) score = Math.max(score, 850);
        else if (lk.includes(q)) score = Math.max(score, 750);
      }
      if (!score && fuzzyMatch(name, q)) score = 400;
    }
    return { ...item, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(emojiItem);
}

function emojiItem(item) {
  return {
    id: `emoji-${item.e}`,
    type: 'emoji',
    emoji: item.e,
    title: item.n,
    subtitle: (item.k || []).join(' · '),
    icon: 'smile'
  };
}

// 待办事项
const TODO_KEY = 'gofun_todos';
async function getTodos() {
  try {
    const obj = await chrome.storage.local.get(TODO_KEY);
    return obj[TODO_KEY] || [];
  } catch (_) {
    return [];
  }
}
async function saveTodos(todos) {
  await chrome.storage.local.set({ [TODO_KEY]: todos });
}

async function searchTodos(query) {
  const todos = await getTodos();
  const q = (query || '').toLowerCase();
  const results = [];

  if (query) {
    results.push({
      id: 'todo-add',
      type: 'todo-add',
      title: `添加待办："${query}"`,
      subtitle: '回车添加到清单',
      text: query,
      icon: 'plus'
    });
  }

  const matched = todos
    .filter(t => !q || (t.text || '').toLowerCase().includes(q))
    .sort((a, b) => (a.done - b.done) || (b.ts - a.ts));

  for (const t of matched.slice(0, 12)) {
    results.push({
      id: `todo-${t.id}`,
      type: 'todo',
      todoId: t.id,
      title: t.text,
      subtitle: t.done ? '已完成 · 回车重新打开' : '回车标记完成',
      done: !!t.done,
      icon: t.done ? 'check-circle' : 'circle'
    });
  }

  if (!query && todos.some(t => t.done)) {
    results.push({
      id: 'todo-clear',
      type: 'todo-clear',
      title: '清除已完成的待办',
      subtitle: '删除所有已完成项',
      icon: 'trash'
    });
  }

  if (!query && !todos.length) {
    results.push({
      id: 'todo-hint',
      type: 'answer',
      title: '暂无待办',
      subtitle: '输入内容后回车即可添加，如：/todo 写周报',
      icon: 'check'
    });
  }

  return results;
}

// 天气查询（wttr.in 免费接口）
const WEATHER_ZH = [
  ['sunny', '晴'], ['clear', '晴'], ['partly cloudy', '多云间晴'], ['cloudy', '多云'],
  ['overcast', '阴'], ['light rain', '小雨'], ['moderate rain', '中雨'], ['heavy rain', '大雨'],
  ['patchy rain', '零星小雨'], ['rain', '雨'], ['drizzle', '毛毛雨'], ['thunder', '雷'],
  ['snow', '雪'], ['sleet', '雨夹雪'], ['mist', '薄雾'], ['fog', '雾'], ['haze', '霾'],
  ['wind', '大风'], ['shower', '阵雨']
];
function weatherDescZh(desc) {
  const d = (desc || '').toLowerCase();
  for (const [en, zh] of WEATHER_ZH) {
    if (d.includes(en)) return zh;
  }
  return desc || '';
}

async function searchWeather(query) {
  const settings = await getSettings();
  const city = (query || '').trim() || settings.weatherCity;
  if (!city) {
    return [{
      id: 'weather-nocity', type: 'answer', icon: 'cloud',
      title: '未设置城市',
      subtitle: '输入 /wx 城市名 查询，或在 /opt 设置默认城市'
    }];
  }
  try {
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    const cur = (j.current_condition || [])[0] || {};
    const area = (((j.nearest_area || [])[0] || {}).areaName || [])[0] || {};
    const name = area.value || city;

    const results = [];
    const nowLine = `${name} ${cur.temp_C}°C ${weatherDescZh(cur.weatherDesc?.[0]?.value)}`;
    results.push({
      id: 'weather-now', type: 'answer', answerKind: 'weather', icon: 'cloud',
      title: nowLine,
      subtitle: `体感 ${cur.FeelsLikeC}°C · 湿度 ${cur.humidity}% · 风 ${cur.windspeedKmph}km/h`,
      copyText: nowLine
    });
    for (const day of (j.weather || []).slice(0, 3)) {
      const desc = weatherDescZh(day.hourly?.[4]?.weatherDesc?.[0]?.value);
      const line = `${day.date} ${day.mintempC}~${day.maxtempC}°C ${desc}`;
      results.push({
        id: `weather-${day.date}`, type: 'answer', answerKind: 'weather', icon: 'cloud',
        title: line,
        subtitle: `${name} 预报`,
        copyText: `${name} ${line}`
      });
    }
    return results;
  } catch (e) {
    return [{
      id: 'weather-err', type: 'answer', icon: 'cloud',
      title: '天气查询失败',
      subtitle: String(e.message || e)
    }];
  }
}

// RSS：抓取并解析（SW 无 DOMParser，用正则简易解析）
function rssClean(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}
function rssPick(block, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return m ? rssClean(m[1]) : '';
}
function parseRss(xml) {
  const items = [];
  let m;
  const headEnd = xml.search(/<(item|entry)[\s>]/i);
  const feedTitle = rssPick(headEnd > 0 ? xml.slice(0, headEnd) : '', 'title');

  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  while ((m = itemRe.exec(xml)) && items.length < 20) {
    const b = m[1];
    items.push({ title: rssPick(b, 'title') || rssPick(b, 'link'), link: rssPick(b, 'link') });
  }
  if (!items.length) {
    const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xml)) && items.length < 20) {
      const b = m[1];
      const lm = /<link[^>]*href=["']([^"']+)["']/i.exec(b);
      items.push({ title: rssPick(b, 'title'), link: lm ? lm[1] : '' });
    }
  }
  return { feedTitle, items: items.filter(i => i.title || i.link) };
}

async function searchRss(query) {
  const settings = await getSettings();
  const q = (query || '').trim();

  // 无关键词：列出设置的订阅源，选中后回填输入框继续
  if (!q) {
    if (!settings.rssFeeds.length) {
      return [{
        id: 'rss-nofeed', type: 'answer', icon: 'rss',
        title: '未配置 RSS 订阅源',
        subtitle: '在 /opt 设置页添加，或直接输入 /rss <feed地址>'
      }];
    }
    return settings.rssFeeds.map(url => ({
      id: `rss-feed-${url}`,
      type: 'rss-feed',
      title: safeHostname(url) || url,
      subtitle: url,
      url,
      setInput: `/rss ${url} `,
      icon: 'rss'
    }));
  }

  // 有关键词：视为 feed 地址抓取
  const feedUrl = /^https?:\/\//i.test(q) ? q : 'https://' + q;
  try {
    const resp = await fetch(feedUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const xml = await resp.text();
    const { feedTitle, items } = parseRss(xml);
    if (!items.length) {
      return [{ id: 'rss-empty', type: 'answer', icon: 'rss', title: '未解析到文章', subtitle: feedUrl }];
    }
    return items.map((it, i) => ({
      id: `rss-${i}-${it.link}`,
      type: 'rss',
      title: it.title || it.link,
      subtitle: feedTitle || feedUrl,
      url: it.link,
      icon: 'rss'
    }));
  } catch (e) {
    return [{
      id: 'rss-err', type: 'answer', icon: 'rss',
      title: 'RSS 抓取失败',
      subtitle: String(e.message || e)
    }];
  }
}

// ========= 日历（ICS 订阅源，对标 TabCmdr Calendar）=========
// 解析 ICS 文本中的 VEVENT（简易解析：SUMMARY/DTSTART/DTEND/LOCATION/URL，支持日期与日期时间）
function parseIcsDate(v) {
  // 形如 20260812T090000Z / 20260812T090000 / 20260812
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v || '');
  if (!m) return null;
  if (m[4] == null) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); // 全天事件
  }
  const { 1: y, 2: mo, 3: d, 4: h, 5: mi, 6: s } = m;
  if (m[7] === 'Z') return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return new Date(+y, +mo - 1, +d, +h, +mi, +s); // 本地时间
}

function parseIcsEvents(text) {
  const events = [];
  // ICS 折行：以空格/制表符开头的行是上一行的延续
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi;
  let m;
  while ((m = re.exec(unfolded))) {
    const block = m[1];
    const pick = (name) => {
      const mm = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'im').exec(block);
      return mm ? mm[1].trim() : '';
    };
    const summary = pick('SUMMARY');
    const start = parseIcsDate(pick('DTSTART'));
    const end = parseIcsDate(pick('DTEND'));
    const location = pick('LOCATION');
    let url = pick('URL');
    // 会议链接常出现在 LOCATION / DESCRIPTION 里
    if (!url) {
      const lm = /(https?:\/\/[^\s<>"]+)/i.exec(location + ' ' + pick('DESCRIPTION'));
      if (lm) url = lm[1];
    }
    if (start) events.push({ summary: summary || '(无标题)', start, end, location, url });
  }
  return events;
}

async function searchCalendar(query) {
  const settings = await getSettings();
  if (!settings.calendarFeeds.length) {
    return [{
      id: 'cal-nofeed', type: 'answer', icon: 'calendar',
      title: '未配置日历订阅',
      subtitle: '在 /opt 设置页粘贴 ICS 订阅地址（Google 日历 → 设置 → 日历集成 → 私密地址）'
    }];
  }
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000; // 未来 14 天
  const all = [];
  for (const feed of settings.calendarFeeds) {
    try {
      const resp = await fetch(feed);
      if (!resp.ok) continue;
      const text = await resp.text();
      for (const ev of parseIcsEvents(text)) {
        const ts = ev.start.getTime();
        if (ts >= now - 30 * 60 * 1000 && ts <= horizon) all.push(ev); // 进行中的也算
      }
    } catch (_) { /* 单个源失败不影响其余 */ }
  }
  all.sort((a, b) => a.start - b.start);

  const q = (query || '').toLowerCase();
  const matched = all.filter(ev => !q || ev.summary.toLowerCase().includes(q) || (ev.location || '').toLowerCase().includes(q));
  if (!matched.length) {
    return [{
      id: 'cal-empty', type: 'answer', icon: 'calendar',
      title: q ? `没有找到"${query}"相关的日程` : '未来 14 天没有日程',
      subtitle: '仅显示 ICS 订阅源中未来两周的事件'
    }];
  }

  const dayFmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
  const timeFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return matched.slice(0, 12).map((ev, i) => {
    const soon = ev.start.getTime() - now < 60 * 60 * 1000 && ev.start.getTime() > now - 30 * 60 * 1000;
    return {
      id: `cal-${i}-${ev.start.getTime()}`,
      type: 'calendar',
      title: `${soon ? '🔴 ' : ''}${ev.summary}`,
      subtitle: `${dayFmt.format(ev.start)} ${timeFmt.format(ev.start)}${ev.location ? ' · ' + ev.location : ''}${ev.url ? ' · 回车加入会议' : ''}`,
      url: ev.url || null,
      icon: 'calendar'
    };
  });
}

// ========= 即时答案（计算器 / 单位 / 时区 / 颜色 / 进制）=========

// 安全数学表达式求值（递归下降，不碰 eval）
function evalMath(expr) {
  const tokens = [];
  let i = 0;
  const s = expr.replace(/\s+/g, '');
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      tokens.push({ t: 'num', v: parseFloat(num) });
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      let name = '';
      while (i < s.length && /[a-z]/i.test(s[i])) name += s[i++];
      tokens.push({ t: 'fn', v: name.toLowerCase() });
      continue;
    }
    if ('+-*/^(),'.includes(ch)) { tokens.push({ t: ch }); i++; continue; }
    return null; // 非法字符
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, ln: Math.log, log: Math.log10,
    exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  function parseExpr() {
    let v = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = next().t;
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = next().t;
      const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    let base = parseUnary();
    if (peek() && peek().t === '^') {
      next();
      const exp = parseFactor();
      return Math.pow(base, exp);
    }
    return base;
  }
  function parseUnary() {
    if (peek() && peek().t === '-') { next(); return -parseUnary(); }
    if (peek() && peek().t === '+') { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = next();
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'fn') {
      if (CONSTS[tk.v] != null && !(peek() && peek().t === '(')) return CONSTS[tk.v];
      const fn = FUNCS[tk.v];
      if (!fn) throw new Error('unknown fn');
      if (!peek() || peek().t !== '(') throw new Error('missing (');
      next();
      const arg = parseExpr();
      if (!peek() || peek().t !== ')') throw new Error('missing )');
      next();
      return fn(arg);
    }
    if (tk.t === '(') {
      const v = parseExpr();
      if (!peek() || peek().t !== ')') throw new Error('missing )');
      next();
      return v;
    }
    throw new Error('unexpected token');
  }

  try {
    const v = parseExpr();
    if (pos !== tokens.length) return null;
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return v;
  } catch (_) {
    return null;
  }
}

function fmtNum(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(parseFloat(n.toPrecision(12)));
}

// 单位换算表：value = 相对基准单位的倍率
const UNIT_TABLES = [
  { kind: '长度', base: 'm', units: { km: 1000, kilometer: 1000, kilometers: 1000, m: 1, meter: 1, meters: 1, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254, yd: 0.9144, yard: 0.9144, yards: 0.9144, nm: 1852 } },
  { kind: '重量', base: 'kg', units: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.028349523125, ounce: 0.028349523125 } },
  { kind: '体积', base: 'l', units: { l: 1, liter: 1, liters: 1, ml: 0.001, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365 } },
  { kind: '数据', base: 'b', units: { b: 1, byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 } },
  { kind: '速度', base: 'ms', units: { ms: 1, 'm/s': 1, kmh: 1 / 3.6, 'km/h': 1 / 3.6, kph: 1 / 3.6, mph: 0.44704, knot: 0.514444, knots: 0.514444 } },
  { kind: '面积', base: 'm2', units: { m2: 1, sqm: 1, km2: 1e6, ha: 1e4, hectare: 1e4, acre: 4046.8564224, sqft: 0.09290304 } }
];
const TEMP_UNITS = { c: 'c', '°c': 'c', '℃': 'c', celsius: 'c', f: 'f', '°f': 'f', '℉': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };

function convertTemp(v, from, to) {
  let c = from === 'c' ? v : from === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
  return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
}

function tryUnitConversion(query) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z°℃℉/]+)\s+(?:to|in|as|->|=)\s*([a-zA-Z°℃℉/]+)\s*$/i.exec(query);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const from = m[2].toLowerCase();
  const to = m[3].toLowerCase();

  // 温度单独处理
  if (TEMP_UNITS[from] && TEMP_UNITS[to]) {
    const r = convertTemp(v, TEMP_UNITS[from], TEMP_UNITS[to]);
    return { title: `${fmtNum(parseFloat(r.toFixed(4)))} ${m[3].replace('elsius', '').replace('ahrenheit','')}`, subtitle: `${v} ${m[2]} = （温度换算）`, copyText: fmtNum(parseFloat(r.toFixed(4))) };
  }

  for (const table of UNIT_TABLES) {
    if (table.units[from] != null && table.units[to] != null) {
      const r = v * table.units[from] / table.units[to];
      const text = fmtNum(parseFloat(r.toPrecision(8)));
      return { title: `${text} ${m[3]}`, subtitle: `${v} ${m[2]} = （${table.kind}换算）`, copyText: text };
    }
  }
  return null;
}

// 时区城市映射
const TZ_CITIES = {
  beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', 北京: 'Asia/Shanghai', 上海: 'Asia/Shanghai',
  tokyo: 'Asia/Tokyo', 东京: 'Asia/Tokyo', seoul: 'Asia/Seoul', 首尔: 'Asia/Seoul',
  singapore: 'Asia/Singapore', 新加坡: 'Asia/Singapore', hongkong: 'Asia/Hong_Kong', 'hong kong': 'Asia/Hong_Kong', 香港: 'Asia/Hong_Kong',
  taipei: 'Asia/Taipei', 台北: 'Asia/Taipei', dubai: 'Asia/Dubai', 迪拜: 'Asia/Dubai',
  london: 'Europe/London', 伦敦: 'Europe/London', paris: 'Europe/Paris', 巴黎: 'Europe/Paris',
  berlin: 'Europe/Berlin', 柏林: 'Europe/Berlin', moscow: 'Europe/Moscow', 莫斯科: 'Europe/Moscow',
  sydney: 'Australia/Sydney', 悉尼: 'Australia/Sydney', auckland: 'Pacific/Auckland', 奥克兰: 'Pacific/Auckland',
  newyork: 'America/New_York', 'new york': 'America/New_York', nyc: 'America/New_York', 纽约: 'America/New_York',
  losangeles: 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 洛杉矶: 'America/Los_Angeles',
  sanfrancisco: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', 旧金山: 'America/Los_Angeles',
  chicago: 'America/Chicago', 芝加哥: 'America/Chicago', toronto: 'America/Toronto', 多伦多: 'America/Toronto',
  vancouver: 'America/Vancouver', 温哥华: 'America/Vancouver', boston: 'America/New_York', 波士顿: 'America/New_York',
  seattle: 'America/Los_Angeles', 西雅图: 'America/Los_Angeles', utc: 'UTC', gmt: 'UTC'
};

function tryTime(query) {
  const q = query.trim().toLowerCase();

  // time in X / X time / X 时间
  let m = /^(?:time\s+in\s+|(.+?)\s+(?:time|时间)$)/i.exec(q) || /^time\s+in\s+(.+)$/i.exec(q);
  let city = null;
  if (/^time\s+in\s+/.test(q)) city = q.replace(/^time\s+in\s+/, '').trim();
  else {
    const m2 = /^(.+?)\s+(?:time|时间)$/.exec(q);
    if (m2) city = m2[1].trim();
  }
  if (city) {
    const tz = TZ_CITIES[city.replace(/\s+/g, ' ')] || TZ_CITIES[city.replace(/\s+/g, '')];
    if (tz) {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short', month: 'short', day: 'numeric' });
      const text = fmt.format(now);
      return { title: `${city} ${text}`, subtitle: `时区 ${tz}`, copyText: text };
    }
  }

  // now + 3 days / now - 2 hours（日期计算）
  const dm = /^now\s*([+-])\s*(\d+)\s*(second|minute|hour|day|week|month|year)s?$/i.exec(q);
  if (dm) {
    const sign = dm[1] === '-' ? -1 : 1;
    const n = parseInt(dm[2], 10) * sign;
    const unit = dm[3].toLowerCase();
    const d = new Date();
    const map = { second: 'Seconds', minute: 'Minutes', hour: 'Hours', day: 'Date', week: null, month: 'Month', year: 'FullYear' };
    if (unit === 'week') d.setDate(d.getDate() + n * 7);
    else if (unit === 'month') d.setMonth(d.getMonth() + n);
    else if (unit === 'year') d.setFullYear(d.getFullYear() + n);
    else if (unit === 'day') d.setDate(d.getDate() + n);
    else if (unit === 'hour') d.setHours(d.getHours() + n);
    else if (unit === 'minute') d.setMinutes(d.getMinutes() + n);
    else d.setSeconds(d.getSeconds() + n);
    const text = d.toLocaleString('zh-CN', { hour12: false });
    return { title: text, subtitle: `现在 ${dm[1]}${dm[2]} ${unit}`, copyText: text };
  }

  // unix 时间戳
  if (q === 'unix' || q === 'timestamp' || q === 'now ts') {
    const ts = Math.floor(Date.now() / 1000);
    return { title: String(ts), subtitle: '当前 Unix 时间戳（秒）', copyText: String(ts) };
  }
  if (/^\d{10}$/.test(q)) {
    const d = new Date(parseInt(q, 10) * 1000);
    const text = d.toLocaleString('zh-CN', { hour12: false });
    return { title: text, subtitle: `Unix 时间戳 ${q}`, copyText: text };
  }
  if (/^\d{13}$/.test(q)) {
    const d = new Date(parseInt(q, 10));
    const text = d.toLocaleString('zh-CN', { hour12: false });
    return { title: text, subtitle: `毫秒时间戳 ${q}`, copyText: text };
  }
  return null;
}

// 颜色转换
function tryColor(query) {
  const q = query.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(q);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const { h, s, l } = rgbToHsl(r, g, b);
    return {
      title: `rgb(${r}, ${g}, ${b}) · hsl(${h}, ${s}%, ${l}%)`,
      subtitle: `#${hex.toUpperCase()} 的颜色转换`,
      copyText: `rgb(${r}, ${g}, ${b})`,
      color: `#${hex}`
    };
  }
  m = /^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(q);
  if (m) {
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    if (r > 255 || g > 255 || b > 255) return null;
    const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const { h, s, l } = rgbToHsl(r, g, b);
    return {
      title: `${hex} · hsl(${h}, ${s}%, ${l}%)`,
      subtitle: `rgb(${r}, ${g}, ${b}) 的颜色转换`,
      copyText: hex,
      color: hex
    };
  }
  return null;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// 进制转换
function tryRadix(query) {
  const q = query.trim().toLowerCase();
  let m = /^(\d+)\s+(?:to|in)\s+(binary|bin|octal|oct|hex|hexadecimal|decimal|dec)$/i.exec(q);
  if (m) {
    const n = parseInt(m[1], 10);
    const target = m[2].toLowerCase();
    let text = null, label = '';
    if (/^bin/.test(target)) { text = '0b' + n.toString(2); label = '二进制'; }
    else if (/^oct/.test(target)) { text = '0o' + n.toString(8); label = '八进制'; }
    else if (/^hex/.test(target)) { text = '0x' + n.toString(16).toUpperCase(); label = '十六进制'; }
    else { text = String(n); label = '十进制'; }
    return { title: text, subtitle: `${m[1]} 的${label}`, copyText: text };
  }
  if (/^0x[0-9a-f]+$/i.test(q)) {
    const n = parseInt(q, 16);
    return { title: String(n), subtitle: `${q} 的十进制`, copyText: String(n) };
  }
  if (/^0b[01]+$/.test(q)) {
    const n = parseInt(q.slice(2), 2);
    return { title: String(n), subtitle: `${q} 的十进制`, copyText: String(n) };
  }
  return null;
}

// 数学表达式（含 "20% of 500" 与 "2+2"、"sqrt(144)"）
function tryMath(query) {
  let q = query.trim();
  if (!/[0-9]/.test(q)) return null;

  // X% of Y
  let m = /^(-?\d+(?:\.\d+)?)\s*%\s*of\s*(-?\d+(?:\.\d+)?)$/i.exec(q);
  if (m) {
    const r = parseFloat(m[1]) / 100 * parseFloat(m[2]);
    return { title: fmtNum(r), subtitle: `${m[1]}% of ${m[2]}`, copyText: fmtNum(r) };
  }

  // 只允许数字与运算符/函数字符
  if (!/^[\d\s+\-*/().,%^a-z]*$/i.test(q)) return null;
  if (!/[+\-*/^%]/.test(q) && !/[a-z]+\s*\(/i.test(q)) return null;

  // 百分号：数字% → (数字/100)
  q = q.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');

  const v = evalMath(q);
  if (v == null) return null;
  const text = fmtNum(v);
  return { title: text, subtitle: `= ${query.trim()}`, copyText: text };
}

// URL 识别
function tryOpenUrl(query) {
  const q = query.trim();
  if (/\s/.test(q)) return null;
  if (/^https?:\/\/\S+$/i.test(q)) {
    return { title: `打开网址 ${q}`, url: q, copyText: q };
  }
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(q) && /\.[a-z]{2,}/i.test(q)) {
    return { title: `打开网址 ${q}`, url: 'https://' + q, copyText: 'https://' + q };
  }
  return null;
}

// UUID v4 生成（SW 中 crypto 可用）
function tryUuid(query) {
  const q = query.trim().toLowerCase();
  if (q !== 'uuid' && q !== 'uuid v4' && q !== 'guid') return null;
  const id = crypto.randomUUID();
  return { title: id, subtitle: 'UUID v4 · 回车复制', copyText: id };
}

// 汇总即时答案
function instantAnswers(query) {
  const out = [];
  const push = (kind, r) => {
    if (!r) return;
    out.push({
      id: `answer-${kind}-${query}`,
      type: 'answer',
      answerKind: kind,
      title: r.title,
      subtitle: r.subtitle,
      copyText: r.copyText || r.title,
      color: r.color,
      icon: { calc: 'calc', unit: 'calc', color: 'palette', time: 'clock', radix: 'hash', uuid: 'key' }[kind] || 'calc'
    });
  };
  push('calc', tryMath(query));
  push('unit', tryUnitConversion(query));
  push('time', tryTime(query));
  push('color', tryColor(query));
  push('radix', tryRadix(query));
  push('uuid', tryUuid(query));
  return out;
}

// 搜索引擎匹配：query 形如 "g 关键词"，key 命中设置中的自定义引擎
function matchSearchEngine(query, engines) {
  const m = /^(\S+)\s+(.+)$/.exec(query.trim());
  if (!m) return null;
  const eng = (engines || []).find(e => e.key && e.key.toLowerCase() === m[1].toLowerCase());
  if (!eng || !eng.url) return null;
  const url = eng.url.replace(/%s/g, encodeURIComponent(m[2].trim()));
  return {
    id: `engine-${eng.key}-${m[2]}`,
    type: 'websearch',
    title: `在 ${eng.key} 搜索"${m[2].trim()}"`,
    subtitle: url,
    url,
    icon: 'search'
  };
}

// ========= 解析搜索模式 =========
function parseQuery(rawQuery) {
  const trimmed = normalizeColonPrefix(rawQuery.trim());
  for (const { scope, full, short } of SCOPE_PREFIXES) {
    if (trimmed.startsWith(full + ' ')) return { scope, query: trimmed.slice(full.length + 1).trim() };
    if (trimmed === full)                return { scope, query: '' };
    if (short && trimmed.startsWith(short + ' ')) return { scope, query: trimmed.slice(short.length + 1).trim() };
    if (short && trimmed === short)               return { scope, query: '' };
  }
  if (trimmed.startsWith('/')) {
    return { scope: 'commands', query: trimmed.slice(1).trim() };
  }
  return { scope: 'all', query: trimmed };
}

// ========= 综合搜索 =========
async function performSearch(rawQuery) {
  const { scope, query } = parseQuery(rawQuery);
  const limit = DEFAULT_RESULTS_LIMIT;

  try {
    switch (scope) {
      case 'tabs':      return await searchTabs(query, limit);
      case 'history':   return await searchHistory(query, limit);
      case 'bookmarks': return await searchBookmarks(query, limit);
      case 'commands':  return searchCommands(query, limit);
      case 'closed':    return await searchClosed(query, limit);
      case 'downloads': return await searchDownloads(query, limit);
      case 'emoji':     return searchEmoji(query, 24);
      case 'todo':      return await searchTodos(query);
      case 'weather':   return await searchWeather(query);
      case 'rss':       return await searchRss(query);
      case 'calendar':  return await searchCalendar(query);
      case 'ai':        return []; // AI 模式由 content 本地接管
      default: {
        // 空查询：Tab + 命令（冷启动快）
        if (!query) {
          const [tabs, commands] = await Promise.all([
            searchTabs(query, 12),
            searchCommands(query, 8)
          ]);
          const seen = new Set();
          const results = [];
          const add = (items) => {
            for (const item of items) {
              const key = item.type === 'tab' ? `tab-${item.tabId}` : item.url || item.id;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push(item);
            }
          };
          add(tabs);
          add(commands);
          return results.slice(0, limit);
        }

        // 即时答案（计算/单位/时区/颜色/进制/UUID）同步可得，置顶
        const answers = instantAnswers(query);
        const openUrl = answers.length ? null : tryOpenUrl(query);
        const settings = await getSettings();
        const engineHit = matchSearchEngine(query, settings.searchEngines);

        const [tabs, commands, history, bookmarks, closed] = await Promise.all([
          searchTabs(query, 8),
          searchCommands(query, 6),
          searchHistory(query, 6),
          searchBookmarks(query, 4),
          searchClosed(query, 3)
        ]);

        const seen = new Set();
        const results = [];
        const add = (items) => {
          for (const item of items) {
            const key = item.type === 'tab' ? `tab-${item.tabId}` : item.url || item.id;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(item);
          }
        };

        add(answers);
        if (engineHit) results.push(engineHit);
        if (openUrl) {
          results.push({
            id: `openurl-${openUrl.url}`, type: 'openurl',
            title: openUrl.title, subtitle: openUrl.url, url: openUrl.url, icon: 'link'
          });
        }
        add(tabs);
        add(commands);
        add(closed);
        add(history);
        add(bookmarks);

        // 兜底：网页搜索
        results.push({
          id: `websearch-${query}`, type: 'websearch',
          title: `在 Google 搜索"${query}"`,
          subtitle: '使用默认搜索引擎查找',
          url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
          icon: 'search'
        });

        return results.slice(0, limit);
      }
    }
  } catch (err) {
    console.error('Search error:', err);
    return [];
  }
}

// ========= AI 聊天（自带 Key，请求直连服务商）=========
const AI_PROVIDERS = {
  openai:     { type: 'openai',    baseUrl: 'https://api.openai.com/v1',                    model: 'gpt-4o-mini' },
  openrouter: { type: 'openai',    baseUrl: 'https://openrouter.ai/api/v1',                 model: 'openai/gpt-4o-mini' },
  deepseek:   { type: 'openai',    baseUrl: 'https://api.deepseek.com/v1',                  model: 'deepseek-chat' },
  grok:       { type: 'openai',    baseUrl: 'https://api.x.ai/v1',                          model: 'grok-3-mini' },
  mistral:    { type: 'openai',    baseUrl: 'https://api.mistral.ai/v1',                    model: 'mistral-small-latest' },
  perplexity: { type: 'openai',    baseUrl: 'https://api.perplexity.ai',                    model: 'sonar' },
  anthropic:  { type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',                 model: 'claude-3-5-haiku-latest' },
  gemini:     { type: 'gemini',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  custom:     { type: 'openai',    baseUrl: '',                                             model: '' }
};

async function aiChat(userMessages) {
  const s = await getSettings();
  if (!s.aiApiKey) {
    return { ok: false, error: '未配置 API Key。请先在设置页填写（命令 /opt 打开）' };
  }
  const p = AI_PROVIDERS[s.aiProvider] || AI_PROVIDERS.openai;
  const baseUrl = (s.aiProvider === 'custom' ? s.aiBaseUrl : p.baseUrl).replace(/\/+$/, '');
  const model = s.aiModel || p.model;
  if (!baseUrl || !model) {
    return { ok: false, error: '未配置完整的服务商信息（Base URL / 模型）' };
  }

  const messages = [
    { role: 'system', content: 'You are a helpful assistant inside a browser command palette. Be concise. Reply in the same language as the user.' },
    ...userMessages.slice(-20)
  ];

  try {
    if (p.type === 'openai') {
      const r = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.aiApiKey },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: j?.error?.message || ('HTTP ' + r.status) };
      return { ok: true, reply: j.choices?.[0]?.message?.content || '(空回复)' };
    }
    if (p.type === 'anthropic') {
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const msgs = messages.filter(m => m.role !== 'system');
      const r = await fetch(baseUrl + '/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': s.aiApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: 2048, ...(sys ? { system: sys } : {}), messages: msgs })
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: j?.error?.message || ('HTTP ' + r.status) };
      return { ok: true, reply: (j.content || []).map(c => c.text || '').join('') || '(空回复)' };
    }
    if (p.type === 'gemini') {
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const contents = messages.filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const r = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.aiApiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}) })
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: j?.error?.message || ('HTTP ' + r.status) };
      const reply = (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
      return { ok: true, reply: reply || '(空回复)' };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  return { ok: false, error: '未知的服务商类型' };
}

// ========= 执行选中的结果 =========
// tabAction：对 tab 类型结果的修饰操作（content 修饰键触发），'close' | 'pin' | 'mute'
async function executeItem(item, tabAction) {
  if (!item) return;

  switch (item.type) {
    case 'tab': {
      try {
        if (tabAction === 'close') {
          await chrome.tabs.remove(item.tabId);
          return { refresh: true }; // 通知 content 刷新列表且保持面板打开
        }
        if (tabAction === 'pin') {
          const t = await chrome.tabs.get(item.tabId);
          await chrome.tabs.update(item.tabId, { pinned: !t.pinned });
          return { refresh: true };
        }
        if (tabAction === 'mute') {
          const t = await chrome.tabs.get(item.tabId);
          await chrome.tabs.update(item.tabId, { muted: !t.mutedInfo?.muted });
          return { refresh: true };
        }
        await chrome.tabs.update(item.tabId, { active: true });
        const tab = await chrome.tabs.get(item.tabId).catch(() => null);
        if (tab && tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to switch tab:', e);
      }
      break;
    }

    case 'calendar': {
      // 有会议/详情链接则打开，否则无操作
      if (item.url) {
        try { await chrome.tabs.create({ url: item.url, active: true }); } catch (e) {}
      }
      break;
    }

    case 'history':
    case 'bookmark':
    case 'rss':
    case 'openurl':
    case 'websearch': {
      if (!item.url) return;
      try {
        await chrome.tabs.create({ url: item.url, active: true });
      } catch (e) {
        console.error('Failed to open url:', e);
      }
      break;
    }

    case 'closed': {
      try {
        await chrome.sessions.restore(item.sessionId);
      } catch (e) {
        // sessionId 失效时直接开 URL
        if (item.url) await chrome.tabs.create({ url: item.url });
      }
      break;
    }

    case 'download': {
      try {
        if (item.state === 'complete') await chrome.downloads.open(item.downloadId);
        else await chrome.downloads.show(item.downloadId);
      } catch (e) {
        try { await chrome.downloads.show(item.downloadId); } catch (_) {}
      }
      break;
    }

    case 'command': {
      const cmd = COMMANDS.find(c => c.id === item.id);
      if (cmd && cmd.action) {
        try {
          await cmd.action();
        } catch (e) {
          console.error('Command action failed:', e);
        }
      }
      // client / setScope 命令由 content 处理，不到这里
      break;
    }

    default:
      break;
  }
}

// ========= 消息处理 =========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // PING：用于 content script 注入时预热 SW
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return false;
  }

  if (message.type === 'SEARCH') {
    performSearch(message.query).then(results => {
      sendResponse({ results });
    });
    return true; // 异步响应
  }

  if (message.type === 'EXECUTE') {
    executeItem(message.item, message.tabAction).then((r) => {
      sendResponse({ success: true, refresh: !!(r && r.refresh) });
    }).catch(err => {
      console.error(err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // 区域截图：content 框选后发来 CSS 像素坐标，这里截屏并按 devicePixelRatio 裁剪下载
  if (message.type === 'SCREENSHOT_AREA') {
    (async () => {
      const rect = message.rect || {};
      const dpr = rect.dpr || 1;
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      const blob = await (await fetch(dataUrl)).blob();
      const bmp = await createImageBitmap(blob);
      const x = Math.max(0, Math.round(rect.x * dpr));
      const y = Math.max(0, Math.round(rect.y * dpr));
      const w = Math.min(bmp.width - x, Math.round(rect.width * dpr));
      const h = Math.min(bmp.height - y, Math.round(rect.height * dpr));
      if (w <= 0 || h <= 0) throw new Error('选区超出截图范围');
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      // SW 无 FileReader，手动转 base64
      const buf = new Uint8Array(await out.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      }
      const outUrl = 'data:image/png;base64,' + btoa(bin);
      await chrome.downloads.download({
        url: outUrl,
        filename: `gofun-screenshot-area-${Date.now()}.png`,
        saveAs: false
      });
      sendResponse({ success: true });
    })().catch(err => {
      console.error(err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // ---- 待办 ----
  if (message.type === 'TODO_ADD') {
    (async () => {
      const todos = await getTodos();
      todos.unshift({ id: 't' + Date.now(), text: message.text, done: false, ts: Date.now() });
      await saveTodos(todos);
      sendResponse({ success: true, todos });
    })();
    return true;
  }
  if (message.type === 'TODO_TOGGLE') {
    (async () => {
      const todos = await getTodos();
      const t = todos.find(x => x.id === message.id);
      if (t) t.done = !t.done;
      await saveTodos(todos);
      sendResponse({ success: true, todos });
    })();
    return true;
  }
  if (message.type === 'TODO_REMOVE') {
    (async () => {
      let todos = await getTodos();
      todos = todos.filter(x => x.id !== message.id);
      await saveTodos(todos);
      sendResponse({ success: true, todos });
    })();
    return true;
  }
  if (message.type === 'TODO_CLEAR_DONE') {
    (async () => {
      let todos = await getTodos();
      todos = todos.filter(x => !x.done);
      await saveTodos(todos);
      sendResponse({ success: true, todos });
    })();
    return true;
  }

  // ---- AI 聊天 ----
  if (message.type === 'AI_CHAT') {
    aiChat(message.messages || []).then(sendResponse);
    return true;
  }

  return false;
});

// ========= 快捷键 & 图标入口 =========
async function openPaletteInTab(tab) {
  if (!tab || !tab.id) return;

  // chrome:// / edge:// / file:// 等受限协议无法注入 content script，
  // 此时 fallback 到新标签页打开面板
  const restricted =
    !tab.url ||
    /^(chrome|edge|brave|opera|vivaldi|chrome-untrusted):\/\//i.test(tab.url);

  const sendOpen = async (targetTabId) => {
    try {
      await chrome.tabs.sendMessage(targetTabId, { type: 'OPEN_PALETTE' });
      return true;
    } catch (_) {
      return false;
    }
  };

  if (restricted) {
    const nt = await chrome.tabs.create({ url: 'chrome://newtab', active: true });
    setTimeout(async () => {
      const ok = await sendOpen(nt.id);
      if (!ok) {
        try {
          await injectContentScript(nt.id);
          setTimeout(() => sendOpen(nt.id).catch(() => {}), 180);
        } catch (_) { /* 依然受限，忽略 */ }
      }
    }, 200);
    return;
  }

  const ok = await sendOpen(tab.id);
  if (ok) return;

  try {
    await injectContentScript(tab.id);
    setTimeout(() => sendOpen(tab.id).catch(() => {}), 180);
  } catch (e) {
    console.error('Inject content script failed:', e);
  }
}

// 注入 content script：先重置注入守卫，再注入 JS 和 CSS
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__GOFUN_INJECTED__ = false; }
  }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['palette.css'] });
}

// 扩展安装/更新时，主动向所有 http(s) 标签页注入 content script
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (/^https?:\/\//.test(tab.url || '')) {
        injectContentScript(tab.id).catch(() => {});
      }
    }
  } catch (_) {}
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-palette') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openPaletteInTab(tab);
});

chrome.action.onClicked.addListener(async (tab) => {
  await openPaletteInTab(tab);
});

// ========= 标签页缓存 =========
let cacheTimer = null;
async function cacheTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const curWin = await chrome.windows.getCurrent().catch(() => null);
    const simplified = tabs.map(t => ({
      id: `tab-${t.id}`,
      type: 'tab',
      title: t.title || t.url || '无标题',
      subtitle: t.url,
      url: t.url,
      tabId: t.id,
      active: t.active,
      otherWindow: curWin ? t.windowId !== curWin.id : false,
      icon: 'tab'
    }));
    await chrome.storage.local.set({ cachedTabs: simplified });
  } catch (e) { /* SW 上下文失效时忽略 */ }
}

function cacheTabsDebounced() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(cacheTabs, 100);
}

cacheTabs();

chrome.tabs.onCreated.addListener(cacheTabsDebounced);
chrome.tabs.onUpdated.addListener(cacheTabsDebounced);
chrome.tabs.onRemoved.addListener(cacheTabsDebounced);
chrome.tabs.onActivated.addListener(cacheTabsDebounced);
