/**
 * 一次性静态检查：卡片样式。
 * 1. 用 stub 的 document 捕获插件真正注入的那段 CSS —— 顺便把"样式注入"这条代码路径也跑通。
 * 2. 校验用到的每个主题 token 都真实存在（拼错会静默变成无颜色）。
 * 3. 校验每个用了 color-mix 的属性，都有一条更早的不含 color-mix 的兜底声明。
 * 4. 校验毛玻璃的几件要素都在，以及高对比模式有退回。
 */
import fs from 'node:fs';

/** 来自 cordis_inspect_query(client Theme.listTokens) 的权威名单。 */
const TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]);

// ---------- 1. 捕获注入的 CSS ----------
let injected = null;
let removed = false;
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove: () => (removed = true) }),
  head: { appendChild: (tag) => (injected = tag.textContent) },
};

const fakeReact = { createElement: () => null, useState: (initial) => [initial, () => {}] };
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (module) => (loaded = module) } };
await import(new URL('../client.js', import.meta.url).href);

let component = null;
const plugin = loaded.factory((name) => {
  if (name === 'react') return fakeReact;
  throw new Error(`不应 require ${name}`);
});
plugin.apply({
  effect: (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') dispose();
  },
  slots: { inject: (key, cb) => cb(), register: (options, comp) => ((component = comp), () => {}) },
  locale: { register: () => () => {}, bind: () => (key) => key },
});

const problems = [];
if (typeof injected !== 'string' || injected.length === 0) problems.push('样式没有被注入（document stub 没收到 <style>）');
if (!removed) problems.push('卸载清理没跑（<style> 标签没被移除）');
const css = injected ?? '';

// ---------- 2. token 是否存在 ----------
// 公开清单（cordis_inspect_query Theme.listTokens）之外的 token 只在带 var() 兜底时才允许使用：
// token 万一改名，样式会退化到兜底色，而不是变成透明/无颜色。
const usages = [...css.matchAll(/var\((--dsw-(?:alias|specific)-[a-z0-9-]+)(\s*,[^)]*)?\)/g)];
const used = new Set(usages.map((match) => match[1]));
const unknown = [];
const guarded = [];
for (const match of usages) {
  if (TOKENS.has(match[1])) continue;
  if (match[2] === undefined) unknown.push(match[1]);
  else if (!guarded.includes(match[1])) guarded.push(match[1]);
}
console.log(`用到 token ${used.size} 个：${[...used].sort().join(' ')}`);
if (guarded.length > 0) console.log(`清单外但带兜底的 token ${guarded.length} 个：${guarded.join(' ')}`);
if (unknown.length > 0) problems.push(`用了不存在、又没给兜底的 token：${[...new Set(unknown)].join(', ')}`);

// ---------- 3. color-mix 必须有兜底 ----------
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
const seen = new Set();
for (const { selector, body } of rules) {
  // 分组选择器要拆开看：只要其中一个成员此前有过兜底，整个分组里那个成员的 color-mix 就是安全的。
  const keys = selector.split(',').map((part) => part.trim()).filter((part) => part !== '');
  for (const declaration of body.split(';')) {
    const at = declaration.indexOf(':');
    if (at < 0) continue;
    let property = declaration.slice(0, at).trim();
    const value = declaration.slice(at + 1).trim();
    if (property === '' || value === '') continue;
    // 简写与其长写按同一个属性看待。
    if (property === 'border-color') property = 'border';
    const sideColor = /^border-(top|right|bottom|left)-color$/.exec(property);
    if (sideColor !== null) property = `border-${sideColor[1]}`;
    const missing = keys.filter((key) => !seen.has(`${key}|${property}`));
    if (value.includes('color-mix(')) {
      for (const key of missing) problems.push(`${key} 的 ${property} 用了 color-mix，却没有更早的兜底声明`);
    } else {
      for (const key of keys) seen.add(`${key}|${property}`);
    }
    // 固化踩过的坑：warn 色在浅色主题下当文字只有 2.15:1，只能用于装饰（圆点、CSS 生成的记号）。
    if (property === 'color' && value.includes('var(--dsw-alias-state-warn-primary)') && !selector.includes(':before')) {
      problems.push(`${selector} 把 warn 色当文字色用了 —— 浅色主题下实测只有 2.15:1，不可读`);
    }
  }
}
console.log(`解析到 ${rules.length} 条规则`);

