// background.js - 处理搜索与动作执行
// GoFun 对标 TabCmdr：Tab/历史/书签/最近关闭/下载 搜索 + 51 条命令

const DEFAULT_RESULTS_LIMIT = 20;

// ========= 设置 =========
const SETTINGS_KEY = 'gofun_settings';
const DEFAULT_SETTINGS = {
  theme: 'system',
  compact: false,
  position: 'center',
  historyDays: 90
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
    id: 'cmd.options', type: 'command', title: 'GoFun 设置', subtitle: '主题、位置、紧凑模式等配置',
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
  { scope: 'downloads', full: '/downloads', short: '/d' }
];

// TabCmdr 风格的冒号前缀别名（:b foo 等价于 /b foo），仅在输入以冒号开头时生效
const COLON_ALIASES = {
  ':t': '/tabs', ':tabs': '/tabs',
  ':h': '/history', ':history': '/history',
  ':b': '/bookmarks', ':bookmarks': '/bookmarks',
  ':c': '/commands', ':commands': '/commands',
  ':cl': '/closed', ':closed': '/closed',
  ':d': '/downloads', ':downloads': '/downloads'
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
  // rest 里保留 alias / browserKbd / client 供前端使用
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

        const openUrl = tryOpenUrl(query);

        const [tabs, commands, history, bookmarks, closed, downloads] = await Promise.all([
          searchTabs(query, 8),
          searchCommands(query, 6),
          searchHistory(query, 6),
          searchBookmarks(query, 4),
          searchClosed(query, 3),
          searchDownloads(query, 4)
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

        if (openUrl) {
          results.push({
            id: `openurl-${openUrl.url}`, type: 'openurl',
            title: openUrl.title, subtitle: openUrl.url, url: openUrl.url, icon: 'link'
          });
        }
        add(tabs);
        add(commands);
        add(closed);
        add(downloads);
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

// ========= 执行选中的结果 =========
// tabAction：对 tab 类型结果的修饰操作（content 悬停按钮 / 修饰键触发）
// 支持：'close' | 'pin' | 'mute' | 'reload' | 'duplicate' | 'move' | 'group' | 'popout'
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
        if (tabAction === 'reload') {
          await chrome.tabs.reload(item.tabId);
          return { refresh: true };
        }
        if (tabAction === 'duplicate') {
          await chrome.tabs.duplicate(item.tabId);
          return { refresh: true };
        }
        if (tabAction === 'move') {
          // 把该标签页抽到一个新窗口
          await chrome.windows.create({ tabId: item.tabId });
          return { refresh: true };
        }
        if (tabAction === 'popout') {
          // 在新窗口打开该 URL（保留原标签页）
          if (item.url) await chrome.windows.create({ url: item.url });
          return { refresh: true };
        }
        if (tabAction === 'group') {
          // 把同域名（含该标签页）的标签页归入同一组
          const cur = await chrome.tabs.get(item.tabId);
          const host = safeHostname(cur.url);
          if (host) {
            const tabs = await chrome.tabs.query({ windowId: cur.windowId });
            const ids = tabs
              .filter(t => safeHostname(t.url) === host)
              .map(t => t.id);
            if (ids.length) {
              const gid = await chrome.tabs.group({ tabIds: ids });
              await chrome.tabGroups.update(gid, { title: host }).catch(() => {});
            }
          }
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

    case 'history':
    case 'bookmark':
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
      // client 命令由 content 处理，不到这里
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
