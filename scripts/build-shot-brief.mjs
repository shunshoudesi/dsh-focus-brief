/**
 * 肉眼取证：把 **v1 那张小卡**（普通对话视图里的重点卡）渲染成单卡页面，供截图。
 *
 * 为什么单独一个脚本：`build-shot-pages.mjs` 造的是 v2（专注视图）的卡，
 * 而用户这次要求改的是 v1 的样式（「这个模块的样式修改一下，简约大气」）。
 * 改样式这件事**只有肉眼能验**——断言能证明「规则在不在」，证明不了「读起来像不像样」。
 *
 * 出两个形态 × 两套主题：折叠态、展开态。
 * 用法: node scripts/build-shot-brief.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { ROOT, REACT_DIR as dir, themeSource } from './_paths.mjs';

function loadUmd(file, requireFn) {
  const code = fs.readFileSync(file, 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, requireFn);
  return module.exports;
}
const react = loadUmd(`${dir}react.dev.js`, () => {
  throw new Error('react 不该 require 别的包');
});
const server = loadUmd(`${dir}react-dom-server.dev.js`, (name) => (name === 'react' ? react : (() => { throw new Error(name); })()));

/* ---------- 宿主半：拿真实的 v1 投影值（和界面上那张卡同源） ---------- */
const host = await import(new URL('../index.js', import.meta.url).href);
const definitions = [];
host.apply({ sessionProjections: { register: (definition) => definitions.push(definition) }, inject: () => {} });
const briefDefinition = definitions.find((definition) => definition.key === 'focusBrief');

const root = path.join(os.homedir(), '.dsh', 'sessions');
const files = [];
const walk = (folder) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'session.v4.jsonl.zstd') files.push(full);
  }
};
walk(root);

/** 挑一张「料最足」的卡：有要点、有要你拍板的事、有提问——折叠与展开都看得出层次。 */
let best = null;
for (const file of files) {
  let state = briefDefinition.init();
  for (const event of readSessionEvents(file)) state = briefDefinition.apply(state, event);
  for (const brief of briefDefinition.wire.view(state)) {
    const score = (brief.bullets?.length ?? 0) + (brief.asks?.length ?? 0) * 2 + (brief.prompt === '' ? 0 : 3);
    if (best === null || score > best.score) best = { score, brief };
  }
}
if (best === null) {
  console.error('语料里没有可用的 v1 卡片');
  process.exit(2);
}
const brief = best.brief;

/* ---------- 客户端半 ---------- */
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
const clientModule = loaded;
/** 抓 seat 组件（v1 是 conversation.chat.turnTail）。 */
let Tail = null;
const dictionaries = {};
clientModule
  .factory((name) => (name === 'react' ? react : (() => { throw new Error(`require 了 ${name}`); })()))
  .apply({
    effect: (fn) => fn(),
    slots: {
      inject: (key, callback) => callback(),
      register: (options, component) => {
        if (options.name === 'conversation.chat.turnTail') Tail = component;
        return () => {};
      },
    },
    locale: {
      register: (ns, dicts) => {
        dictionaries[ns] = dicts;
        return () => {};
      },
      bind: () => (key) => key,
    },
  });
const zh = dictionaries['focus-brief'].zh;
const t = (key, params) =>
  (zh[key] ?? `MISSING:${key}`).replace(/\{(\w+)\}/g, (whole, name) => (params !== undefined && name in params ? String(params[name]) : whole));

/** `open` 是 v1 组件里的第一个 useState；`sample` 默认取语料里那张最足的卡。 */
async function render(open, sample = brief) {
  const queue = [open];
  const shim = { ...react, useState: (initial) => [queue.shift() ?? initial, () => {}] };
  let View = null;
  clientModule
    .factory((name) => (name === 'react' ? shim : (() => { throw new Error(name); })()))
    .apply({
      effect: (fn) => fn(),
      slots: {
        inject: (key, callback) => callback(),
        register: (options, component) => {
          if (options.name === 'conversation.chat.turnTail') View = component;
          return () => {};
        },
      },
      locale: { register: () => () => {}, bind: () => t },
    });
  // 用流式 API（这份 React 的 UMD 构建里没有 renderToStaticMarkup，v2 的取证页也是这么渲的）。
  const stream = await server.renderToReadableStream(
    react.createElement(View, {
      t,
      turn: { turn: sample.turn },
      useProjection: (key, selector) => (selector === undefined ? [sample] : selector([sample])),
    }),
  );
  return await new Response(stream).text();
}

