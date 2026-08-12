/* GoFun 设置页逻辑
   存储：chrome.storage.sync，key 固定为 'gofun_settings'
   读取失败时静默回退到 DEFAULTS，纯原生 JS，无外部依赖 */

'use strict';

const STORAGE_KEY = 'gofun_settings';

const DEFAULTS = {
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
  searchEngines: [],
  calendarFeeds: []
};

/* 主题列表：value / 显示名 / 代表背景色 / 代表强调色 */
const THEMES = [
  { value: 'system',      name: '跟随系统',   bg: 'linear-gradient(135deg, #ffffff 50%, #1c1c1e 50%)', accent: '#007aff' },
  { value: 'light',       name: '浅色',       bg: '#ffffff', accent: '#007aff' },
  { value: 'dark',        name: '深色',       bg: '#1c1c1e', accent: '#0a84ff' },
  { value: 'dracula',     name: 'Dracula',    bg: '#282a36', accent: '#bd93f9' },
  { value: 'nord',        name: 'Nord',       bg: '#2e3440', accent: '#88c0d0' },
  { value: 'catppuccin',  name: 'Catppuccin', bg: '#1e1e2e', accent: '#cba6f7' },
  { value: 'tokyo-night', name: 'Tokyo Night',bg: '#1a1b26', accent: '#7aa2f7' },
  { value: 'gruvbox',     name: 'Gruvbox',    bg: '#282828', accent: '#fabd2f' },
  { value: 'solarized',   name: 'Solarized',  bg: '#fdf6e3', accent: '#268bd2' },
  { value: 'rose-pine',   name: 'Rosé Pine',  bg: '#191724', accent: '#ebbcba' },
  { value: 'one-dark',    name: 'One Dark',   bg: '#282c34', accent: '#61afef' },
  { value: 'monokai',     name: 'Monokai',    bg: '#272822', accent: '#a6e22e' },
  { value: 'ayu',         name: 'Ayu Dark',   bg: '#0b0e14', accent: '#39bae6' },
  { value: 'palenight',   name: 'Palenight',  bg: '#292d3e', accent: '#82aaff' },
  { value: 'everforest',  name: 'Everforest', bg: '#2d353b', accent: '#a7c080' }
];

let selectedTheme = DEFAULTS.theme;

/* ========= DOM 引用 ========= */
const els = {};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  els.themeGrid = $('theme-grid');
  els.compact = $('compact');
  els.position = $('position');
  els.historyDays = $('history-days');
  els.searchEngines = $('search-engines');
  els.weatherCity = $('weather-city');
  els.rssFeeds = $('rss-feeds');
  els.calendarFeeds = $('calendar-feeds');
  els.aiProvider = $('ai-provider');
  els.aiApiKey = $('ai-api-key');
  els.aiModel = $('ai-model');
  els.aiBaseUrlField = $('ai-base-url-field');
  els.aiBaseUrl = $('ai-base-url');
  els.btnSave = $('btn-save');
  els.saveStatus = $('save-status');
}

/* ========= 主题卡片 ========= */
function renderThemeGrid() {
  els.themeGrid.innerHTML = '';
  THEMES.forEach((theme) => {
    const card = document.createElement('div');
    card.className = 'theme-card' + (theme.value === selectedTheme ? ' selected' : '');
    card.dataset.theme = theme.value;

    const swatches = document.createElement('div');
    swatches.className = 'swatches';

    const bgSwatch = document.createElement('span');
    bgSwatch.className = 'swatch';
    bgSwatch.style.background = theme.bg;

    const accentSwatch = document.createElement('span');
    accentSwatch.className = 'swatch';
    accentSwatch.style.background = theme.accent;

    const name = document.createElement('div');
    name.className = 'theme-name';
    name.textContent = theme.name;

    swatches.appendChild(bgSwatch);
    swatches.appendChild(accentSwatch);
    card.appendChild(swatches);
    card.appendChild(name);

    card.addEventListener('click', () => {
      selectedTheme = theme.value;
      renderThemeGrid();
    });

    els.themeGrid.appendChild(card);
  });
}

