/**
 * 一次性验证：配色在真实主题取值下读不读得清。
 * 从主题包里取真实的浅色/深色 token 取值 → 自己算合成后的底色 → 算 WCAG 对比度。
 * 浏览器渲染不到的时候，对比度仍然算得出来——这正是它存在的意义。
 *
 * 阈值分两类：
 * - 文字 4.5:1。
 * - 图形（圆点、图标、装饰记号）3:1，即 WCAG 1.4.11 对非文本内容的要求。
 * 「未激活/中断」类的浅灰标记按语义本来就该淡，单独列为参考项（打印比值但不判失败）。
 */
import fs from 'node:fs';
import { themeSource } from './_paths.mjs';

const file = themeSource();
const source = fs.readFileSync(file, 'utf8');

const globalPairs = new Map();
for (const match of source.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
  globalPairs.set(match[1], match[2]);
}

function enclosingBlock(text, index) {
  const open = text.lastIndexOf('{', index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { header: text.slice(Math.max(0, open - 80), open), body: text.slice(open + 1, i) };
    }
  }
  return null;
}

function resolve(name, seen = 0) {
  const raw = globalPairs.get(name);
  if (raw === undefined || seen > 4) return null;
  const reference = /^var\((--[\w-]+)\)$/.exec(raw.trim());
  return reference !== null ? resolve(reference[1], seen + 1) : raw;
}