// ---------- 4b. 滚轮不许被自己吞掉 ----------
{
  // 这条抖的是**整份样式**，不只根节点：踩过的坑是 overscroll-behavior:contain 把滚轮吞掉、
  // 又不许链式传给外壳，用户于是「专注界面滚轮没法用」。凡是自己造滚动容器的地方都要留链式。
  const contain = [...css.matchAll(/([^{}]+)\{([^{}]*overscroll-behavior[^;}]*contain[^{}]*)\}/g)];
  for (const match of contain) {
    problems.push(`${match[1].trim()} 用了 overscroll-behavior:contain —— 会吞掉滚轮并挡住链式滚动（真被用户报过）`);
  }
  let scrollables = 0;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*overflow-y:auto[^{}]*)\}/g)) {
    scrollables++;
    if (!/overscroll-behavior:\s*auto/.test(match[2])) {
      problems.push(`${match[1].trim()} 是滚动容器，但没写明 overscroll-behavior:auto（默认就是 auto，写明是为了不再踩 contain 的坑）`);
    }
  }
  console.log(`自己造的滚动容器 ${scrollables} 个，全部显式 overscroll-behavior:auto`);
  const rootRule = /\.dfv-root\{([^}]*)\}/.exec(css);
  if (rootRule === null) problems.push('找不到 .dfv-root 规则');
  else if (/height\s*:\s*100%/.test(rootRule[1])) {
    problems.push('.dfv-root 用了 height:100% —— 在外壳那个 flex 滚动容器里解不出确定高度，会变成滚不动的空滚动容器');
  }
}

