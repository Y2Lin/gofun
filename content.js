// content.js - GoFun 命令面板 UI 与交互

(function () {
  'use strict';

  // 防止内容脚本重复注入（同一个 tab 里多次注入也只会保留一个实例）
  if (window.__GOFUN_INJECTED__) return;
  window.__GOFUN_INJECTED__ = true;

  const OVERLAY_ID = 'quick-palette-overlay';
  const SEARCH_DEBOUNCE = 60;
  const LOADING_DELAY = 120;  // 结果在 120ms 内返回则不显示"搜索中"，避免闪烁

  let overlay = null;
  let input = null;
  let resultsEl = null;
  let scopeEl = null;
  let selectedIndex = 0;
  let results = [];
  let searchTimeout = null;
  let loadingTimeout = null;
  let isVisible = false;
  let lastQuery = '';
  let searchSeq = 0;   // 搜索请求序号，竞态时丢弃过期响应

  const ICONS = {
    tab: '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 6V4h6v2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24"><path d="M5 3h14v18l-7-4-7 4z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    command: '<svg viewBox="0 0 24 24"><path d="M4 8h16M4 12h10M4 16h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'arrow-left': '<svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'arrow-right': '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
  };

  // 命令快照：与 background COMMANDS 保持字段一致（无 action），用于首次打开面板时立即渲染，不等 SW 响应
  const COMMAND_SNAPSHOT = [
    { id:'cmd.newtab',       type:'command', title:'新建标签页',     subtitle:'在当前窗口打开新的标签页', icon:'plus',        alias:['/n'],   browserKbd:'Ctrl T' },
    { id:'cmd.closetab',     type:'command', title:'关闭当前标签页', subtitle:'关闭当前激活的标签页',     icon:'x',           alias:['/w'],   browserKbd:'Ctrl W' },
    { id:'cmd.duplicatetab', type:'command', title:'复制当前标签页', subtitle:'复制当前标签页',           icon:'copy',        alias:['/dup'] },
    { id:'cmd.reload',       type:'command', title:'重新加载当前页', subtitle:'刷新当前标签页',           icon:'refresh',     alias:['/r'],   browserKbd:'Ctrl R' },
    { id:'cmd.goback',       type:'command', title:'后退',           subtitle:'在历史记录中后退',         icon:'arrow-left',  alias:['/back'],browserKbd:'Alt ←' },
    { id:'cmd.goforward',    type:'command', title:'前进',           subtitle:'在历史记录中前进',         icon:'arrow-right', alias:['/fwd'], browserKbd:'Alt →' },
    { id:'cmd.extensions',   type:'command', title:'管理扩展',       subtitle:'打开扩展管理页面',         icon:'grid',        alias:['/ext'] },
    { id:'cmd.settings',     type:'command', title:'浏览器设置',     subtitle:'打开设置页面',             icon:'settings',    alias:['/set'] },
    { id:'cmd.bookmarks',    type:'command', title:'书签管理器',     subtitle:'打开书签管理器',           icon:'bookmark',    alias:['/bm'],  browserKbd:'Ctrl Shift O' },
    { id:'cmd.history',      type:'command', title:'历史记录',       subtitle:'打开历史记录页面',         icon:'clock',       alias:['/his'], browserKbd:'Ctrl H' }
  ];

  // 范围前缀定义（全称 + 单字母缩写），和 background 的 SCOPE_PREFIXES 保持一致
  const SCOPE_PREFIXES = [
    { scope: 'tabs',      full: '/tabs',      short: '/t', label: '标签页'   },
    { scope: 'history',   full: '/history',   short: '/h', label: '历史记录' },
    { scope: 'bookmarks', full: '/bookmarks', short: '/b', label: '书签'     },
    { scope: 'commands',  full: '/commands',  short: '/c', label: '命令'     }
  ];

  // 从 scope 前缀（全称或单字母）中剥离掉前缀，取真正用于高亮的关键字
  function stripScopePrefix(rawQuery) {
    const trimmed = rawQuery.trim();
    for (const { full, short } of SCOPE_PREFIXES) {
      if (trimmed.startsWith(full + ' '))  return trimmed.slice(full.length + 1).trim();
      if (trimmed === full)                return '';
      if (trimmed.startsWith(short + ' ')) return trimmed.slice(short.length + 1).trim();
      if (trimmed === short)               return '';
    }
    if (trimmed.startsWith('/')) {
      const rest = trimmed.slice(1);
      return rest.includes(' ') ? rest.slice(rest.indexOf(' ') + 1).trim() : '';
    }
    return trimmed;
  }

  function getScopeLabel(rawQuery) {
    const trimmed = rawQuery.trim();
    for (const { full, short, label } of SCOPE_PREFIXES) {
      if (trimmed === full || trimmed.startsWith(full + ' ') ||
          trimmed === short || trimmed.startsWith(short + ' ')) {
        return label;
      }
    }
    if (trimmed.startsWith('/')) return '命令';
    return '';
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return null;
    }
  }

  function faviconHtml(item) {
    const host = safeHostname(item.url);
    if (!host) return null;
    return `<img class="qp-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'qp-favicon-fallback',textContent:''}))" alt="" />`;
  }

  function getIconHtml(item) {
    // 命令类型：用内置 SVG 图标
    if (item.type === 'command') {
      return (item.icon && ICONS[item.icon]) ? ICONS[item.icon] : ICONS.command;
    }
    // tab / history / bookmark：优先用网站 favicon，失败则用内置 SVG
    if (item.url) {
      const fav = faviconHtml(item);
      if (fav) return fav;
    }
    if (item.icon && ICONS[item.icon]) return ICONS[item.icon];
    return ICONS.tab;
  }

  function getGroupLabel(type) {
    switch (type) {
      case 'tab': return '标签页';
      case 'history': return '历史记录';
      case 'bookmark': return '书签';
      case 'command': return '命令';
      default: return '结果';
    }
  }

  // 给文本中的 query 子串加 <mark class="qp-match"> 高亮
  function highlight(text, query) {
    text = escapeHtml(text || '');
    const q = (query || '').trim();
    if (!q) return text;
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx === -1) return text;
    return (
      text.slice(0, idx) +
      '<mark class="qp-match">' + text.slice(idx, idx + needle.length) + '</mark>' +
      text.slice(idx + needle.length)
    );
  }

  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    const container = document.createElement('div');
    container.id = 'quick-palette-container';

    const inputWrap = document.createElement('div');
    inputWrap.id = 'quick-palette-input-wrap';

    scopeEl = document.createElement('span');
    scopeEl.id = 'quick-palette-scope';

    input = document.createElement('input');
    input.id = 'quick-palette-input';
    input.type = 'text';
    input.placeholder = '搜索打开的 Tab、历史记录、书签或命令…';
    input.autocomplete = 'off';
    input.spellcheck = false;

    inputWrap.appendChild(scopeEl);
    inputWrap.appendChild(input);

    resultsEl = document.createElement('div');
    resultsEl.id = 'quick-palette-results';

    const footer = document.createElement('div');
    footer.id = 'quick-palette-footer';
    footer.innerHTML = `
      <div class="qp-hint">
        <span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span>
        <span><kbd>PgUp</kbd> <kbd>PgDn</kbd> 翻页</span>
        <span><kbd>↵</kbd> 确认</span>
        <span><kbd>esc</kbd> 关闭</span>
      </div>
      <div>
        <span><kbd>/t</kbd> <kbd>/h</kbd> <kbd>/b</kbd> <kbd>/c</kbd> 切换范围</span>
      </div>
    `;

    container.appendChild(inputWrap);
    container.appendChild(resultsEl);
    container.appendChild(footer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePalette();
    });

    input.addEventListener('input', handleInput);
  }

  // 渲染命令右侧的快捷键提示：GoFun 缩写（高亮）+ 浏览器快捷键（灰色）
  function shortcutsHtml(alias, browserKbd) {
    let html = '';
    // GoFun 命令缩写（如 /n、/ext）— 突出显示
    if (alias && alias.length) {
      const keys = alias.map(a => `<kbd class="qp-alias">${escapeHtml(a)}</kbd>`).join('');
      html += `<span class="qp-shortcuts">${keys}</span>`;
    }
    // 浏览器原生快捷键（如 Ctrl T）— 灰色淡显
    if (browserKbd) {
      const keys = browserKbd.split(/\s+/).filter(Boolean)
        .map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('');
      html += `<span class="qp-browser-kbd">${keys}</span>`;
    }
    return html;
  }

  function showScope(query) {
    if (!scopeEl) return;
    const scope = getScopeLabel(query);
    if (scope) {
      scopeEl.textContent = scope;
      scopeEl.classList.add('qp-visible');
    } else {
      scopeEl.classList.remove('qp-visible');
    }
  }

  function handleInput(e) {
    const query = input.value;
    lastQuery = query;
    showScope(query);
    selectedIndex = 0;

    clearTimeout(searchTimeout);
    scheduleLoading();
    searchTimeout = setTimeout(() => {
      performSearch(query);
    }, SEARCH_DEBOUNCE);
  }

  // 延迟显示 loading：如果 LOADING_DELAY ms 内结果已返回，就不显示"搜索中"，避免闪烁
  function scheduleLoading() {
    clearTimeout(loadingTimeout);
    if (resultsEl) resultsEl.innerHTML = ''; // 清空旧结果但不立即显示 loading
    loadingTimeout = setTimeout(() => {
      if (resultsEl && !resultsEl.children.length) {
        showLoading();
      }
    }, LOADING_DELAY);
  }

  function cancelLoading() {
    clearTimeout(loadingTimeout);
    loadingTimeout = null;
  }

  function showLoading() {
    if (!resultsEl) return;
    resultsEl.innerHTML =
      '<div id="quick-palette-loading"><span class="qp-loading-dots"><span></span><span></span><span></span></span>搜索中…</div>';
  }

  // 全局导航：面板可见时任何地方按下导航键都生效（document 捕获阶段统一处理）
  function handleGlobalNav(e) {
    if (!isVisible) return;

    // Ctrl/Cmd 组合键不拦截（Ctrl+Tab、Ctrl+T、Ctrl+W 等浏览器快捷键正常工作）
    // 例外：Ctrl/Cmd+Home、Ctrl/Cmd+End 是面板内导航
    if ((e.ctrlKey || e.metaKey) && e.key !== 'Home' && e.key !== 'End') return;

    // 处理"和选择/执行相关"的键：上下键、Tab、翻页、Home/End、Enter、Esc
    const isNavKey = (function () {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'PageDown':
        case 'PageUp':
        case 'Tab':
        case 'Enter':
        case 'Escape':
          return true;
        case 'Home':
        case 'End':
          return !!(e.metaKey || e.ctrlKey);
        default:
          return false;
      }
    })();
    if (!isNavKey) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        moveSelection(5);
        break;
      case 'PageUp':
        e.preventDefault();
        moveSelection(-5);
        break;
      case 'Home':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          selectedIndex = 0;
          renderResults(results);
          scrollSelectedIntoView();
        }
        break;
      case 'End':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          selectedIndex = Math.max(0, results.length - 1);
          renderResults(results);
          scrollSelectedIntoView();
        }
        break;
      case 'Enter':
        e.preventDefault();
        executeSelected();
        break;
      case 'Escape':
        e.preventDefault();
        closePalette();
        break;
      case 'Tab':
        e.preventDefault();
        moveSelection(e.shiftKey ? -1 : 1);
        break;
    }
  }

  // 只移动 .qp-selected class，不重建 DOM
  // 避免 mouseenter 与键盘导航冲突（重建 DOM 会导致鼠标所在项重复触发 mouseenter）
  function updateSelectionClass() {
    if (!resultsEl) return;
    const prev = resultsEl.querySelector('.qp-selected');
    if (prev) prev.classList.remove('qp-selected');
    const cur = resultsEl.querySelector('.qp-item[data-index="' + selectedIndex + '"]');
    if (cur) cur.classList.add('qp-selected');
  }

  function moveSelection(delta) {
    if (!results.length) return;
    if (selectedIndex < 0) selectedIndex = 0;
    selectedIndex = (selectedIndex + delta + results.length) % results.length;
    updateSelectionClass();
    scrollSelectedIntoView();
  }

  function scrollSelectedIntoView() {
    if (!resultsEl) return;
    const selected = resultsEl.querySelector('.qp-selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function executeSelected() {
    const item = results[selectedIndex];
    if (item) {
      executeItem(item);
      closePalette();
    }
  }

  function openPalette() {
    createOverlay();
    isVisible = true;
    overlay.offsetHeight;
    overlay.classList.add('qp-visible');
    input.value = '';
    requestAnimationFrame(() => input && input.focus());
    selectedIndex = 0;
    lastQuery = '';
    showScope('');

    // Phase 1（0ms）：立即用内置命令快照渲染首屏
    results = COMMAND_SNAPSHOT.slice();
    renderResults(results);

    // Phase 2（~1ms）：从 storage 读取缓存的标签页（无需 SW，极快）
    chrome.storage.local.get('cachedTabs', ({ cachedTabs }) => {
      if (!isVisible) return;
      if (cachedTabs && cachedTabs.length > 0) {
        results = [...cachedTabs.slice(0, 12), ...COMMAND_SNAPSHOT.slice(0, 8)];
        selectedIndex = 0;
        renderResults(results);
      }
    });

    // Phase 3（~50-200ms）：异步请求 SW 获取最新结果，覆盖缓存
    performSearch('');
  }

  function closePalette() {
    if (!overlay) return;
    isVisible = false;
    overlay.classList.remove('qp-visible');
    clearTimeout(searchTimeout);
    searchTimeout = null;
    cancelLoading();
    setTimeout(() => {
      if (!isVisible && overlay) {
        overlay.remove();
        overlay = null;
        input = null;
        resultsEl = null;
        scopeEl = null;
        results = [];
        selectedIndex = 0;
      }
    }, 160);
  }

  function performSearch(query) {
    if (!isVisible) return;
    const mySeq = ++searchSeq;

    chrome.runtime.sendMessage({ type: 'SEARCH', query }, (response) => {
      if (!isVisible || mySeq !== searchSeq) return;
      cancelLoading();  // 结果回来，取消延迟 loading
      if (chrome.runtime.lastError) {
        console.error('Search error:', chrome.runtime.lastError.message);
        // SW 还在启动时可能出错，静默保留当前快照
        return;
      }
      const newResults = response?.results || [];
      results = newResults;
      selectedIndex = results.length > 0 ? 0 : -1;
      renderResults(results);
    });
  }

  function renderResults(items, highlightQuery) {
    if (!resultsEl) return;
    const q = highlightQuery != null ? highlightQuery : stripScopePrefix(lastQuery);

    if (items.length === 0) {
      resultsEl.innerHTML = '<div id="quick-palette-empty">未找到结果</div>';
      return;
    }

    // 按类型分组
    const grouped = {};
    const order = ['tab', 'command', 'history', 'bookmark'];
    for (const item of items) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push(item);
    }

    resultsEl.innerHTML = '';

    for (const type of order) {
      if (!grouped[type]) continue;

      const groupEl = document.createElement('div');
      groupEl.className = 'qp-group';

      const label = document.createElement('div');
      label.className = 'qp-group-label';
      label.textContent = getGroupLabel(type);
      groupEl.appendChild(label);

      grouped[type].forEach((item) => {
        const globalIndex = items.indexOf(item);
        const el = document.createElement('div');
        el.className = 'qp-item';
        if (globalIndex === selectedIndex) el.classList.add('qp-selected');
        el.dataset.index = String(globalIndex);

        const iconHtml = getIconHtml(item);
        const badge = type === 'tab' && item.active ? '<span class="qp-badge">当前</span>' : '';
        const shortcuts = type === 'command' ? shortcutsHtml(item.alias, item.browserKbd) : '';

        el.innerHTML = `
          <div class="qp-icon">${iconHtml}</div>
          <div class="qp-content">
            <div class="qp-title">${highlight(item.title || '', q)}${badge}</div>
            <div class="qp-subtitle">${highlight(item.subtitle || '', q)}</div>
          </div>
          ${shortcuts}
        `;

        el.addEventListener('click', () => {
          executeItem(item);
          closePalette();
        });

        el.addEventListener('mouseenter', () => {
          selectedIndex = globalIndex;
          updateSelectionClass();
        });

        groupEl.appendChild(el);
      });

      resultsEl.appendChild(groupEl);
    }
  }

  function executeItem(item) {
    chrome.runtime.sendMessage({ type: 'EXECUTE', item }, () => {
      // 即使 sendMessage 失败也不阻塞 UI（错误已在 background 打日志）
      if (chrome.runtime.lastError) {
        console.error('Execute error:', chrome.runtime.lastError.message);
      }
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 监听来自 background 的打开指令
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_PALETTE') {
      // 避免某些站点里快捷键和后备监听同时触发导致两次 open
      if (isVisible) {
        closePalette();
      } else {
        openPalette();
      }
      sendResponse({ success: true });
      return true;
    }
    return false;
  });

  // 全局快捷键 & 面板导航
  // 挂在 window（而非 document）上，确保在 capture 阶段最先执行
  // 部分大站（如淘宝）在 window capture 阶段 stopPropagation，挂在 document 上会收不到事件
  // - Ctrl+P：页面层拦截，开 / 关面板
  // - Ctrl+Shift+P：由 Chrome manifest command 处理，不在此重复拦截
  // - 上下键、Tab、翻页、Ctrl+Home/End、Enter、Esc：面板内导航
  window.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    const isP = e.key && e.key.toLowerCase() === 'p';

    // Ctrl+Shift+P 由 Chrome command 处理，这里跳过（避免 open→close 竞态）
    // 仅在面板输入框内时阻止默认行为（如打印），但不执行开/关
    if (isCtrl && isP && isShift) {
      if (isVisible && e.target === input) {
        e.preventDefault();
      }
      return;
    }

    // 面板内导航（上下键、Tab、Enter、Esc 等）
    handleGlobalNav(e);

    // Ctrl+P（无 Shift）：页面层拦截
    if (isCtrl && isP) {
      const tag = (e.target && e.target.tagName) || '';
      const inOwnInput = e.target === input;
      const inEditable = !inOwnInput && (
        /^(INPUT|TEXTAREA|SELECT)$/.test(tag) ||
        (e.target && e.target.isContentEditable)
      );

      if (inOwnInput) {
        e.preventDefault();
        closePalette();
        return;
      }

      if (!inEditable) {
        e.preventDefault();
        if (isVisible) {
          closePalette();
        } else {
          openPalette();
        }
        return;
      }
    }
  }, true);

  // 注入后立即发 PING 唤醒 Service Worker，避免第一次打开面板时 SW 冷启动延迟
  try {
    chrome.runtime.sendMessage({ type: 'PING' }, () => void chrome.runtime.lastError);
  } catch (_) { /* 扩展上下文失效时忽略 */ }
})();
