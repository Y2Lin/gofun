// tests/unit/extract.js
// 从扩展源文件中提取纯函数/常量，注入到隔离 VM 上下文执行。
// 扩展代码是 IIFE 且依赖 chrome/DOM，无法直接 require；这里用正则提取可独立测试的纯逻辑。
//
// 注意：VM 沙箱中 `const` / `let` 声明不会挂到全局对象上，
// 因此提取出的代码会把 `const` / `let` 替换为 `var`，确保 sandbox 可访问。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 项目根目录（tests/unit/../.. = 项目根）
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * 找到某个顶层声明（function name / const NAME）的字符位置。
 * 支持 function / async function / const / let / var 前缀。
 */
function findDecl(src, name) {
  const re = new RegExp(`(?:async\\s+function|function|const|let|var)\\s+${name}\\b`);
  const m = re.exec(src);
  return m ? m.index : -1;
}

/**
 * 提取从某个声明开始、到匹配右括号结束的函数/常量（按大括号配平）。
 * 支持 function / const / let / var 声明的对象、数组、函数体。
 * @param {string} src 源码
 * @param {number} startPos 声明关键字位置（如 const 或 function 的起始位置）
 */
function extractBalanced(src, startPos) {
  // 找到声明后的第一个 { 或 [
  let braceIdx = src.indexOf('{', startPos);
  let bracketIdx = src.indexOf('[', startPos);
  let openCh, closeCh, i;
  if (braceIdx === -1 && bracketIdx === -1) {
    throw new Error('No opening brace or bracket found');
  }
  if (braceIdx === -1 || (bracketIdx !== -1 && bracketIdx < braceIdx)) {
    openCh = '['; closeCh = ']'; i = bracketIdx;
  } else {
    openCh = '{'; closeCh = '}'; i = braceIdx;
  }
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return src.slice(startPos, i + 1);
    }
  }
  throw new Error('Unbalanced braces/brackets');
}

/**
 * 按名称提取一个声明（常量或函数），自动处理大括号/中括号配平。
 * 提取后把 const/let 替换为 var，确保 VM 沙箱全局可访问。
 */
function extractByName(src, name) {
  const pos = findDecl(src, name);
  if (pos === -1) throw new Error(`Declaration not found: ${name}`);
  let code = extractBalanced(src, pos);
  // 把开头的 const/let 替换为 var，使 VM 沙箱中能通过 sandbox 访问
  code = code.replace(/^(const|let)\s+/, 'var ');
  return code;
}

// ---- background.js 纯逻辑 ----
function loadBackgroundPure() {
  const src = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

  const code = [
    extractByName(src, 'SCORE'),
    extractByName(src, 'SCOPE_PREFIXES'),
    extractByName(src, 'COLON_ALIASES'),
    extractByName(src, 'normalizeColonPrefix'),
    extractByName(src, 'safeHostname'),
    extractByName(src, 'fuzzyMatch'),
    extractByName(src, 'scoreResult'),
    extractByName(src, 'scoreCommand'),
    extractByName(src, 'formatSize'),
    extractByName(src, 'tryOpenUrl'),
    extractByName(src, 'parseQuery'),
  ].join('\n');

  const sandbox = { URL };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// ---- content.js 纯逻辑 ----
function loadContentPure() {
  const src = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

  // 模拟 document（用于 escapeHtml / highlight 等需要创建元素的函数）
  const doc = {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        _text: '',
        _html: '',
        set textContent(v) { this._text = String(v); this._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
        get textContent() { return this._text; },
        set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); },
        get innerHTML() { return this._html; },
        appendChild() {},
        addEventListener() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        dataset: {},
        style: {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        focus() {},
      };
      return el;
    },
  };

  const code = [
    extractByName(src, 'SCOPE_PREFIXES'),
    extractByName(src, 'COLON_ALIASES'),
    extractByName(src, 'CATEGORIES'),
    extractByName(src, 'normalizeColonPrefix'),
    extractByName(src, 'parseScope'),
    extractByName(src, 'stripScopePrefix'),
    extractByName(src, 'getScopeLabel'),
    extractByName(src, 'safeHostname'),
    extractByName(src, 'categoryFromQuery'),
    extractByName(src, 'getGroupLabel'),
    extractByName(src, 'highlight'),
    extractByName(src, 'escapeHtml'),
  ].join('\n');

  const sandbox = { document: doc, URL };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

module.exports = { loadBackgroundPure, loadContentPure, ROOT, findDecl, extractBalanced, extractByName };