/* ---------- 主题取值（和 v2 取证页同一套写法） ---------- */
const source = fs.readFileSync(themeSource(), 'utf8');
function enclosingBlock(text, index) {
  const open = text.lastIndexOf('{', index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
}
const scopeLines = [];
for (const match of source.matchAll(/--dsw-alias-bg-layer-1\s*:/g)) {
  const body = enclosingBlock(source, match.index);
  const lines = [];
  for (const declaration of body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) lines.push(`${declaration[1]}:${declaration[2].trim()}`);
  scopeLines.push(lines.join(';'));
}
const globalTokens = [...new Map([...source.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)].map((m) => [m[1], m[2]])).entries()]
  .map(([key, value]) => `${key}:${value}`)
  .join(';');

const shotsDir = path.join(ROOT, '.tmp', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

/** 取证页外壳（与 v2 取证页同一套写法）：主题 token + 插件实际注入的 CSS + 水印 + 卡片。
 *  水印 `CLEAN=1` 时收进 HTML 注释；caption 传空串则完全不带（给外面看的截图）。 */
function pageOf(title, card, scope, caption) {
  const foot = caption === '' ? '' : process.env.CLEAN === '1' ? `<!-- ${caption} -->` : `<div class="foot">${caption}</div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title><style>
:root{${globalTokens};${scope}}
body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:"Microsoft YaHei",sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:18px 18px 40px}
.foot{padding:6px 2px 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
${injected}
</style></head><body><div class="wrap">
${foot}
${card}
</div></body></html>`;
}

const written = [];
for (const [id, open] of [
  ['closed', false],
  ['open', true],
]) {
  const card = await render(open);
  for (const [theme, scope] of [
    ['light', scopeLines[0]],
    ['dark', scopeLines[1]],
  ]) {
    const caption = `brief ${id} · ${theme} ｜ 第 ${brief.turn} 轮 ｜ 要点 ${brief.bullets.length} · 待定 ${brief.asks.length} · 提问 ${brief.prompt === '' ? '无' : `${brief.prompt.length} 字`}`;
    const out = path.join(shotsDir, `brief-${id}-${theme}.html`);
    fs.writeFileSync(out, pageOf(`brief-${id}-${theme}`, card, scope, caption), 'utf8');
    written.push(`brief-${id}-${theme}`);
  }
}

/* README / 插件市场用的**演示**卡：内容中立（同 v2 演示轮次那件事），启用 `DEMO=1` 才产出。
 *  为什么不直接用上面那张「料最足」的真实卡：仓库要公开，真实卡的提问与要点是会话原文。 */
if (process.env.DEMO === '1') {
  const demo = {
    turn: 42,
    startSeq: 0,
    prompt: '把导出报表的接口从同步改成异步任务，顺便补上失败重试。',
    headline: '同步导出改成入队后立刻返回任务号、前端轮询取结果，重试按 1s / 4s / 16s 退避走三次。',
    // 要点必须是 `{ text, depth }` 对象：v1 卡按 `item.text` 渲染、按 `item.depth` 缩进，
    // 传字符串会渲出三个空圆点（截图里一眼看得见，字符串形参则静默）。
    bullets: [
      { depth: 0, text: '入队后立刻返回任务号，前端改成 2 秒轮询' },
      { depth: 0, text: '失败重试按指数退避，超过三次标记为失败' },
      { depth: 1, text: '超时上限 10 分钟，超时后释放占用的并发位' },
    ],
    asks: ['并发上限沿用现在的 4，还是提到 8？', '旧的同步接口要不要留一个版本兼容？'],
    toolCalls: 12,
    answerChars: 1063,
  };
  for (const [id, open] of [
    ['closed', false],
    ['open', true],
  ]) {
    const card = await render(open, demo);
    fs.writeFileSync(path.join(shotsDir, `demo-brief-${id}-light.html`), pageOf(`demo-brief-${id}-light`, card, scopeLines[0], ''), 'utf8');
    written.push(`demo-brief-${id}-light（演示卡）`);
  }
}
console.log(`写出 ${written.length} 个 v1 页面到 .tmp/shots/：${written.join('、')}`);
console.log(`用的那一张卡：第 ${brief.turn} 轮，要点 ${brief.bullets.length} 条、待你拍板 ${brief.asks.length} 条、提问 ${brief.prompt === '' ? '（无）' : '有'}`);
console.log(`结论：${brief.headline}`);