// ---------- 5. 要素与退回 ----------
const must = [
  // v1（普通对话视图里那张小卡）
  ['v1 半透明底（从 token 派生并掺了 label 色）', /background-color:color-mix\(in srgb,color-mix\(in srgb,var\(--dsw-alias-bg-layer-1\)/],
  ['v1 顶部渐隐光泽', /background-image:linear-gradient\(color-mix\(in srgb,var\(--dsw-alias-label-primary\)/],
  ['v1 背景模糊', /backdrop-filter:blur\(20px\) saturate\(180%\)/],
  ['v1 顶部内高光', /inset 0 1px 0 color-mix\(/],
  // v2（专注视图）
  ['v2 实底卡面用主题面色', /\.dfv-card\{[^}]*background-color:var\(--dsw-alias-bg-layer-1\)/],
  ['v2 发丝边直接用 token 自带的 alpha', /\.dfv-card\{[^}]*border:1px solid var\(--dsw-alias-border-l2\)/],
  ['v2 柔和投影（设计稿那两层）', /\.dfv-card\{[^}]*box-shadow:0 1px 2px rgba\(0,0,0,\.04\),0 4px 14px rgba\(0,0,0,\.06\)/],
  ['v2 叠压用负边距', /margin-bottom:-6px/],
  ['v2 叠压有层级', /\.dfv-blocks\[data-open="false"\] \.dfv-block:nth-child\(6\)|nth-child\(n\+6\)/],
  ['v2 展开是纵向手风琴（不叠）', /\.dfv-blocks\[data-open="true"\] \.dfv-block\{[^}]*margin-bottom:8px/],
  ['v2 状态点分色', /\.dfv-dot\[data-state="wait"\]\{background-color:var\(--dsw-alias-state-warn-primary\)\}/],
  ['v2 卡片圆角 16px（设计稿）', /\.dfv-card\{[^}]*border-radius:16px/],
  ['v2 键盘焦点可见', /\.dfv-row:focus-visible\{outline:2px solid/],
  ['v2 根容器自带滚动', /\.dfv-root\{[^}]*overflow-y:auto/],
  // 滚轮失效那个真坑：外壳把视图放进一个「自己就是滚动容器」的 flex 纵向容器里，
  // 视图若用 height:100% 就会变成「没有可滚内容却仍是滚动容器」的元素，
  // 再配 overscroll-behavior:contain 就会把滚轮吞掉、还不许链式传给外壳 —— 整个界面滚不动。
  ['v2 根容器不用 height:100%（改为 flex 子项写法）', /\.dfv-root\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*height:auto/],
  // 这两条是一套：外壳在「有 composer overlay」的配置下会把包装层改成 flex:1 1 0 + min-height:0 + overflow:hidden，
  // 那时必须由视图自己滚；而在活跃期由外壳滚。两半都在，才两种配置都对。
  ['v2 根容器保留自己滚的能力（overlay 配置下包装层会裁切）', /\.dfv-root\{[^}]*overflow-y:auto/],
  ['v2 根容器保留链式滚动（overscroll-behavior:auto）', /\.dfv-root\{[^}]*overscroll-behavior:auto/],
  // 回答气泡照官方对话那条气泡的样子：用官方自己的 `--dsw-specific-bubble`（浅蓝底）+ label-primary（黑字）。
  // 这个 token 不在官方清单里，所以必须带兜底色（下面 token 存在性那一段也会再查一次）。
  ['回答气泡用官方气泡底色 token（带兜底）', /\.dfv-bubble\{[^}]*background-color:var\(--dsw-specific-bubble,#edf3fe\)/],
  ['回答气泡圆角用官方 radius token（带兜底）', /\.dfv-bubble\{[^}]*border-radius:var\(--dsw-radius-md,12px\)/],
  ['回答正文渲染成元素（围栏代码块保留换行）', /\.dfv-pre\{[^}]*white-space:pre-wrap/],
  ['回答正文里的表格有边框', /\.dfv-table th,\.dfv-table td\{[^}]*border:1px solid var\(--dsw-alias-border-l1\)/],
  // 踩过的坑：说明文字是 <span>，`margin-top` 对行内元素无效，结果和工具名粘在一行
  // （`改文件 · index.js · 完成The file … has been updated successfully.`）。必须独占一行。
  ['v2 原始记录的说明独占一行', /\.dfv-raw-note\{display:block/],
  // 两版共同要求
  ['主题能力探测', /@supports \(color:color-mix\(/],
  ['高对比模式退回', /@media \(forced-colors:active\)/],
  ['减少动效退回', /@media \(prefers-reduced-motion:reduce\)/],
];
for (const [label, pattern] of must) {
  if (!pattern.test(css)) problems.push(`缺少要素：${label}`);
}

// ---------- 5b. 执行日志不许回到卡片里 ----------
// 用户的原话是「不要他的执行日志」：一张卡只放**回答本身**拆出来的东西
// （要你定的事 / 关键数据 / 产出文件 / 结论建议 / 风险提醒），工具调用时间线不进卡。
// 宿主那一半已经不再产出 steps 块，样式这半再钉一次：那些选择器一旦回来就算失败。
for (const [label, pattern] of [
  ['步骤时间线选择器（.dfv-steps / .dfv-step*）', /\.dfv-step/],
  ['步骤图标底色（data-id="steps"）', /data-id="steps"/],
  ['步骤文案键（block.steps / count.steps）', /block\.steps|count\.steps/],
  ['「执行过程」这个块名', /执行过程/],
]) {
  if (pattern.test(css)) problems.push(`执行日志的${label}又出现在样式里了`);
}

console.log(`\nCSS 长度 ${css.length} 字符｜问题 ${problems.length} 项`);
for (const problem of problems) console.log('  ❌ ' + problem);
console.log(problems.length === 0 ? '\n样式检查全部通过' : '\n样式检查有失败');
process.exit(problems.length === 0 ? 0 : 1);