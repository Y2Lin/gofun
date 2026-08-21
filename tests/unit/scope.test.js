const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackgroundPure, loadContentPure } = require('./extract');

const bg = loadBackgroundPure();
const ct = loadContentPure();

// VM 沙箱产出的对象原型与主上下文不同，deepStrictEqual 会失败；用 JSON 比较内容
function eqObj(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe('background.normalizeColonPrefix', () => {
  test('非冒号开头原样返回', () => {
    assert.equal(bg.normalizeColonPrefix('hello'), 'hello');
  });
  test(':t 归一化为 /tabs', () => {
    assert.equal(bg.normalizeColonPrefix(':t'), '/tabs');
    assert.equal(bg.normalizeColonPrefix(':t github'), '/tabs github');
  });
  test('完整冒号别名', () => {
    assert.equal(bg.normalizeColonPrefix(':tabs'), '/tabs');
    assert.equal(bg.normalizeColonPrefix(':b'), '/bookmarks');
    assert.equal(bg.normalizeColonPrefix(':h'), '/history');
    assert.equal(bg.normalizeColonPrefix(':cl'), '/closed');
    assert.equal(bg.normalizeColonPrefix(':d'), '/downloads');
  });
  test('未知冒号前缀原样返回', () => {
    assert.equal(bg.normalizeColonPrefix(':xyz'), ':xyz');
  });
  test('大小写不敏感', () => {
    assert.equal(bg.normalizeColonPrefix(':T'), '/tabs');
    assert.equal(bg.normalizeColonPrefix(':B foo'), '/bookmarks foo');
  });
});

describe('background.parseQuery', () => {
  test('全称前缀 + 关键字', () => {
    eqObj(bg.parseQuery('/tabs github'), { scope: 'tabs', query: 'github' });
  });
  test('缩写前缀 + 关键字', () => {
    eqObj(bg.parseQuery('/t github'), { scope: 'tabs', query: 'github' });
  });
  test('仅前缀（无关键字）', () => {
    eqObj(bg.parseQuery('/history'), { scope: 'history', query: '' });
  });
  test('冒号前缀', () => {
    eqObj(bg.parseQuery(':b chrome'), { scope: 'bookmarks', query: 'chrome' });
  });
  test('普通搜索归为 all', () => {
    eqObj(bg.parseQuery('hello world'), { scope: 'all', query: 'hello world' });
  });
  test('斜杠开头但非已知 scope 归为命令搜索', () => {
    eqObj(bg.parseQuery('/n'), { scope: 'commands', query: 'n' });
  });
  test('长前缀优先于短前缀（/tabs 不被 /t 抢先）', () => {
    eqObj(bg.parseQuery('/tabs foo'), { scope: 'tabs', query: 'foo' });
  });
  test('前后空格被 trim', () => {
    eqObj(bg.parseQuery('  /t  foo  '), { scope: 'tabs', query: 'foo' });
  });
});

describe('background SCOPE_PREFIXES / COLON_ALIASES 一致性', () => {
  test('6 个 scope 都有全称', () => {
    const scopes = bg.SCOPE_PREFIXES.map(p => p.scope);
    assert.equal(JSON.stringify(scopes),
      JSON.stringify(['tabs', 'history', 'bookmarks', 'commands', 'closed', 'downloads']));
  });
  test('所有 short 前缀非空且以 / 开头', () => {
    for (const p of bg.SCOPE_PREFIXES) {
      assert.ok(p.short && p.short.startsWith('/'), `${p.scope} short 异常: ${p.short}`);
      assert.ok(p.full.startsWith('/'));
    }
  });
  test('COLON_ALIASES 每个值都对应一个 SCOPE full', () => {
    const fulls = new Set(bg.SCOPE_PREFIXES.map(p => p.full));
    for (const target of Object.values(bg.COLON_ALIASES)) {
      assert.ok(fulls.has(target), `冒号别名指向未知 scope: ${target}`);
    }
  });
  test('双端 SCOPE_PREFIXES 核心字段一致（content 多 label 字段，bg 无）', () => {
    const bgCore = bg.SCOPE_PREFIXES.map(p => ({ scope: p.scope, full: p.full, short: p.short }));
    const ctCore = ct.SCOPE_PREFIXES.map(p => ({ scope: p.scope, full: p.full, short: p.short }));
    assert.equal(JSON.stringify(bgCore), JSON.stringify(ctCore));
  });
  test('content SCOPE_PREFIXES 每项都有 label 字段', () => {
    for (const p of ct.SCOPE_PREFIXES) {
      assert.ok(typeof p.label === 'string' && p.label.length > 0,
        `${p.scope} 缺少 label`);
    }
  });
  test('双端 COLON_ALIASES 内容完全一致', () => {
    assert.equal(JSON.stringify(bg.COLON_ALIASES), JSON.stringify(ct.COLON_ALIASES));
  });
});
