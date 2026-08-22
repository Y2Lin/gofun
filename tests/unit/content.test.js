const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadContentPure } = require('./extract');

const c = loadContentPure();

describe('content.parseScope', () => {
  test('全称前缀', () => {
    assert.equal(c.parseScope('/history'), 'history');
    assert.equal(c.parseScope('/tabs foo'), 'tabs');
  });
  test('缩写前缀', () => {
    assert.equal(c.parseScope('/h'), 'history');
    assert.equal(c.parseScope('/d x'), 'downloads');
    assert.equal(c.parseScope('/cl'), 'closed');
  });
  test('冒号前缀', () => {
    assert.equal(c.parseScope(':b'), 'bookmarks');
    assert.equal(c.parseScope(':c foo'), 'commands');
  });
  test('无 scope 返回 all', () => {
    assert.equal(c.parseScope('hello'), 'all');
    assert.equal(c.parseScope(''), 'all');
  });
  test('未知 / 前缀也视为非 all（由 getScopeLabel 判定命令），但 parseScope 返回 all', () => {
    // parseScope 只识别已知前缀，未知 / 不命中已知 scope
    assert.equal(c.parseScope('/unknown'), 'all');
  });
});

describe('content.stripScopePrefix', () => {
  test('剥离全称前缀', () => {
    assert.equal(c.stripScopePrefix('/history github'), 'github');
    assert.equal(c.stripScopePrefix('/tabs'), '');
  });
  test('剥离缩写前缀', () => {
    assert.equal(c.stripScopePrefix('/h github'), 'github');
    assert.equal(c.stripScopePrefix('/d'), '');
  });
  test('剥离冒号前缀', () => {
    assert.equal(c.stripScopePrefix(':b react'), 'react');
  });
  test('普通查询原样返回', () => {
    assert.equal(c.stripScopePrefix('github'), 'github');
  });
});

describe('content.getScopeLabel', () => {
  test('已知 scope 返回中文标签', () => {
    assert.equal(c.getScopeLabel('/tabs'), '标签页');
    assert.equal(c.getScopeLabel('/h'), '历史记录');
    assert.equal(c.getScopeLabel('/d file'), '下载');
  });
  test('未知 / 前缀返回"命令"', () => {
    assert.equal(c.getScopeLabel('/newtab'), '命令');
  });
  test('无 scope 返回空串', () => {
    assert.equal(c.getScopeLabel('hello'), '');
  });
});

describe('content.categoryFromQuery', () => {
  test('commands scope 映射到 tools 分类', () => {
    assert.equal(c.categoryFromQuery('/commands x'), 'tools');
  });
  test('各 scope 映射到同名分类', () => {
    assert.equal(c.categoryFromQuery('/tabs'), 'tabs');
    assert.equal(c.categoryFromQuery('/b x'), 'bookmarks');
    assert.equal(c.categoryFromQuery('/h x'), 'history');
    assert.equal(c.categoryFromQuery('/d x'), 'downloads');
    assert.equal(c.categoryFromQuery('/cl'), 'closed');
  });
  test('普通查询归为 all', () => {
    assert.equal(c.categoryFromQuery('anything'), 'all');
  });
});

describe('content.escapeHtml', () => {
  test('转义 < > &', () => {
    assert.equal(c.escapeHtml('<a>'), '&lt;a&gt;');
    assert.equal(c.escapeHtml('a&b'), 'a&amp;b');
  });
  test('普通文本不变', () => {
    assert.equal(c.escapeHtml('GitHub'), 'GitHub');
    assert.equal(c.escapeHtml(''), '');
  });
  test('纯文本路径（textContent → innerHTML）不引入额外转义', () => {
    // escapeHtml 用的是 div.textContent = text; return div.innerHTML
    // 浏览器对 textContent 赋值后 innerHTML 只转义 < > &，不转义 " '
    const result = c.escapeHtml('"hello"');
    assert.ok(result.includes('"'), '双引号不应被转义');
  });
});

describe('content.highlight', () => {
  test('无 query 不添加 mark', () => {
    assert.equal(c.highlight('GitHub', ''), 'GitHub');
  });
  test('匹配部分包裹 mark', () => {
    assert.equal(c.highlight('GitHub', 'git'), '<mark class="qp-match">Git</mark>Hub');
  });
  test('大小写不敏感', () => {
    assert.equal(c.highlight('GITHUB', 'git'), '<mark class="qp-match">GIT</mark>HUB');
  });
  test('无匹配返回转义纯文本', () => {
    assert.equal(c.highlight('GitHub', 'xyz'), 'GitHub');
  });
  test('含 HTML 特殊字符的文本能正确转义且高亮（修复点）', () => {
    // 先在原文定位再转义，不能破坏实体
    const out = c.highlight('A & B', '&');
    assert.equal(out, 'A <mark class="qp-match">&amp;</mark> B');
  });
  test('含尖括号的文本不被截断', () => {
    const out = c.highlight('a <b> c', 'b');
    assert.equal(out, 'a &lt;<mark class="qp-match">b</mark>&gt; c');
  });
});

describe('content.getGroupLabel', () => {
  test('各类型返回中文标签', () => {
    assert.equal(c.getGroupLabel('tab'), '标签页');
    assert.equal(c.getGroupLabel('history'), '历史记录');
    assert.equal(c.getGroupLabel('bookmark'), '书签');
    assert.equal(c.getGroupLabel('command'), '命令');
    assert.equal(c.getGroupLabel('closed'), '最近关闭');
    assert.equal(c.getGroupLabel('download'), '下载');
    assert.equal(c.getGroupLabel('openurl'), '打开网址');
    assert.equal(c.getGroupLabel('websearch'), '网页搜索');
  });
  test('未知类型降级为"结果"', () => {
    assert.equal(c.getGroupLabel('unknown'), '结果');
  });
});

describe('content 与 background scope 定义同步', () => {
  test('两边 SCOPE_PREFIXES 数量一致', () => {
    const { loadBackgroundPure } = require('./extract');
    const bg = loadBackgroundPure();
    assert.equal(c.SCOPE_PREFIXES.length, bg.SCOPE_PREFIXES.length);
  });
  test('两边 scope/full/short 完全一致', () => {
    const { loadBackgroundPure } = require('./extract');
    const bg = loadBackgroundPure();
    c.SCOPE_PREFIXES.forEach((p, i) => {
      assert.equal(p.scope, bg.SCOPE_PREFIXES[i].scope);
      assert.equal(p.full, bg.SCOPE_PREFIXES[i].full);
      assert.equal(p.short, bg.SCOPE_PREFIXES[i].short);
    });
  });
  test('两边 COLON_ALIASES 一致', () => {
    const { loadBackgroundPure } = require('./extract');
    const bg = loadBackgroundPure();
    assert.equal(JSON.stringify(c.COLON_ALIASES), JSON.stringify(bg.COLON_ALIASES));
  });
});