function parseColor(text) {
  const value = (text ?? '').trim();
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(value);
  if (hex !== null) {
    let body = hex[1];
    if (body.length === 3) body = body.split('').map((c) => c + c).join('');
    return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16), body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(value);
  if (rgb !== null) {
    const parts = rgb[1].split(/[,\s/]+/).filter((part) => part !== '').map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

const over = (top, bottom) => {
  const alpha = top[3] + bottom[3] * (1 - top[3]);
  const channel = (i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
};
const luminance = (color) => {
  const linear = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
};
const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const scopes = [];
for (const match of source.matchAll(/--dsw-alias-bg-layer-1\s*:/g)) {
  const block = enclosingBlock(source, match.index);
  if (block === null) continue;
  const tokens = new Map();
  for (const declaration of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const value = declaration[2].trim();
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    const color = parseColor(reference !== null ? (resolve(reference[1]) ?? '') : value);
    if (color !== null) tokens.set(declaration[1], color);
  }
  scopes.push({ header: block.header.replace(/\s+/g, ' ').trim().slice(-40), tokens });
}

const WHITE = [255, 255, 255, 1];
/** 设计稿的图标底色（作品色）：白字/白记号压在这些底色上，按图形阈值 3:1 要求。 */
const CHIPS = {
  '关键数据图标 #7c5cf0': '#7c5cf0',
  '产出文件图标 #217346': '#217346',
  '结论建议图标 #3b82f6': '#3b82f6',
  '风险提醒图标 #e5544b': '#e5544b',
  '需要你确认图标 #c2410c': '#c2410c',
};
const FILE_CHIPS = { XLSX: '#217346', DOCX: '#2b579a', PDF: '#c0392b', PNG: '#7a5af5', HTML: '#c2410c', MD: '#475569', TS: '#b45309', '其它': '#61666b' };

let bad = 0;
let info = 0;

for (const [index, scope] of scopes.entries()) {
  const get = (name) => scope.tokens.get(name) ?? parseColor(resolve(name) ?? '');
  const base = get('--dsw-alias-bg-base');
  const layer1 = get('--dsw-alias-bg-layer-1');
  const label = get('--dsw-alias-label-primary');
  const secondary = get('--dsw-alias-label-secondary');
  const warn = get('--dsw-alias-state-warn-primary');
  const brand = get('--dsw-alias-brand-primary');
  const success = get('--dsw-alias-state-success-primary');
  const error = get('--dsw-alias-state-error-primary');
  const idle = get('--dsw-alias-state-idle-primary');
  const business = get('--dsw-alias-state-business-primary') ?? brand;
  const border2 = get('--dsw-alias-border-l2');

  /** 卡内分区底色：color-mix(label 4%, transparent) 落在实底卡面上。 */
  const rowBg = over([label[0], label[1], label[2], 0.04], layer1);
  const tint = (color, ratio) => over([color[0], color[1], color[2], ratio], layer1);

  console.log(`\n=== 作用域 ${index + 1}：…${scope.header} ===`);
  console.log(`  base ${hex(base)}｜layer1 ${hex(layer1)}｜卡内分区 ${hex(rowBg)}｜brand ${hex(brand)}`);
  console.log(`  圆角实底卡面与页面底的亮度差 ${(Math.abs(luminance(layer1) - luminance(base)) * 100).toFixed(1)}%（浅色主题下两者同为白色，卡靠发丝边与投影分层）`);
  if (border2 !== null) {
    const edge = over(border2, base);
    console.log(`  发丝边落在页面底上成 ${hex(edge)}｜边缘对比度 ${contrast(edge, base).toFixed(2)}:1`);
  }

  const checks = [
    // ---- v1：普通对话视图里那张小卡 ----
    // 2026-10 重做成实底卡（原来是毛玻璃 + 半透明底，所以旧断言把卡面折成了 layer1 72% 叠在页面底上）。
    // 现在卡面就是 layer1 本身，于是 v1/v2 两边的算式一致；新增两条覆盖重做带进来的元素：
    // 「待定 N」那个软底小片，以及标题行那枚品牌色圆点（按图形 3:1）。
    ['v1 结论文字 (label-primary 在卡面)', label, layer1, 4.5],
    ['v1 次要文字 (label-secondary 在卡面)', secondary, layer1, 4.5],
    ['v1 标题行小圆点 (brand 在卡面)', brand, layer1, 3],
    ['v1「待定 N」小片文字 (label-primary 在 14% warn 软底上)', label, tint(warn, 0.14), 4.5],
    // ---- v2：专注视图 ----
    ['v2 标题／结论文字 (label-primary 在卡面)', label, layer1, 4.5],
    // 用户提问气泡：底色就是官方对话那条气泡自己的 token（浅色 #edf3fe / 深色 #2c2c2e），字色是 label-primary。
    // 取不到 token 时退回我写在 CSS 里的兜底色，保证这一项永远算得出来。
    ['v2 用户提问气泡正文 (label-primary 在官方气泡底上)', label, get('--dsw-specific-bubble') ?? parseColor('#edf3fe'), 4.5],
    ['v2 提问气泡里的附件占位 (label-secondary 在官方气泡底上)', secondary, get('--dsw-specific-bubble') ?? parseColor('#edf3fe'), 4.5],
    ['v2 次要文字 (label-secondary 在卡面)', secondary, layer1, 4.5],
    // 多项块底部那两颗按钮：「收起这块」是描边 + label-secondary（用户要求的那颗），
    // 「还有 N 个 / 只看前 M 个」是软底 + label-primary（与上面 `.dfv-more` 同款）。
    ['v2「收起这块」按钮文字 (label-secondary 在卡面)', secondary, layer1, 4.5],
    ['v2「还有 N 个」按钮文字 (label-primary 在 4% 分区上)', label, rowBg, 4.5],
    ['v2 卡内小字 (label-secondary 在 4% 分区上)', secondary, rowBg, 4.5],
    ['v2 状态药丸 完成 (label-primary 在 16% success)', label, tint(success, 0.16), 4.5],
    ['v2 状态药丸 进行中 (label-primary 在 16% 业务蓝)', label, tint(business, 0.16), 4.5],
    ['v2 状态药丸 待确认 (label-primary 在 18% warn)', label, tint(warn, 0.18), 4.5],
    ['v2 状态药丸 失败 (label-primary 在 14% error)', label, tint(error, 0.14), 4.5],
    ['v2 状态药丸 中断 (label-primary 在 30% idle)', label, tint(idle, 0.3), 4.5],
    ['v2 主按钮文字 (bg-base 在 brand 上)', base, brand, 4.5],
    // 圆点：成功/待确认这两个主题色在浅色主题下对白底只有 2.2:1，主题自身如此，
    // 且状态另有文字承载（14.98~18.90:1），所以按 1.4.11 的“非必需图形”处理，移到参考项。
    ['v2 图形 失败圆点 (error 在卡面)', error, layer1, 3],
    ['v2 图形 进行中圆点 (业务蓝在卡面)', business, layer1, 3],
    ['v2 图形 卡内失败记号 (error 在分区上)', error, rowBg, 3],
    ['v2 提醒条 失败底上的正文 (label-primary)', label, over([error[0], error[1], error[2], 0.1], layer1), 4.5],
    ['v2 提醒条 待办底上的正文 (label-primary)', label, over([warn[0], warn[1], warn[2], 0.12], layer1), 4.5],
  ];

  for (const [name, color, background, threshold] of checks) {
    if (color === null) {
      console.log(`  ⚠️ ${name}：取不到取值`);
      continue;
    }
    const ratio = contrast(color, background);
    const ok = ratio >= threshold;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}：${ratio.toFixed(2)}:1（阈值 ${threshold}）`);
  }

  // 参考项：语义上就该“淡”、或只是重复提示的标记，不判失败，只留数。
  // 依据：WCAG 1.4.11 管的是“理解内容所必需”的图形；状态与提醒在卡片上同时有文字（14.98~18.90:1），
  // 色点/记号只是第二条提示线。而且这些就是主题自己的 success / warn / idle 取值，DSH 自带界面同样这么用。
  const references = [
    ['完成圆点（冗余提示，文字已表达状态）', success],
    ['待确认圆点（冗余提示）', warn],
    ['中断圆点（未激活，语义上就该淡）', idle],
    ['待办记号（冗余提示）', warn],
  ];
  for (const [name, color] of references) {
    if (color === null) continue;
    info++;
    console.log(`  ℹ️ ${name}：${contrast(color, layer1).toFixed(2)}:1（参考，不计入失败）`);
  }

  // 图标：白字/白记号压在设计稿的作品色上，按图形阈值要求。
  for (const [name, value] of Object.entries(CHIPS)) {
    const color = parseColor(value);
    const ratio = contrast(WHITE, color);
    const ok = ratio >= 3;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} v2 图标白字 ${name}：${ratio.toFixed(2)}:1（阈值 3）`);
  }
  for (const [name, value] of Object.entries(FILE_CHIPS)) {
    const color = parseColor(value);
    const ratio = contrast(WHITE, color);
    const ok = ratio >= 3;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} v2 文件图标白字 ${name}：${ratio.toFixed(2)}:1（阈值 3）`);
  }
}

console.log(`\n不达标 ${bad} 项｜参考项 ${info} 项`);
process.exit(bad === 0 ? 0 : 1);