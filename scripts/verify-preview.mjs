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
  ['插件 CSS：展开整摞后纵向排开', /\.dfv-blocks\[data-open="true"\] \.dfv-block\{/],
  ['插件 CSS：多项块底部的收起按钮', /\.dfv-collapse\{[^}]*border:1px solid var\(--dsw-alias-border-l1\)/],
  ['插件 CSS：块底部那一行是横排', /\.dfv-block-foot\{[^}]*display:flex/],
  ['预览里真的渲染出了「收起这块」（说明挑到了多项块那一轮）', /class="dfv-collapse"/],
  ['预览里「还有 N 个 ›」能回退成「只看前 M 个」', /只看前 \d/],
  ['插件 CSS：回答全文按需渲染', /\.dfv-full\{[^}]*overflow-wrap:anywhere/],
  ['插件 CSS：用户提问气泡（官方气泡底色 token）', /\.dfv-ask-text\{[^}]*background-color:var\(--dsw-specific-bubble/],
  ['用户提问渲染出来了', /class="dfv-ask-text"/],
  ['插件 CSS：v1 小卡也在（一份 CSS 里两版共存）', /\.dfb-card\{/],
  ['默认叠压态的卡', /class="dfv-blocks" data-open="false"/],
  ['展开态的卡', /class="dfv-blocks" data-open="true"/],
  ['回答区（卡里那块白底）', /class="dfv-answer"/],
  ['「完成 · 待你定 N」药丸', /待你定 \d/],
  ['③ 展开整摞那格的标注', /pv-tag">③ 点「展开/],
  ['主题切换脚本', /data-act="theme"/],
  ['页面底色切换脚本', /data-act="page"/],
  ['四种状态的标注', /① 点「展开回答全文[\s\S]*② 默认[\s\S]*③ 点「展开[\s\S]*④ 再点开其中一块/],
  ['「展开整摞 ≠ 展开内容」写明在标注里', /每块内容仍然收起/],
  ['1~2 块直接铺开的说明（去掉日志后最常见的形态）', /直接铺开（不叠）/],
];
for (const [label, pattern] of must) {
  if (!pattern.test(html)) problems.push(`缺少：${label}`);
}

// 新契约的**反例**也在预览里：③ 那格（点过「展开 N 个信息块」）必须是**零个**块内容——
// 只要那里出现一个 `dfv-body`，就说明「展开整摞」又把内容一起铺出来了（老行为）。
{
  const tag3 = html.indexOf('pv-tag">③');
  const tag4 = html.indexOf('pv-tag">④');
  if (tag3 < 0 || tag4 <= tag3) problems.push('找不到 ③/④ 两格的标注，没法核对「展开整摞不展开内容」');
  else {
    if (html.slice(tag3, tag4).includes('class="dfv-body"')) problems.push('③ 展开整摞那一格里出现了块内容（每块都该是收起的）');
    if (!html.slice(tag4).includes('class="dfv-body"')) problems.push('④ 点开一块那一格里没有块内容（点了就该出来）');
  }
}

// 反向：预览本身也不该带执行日志或原始记录——它是给用户看的东西，留一点点残留都会误导。
// 断言写的是**骨架**（CSS 规则、类属性），不是裸词：预览里放的是真实回答原文，
// 有一轮的回答本身就在讲「我把原始记录模块删了」，里面还写着 `.dfv-raw*` 这个类名——
// 拿裸词去查，命中的是回答内容而不是残留（这条断言就是这么误报过一次）。
// 所以：CSS 规则要求**一条规则从行首/分号后开始**；类名要求出现在 class 属性里。
for (const [label, pattern] of [
  ['执行日志的时间线（.dfv-step 规则）', /(?:^|[;}])\s*\.dfv-step[\s,:{]/m],
  ['步骤「详情」按钮（dfv-step 类）', /class="[^"]*\bdfv-step/],
  ['「执行过程」这个块名', /执行过程/],
  ['原始记录模块的样式规则', /(?:^|[;}])\s*\.dfv-raw[\s,:{]/m],
  ['原始记录模块的类名', /class="[^"]*\bdfv-raw/],
  ['「原始记录 N 条」那一行', /原始记录 \d+ 条/],
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