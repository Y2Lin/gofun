const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  launchExtension, waitForExtensionId,
  injectContentScript, openPalette, closePalette, togglePalette,
  getResultTitles, getActiveCategory,
} = require('./helpers');

let context;
let page;
let server;
let serverUrl;
let extId;

test.beforeAll(async () => {
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const p = path.join(__dirname, 'fixture.html');
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      serverUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  context = await launchExtension();
  extId = await waitForExtensionId(context);
});

test.afterAll(async () => {
  await context.close();
  server.close();
});

test.beforeEach(async () => {
  page = await context.newPage();
  await page.goto(`${serverUrl}/fixture.html`, { waitUntil: 'domcontentloaded' });
  await injectContentScript(page, extId);
});

test.afterEach(async () => {
  await page.close();
});

// ─── 面板基础 ───
test.describe('面板基础', () => {
  test('打开面板，Esc 关闭', async () => {
    await openPalette(page);
    await expect(page.locator('#quick-palette-container')).toBeVisible();
    await expect(page.locator('#quick-palette-input')).toBeFocused();
    await closePalette(page);
    await expect(page.locator('#quick-palette-container')).toHaveCount(0);
  });

  test('面板包含输入框、7 个分类、结果区、footer', async () => {
    await openPalette(page);
    await expect(page.locator('#quick-palette-input')).toBeVisible();
    await expect(page.locator('.qp-tab')).toHaveCount(7);
    await expect(page.locator('#quick-palette-footer')).toBeVisible();
    await expect(page.locator('#quick-palette-results')).toBeVisible();
  });

  test('toggle 切换关闭面板', async () => {
    await openPalette(page);
    await togglePalette(page);
    await expect(page.locator('#quick-palette-container')).toHaveCount(0);
  });

  test('空查询首屏渲染命令结果', async () => {
    await openPalette(page);
    await page.waitForTimeout(300);
    const items = page.locator('.qp-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('分类 Tab 顺序正确：All → Tabs → Bookmarks → History → Downloads → Recently Closed → Tools', async () => {
    await openPalette(page);
    const tabs = await page.locator('.qp-tab').allTextContents();
    expect(tabs).toEqual(['All', 'Tabs', 'Bookmarks', 'History', 'Downloads', 'Recently Closed', 'Tools']);
  });
});

// ─── 搜索 ───
test.describe('搜索', () => {
  test('输入关键字触发搜索，结果渲染', async () => {
    await openPalette(page);
    await page.keyboard.type('tab');
    await page.locator('.qp-item').first().waitFor({ timeout: 5000 });
    const titles = await getResultTitles(page);
    expect(titles.length).toBeGreaterThan(0);
  });

  test('无匹配结果显示空状态', async () => {
    await openPalette(page);
    await page.keyboard.type('zzzznotexistzzzz');
    await page.waitForTimeout(800);
    await expect(page.locator('#quick-palette-empty')).toBeVisible();
    await expect(page.locator('#quick-palette-empty')).toContainText('未找到结果');
  });

  test('命令缩写 /n 精确匹配"新建标签页"', async () => {
    await openPalette(page);
    await page.keyboard.type('/n');
    await page.waitForTimeout(500);
    const titles = await getResultTitles(page);
    expect(titles[0]).toContain('新建标签页');
  });

  test('匹配文本有高亮标记', async () => {
    await openPalette(page);
    await page.keyboard.type('新建');
    await page.locator('.qp-item').first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(200);
    const highlights = await page.locator('mark.qp-match').count();
    expect(highlights).toBeGreaterThan(0);
  });

  test('输入框内容与搜索词同步', async () => {
    await openPalette(page);
    await page.keyboard.type('hello');
    await expect(page.locator('#quick-palette-input')).toHaveValue('hello');
  });
});

// ─── 范围前缀 ───
test.describe('范围前缀', () => {
  test('/h 切换到历史分类', async () => {
    await openPalette(page);
    await page.keyboard.type('/h');
    await page.waitForTimeout(500);
    expect(await getActiveCategory(page)).toBe('History');
    await expect(page.locator('#quick-palette-scope')).toBeVisible();
  });

  test('冒号前缀 :b 等价于 /b（书签）', async () => {
    await openPalette(page);
    await page.keyboard.type(':b');
    await page.waitForTimeout(500);
    expect(await getActiveCategory(page)).toBe('Bookmarks');
  });

  test('/d 显示下载分类', async () => {
    await openPalette(page);
    await page.keyboard.type('/d');
    await page.waitForTimeout(500);
    expect(await getActiveCategory(page)).toBe('Downloads');
  });

  test('点击分类 Tab 切换作用域', async () => {
    await openPalette(page);
    await page.locator('.qp-tab').nth(1).click(); // Tabs
    await page.waitForTimeout(300);
    expect(await getActiveCategory(page)).toBe('Tabs');
    const inputVal = await page.locator('#quick-palette-input').inputValue();
    expect(inputVal).toContain('/tabs');
  });

  test('全称前缀 /tabs 也能切换分类', async () => {
    await openPalette(page);
    await page.keyboard.type('/tabs');
    await page.waitForTimeout(500);
    expect(await getActiveCategory(page)).toBe('Tabs');
  });
});

// ─── 键盘导航 ───
test.describe('键盘导航', () => {
  test('ArrowDown/ArrowUp 移动选中态', async () => {
    await openPalette(page);
    await page.keyboard.type('tab');
    await page.locator('.qp-item').first().waitFor({ timeout: 5000 });
    const first = page.locator('.qp-item').first();
    await expect(first).toHaveClass(/qp-selected/);
    await page.keyboard.press('ArrowDown');
    await expect(first).not.toHaveClass(/qp-selected/);
    await expect(page.locator('.qp-item').nth(1)).toHaveClass(/qp-selected/);
    await page.keyboard.press('ArrowUp');
    await expect(first).toHaveClass(/qp-selected/);
  });

  test('Tab 键在分类间循环切换', async () => {
    await openPalette(page);
    const initial = await getActiveCategory(page);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const after = await getActiveCategory(page);
    expect(after).not.toBe(initial);
  });

  test('Shift+Tab 反向切换分类', async () => {
    await openPalette(page);
    const initial = await getActiveCategory(page);
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(300);
    const after = await getActiveCategory(page);
    expect(after).not.toBe(initial);
  });
});

// ─── 执行 ───
test.describe('执行', () => {
  test('Enter 执行"打开设置"命令，触发执行并打开新标签页', async () => {
    await openPalette(page);
    await page.keyboard.type('/opt');
    await page.waitForTimeout(600);
    const titles = await getResultTitles(page);
    expect(titles[0]).toContain('设置');
    const newPagePromise = context.waitForEvent('page', { timeout: 5000 });
    await page.keyboard.press('Enter');
    const newPage = await newPagePromise;
    await newPage.waitForLoadState('domcontentloaded');
    const executedId = await page.evaluate(() => window.__GOFUN_LAST_EXECUTED_ID__);
    expect(executedId).toBe('cmd.options');
    expect(newPage.url()).toContain('options=true');
    await newPage.close();
  });

  test('扩展 options.html 页面可直接加载', async () => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'domcontentloaded' });
    await expect(optionsPage.locator('body')).toBeVisible();
    await optionsPage.close();
  });

  test('执行命令后面板关闭', async () => {
    await openPalette(page);
    await page.keyboard.type('/opt');
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator('#quick-palette-overlay')).toHaveCount(0);
  });
});