/* ========= 自定义 Base URL 显隐 ========= */
function toggleBaseUrlField() {
  const isCustom = els.aiProvider.value === 'custom';
  els.aiBaseUrlField.classList.toggle('hidden', !isCustom);
}

/* ========= 回填表单 ========= */
function fillForm(settings) {
  selectedTheme = THEMES.some((t) => t.value === settings.theme)
    ? settings.theme
    : DEFAULTS.theme;
  renderThemeGrid();

  els.compact.checked = Boolean(settings.compact);
  els.position.value = settings.position;
  els.historyDays.value = String(settings.historyDays);
  els.searchEngines.value = Array.isArray(settings.searchEngines)
    ? settings.searchEngines.map((e) => `${e.key} ${e.url}`).join('\n')
    : '';
  els.weatherCity.value = settings.weatherCity;
  els.rssFeeds.value = Array.isArray(settings.rssFeeds)
    ? settings.rssFeeds.join('\n')
    : '';
  els.calendarFeeds.value = Array.isArray(settings.calendarFeeds)
    ? settings.calendarFeeds.join('\n')
    : '';
  els.aiProvider.value = settings.aiProvider;
  els.aiApiKey.value = settings.aiApiKey;
  els.aiModel.value = settings.aiModel;
  els.aiBaseUrl.value = settings.aiBaseUrl;
  toggleBaseUrlField();
}

/* ========= 收集表单 ========= */
function collectForm() {
  const rssFeeds = els.rssFeeds.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const calendarFeeds = els.calendarFeeds.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // 每行：触发词 + 空格 + URL（%s 占位）
  const searchEngines = els.searchEngines.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sp = line.indexOf(' ');
      if (sp <= 0) return null;
      const key = line.slice(0, sp).trim();
      const url = line.slice(sp + 1).trim();
      if (!key || !url.includes('%s')) return null;
      return { key, url };
    })
    .filter(Boolean);

  return {
    theme: selectedTheme,
    compact: els.compact.checked,
    position: els.position.value,
    historyDays: parseInt(els.historyDays.value, 10),
    weatherCity: els.weatherCity.value.trim(),
    rssFeeds: rssFeeds,
    calendarFeeds: calendarFeeds,
    searchEngines: searchEngines,
    aiProvider: els.aiProvider.value,
    aiApiKey: els.aiApiKey.value.trim(),
    aiModel: els.aiModel.value.trim(),
    aiBaseUrl: els.aiBaseUrl.value.trim()
  };
}

/* ========= 加载设置 ========= */
function loadSettings() {
  try {
    chrome.storage.sync.get(STORAGE_KEY, (data) => {
      if (chrome.runtime.lastError) {
        fillForm(Object.assign({}, DEFAULTS));
        return;
      }
      const stored = data && data[STORAGE_KEY];
      fillForm(Object.assign({}, DEFAULTS, stored || {}));
    });
  } catch (e) {
    fillForm(Object.assign({}, DEFAULTS));
  }
}

/* ========= 保存设置 ========= */
let statusTimer = null;

function showSavedStatus() {
  els.saveStatus.classList.add('visible');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    els.saveStatus.classList.remove('visible');
  }, 2000);
}

function saveSettings() {
  const settings = collectForm();
  try {
    chrome.storage.sync.set({ [STORAGE_KEY]: settings }, () => {
      showSavedStatus();
    });
  } catch (e) {
    /* 存储不可用时静默失败 */
  }
}

/* ========= 初始化 ========= */
document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  renderThemeGrid();
  loadSettings();

  els.aiProvider.addEventListener('change', toggleBaseUrlField);
  els.btnSave.addEventListener('click', saveSettings);
});
