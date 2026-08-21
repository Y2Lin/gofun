// tests/e2e/helpers.js
// E2E 测试辅助：启动带扩展的 Chromium、注入 content script（含 mock chrome API）、打开面板。
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..').replace(/\\/g, '/');
const PROFILE_DIR = path.join(ROOT, '.test-profile');

async function launchExtension() {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  const browsersPath = path.join(ROOT, '.ms-playwright');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--enable-extensions',
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
    ],
    viewport: { width: 1280, height: 800 },
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
  });
  return context;
}

// 等待扩展 Service Worker 出现，并返回扩展 ID
async function waitForExtensionId(context, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const workers = context.serviceWorkers();
    for (const w of workers) {
      const m = w.url().match(/chrome-extension:\/\/([^/]+)/);
      if (m) return m[1];
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Service worker / extension id not ready within timeout');
}

// 在页面中注入 mock chrome API + palette.css + content.js
// 注意：Playwright/Chromium 在自动化模式下不会自动注入 content script，因此测试主动注入。
async function injectContentScript(page, extId) {
  await page.addScriptTag({
    content: `
      (function() {
        if (window.__GOFUN_MOCK_READY__) return;
        window.__GOFUN_MOCK_READY__ = true;

        function mockSearch(query) {
          const q = (query || '').toLowerCase();
          if (q.includes('zzzznotexistzzzz')) return [];
          if (q === '/n') {
            return [{ type: 'command', id: 'cmd.newtab', title: '新建标签页', subtitle: '打开一个新标签页', icon: 'plus', alias: ['/n'], browserKbd: 'Ctrl T' }];
          }
          if (q.startsWith('/opt') || q.startsWith(':opt')) {
            return [{ type: 'command', id: 'cmd.options', title: '打开 GoFun 设置', subtitle: '管理主题、快捷键与行为', icon: 'settings', alias: ['/opt'] }];
          }
          if (q.startsWith('/h') || q.startsWith(':h')) {
            return [{ type: 'history', id: 'history-1', title: 'Example History', url: 'https://example.com', lastVisitTime: Date.now(), icon: 'clock' }];
          }
          if (q.startsWith('/b') || q.startsWith(':b')) {
            return [{ type: 'bookmark', id: 'bookmark-1', title: 'Example Bookmark', url: 'https://example.com', icon: 'bookmark' }];
          }
          if (q.startsWith('/d') || q.startsWith(':d')) {
            return [{ type: 'download', id: 'download-1', downloadId: 1, title: 'Example Download', url: 'https://example.com/file.zip', icon: 'download' }];
          }
          return [
            { type: 'command', id: 'cmd.newtab', title: '新建标签页', subtitle: '打开一个新标签页', icon: 'plus', alias: ['/n'], browserKbd: 'Ctrl T' },
            { type: 'command', id: 'cmd.options', title: '打开 GoFun 设置', subtitle: '管理主题、快捷键与行为', icon: 'settings', alias: ['/opt'] }
          ];
        }
        window.__GOFUN_MOCK_SEARCH__ = mockSearch;

        window.chrome = window.chrome || {};
        window.chrome.runtime = {
          sendMessage: function(msg, callback) {
            setTimeout(function() {
              try {
                if (msg.type === 'PING') {
                  if (callback) callback({ pong: true });
                } else if (msg.type === 'SEARCH') {
                  if (callback) callback({ results: mockSearch(msg.query) });
                } else if (msg.type === 'GET_TAB_CACHE') {
                  if (callback) callback({ tabs: [] });
                } else if (msg.type === 'EXECUTE') {
                  if (msg.item && msg.item.id) {
                    window.__GOFUN_LAST_EXECUTED_ID__ = msg.item.id;
                  }
                  // 在 mock 环境下无法从普通页面打开 chrome-extension URL，
                  // 因此通过 about:blank 模拟“打开新标签页”行为，供测试验证。
                  if (msg.item && msg.item.id === 'cmd.options') {
                    window.open('about:blank?options=true', '_blank');
                  }
                  if (callback) callback({ success: true });
                } else {
                  if (callback) callback({});
                }
              } catch (e) {
                console.error('mock chrome error:', e);
                if (callback) callback({});
              }
            }, 30);
          },
          onMessage: { addListener: function() {} },
          get lastError() { return undefined; }
        };
        window.chrome.storage = {
          sync: {
            get: function(k, cb) { if (cb) setTimeout(function() { cb({}); }, 0); },
            set: function(v, cb) { if (cb) setTimeout(function() { cb(); }, 0); },
            onChanged: { addListener: function() {} }
          },
          local: {
            get: function(k, cb) { if (cb) setTimeout(function() { cb({}); }, 0); },
            set: function(v, cb) { if (cb) setTimeout(function() { cb(); }, 0); },
            onChanged: { addListener: function() {} }
          }
        };
      })();
    `
  });
  await page.addStyleTag({ path: path.join(ROOT, 'palette.css') });
  await page.addScriptTag({ path: path.join(ROOT, 'content.js') });
  // 等待 content.js 初始化完成
  await page.waitForFunction(() => !!window.__GOFUN_INJECTED__, { timeout: 5000 });
}

// 在页面上打开/关闭面板
async function openPalette(page) {
  await page.locator('#quick-palette-overlay').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
  await page.evaluate(() => window.__GOFUN_TEST__.openPalette());
  await page.locator('#quick-palette-overlay.qp-visible').waitFor({ timeout: 5000 });
}

async function closePalette(page) {
  await page.evaluate(() => window.__GOFUN_TEST__.closePalette());
  await page.locator('#quick-palette-overlay').waitFor({ state: 'detached', timeout: 3000 });
}

async function togglePalette(page) {
  const visible = await page.evaluate(() => window.__GOFUN_TEST__.isVisible());
  if (visible) await closePalette(page); else await openPalette(page);
}

// 读取面板当前结果项（标题文本数组）
async function getResultTitles(page) {
  return page.locator('.qp-item .qp-title-text').allTextContents();
}

async function getActiveCategory(page) {
  return page.locator('.qp-tab.qp-active').textContent();
}

module.exports = {
  ROOT,
  PROFILE_DIR,
  launchExtension,
  waitForExtensionId,
  injectContentScript,
  openPalette,
  closePalette,
  togglePalette,
  getResultTitles,
  getActiveCategory,
};
