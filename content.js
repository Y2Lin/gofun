// content.js - GoFun 命令面板 UI 与交互

(function () {
  'use strict';

  // 防止内容脚本重复注入（同一个 tab 里多次注入也只会保留一个实例）
  if (window.__GOFUN_INJECTED__) return;
  window.__GOFUN_INJECTED__ = true;

  const OVERLAY_ID = 'quick-palette-overlay';
  const SEARCH_DEBOUNCE = 60;
  const LOADING_DELAY = 120;  // 结果在 120ms 内返回则不显示"搜索中"，避免闪烁
  const SETTINGS_KEY = 'gofun_settings';
  const AI_HISTORY_KEY = 'gofun_ai_chat';

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
  let currentSettings = null;

  // AI 聊天状态
  let aiMessages = [];       // [{role:'user'|'assistant', content}]
  let aiSending = false;

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
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l1 7 3 3v2H5v-2l3-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dedup: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 16V4h12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12l4 4M16 12l-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    'x-circle': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    'arrow-right-circle': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8M13 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sort: '<svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 20l3-3M11 6h10M11 12h7M11 18h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    group: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 7h6M7 13v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    ungroup: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><path d="M16 5l4 4M20 5l-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    merge: '<svg viewBox="0 0 24 24"><path d="M4 5v14M20 5v14M4 12h16M12 8l4 4-4 4M12 8L8 12l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    window: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9h18" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    incognito: '<svg viewBox="0 0 24 24"><circle cx="7" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 11h16l-2-7H6zM9 14l1.5-3M15 14l-1.5-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    restore: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'zoom-in': '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    'zoom-out': '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35M8 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    'zoom-reset': '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><text x="11" y="14" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">1:1</text></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    markdown: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 15V9l3 3 3-3v6M16 9v4m0 0l-2-2m2 2l2-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14h3v3h-3zM20 14h1M14 20h2M19 19h2v2h-2z" fill="currentColor" stroke="none"/></svg>',
    'arrow-up': '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'arrow-down': '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    printer: '<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="6" y="14" width="12" height="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    smile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 14s1.5 2 4 2 4-2 4-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 9h.01M15 9h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'check-circle': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 9.5L10.8 15 8 12.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    circle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.8L19.7 10l-5.8 1.9L12 17.7l-1.9-5.8L4.3 10l5.8-1.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M19 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    rss: '<svg viewBox="0 0 24 24"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    calc: '<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M12 21a9 9 0 0 0 9-9c0-1.5-1-2-2-2h-2.5a2 2 0 0 1-1.5-3.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    hash: '<svg viewBox="0 0 24 24"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  // 命令快照：与 background COMMANDS 保持字段一致（无 action），用于首次打开面板时立即渲染，不等 SW 响应
  const COMMAND_SNAPSHOT = [
    { id:'cmd.newtab',       type:'command', title:'新建标签页',       subtitle:'在当前窗口打开新的标签页',   icon:'plus',        alias:['/n'],   browserKbd:'Ctrl T' },
    { id:'cmd.closetab',     type:'command', title:'关闭当前标签页',   subtitle:'关闭当前激活的标签页',       icon:'x',           alias:['/w'],   browserKbd:'Ctrl W' },
    { id:'cmd.duplicatetab', type:'command', title:'复制当前标签页',   subtitle:'复制当前标签页',             icon:'copy',        alias:['/dup'] },
    { id:'cmd.reload',       type:'command', title:'重新加载当前页',   subtitle:'刷新当前标签页',             icon:'refresh',     alias:['/r'],   browserKbd:'Ctrl R' },
    { id:'cmd.hardreload',   type:'command', title:'硬性重新加载',     subtitle:'清除缓存并刷新当前页',       icon:'refresh',     alias:['/hr'] },
    { id:'cmd.goback',       type:'command', title:'后退',             subtitle:'在历史记录中后退',           icon:'arrow-left',  alias:['/back'],browserKbd:'Alt ←' },
    { id:'cmd.goforward',    type:'command', title:'前进',             subtitle:'在历史记录中前进',           icon:'arrow-right', alias:['/fwd'], browserKbd:'Alt →' },
    { id:'cmd.pin',          type:'command', title:'固定 / 取消固定标签页', subtitle:'切换当前标签页的固定状态', icon:'pin',        alias:['/pin'] },
    { id:'cmd.mute',         type:'command', title:'静音 / 取消静音标签页', subtitle:'切换当前标签页的静音状态', icon:'mute',       alias:['/mute'] },
    { id:'cmd.closedupes',   type:'command', title:'关闭重复标签页',   subtitle:'找出并关闭 URL 重复的标签页', icon:'dedup',       alias:['/dedup'] },
    { id:'cmd.closeothers',  type:'command', title:'关闭其他标签页',   subtitle:'保留当前页，关闭其余标签页', icon:'x-circle',    alias:['/co'] },
    { id:'cmd.closeright',   type:'command', title:'关闭右侧标签页',   subtitle:'关闭当前页右侧的所有标签页', icon:'arrow-right-circle', alias:['/cr'] },
    { id:'cmd.sorttabs',     type:'command', title:'按标题排序标签页', subtitle:'整理当前窗口，固定标签页不动', icon:'sort',       alias:['/sort'] },
    { id:'cmd.groupdomain',  type:'command', title:'按域名分组标签页', subtitle:'把同域名的标签页归入标签组', icon:'group',       alias:['/group'] },
    { id:'cmd.ungroupall',   type:'command', title:'取消所有标签分组', subtitle:'解散当前窗口的全部标签组',   icon:'ungroup',     alias:['/ungroup'] },
    { id:'cmd.mergewindows', type:'command', title:'合并所有窗口',     subtitle:'把所有窗口合并到当前窗口',   icon:'merge',       alias:['/merge'] },
    { id:'cmd.suspendothers', type:'command', title:'挂起其他标签页',  subtitle:'休眠未使用的标签页释放内存', icon:'moon',        alias:['/sus'] },
    { id:'cmd.movetowindow', type:'command', title:'移动到新窗口',     subtitle:'把当前标签页移到新窗口',     icon:'window',      alias:['/mv'] },
    { id:'cmd.restoreclosed', type:'command', title:'恢复最近关闭的标签页', subtitle:'重新打开刚刚关闭的标签页', icon:'restore',   alias:['/undo'], browserKbd:'Ctrl Shift T' },
    { id:'cmd.newwindow',    type:'command', title:'新建窗口',         subtitle:'打开一个新的浏览器窗口',     icon:'window',      alias:['/win'], browserKbd:'Ctrl N' },
    { id:'cmd.incognito',    type:'command', title:'新建无痕窗口',     subtitle:'打开一个新的无痕窗口',       icon:'incognito',   alias:['/inc'], browserKbd:'Ctrl Shift N' },
    { id:'cmd.zoomin',       type:'command', title:'放大页面',         subtitle:'当前页缩放 +20%',            icon:'zoom-in',     alias:['/zi'] },
    { id:'cmd.zoomout',      type:'command', title:'缩小页面',         subtitle:'当前页缩放 -20%',            icon:'zoom-out',    alias:['/zo'] },
    { id:'cmd.zoomreset',    type:'command', title:'重置缩放',         subtitle:'恢复 100% 缩放',             icon:'zoom-reset',  alias:['/zr'] },
    { id:'cmd.viewsource',   type:'command', title:'查看网页源代码',   subtitle:'在新标签页打开源代码',       icon:'code',        alias:['/src'] },
    { id:'cmd.screenshot',   type:'command', title:'截图当前页面',     subtitle:'截取可见区域保存为 PNG',     icon:'camera',      alias:['/ss'] },
    { id:'cmd.copyurl',      type:'command', title:'复制当前页网址',   subtitle:'复制当前标签页 URL',         icon:'link',        alias:['/cu'],  client:true },
    { id:'cmd.copytitle',    type:'command', title:'复制当前页标题',   subtitle:'复制当前标签页标题',         icon:'copy',        alias:['/ct'],  client:true },
    { id:'cmd.copymd',       type:'command', title:'复制 Markdown 链接', subtitle:'复制 [标题](网址) 格式',   icon:'markdown',    alias:['/md'],  client:true },
    { id:'cmd.qr',           type:'command', title:'当前页二维码',     subtitle:'生成当前页 URL 的二维码',    icon:'qr',          alias:['/qr'],  client:true },
    { id:'cmd.scrolltop',    type:'command', title:'滚动到顶部',       subtitle:'回到页面最上方',             icon:'arrow-up',    alias:['/top'], client:true },
    { id:'cmd.scrollbottom', type:'command', title:'滚动到底部',       subtitle:'跳到页面最下方',             icon:'arrow-down',  alias:['/btm'], client:true },
    { id:'cmd.print',        type:'command', title:'打印页面',         subtitle:'调用浏览器打印当前页',       icon:'printer',     alias:['/print'], browserKbd:'Ctrl P', client:true },
    { id:'cmd.fullscreen',   type:'command', title:'切换全屏',         subtitle:'进入 / 退出页面全屏',        icon:'fullscreen',  alias:['/fs'],  client:true },
    { id:'cmd.emoji',        type:'command', title:'Emoji 搜索',       subtitle:'模糊搜索 Emoji，回车复制',   icon:'smile',       alias:['/e'],   setScope:'/emoji ' },
    { id:'cmd.todo',         type:'command', title:'待办事项',         subtitle:'快速管理你的待办清单',       icon:'check',       alias:['/todo'], setScope:'/todo ' },
    { id:'cmd.weather',      type:'command', title:'天气查询',         subtitle:'查看城市当前天气与三天预报', icon:'cloud',       alias:['/wx'],  setScope:'/wx ' },
    { id:'cmd.ai',           type:'command', title:'AI 助手',          subtitle:'与 AI 对话，@page 携带当前页内容', icon:'sparkles', alias:['/ai'], setScope:'/ai ' },
    { id:'cmd.rss',          type:'command', title:'RSS 阅读器',       subtitle:'阅读订阅源或输入 feed 地址', icon:'rss',         alias:['/rss'], setScope:'/rss ' },
    { id:'cmd.extensions',   type:'command', title:'管理扩展',         subtitle:'打开扩展管理页面',           icon:'grid',        alias:['/ext'] },
    { id:'cmd.settings',     type:'command', title:'浏览器设置',       subtitle:'打开设置页面',               icon:'settings',    alias:['/set'] },
    { id:'cmd.bookmarks',    type:'command', title:'书签管理器',       subtitle:'打开书签管理器',             icon:'bookmark',    alias:['/bm'],  browserKbd:'Ctrl Shift O' },
    { id:'cmd.history',      type:'command', title:'历史记录',         subtitle:'打开历史记录页面',           icon:'clock',       alias:['/his'], browserKbd:'Ctrl H' },
    { id:'cmd.downloadspage', type:'command', title:'下载内容',        subtitle:'打开下载管理页面',           icon:'download',    alias:['/dlp'], browserKbd:'Ctrl J' },
    { id:'cmd.options',      type:'command', title:'GoFun 设置',       subtitle:'主题、位置、AI Key 等配置',  icon:'settings',    alias:['/opt'] }
  ];

  // 范围前缀定义（全称 + 缩写），和 background 的 SCOPE_PREFIXES 保持一致
  const SCOPE_PREFIXES = [
    { scope: 'tabs',      full: '/tabs',      short: '/t',  label: '标签页'   },
    { scope: 'history',   full: '/history',   short: '/h',  label: '历史记录' },
    { scope: 'bookmarks', full: '/bookmarks', short: '/b',  label: '书签'     },
    { scope: 'commands',  full: '/commands',  short: '/c',  label: '命令'     },
    { scope: 'closed',    full: '/closed',    short: '/cl', label: '最近关闭' },
    { scope: 'downloads', full: '/downloads', short: '/d',  label: '下载'     },
    { scope: 'emoji',     full: '/emoji',     short: '/e',  label: 'Emoji'   },
    { scope: 'todo',      full: '/todo',      short: null,  label: '待办'     },
    { scope: 'weather',   full: '/weather',   short: '/wx', label: '天气'     },
    { scope: 'rss',       full: '/rss',       short: null,  label: 'RSS'     },
    { scope: 'ai',        full: '/ai',        short: null,  label: 'AI'      }
  ];

  function parseScope(rawQuery) {
    const trimmed = rawQuery.trim();
    for (const { scope, full, short } of SCOPE_PREFIXES) {
      if (trimmed.startsWith(full + ' ') || trimmed === full) return scope;
      if (short && (trimmed.startsWith(short + ' ') || trimmed === short)) return scope;
    }
    return 'all';
  }

  // 从 scope 前缀（全称或缩写）中剥离掉前缀，取真正用于高亮的关键字
  function stripScopePrefix(rawQuery) {
    const trimmed = rawQuery.trim();
    for (const { full, short } of SCOPE_PREFIXES) {
      if (trimmed.startsWith(full + ' '))  return trimmed.slice(full.length + 1).trim();
      if (trimmed === full)                return '';
      if (short && trimmed.startsWith(short + ' ')) return trimmed.slice(short.length + 1).trim();
      if (short && trimmed === short)               return '';
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
          (short && (trimmed === short || trimmed.startsWith(short + ' ')))) {
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
    // emoji：直接显示字符
    if (item.type === 'emoji') {
      return `<span class="qp-emoji-char">${item.emoji}</span>`;
    }
    // 颜色答案：显示色块
    if (item.type === 'answer' && item.color) {
      return `<span class="qp-color-swatch" style="background:${escapeHtml(item.color)}"></span>`;
    }
    // 命令/答案/待办等：用内置 SVG 图标
    const svgTypes = ['command', 'answer', 'todo', 'todo-add', 'todo-clear', 'websearch', 'openurl', 'download', 'closed'];
    if (svgTypes.includes(item.type)) {
      return (item.icon && ICONS[item.icon]) ? ICONS[item.icon] : ICONS.command;
    }
    // tab / history / bookmark / rss：优先用网站 favicon，失败则用内置 SVG
    if (item.url) {
      const fav = faviconHtml(item);
      if (fav) return fav;
    }
    if (item.icon && ICONS[item.icon]) return ICONS[item.icon];
    return ICONS.tab;
  }

  const GROUP_ORDER = ['answer', 'tab', 'command', 'closed', 'download', 'history', 'bookmark', 'emoji', 'todo', 'todo-add', 'todo-clear', 'rss-feed', 'rss', 'openurl', 'websearch'];

  function getGroupLabel(type) {
    switch (type) {
      case 'answer': return '答案';
      case 'tab': return '标签页';
      case 'history': return '历史记录';
      case 'bookmark': return '书签';
      case 'command': return '命令';
      case 'closed': return '最近关闭';
      case 'download': return '下载';
      case 'emoji': return 'Emoji';
      case 'todo': case 'todo-add': case 'todo-clear': return '待办';
      case 'rss-feed': return 'RSS 订阅源';
      case 'rss': return 'RSS 文章';
      case 'openurl': return '打开网址';
      case 'websearch': return '网页搜索';
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
    input.placeholder = '搜索 Tab、历史、书签、下载，输入 / 看命令，或直接算 2+2…';
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
        <span><kbd>↵</kbd> 确认</span>
        <span><kbd>esc</kbd> 关闭</span>
      </div>
      <div>
        <span><kbd>/t</kbd> <kbd>/h</kbd> <kbd>/b</kbd> <kbd>/cl</kbd> <kbd>/d</kbd> <kbd>/e</kbd> <kbd>/todo</kbd> <kbd>/wx</kbd> <kbd>/ai</kbd></span>
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

    // 应用保存的主题/位置/紧凑设置
    if (currentSettings) applySettings(currentSettings);
  }

  // ========= 设置应用 =========
  const THEME_LIST = ['light', 'dark', 'dracula', 'nord', 'catppuccin', 'tokyo-night', 'gruvbox', 'solarized', 'rose-pine'];
  function applySettings(s) {
    if (!overlay) return;
    for (const t of THEME_LIST) overlay.classList.remove('qp-theme-' + t);
    if (s.theme && s.theme !== 'system') overlay.classList.add('qp-theme-' + s.theme);
    overlay.classList.toggle('qp-compact', !!s.compact);
    overlay.classList.remove('qp-pos-center', 'qp-pos-top', 'qp-pos-bottom');
    overlay.classList.add('qp-pos-' + (s.position || 'center'));
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(SETTINGS_KEY, (obj) => {
        if (chrome.runtime.lastError) return;
        currentSettings = obj[SETTINGS_KEY] || {};
        applySettings(currentSettings);
      });
    } catch (_) {}
  }

  // 设置页保存后实时生效
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[SETTINGS_KEY]) {
        currentSettings = changes[SETTINGS_KEY].newValue || {};
        applySettings(currentSettings);
      }
    });
  } catch (_) {}

  // 渲染命令右侧的快捷键提示：GoFun 缩写（高亮）+ 浏览器快捷键（灰色）
  function shortcutsHtml(alias, browserKbd) {
    let html = '';
    if (alias && alias.length) {
      const keys = alias.map(a => `<kbd class="qp-alias">${escapeHtml(a)}</kbd>`).join('');
      html += `<span class="qp-shortcuts">${keys}</span>`;
    }
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
    // AI 模式下换 placeholder 提示
    if (input) {
      input.placeholder = parseScope(query) === 'ai'
        ? '向 AI 提问，回车发送；@page 可附带当前页内容…'
        : '搜索 Tab、历史、书签、下载，输入 / 看命令，或直接算 2+2…';
    }
  }

  function handleInput(e) {
    const query = input.value;
    lastQuery = query;
    showScope(query);
    selectedIndex = 0;

    // AI 模式：不发搜索，本地渲染聊天界面
    if (parseScope(query) === 'ai') {
      cancelLoading();
      renderAiChat();
      return;
    }

    clearTimeout(searchTimeout);
    scheduleLoading();
    searchTimeout = setTimeout(() => {
      performSearch(query);
    }, SEARCH_DEBOUNCE);
  }

  // 延迟显示 loading：如果 LOADING_DELAY ms 内结果已返回，就不显示"搜索中"，避免闪烁
  function scheduleLoading() {
    clearTimeout(loadingTimeout);
    if (resultsEl) resultsEl.innerHTML = '';
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

  // 全局导航：面板可见时任何地方按下导航键都生效
  function handleGlobalNav(e) {
    if (!isVisible) return;

    if ((e.ctrlKey || e.metaKey) && e.key !== 'Home' && e.key !== 'End') return;

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

    const aiMode = parseScope(lastQuery) === 'ai';

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (aiMode) scrollChat(40); else moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (aiMode) scrollChat(-40); else moveSelection(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        if (aiMode) scrollChat(200); else moveSelection(5);
        break;
      case 'PageUp':
        e.preventDefault();
        if (aiMode) scrollChat(-200); else moveSelection(-5);
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
        if (aiMode) {
          sendAiMessage(stripScopePrefix(lastQuery));
        } else {
          executeSelected();
        }
        break;
      case 'Escape':
        e.preventDefault();
        closePalette();
        break;
      case 'Tab':
        e.preventDefault();
        if (!aiMode) moveSelection(e.shiftKey ? -1 : 1);
        break;
    }
  }

  // 只移动 .qp-selected class，不重建 DOM
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
    if (item) executeItem(item);
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
    loadSettings();

    // Phase 1（0ms）：立即用内置命令快照渲染首屏
    results = COMMAND_SNAPSHOT.slice(0, 10);
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
      cancelLoading();
      if (chrome.runtime.lastError) {
        console.error('Search error:', chrome.runtime.lastError.message);
        return;
      }
      const newResults = response?.results || [];
      results = newResults;
      selectedIndex = results.length > 0 ? 0 : -1;
      renderResults(results);
    });
  }

  // 刷新当前列表（待办操作后保持面板打开）
  function refreshResults() {
    if (!input) return;
    performSearch(input.value);
  }

  function renderResults(items, highlightQuery) {
    if (!resultsEl) return;
    const q = highlightQuery != null ? highlightQuery : stripScopePrefix(lastQuery);

    if (items.length === 0) {
      resultsEl.innerHTML = '<div id="quick-palette-empty">未找到结果</div>';
      return;
    }

    const grouped = {};
    for (const item of items) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push(item);
    }

    resultsEl.innerHTML = '';

    for (const type of GROUP_ORDER) {
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
        if (item.done) el.classList.add('qp-done');
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

  // ========= 执行 =========
  function executeItem(item) {
    // 切换输入框内容（工具入口 / RSS 订阅源）
    if (item.setScope || item.setInput) {
      input.value = item.setScope || item.setInput;
      input.focus();
      handleInput();
      return;
    }

    // 待办操作：保持面板打开并刷新
    if (item.type === 'todo-add') {
      sendBg({ type: 'TODO_ADD', text: item.text }, () => {
        input.value = '/todo ';
        lastQuery = input.value;
        refreshResults();
      });
      return;
    }
    if (item.type === 'todo') {
      sendBg({ type: 'TODO_TOGGLE', id: item.todoId }, refreshResults);
      return;
    }
    if (item.type === 'todo-clear') {
      sendBg({ type: 'TODO_CLEAR_DONE' }, refreshResults);
      return;
    }

    // emoji：复制到剪贴板
    if (item.type === 'emoji') {
      copyText(item.emoji);
      showToast(`已复制 ${item.emoji}`);
      closePalette();
      return;
    }

    // 即时答案：复制结果
    if (item.type === 'answer') {
      if (item.copyText) {
        copyText(item.copyText);
        showToast('已复制答案');
      }
      closePalette();
      return;
    }

    // 客户端命令（页面级操作）
    if (item.type === 'command' && item.client) {
      closePalette();
      runClientCommand(item.id);
      return;
    }

    // 其余交给 background
    chrome.runtime.sendMessage({ type: 'EXECUTE', item }, () => {
      if (chrome.runtime.lastError) {
        console.error('Execute error:', chrome.runtime.lastError.message);
      }
    });
    closePalette();
  }

  function sendBg(message, cb) {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) {
        console.error(message.type + ' error:', chrome.runtime.lastError.message);
        return;
      }
      if (cb) cb(resp);
    });
  }

  // 客户端命令实现
  function runClientCommand(id) {
    switch (id) {
      case 'cmd.copyurl':
        copyText(location.href);
        showToast('已复制网址');
        break;
      case 'cmd.copytitle':
        copyText(document.title);
        showToast('已复制标题');
        break;
      case 'cmd.copymd':
        copyText(`[${document.title}](${location.href})`);
        showToast('已复制 Markdown 链接');
        break;
      case 'cmd.qr':
        showQrOverlay(location.href);
        break;
      case 'cmd.scrolltop':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'cmd.scrollbottom':
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        break;
      case 'cmd.print':
        window.print();
        break;
      case 'cmd.fullscreen':
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
        break;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  // 复制成功提示
  function showToast(text) {
    const old = document.getElementById('gofun-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'gofun-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('qp-visible'));
    setTimeout(() => {
      toast.classList.remove('qp-visible');
      setTimeout(() => toast.remove(), 250);
    }, 1600);
  }

  // 二维码弹层（使用 qrserver 公共 API 生成图片）
  function showQrOverlay(url) {
    const old = document.getElementById('gofun-qr-overlay');
    if (old) old.remove();
    const qr = document.createElement('div');
    qr.id = 'gofun-qr-overlay';
    qr.innerHTML = `
      <div id="gofun-qr-card">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url)}" alt="QR" width="220" height="220"
             onerror="this.outerHTML='<div id=&quot;gofun-qr-error&quot;>二维码加载失败（网络受限）</div>'" />
        <div id="gofun-qr-url">${escapeHtml(url.length > 48 ? url.slice(0, 48) + '…' : url)}</div>
        <div id="gofun-qr-tip">点击任意处关闭</div>
      </div>
    `;
    document.body.appendChild(qr);
    requestAnimationFrame(() => qr.classList.add('qp-visible'));
    qr.addEventListener('click', () => qr.remove());
    const onKey = (e) => {
      if (e.key === 'Escape') {
        qr.remove();
        window.removeEventListener('keydown', onKey, true);
      }
    };
    window.addEventListener('keydown', onKey, true);
  }

  // ========= AI 聊天 =========
  function loadAiHistory(cb) {
    try {
      chrome.storage.local.get(AI_HISTORY_KEY, (obj) => {
        aiMessages = obj[AI_HISTORY_KEY] || [];
        if (cb) cb();
      });
    } catch (_) {
      aiMessages = [];
      if (cb) cb();
    }
  }
  function saveAiHistory() {
    try {
      chrome.storage.local.set({ [AI_HISTORY_KEY]: aiMessages.slice(-50) });
    } catch (_) {}
  }

  function renderAiChat() {
    if (!resultsEl) return;
    cancelLoading();
    results = [];
    selectedIndex = -1;

    if (!aiMessages.length) {
      resultsEl.innerHTML = `
        <div id="quick-palette-ai-empty">
          <div class="qp-ai-title">${ICONS.sparkles} AI 助手</div>
          <div class="qp-ai-tip">输入问题后回车发送。支持 <b>@page</b> 携带当前页面内容（如"总结一下 @page"）。</div>
          <div class="qp-ai-tip">在 <b>/opt</b> 设置页配置 API Key（支持 OpenAI / Claude / Gemini / DeepSeek 等）。</div>
          <div class="qp-ai-actions"><span class="qp-ai-clear" id="qp-ai-clear">清空对话</span></div>
        </div>`;
      bindAiClear();
      return;
    }

    const html = aiMessages.map(m => {
      const cls = m.role === 'user' ? 'qp-ai-user' : 'qp-ai-assistant';
      const roleLabel = m.role === 'user' ? '我' : 'AI';
      return `<div class="qp-ai-msg ${cls}${m.pending ? ' qp-ai-pending' : ''}">
        <div class="qp-ai-role">${roleLabel}</div>
        <div class="qp-ai-bubble">${m.pending ? '<span class="qp-loading-dots"><span></span><span></span><span></span></span>' : escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
      </div>`;
    }).join('');

    resultsEl.innerHTML = `<div id="quick-palette-ai">${html}
      <div class="qp-ai-actions"><span class="qp-ai-clear" id="qp-ai-clear">清空对话</span></div></div>`;
    bindAiClear();
    resultsEl.scrollTop = resultsEl.scrollHeight;
  }

  function bindAiClear() {
    const btn = resultsEl && resultsEl.querySelector('#qp-ai-clear');
    if (btn) {
      btn.addEventListener('click', () => {
        aiMessages = [];
        saveAiHistory();
        renderAiChat();
        if (input) input.focus();
      });
    }
  }

  function scrollChat(delta) {
    if (resultsEl) resultsEl.scrollTop += delta;
  }

  function grabPageText() {
    try {
      const text = (document.body && document.body.innerText) || '';
      return text.replace(/\s+\n/g, '\n').trim().slice(0, 4000);
    } catch (_) {
      return '';
    }
  }

  function sendAiMessage(text) {
    text = (text || '').trim();
    if (!text || aiSending) return;

    const usePage = /@page\b/i.test(text);
    const userText = text.replace(/@page\b/gi, '').trim() || '请总结这个页面';

    const history = aiMessages.map(m => ({ role: m.role, content: m.content }));
    if (usePage) {
      const pageText = grabPageText();
      history.push({
        role: 'user',
        content: `${userText}\n\n---- 当前页面内容（节选） ----\n标题：${document.title}\n网址：${location.href}\n${pageText}`
      });
    } else {
      history.push({ role: 'user', content: userText });
    }

    aiMessages.push({ role: 'user', content: usePage ? `${userText}（含页面内容）` : userText });
    aiMessages.push({ role: 'assistant', content: '', pending: true });
    aiSending = true;

    // 清空输入框中的问题，保留 /ai 前缀
    if (input) {
      input.value = lastQuery.trim().startsWith('/ai') ? '/ai ' : lastQuery.replace(/[^\s]+\s*$/, '');
      if (!input.value.startsWith('/ai')) input.value = '/ai ';
      lastQuery = input.value;
    }
    renderAiChat();

    chrome.runtime.sendMessage({ type: 'AI_CHAT', messages: history }, (resp) => {
      aiSending = false;
      // 移除 pending 占位
      aiMessages = aiMessages.filter(m => !m.pending);
      if (chrome.runtime.lastError) {
        aiMessages.push({ role: 'assistant', content: '发送失败：' + chrome.runtime.lastError.message });
      } else if (resp && resp.ok) {
        aiMessages.push({ role: 'assistant', content: resp.reply });
      } else {
        aiMessages.push({ role: 'assistant', content: '出错了：' + ((resp && resp.error) || '未知错误') });
      }
      saveAiHistory();
      if (isVisible && parseScope(lastQuery) === 'ai') renderAiChat();
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
  window.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    const isP = e.key && e.key.toLowerCase() === 'p';

    // Ctrl+Shift+P 由 Chrome command 处理，这里跳过（避免 open→close 竞态）
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

  // 预载 AI 历史 + 注入后立即发 PING 唤醒 Service Worker
  loadAiHistory();
  try {
    chrome.runtime.sendMessage({ type: 'PING' }, () => void chrome.runtime.lastError);
  } catch (_) { /* 扩展上下文失效时忽略 */ }
})();
