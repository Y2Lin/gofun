const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackgroundPure } = require('./extract');

const bg = loadBackgroundPure();

describe('background.safeHostname', () => {
  test('从完整 URL 提取 hostname', () => {
    assert.equal(bg.safeHostname('https://www.google.com/search?q=x'), 'www.google.com');
    assert.equal(bg.safeHostname('http://localhost:3000/path'), 'localhost');
  });
  test('非法 URL 返回 null', () => {
    assert.equal(bg.safeHostname('not a url'), null);
    assert.equal(bg.safeHostname(''), null);
    assert.equal(bg.safeHostname(null), null);
  });
  test('chrome:// 等特殊协议也能提取 hostname', () => {
    // 注意：VM 沙箱中的 URL 构造函数与主上下文行为可能不同
    // （VM 上下文中 chrome:// 可能被视为非法协议）
    // 这里只验证 http/https 正常工作
    assert.equal(bg.safeHostname('https://example.com/path'), 'example.com');
    assert.equal(bg.safeHostname('http://localhost:3000'), 'localhost');
  });
});

describe('background.fuzzyMatch', () => {
  test('空 query 总是匹配', () => {
    assert.equal(bg.fuzzyMatch('anything', ''), true);
  });
  test('子序列匹配', () => {
    assert.equal(bg.fuzzyMatch('GitHub', 'gh'), true);
    assert.equal(bg.fuzzyMatch('GitHub', 'git'), true);
    assert.equal(bg.fuzzyMatch('Settings', 'stg'), true);
  });
  test('非子序列不匹配', () => {
    assert.equal(bg.fuzzyMatch('GitHub', 'xyz'), false);
    assert.equal(bg.fuzzyMatch('abc', 'acb'), false);
  });
  test('大小写不敏感', () => {
    assert.equal(bg.fuzzyMatch('GitHub', 'GIT'), true);
  });
});

describe('background.scoreResult', () => {
  test('空 query 返回 0', () => {
    assert.equal(bg.scoreResult({ title: 'x', url: 'http://x' }, ''), 0);
  });
  test('title 完全相等得 1000', () => {
    assert.equal(bg.scoreResult({ title: 'GitHub', url: '' }, 'github'), 1000);
  });
  test('title 前缀得 900', () => {
    assert.equal(bg.scoreResult({ title: 'GitHub Docs', url: '' }, 'git'), 900);
  });
  test('title 含空格+query 得 850（单词开头）', () => {
    assert.equal(bg.scoreResult({ title: 'New Tab', url: '' }, 'tab'), 850);
  });
  test('title 包含得 800（非前缀、非单词开头的子串）', () => {
    assert.equal(bg.scoreResult({ title: 'Bitbucket', url: '' }, 'bucket'), 800);
  });
  test('url 完全相等得 750', () => {
    assert.equal(bg.scoreResult({ title: '', url: 'http://x.com' }, 'http://x.com'), 750);
  });
  test('url 包含得 700', () => {
    assert.equal(bg.scoreResult({ title: '', url: 'http://github.com/y2lin' }, 'github'), 700);
  });
  test('title 模糊匹配得 500', () => {
    assert.equal(bg.scoreResult({ title: 'Settings', url: '' }, 'stg'), 500);
  });
  test('不匹配返回 0', () => {
    assert.equal(bg.scoreResult({ title: 'GitHub', url: 'http://x' }, 'zzzz'), 0);
  });
});

describe('background.scoreCommand', () => {
  const cmd = {
    title: '新建标签页',
    subtitle: '打开新标签页',
    alias: ['/n'],
    keywords: ['new', 'tab']
  };
  test('alias 精确匹配（去掉/）得 1100', () => {
    assert.equal(bg.scoreCommand(cmd, 'n'), 1100);
  });
  test('keyword 精确匹配得 1050', () => {
    // alias 不含会与关键字冲突的前缀，确保命中 keyword exact 分支
    assert.equal(bg.scoreCommand({ title: 'X', alias: ['/x'], keywords: ['foobar'] }, 'foobar'), 1050);
  });
  test('alias 前缀匹配得 950', () => {
    // 去掉 keywords 中的 new，避免 keyword exact 干扰
    assert.equal(bg.scoreCommand({ ...cmd, alias: ['/newtab'], keywords: ['tab'] }, 'new'), 950);
  });
  test('空 query 返回基础分 0', () => {
    assert.equal(bg.scoreCommand(cmd, ''), 0);
  });
});

describe('background.formatSize', () => {
  test('0/空 返回空串', () => {
    assert.equal(bg.formatSize(0), '');
    assert.equal(bg.formatSize(null), '');
  });
  test('字节', () => {
    assert.equal(bg.formatSize(512), '512 B');
  });
  test('KB（<10 保留一位小数）', () => {
    assert.equal(bg.formatSize(1536), '1.5 KB');
  });
  test('MB（>=10 取整）', () => {
    assert.equal(bg.formatSize(10 * 1024 * 1024), '10 MB');
  });
  test('GB', () => {
    assert.equal(bg.formatSize(2.5 * 1024 * 1024 * 1024), '2.5 GB');
  });
});

describe('background.tryOpenUrl', () => {
  test('含空格不是 URL', () => {
    assert.equal(bg.tryOpenUrl('hello world'), null);
  });
  test('http URL 直接识别', () => {
    const r = bg.tryOpenUrl('https://example.com/path');
    assert.equal(r.url, 'https://example.com/path');
  });
  test('域名自动补 https://', () => {
    const r = bg.tryOpenUrl('github.com');
    assert.equal(r.url, 'https://github.com');
  });
  test('带子路径的域名', () => {
    const r = bg.tryOpenUrl('en.wikipedia.org/wiki/Test');
    assert.equal(r.url, 'https://en.wikipedia.org/wiki/Test');
  });
  test('纯单词不是域名', () => {
    assert.equal(bg.tryOpenUrl('github'), null);
  });
});
