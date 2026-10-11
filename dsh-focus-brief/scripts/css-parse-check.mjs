/**
 * 一次性验证：拿一个真的 CSS 解析器（css-tree）解析插件自己注入的那段样式。
 * 前面的检查都是正则匹配，只有这一步是真的按 CSS 语法解析 —— 能抓出括号不配平、
 * at-rule 写错、声明值不合法这类正则看不出来的问题。
 */
import fs from 'node:fs';
import { CSS_PARSER_DIR as parserDir } from './_paths.mjs';

/** css-tree 的 dist 是 `var csstree=(()=>{…})()` 形式的普通脚本，要在函数体末尾把它 return 出来。 */
function loadScript(file) {
  const code = fs.readFileSync(file, 'utf8');
  return new Function(`${code}\n;return csstree;`)();
}

const csstree = loadScript(`${parserDir}csstree.js`);
console.log('css-tree 版本:', csstree.version ?? '（未导出）');
console.log('可用能力:', ['parse', 'walk', 'lexer', 'generate'].filter((key) => csstree[key] !== undefined).join(', '));

// ---------- 取插件真正注入的 CSS ----------
let injected = null;
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
  head: { appendChild: (tag) => (injected = tag.textContent) },
};
const fakeReact = { createElement: () => null, useState: (initial) => [initial, () => {}] };
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (module) => (loaded = module) } };
await import(new URL('../client.js', import.meta.url).href);
const plugin = loaded.factory((name) => (name === 'react' ? fakeReact : (() => { throw new Error(name); })()));
plugin.apply({
  effect: (fn) => fn(),
  slots: { inject: (key, cb) => cb(), register: () => () => {} },
  locale: { register: () => () => {}, bind: () => (key) => key },
});

const problems = [];
if (typeof injected !== 'string' || injected.length === 0) problems.push('没捕获到注入的 CSS');
const css = injected ?? '';
console.log(`\nCSS 长度 ${css.length} 字符`);

// ---------- 真解析 ----------
let ast = null;
try {
  ast = csstree.parse(css, { positions: true });
  console.log('✅ 严格模式解析通过');
} catch (error) {
  problems.push(`解析失败：${error.message}`);
  console.log(`❌ 解析失败：${error.message}`);
}

if (ast !== null) {
  const stats = { rule: 0, atrule: 0, declaration: 0 };
  const atRules = [];
  const selectors = new Set();
  csstree.walk(ast, {
    visit: 'Rule',
    enter(node) {
      stats.rule++;
      selectors.add(csstree.generate(node.prelude));
    },
  });
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(node) {
      stats.atrule++;
      atRules.push(`@${node.name} ${csstree.generate(node.prelude)}`);
    },
  });
  csstree.walk(ast, {
    visit: 'Declaration',
    enter() {
      stats.declaration++;
    },
  });
  console.log(`解析结果：规则 ${stats.rule} 条｜at-rule ${stats.atrule} 条｜声明 ${stats.declaration} 条`);
  console.log('at-rule：');
  for (const atRule of atRules) console.log('  ' + atRule);
  console.log(`选择器 ${selectors.size} 个：${[...selectors].join(' ')}`);

  // 括号配平（解析器已经保证，这里再确认一次没被截断）
  const open = (css.match(/\{/g) ?? []).length;
  const close = (css.match(/\}/g) ?? []).length;
  if (open !== close) problems.push(`花括号不配平：{ ×${open} vs } ×${close}`);
}

// ---------- 用 lexer 校验不含 var()/color-mix 的声明值 ----------
// 系统色关键字（Canvas / CanvasText 等）css-tree 2.3 的语法数据没有收录，但它们是
// CSS Color 4 定义的合法 <color>，且 DSH 自己的 forced-colors 样式就在用，所以豁免。
const SYSTEM_COLORS = [
  'Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ActiveText', 'ButtonFace', 'ButtonText',
  'ButtonBorder', 'Field', 'FieldText', 'Highlight', 'HighlightText', 'SelectedItem',
  'SelectedItemText', 'Mark', 'MarkText', 'GrayText', 'AccentColor', 'AccentColorText',
];
if (ast !== null && csstree.lexer !== undefined) {
  let checked = 0;
  let skipped = 0;
  let exempt = 0;
  csstree.walk(ast, {
    visit: 'Declaration',
    enter(node) {
      const property = node.property;
      const value = csstree.generate(node.value);
      if (value.includes('var(') || value.includes('color-mix(')) {
        skipped++;
        return;
      }
      if (SYSTEM_COLORS.some((name) => new RegExp(`\\b${name}\\b`).test(value))) {
        exempt++;
        return;
      }
      const match = csstree.lexer.matchProperty(property, node.value);
      checked++;
      if (match.error !== null && match.error !== undefined) {
        problems.push(`值不合法：${property}: ${value} —— ${match.error.message.split('\n')[0]}`);
      }
    },
  });
  console.log(`\nlexer 校验：检查 ${checked} 条｜跳过（含 var()/color-mix()）${skipped} 条｜豁免系统色 ${exempt} 条`);
} else {
  console.log('\n（这个构建没带 lexer，跳过取值合法性校验）');
}

console.log(`\n问题 ${problems.length} 项`);
for (const problem of problems) console.log('  ❌ ' + problem);
console.log(problems.length === 0 ? '\n真解析全部通过' : '\n真解析有失败');
process.exit(problems.length === 0 ? 0 : 1);