/**
 * 一次性验证：预览文件本身。它是个交付物，不能只是“写出来了”。
 * 1. 内联的 <style> 用真解析器严格解析（主题 token + 插件 CSS + 预览自己的覆盖）。
 * 2. 必需的骨架都在（两种主题作用域、三种状态、叠压/展开/原始记录、切换脚本）。
 * 3. 标签配平（模板拼错会出现多余的闭合标签）。
 */
import fs from 'node:fs';
import { PREVIEW, cssTreeSource } from './_paths.mjs';

const file = PREVIEW;
const html = fs.readFileSync(file, 'utf8');
const problems = [];

const style = /<style>([\s\S]*?)<\/style>/.exec(html);
if (style === null) problems.push('没有内联 <style>');
const css = style?.[1] ?? '';
console.log(`预览文件 ${Math.round(html.length / 1024)} KB｜内联 CSS ${css.length} 字符`);

const code = fs.readFileSync(cssTreeSource(), 'utf8');
const csstree = new Function(`${code}\n;return csstree;`)();
try {
  const ast = csstree.parse(css, { positions: true });
  let rules = 0;
  let declarations = 0;
  csstree.walk(ast, { visit: 'Rule', enter: () => rules++ });
  csstree.walk(ast, { visit: 'Declaration', enter: () => declarations++ });
  console.log(`✅ 内联 CSS 严格解析通过：${rules} 条规则 / ${declarations} 条声明`);
} catch (error) {
  problems.push(`内联 CSS 解析失败：${error.message}`);
}

const must = [
  ['浅色作用域的 token', /:root\{[^}]*--dsw-alias-bg-layer-1/],
  ['深色作用域的 token', /body\[data-ds-dark-theme\]\{[^}]*--dsw-alias-bg-layer-1/],
  ['灰页面开关', /body\[data-gray-page="true"\]\{--dsw-alias-bg-base:#f0f0f0\}/],
  ['插件 CSS：实底卡面', /\.dfv-card\{[^}]*background-color:var\(--dsw-alias-bg-layer-1\)/],
  ['插件 CSS：叠压', /\.dfv-blocks\[data-open="false"\] \.dfv-block\{[^}]*margin-bottom:-6px/],
  ['插件 CSS：手风琴展开', /\.dfv-blocks\[data-open="true"\] \.dfv-block\{/],
  ['插件 CSS：原始记录说明独占一行', /\.dfv-raw-note\{display:block/],
  ['插件 CSS：回答气泡（官方气泡底色 token）', /\.dfv-bubble\{[^}]*background-color:var\(--dsw-specific-bubble/],
  ['插件 CSS：v1 小卡也在（一份 CSS 里两版共存）', /\.dfb-card\{/],
  ['默认叠压态的卡', /class="dfv-blocks" data-open="false"/],
  ['展开态的卡', /class="dfv-blocks" data-open="true"/],
  ['原始记录已展开', /dfv-raw-body/],
  ['「完成 · 待你定 N」药丸', /待你定 \d/],
  ['F2 退化（只剩总卡、没有信息块）', /pv-tag">② 点「展开/],
  ['主题切换脚本', /data-act="theme"/],
  ['页面底色切换脚本', /data-act="page"/],
  ['三种状态的标注', /① 默认[\s\S]*② 点「展开[\s\S]*③ 点开「原始记录/],
  ['1~2 块直接铺开的说明（去掉日志后最常见的形态）', /直接铺开（不叠）/],
];
for (const [label, pattern] of must) {
  if (!pattern.test(html)) problems.push(`缺少：${label}`);
}

// 反向：预览本身也不该带执行日志——它是给用户看的东西，留一点点残留都会误导。
for (const [label, pattern] of [
  ['执行日志的时间线（.dfv-step）', /\.dfv-step/],
  ['步骤「详情」按钮', /dfv-step-open/],
  ['「执行过程」这个块名', /执行过程/],
]) {
  if (pattern.test(html)) problems.push(`不该有：${label}`);
}

// 标签配平（只看我自己拼的容器；React 的输出由 SSR 保证）。
for (const tag of ['section', 'div', 'span', 'script', 'style', 'body', 'html']) {
  const opens = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
  const closes = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
  if (opens !== closes) problems.push(`<${tag}> 不配平：${opens} 开 / ${closes} 闭`);
}

if (html.includes('MISSING:')) problems.push('有没替换的字典键');
if (/>undefined</.test(html)) problems.push('有 undefined 文本');
if (/="undefined"/.test(html)) problems.push('有 undefined 属性');

console.log(`\n问题 ${problems.length} 项`);
for (const problem of problems) console.log(`  ❌ ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);