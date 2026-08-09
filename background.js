// background.js - 处理搜索与动作执行

const DEFAULT_RESULTS_LIMIT = 20;

// 命令列表
// alias:       GoFun 命令缩写（如 /n），参与搜索匹配 + UI 右侧高亮显示
// browserKbd:  浏览器原生快捷键（如 Ctrl+T），仅 UI 灰色提示，不参与搜索
// keywords:    搜索匹配用的英文关键词（不显示在 UI 上），让用户输英文也能搜到
const COMMANDS = [
  {
    id: 'cmd.newtab',
    type: 'command',
    title: '新建标签页',
    subtitle: '在当前窗口打开新的标签页',
    icon: 'plus',
    alias: ['/n'],
    browserKbd: 'Ctrl T',
    keywords: ['new', 'tab', 'newtab', 'open'],
    action: () => chrome.tabs.create({})
  },
  {
    id: 'cmd.closetab',
    type: 'command',
    title: '关闭当前标签页',
    subtitle: '关闭当前激活的标签页',
    icon: 'x',
    alias: ['/w'],
    browserKbd: 'Ctrl W',
    keywords: ['close', 'closetab', 'remove'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.remove(tab.id);
    }
  },
  {
    id: 'cmd.duplicatetab',
    type: 'command',
    title: '复制当前标签页',
    subtitle: '复制当前标签页',
    icon: 'copy',
    alias: ['/dup'],
    keywords: ['duplicate', 'copy', 'clone'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.duplicate(tab.id);
    }
  },
  {
    id: 'cmd.reload',
    type: 'command',
    title: '重新加载当前页',
    subtitle: '刷新当前标签页',
    icon: 'refresh',
    alias: ['/r'],
    browserKbd: 'Ctrl R',
    keywords: ['reload', 'refresh', 'f5'],
    action: () => chrome.tabs.reload()
  },
  {
    id: 'cmd.goback',
    type: 'command',
    title: '后退',
    subtitle: '在历史记录中后退',
    icon: 'arrow-left',
    alias: ['/back'],
    browserKbd: 'Alt ←',
    keywords: ['back', 'goback', 'previous'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.goBack(tab.id);
    }
  },
  {
    id: 'cmd.goforward',
    type: 'command',
    title: '前进',
    subtitle: '在历史记录中前进',
    icon: 'arrow-right',
    alias: ['/fwd'],
    browserKbd: 'Alt →',
    keywords: ['forward', 'next', 'goforward'],
    action: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.goForward(tab.id);
    }
  },
  {
    id: 'cmd.extensions',
    type: 'command',
    title: '管理扩展',
    subtitle: '打开扩展管理页面',
    icon: 'grid',
    alias: ['/ext'],
    keywords: ['extensions', 'ext', 'addon', 'plugin'],
    action: () => chrome.tabs.create({ url: 'chrome://extensions/' })
  },
  {
    id: 'cmd.settings',
    type: 'command',
    title: '浏览器设置',
    subtitle: '打开设置页面',
    icon: 'settings',
    alias: ['/set'],
    keywords: ['settings', 'config', 'preferences', 'setup'],
    action: () => chrome.tabs.create({ url: 'chrome://settings/' })
  },
  {
    id: 'cmd.bookmarks',
    type: 'command',
    title: '书签管理器',
    subtitle: '打开书签管理器',
    icon: 'bookmark',
    alias: ['/bm'],
    browserKbd: 'Ctrl Shift O',
    keywords: ['bookmarks', 'bookmark', 'fav', 'star'],
    action: () => chrome.tabs.create({ url: 'chrome://bookmarks/' })
  },
  {
    id: 'cmd.history',
    type: 'command',
    title: '历史记录',
    subtitle: '打开历史记录页面',
    icon: 'clock',
    alias: ['/his'],
    browserKbd: 'Ctrl H',
    keywords: ['history', 'recent', 'visited'],
    action: () => chrome.tabs.create({ url: 'chrome://history/' })
  },
];

// 支持的范围前缀，含全称和单字母缩写，按 "先长后短" 匹配，避免 /tabs 被 /t 抢先
const SCOPE_PREFIXES = [
  { scope: 'tabs',      full: '/tabs',      short: '/t' },
  { scope: 'history',   full: '/history',   short: '/h' },
  { scope: 'bookmarks', full: '/bookmarks', short: '/b' },
  { scope: 'commands',  full: '/commands',  short: '/c' }
];

