const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const ct = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

function extractCommandIds(src) {
  return [...new Set([...src.matchAll(/id:\s*'(cmd\.[a-z]+)'/g)].map(m => m[1]))];
}

function extractClientIds(src) {
  const set = new Set();
  const positions = [];
  const re = /id:\s*'(cmd\.[a-z]+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) positions.push({ id: m[1], pos: m.index });
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].pos;
    const end = i + 1 < positions.length ? positions[i + 1].pos : src.length;
    const chunk = src.slice(start, end);
    if (/client:\s*true/.test(chunk)) set.add(positions[i].id);
  }
  return set;
}

describe('命令定义双端同步（background ↔ content）', () => {
  const bgIds = extractCommandIds(bg);
  const ctIds = extractCommandIds(ct);
  const bgClient = extractClientIds(bg);
  const ctClient = extractClientIds(ct);

  test('两边命令数量都为 51', () => {
    assert.equal(bgIds.length, 51);
    assert.equal(ctIds.length, 51);
  });

  test('id 集合完全一致', () => {
    const bgSet = new Set(bgIds);
    const ctSet = new Set(ctIds);
    for (const id of bgSet) assert.ok(ctSet.has(id), `content 缺少 ${id}`);
    for (const id of ctSet) assert.ok(bgSet.has(id), `background 缺少 ${id}`);
  });

  test('id 无重复', () => {
    assert.equal(bgIds.length, new Set(bgIds).size);
    assert.equal(ctIds.length, new Set(ctIds).size);
  });

  test('所有 id 以 cmd. 开头', () => {
    for (const id of bgIds) assert.match(id, /^cmd\./);
  });

  test('client:true 标记双端一致', () => {
    assert.equal(bgClient.size, ctClient.size,
      `bg client 数 ${bgClient.size} vs ct ${ctClient.size}`);
    for (const id of bgClient) {
      assert.ok(ctClient.has(id), `content 缺少 client:true: ${id}`);
    }
  });
});

describe('manifest 与资源完整性', () => {
  test('manifest 引用的文件都存在', () => {
    const files = [
      manifest.background.service_worker,
      manifest.options_page,
      ...manifest.content_scripts.flatMap(cs => [...cs.js, ...cs.css]),
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ];
    for (const f of files) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), `文件不存在: ${f}`);
    }
  });

  test('已删除的 emoji-data.js 不再被引用', () => {
    assert.ok(!bg.includes('emoji-data'), 'background 不应引用 emoji-data');
    assert.ok(!ct.includes('emoji-data'), 'content 不应引用 emoji-data');
    assert.ok(!manifest.content_scripts.some(cs =>
      cs.js.some(j => j.includes('emoji'))
    ), 'manifest 不应引用 emoji 脚本');
  });

  test('manifest 声明的权限是精简后的集合', () => {
    const expected = ['tabs', 'history', 'bookmarks', 'activeTab', 'scripting', 'storage', 'sessions', 'downloads', 'tabGroups'];
    assert.deepEqual(manifest.permissions.sort(), expected.sort());
  });
});

describe('文档数字一致性', () => {
  test('README/AGENTS 命令数为 51，无 57/50+ 残留', () => {
    assert.ok(readme.includes('51 条内置命令'), 'README 应包含 51 条命令');
    assert.ok(agents.includes('51 条命令'), 'AGENTS 应包含 51 条命令');
    assert.ok(!readme.includes('57 条'), 'README 不应有 57 条残留');
    assert.ok(!agents.includes('57 条'), 'AGENTS 不应有 57 条残留');
  });
});