// 工具函数
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
// 输 /n 命中"新建标签页"，输 reload 命中"重新加载当前页"
function scoreCommand(cmd, query) {
  const baseScore = scoreResult({ title: cmd.title, subtitle: cmd.subtitle }, query);
  if (!query) return baseScore;
  const q = query.toLowerCase();

  // 匹配 alias（如 /n、/ext）— 去掉 / 后比较
  const alias = cmd.alias || [];
  for (const a of alias) {
    const norm = a.toLowerCase().replace(/\s+/g, '').replace(/^\//, '');
    if (norm === q) return Math.max(baseScore, 1100);
    if (norm.startsWith(q)) return Math.max(baseScore, 950);
    if (q.startsWith(norm)) return Math.max(baseScore, 880);
    if (norm.includes(q)) return Math.max(baseScore, 820);
  }

  // 匹配 keywords（如 reload、close、back）
  const keywords = cmd.keywords || [];
  for (const kw of keywords) {
    const norm = kw.toLowerCase();
    if (norm === q) return Math.max(baseScore, 1050);
    if (norm.startsWith(q)) return Math.max(baseScore, 920);
    if (norm.includes(q)) return Math.max(baseScore, 800);
  }

  return baseScore;
}

// 搜索 Tab
async function searchTabs(query, limit) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const scored = tabs
    .map(tab => ({
      ...tab,
      type: 'tab',
      displayTitle: tab.title || tab.url || '无标题',
      score: scoreResult({ title: tab.title, url: tab.url }, query)
    }))
    .filter(t => !query || t.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(t => ({
    id: `tab-${t.id}`,
    type: 'tab',
    title: t.displayTitle,
    subtitle: t.url,
    url: t.url,
    tabId: t.id,
    active: t.active,
    icon: 'tab'
  }));
}

// 搜索历史
async function searchHistory(query, limit) {
  // 空查询：只取最近 50 条；有查询：限制最近 90 天、最多 100 条候选，避免遍历全部历史
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const historyItems = await chrome.history.search({
    text: query || '',
    maxResults: query ? Math.min(limit * 4, 100) : 50,
    startTime: query ? ninetyDaysAgo : 0
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
      return (a.dateAdded || 0) - (b.dateAdded || 0);  // 空查询时按添加时间排序
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
  // rest 里保留 alias 和 browserKbd 供前端 UI 显示
}

// 解析搜索模式（支持全称 + 单字母缩写：/t /h /b /c）
function parseQuery(rawQuery) {
  const trimmed = rawQuery.trim();
  for (const { scope, full, short } of SCOPE_PREFIXES) {
    const lenFull = full.length;
    const lenShort = short.length;
    if (trimmed.startsWith(full + ' ')) return { scope, query: trimmed.slice(lenFull + 1).trim() };
    if (trimmed === full)                return { scope, query: '' };
    if (trimmed.startsWith(short + ' ')) return { scope, query: trimmed.slice(lenShort + 1).trim() };
    if (trimmed === short)               return { scope, query: '' };
  }
  if (trimmed.startsWith('/')) {
    return { scope: 'commands', query: trimmed.slice(1).trim() };
  }
  return { scope: 'all', query: trimmed };
}

// 综合搜索
async function performSearch(rawQuery) {
  const { scope, query } = parseQuery(rawQuery);
  const limit = DEFAULT_RESULTS_LIMIT;

  try {
    switch (scope) {
      case 'tabs':
        return await searchTabs(query, limit);
      case 'history':
        return await searchHistory(query, limit);
      case 'bookmarks':
        return await searchBookmarks(query, limit);
      case 'commands':
        return searchCommands(query, limit);
      default: {
        // 空查询时只展示 Tab + 常用命令（冷启动更快、结果更聚焦）
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

        // 默认：Tab + 命令优先，历史记录和书签次之
        const [tabs, commands, history, bookmarks] = await Promise.all([
          searchTabs(query, 8),
          searchCommands(query, 6),
          searchHistory(query, 6),
          searchBookmarks(query, 4)
        ]);

        // 合并并去重（基于 URL）
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
        add(history);
        add(bookmarks);

        return results.slice(0, limit);
      }
    }
  } catch (err) {
    console.error('Search error:', err);
    return [];
  }
}

// 执行选中的结果
async function executeItem(item) {
  if (!item) return;

  switch (item.type) {
    case 'tab': {
      try {
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
    case 'bookmark': {
      if (!item.url) return;
      try {
        await chrome.tabs.create({ url: item.url, active: true });
      } catch (e) {
        console.error('Failed to open url:', e);
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
      break;
    }

    default:
      break;
  }
}

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // PING：用于 content script 注入时预热 SW，避免第一次打开面板时冷启动延迟
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
    executeItem(message.item).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      console.error(err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  return false;
});

// 命令快捷键监听 & 点击扩展图标：统一入口
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
    // newtab 也可能受限，给一次兜底重试
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
  // 先清除旧守卫（扩展重载后旧 context 已失效，但 __GOFUN_INJECTED__ 仍为 true）
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__GOFUN_INJECTED__ = false; }
  }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['palette.css'] });
}

// 扩展安装/更新时，主动向所有 http(s) 标签页注入 content script
// 解决"扩展安装前已打开的页面快捷键无效"的问题
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

// 点击扩展图标也打开面板
chrome.action.onClicked.addListener(async (tab) => {
  await openPaletteInTab(tab);
});

// ========= 标签页缓存 =========
// 将当前窗口的标签页列表写入 chrome.storage.local
// content script 打开面板时可直接读取（无需等待 SW 唤醒），实现秒开
let cacheTimer = null;
async function cacheTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const simplified = tabs.map(t => ({
      id: `tab-${t.id}`,
      type: 'tab',
      title: t.title || t.url || '无标题',
      subtitle: t.url,
      url: t.url,
      tabId: t.id,
      active: t.active,
      icon: 'tab'
    }));
    await chrome.storage.local.set({ cachedTabs: simplified });
  } catch (e) { /* SW 上下文失效时忽略 */ }
}

// 防抖：短时间内多个 tab 事件合并为一次写入
function cacheTabsDebounced() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(cacheTabs, 100);
}

// 启动时立即缓存一次
cacheTabs();

// 监听 tab 变化，实时更新缓存
chrome.tabs.onCreated.addListener(cacheTabsDebounced);
chrome.tabs.onUpdated.addListener(cacheTabsDebounced);
chrome.tabs.onRemoved.addListener(cacheTabsDebounced);
chrome.tabs.onActivated.addListener(cacheTabsDebounced);
