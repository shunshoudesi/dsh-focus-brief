/**
 * 一次性取证：把「还没亲眼看过」的几个状态分别渲染成单卡小页面，供真 Chromium 截图。
 * 上几轮的教训是「看过才算验过」——预览页太长、视野只到前两张卡，很多状态从没被看过。
 *
 * 产物：.tmp/shots/case-<id>.html（每个文件一张卡，用 scripts/probe-layout 的截图方式出图）
 * 用法: node .tmp/build-shots.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { REACT_DIR as dir, themeSource, ROOT } from './_paths.mjs';

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

const host = await import(new URL('../index.js', import.meta.url).href);
const definitions = [];
host.apply({ sessionProjections: { register: (definition) => definitions.push(definition) }, inject: () => {} });
const viewDefinition = definitions.find((definition) => definition.key === 'focusView');

/* ---------- 语料：把每个会话折一遍，挑样本 ---------- */
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
const pool = [];
for (const file of files) {
  let state = viewDefinition.init();
  for (const event of readSessionEvents(file)) state = viewDefinition.apply(state, event);
  for (const turn of viewDefinition.wire.view(state)) pool.push(turn);
}
const pick = (predicate) => pool.filter(predicate).at(-1) ?? null;
const has = (turn, id) => (turn?.blocks ?? []).some((block) => block.id === id);

/* 语料补一轮**合成**轮次：真实履历里「会叠成一摞」（完成态 + >2 块）的只有两轮，而且里面没有
   `points`/`files` 这种内容厚的块，于是「展开整摞后每块仍收起 / 再点开其中一块」这两个新形态
   在真实语料里**没有样本**（第一次跑就打印了「语料里没有样本」）。没有样本就没法亲眼验，
   所以照投影 wire 的形状补一轮，专供这两个用例。注意它被 push 在最后，`pick` 取 `.at(-1)`——
   任何它不满足的用例都不会被它顶掉。 */
pool.push({
  turn: 9001,
  startSeq: 0,
  time: Date.UTC(2026, 9, 10, 14, 30),
  state: 'done',
  stateReason: '',
  decisions: 0,
  title: '合成：四块一摞（验证展开后每块仍收起）',
  headline: '这一轮的四个信息块都应该先以标题行出现，点哪块才出哪块的内容。',
  prompt: '合成轮次：用来验证「展开整摞 ≠ 展开内容」。',
  promptMedia: 0,
  blocks: [
    { id: 'asks', items: [{ text: '要不要把默认改成收起' }, { text: '圆点要不要留' }] },
    { id: 'kpi', items: [{ k: '信息块', v: '4' }, { k: '默认收起', v: '4' }] },
    // 产出文件特意给 7 项（> 预览的 5 项）：这样「还有 N 个 › + 收起这块」那一行在截图里真的会出现。
    {
      id: 'files',
      items: [
        { path: 'dsh-focus-brief/client.js', name: 'client.js', dir: 'dsh-focus-brief', ext: 'JS' },
        { path: 'dsh-focus-brief/index.js', name: 'index.js', dir: 'dsh-focus-brief', ext: 'JS' },
        { path: 'dsh-focus-brief/scripts/ssr-view.mjs', name: 'ssr-view.mjs', dir: 'scripts', ext: 'MJS' },
        { path: 'dsh-focus-brief/scripts/css-check.mjs', name: 'css-check.mjs', dir: 'scripts', ext: 'MJS' },
        { path: 'dsh-focus-brief/scripts/contrast-check.mjs', name: 'contrast-check.mjs', dir: 'scripts', ext: 'MJS' },
        { path: 'dsh-focus-brief/scripts/shoot-pages.mjs', name: 'shoot-pages.mjs', dir: 'scripts', ext: 'MJS' },
        { path: 'dsh-focus-brief/MANUAL.md', name: 'MANUAL.md', dir: 'dsh-focus-brief', ext: 'MD' },
      ],
    },
    { id: 'points', items: [{ depth: 0, text: '点「展开 4 个信息块」只铺开标题行' }, { depth: 1, text: '再点这一块才把内容放进 DOM' }] },
  ],
  full: '',
  fullGone: true,
  truncated: false,
  counts: { files: 7, tools: 0, kpi: 2, points: 2, risks: 0, asks: 2 },
  steps: 0,
  chars: 33,
});

const CASES = [
  ['answer-full', (turn) => (turn.full ?? '').length > 600, [true, {}, {}, true]],
  ['ask-only', (turn) => turn.prompt !== '' && (turn.blocks ?? []).length === 0, [false, {}, {}, false]],
  ['asks-risks', (turn) => has(turn, 'asks') && has(turn, 'risks'), [true, {}, {}, false]],
  ['decide-pill', (turn) => turn.state === 'done' && (turn.decisions ?? 0) > 0, [false, {}, {}, false]],
  // 点一下「展开 N 个信息块」得到的形态：N 个标题行铺开、**每块内容仍然收起**（2026-10 的新契约）。
  ['deck-open-rows', (turn) => (turn.blocks ?? []).length >= 3 && has(turn, 'points'), [true, {}, {}, false]],
  // 再点开其中一块：只有那一块把内容铺出来。
  ['block-open', (turn) => (turn.blocks ?? []).length >= 3 && has(turn, 'points'), [true, { points: true }, {}, false]],
  // 多项块（文件 7 项 > 预览 5 项）：底部那一行该同时有「还有 2 个 ›」与「收起这块」。
  ['block-open-more', (turn) => has(turn, 'files') && has(turn, 'points'), [true, { files: true }, {}, false]],
  // 再点「还有 N 个」：变成「只看前 5 个」——这条分支以前是**单向门**，用户就是冲它提的。
  ['block-open-all', (turn) => has(turn, 'files') && has(turn, 'points'), [true, { files: true }, { files: true }, false]],
  ['f2-no-blocks', (turn) => (turn.blocks ?? []).length === 0, [false, {}, {}, false]],
  ['interrupt', (turn) => turn.state === 'interrupt', [false, {}, {}, false]],
  // 结论最长的那一轮：专门用来看「结论那一行会不会被裁」。
  // 以前这里有两道裁切（宿主 200 字上限 + 客户端 `-webkit-line-clamp:2`），
  // 后者是**无声**的——文字在 HTML 里、只是不显示，所以只有截图能看出来。
  ['conclusion-long', (turn) => turn.headline.length > 120, [false, {}, {}, false]],
  ['conclusion-longest', (turn) => turn.headline.length === Math.max(...pool.map((item) => item.headline.length)) && turn.headline.length > 0, [false, {}, {}, false]],
];

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
const requireReact = (name) => {
  if (name === 'react') return react;
  throw new Error(`require 了不该 require 的包: ${name}`);
};
const dictionaries = {};
clientModule
  .factory(requireReact)
  .apply({
    effect: (fn) => fn(),
    slots: { inject: (key, callback) => callback(), register: () => () => {} },
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

async function renderOne(turn, queue) {
  let index = 0;
  const shim = { ...react, useState: (initial) => [queue[index++] ?? initial, () => {}] };
  let View = null;
  clientModule
    .factory((name) => (name === 'react' ? shim : requireReact(name)))
    .apply({
      effect: (fn) => fn(),
      slots: {
        inject: (key, callback) => callback(),
        register: (options, component) => {
          if (options.name === 'conversation.view') View = component;
          return () => {};
        },
      },
      locale: { register: () => () => {}, bind: () => t },
    });
  const stream = await server.renderToReadableStream(
    react.createElement(View, {
      t,
      useProjection: (key, selector) => (selector === undefined ? [turn] : selector([turn])),
      inputActions: { captureInsertion: () => ({}), insertText: () => {} },
      inspectCall: () => {},
    }),
  );
  return await new Response(stream).text();
}

/* ---------- 主题 token ---------- */
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

/** 取证页外壳：主题 token + 插件实际注入的 CSS + 水印 + 卡片。
 *  水印默认可见（工作台里一眼看清这是哪一轮）；`CLEAN=1` 时收进 HTML 注释——
 *  README / 插件市场截图要的是「画面上没有夹具痕迹」，但信息不能丢。 */
function pageFor(title, cards, caption) {
  const foot = caption === '' ? '' : process.env.CLEAN === '1' ? `<!-- ${caption} -->` : `<div class="foot">${caption}</div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title><style>
:root{${globalTokens};${scopeLines[0]}}
body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:"Microsoft YaHei",sans-serif}
.foot{max-width:720px;margin:0 auto;padding:8px 18px 40px;font-size:12px;color:var(--dsw-alias-label-secondary)}
${injected}
</style></head><body>
${foot}
${cards}
</body></html>`;
}

/* README / 插件市场用的**演示**轮次：内容中立（一个普通的开发任务）、五个块齐全、
 *  产出文件 7 项（> 预览 5 项，底部那颗「还有 N 个 / 收起这块」才会出现）。
 *  为什么要另起一轮：仓库要公开，取证页里的真实会话内容（真实提问、真实回答）不该跟着上去；
 *  而 9001 那轮是「验证展开整摞」的合成轮次，标题里写着「验证」，摆进 README 像夹具。
 *  `DEMO=1` 才产出，默认不生成。 */
const DEMO_FULL = [
  '把同步导出改成异步任务，分三步：',
  '',
  '1. 接口层：POST /api/report/export 不再等到文件写完，落一条任务记录后立刻返回 taskId；同一份查询条件在 5 分钟内直接复用旧任务，避免重复排队。',
  '2. 队列层：任务进 export_queue，worker 按并发上限取任务；取任务时写一个 60 秒租约，租约到期没续上的任务允许被重新取，防同一个任务被两个 worker 同时导出。失败按 1s / 4s / 16s 退避重试三次，三次都失败就把任务标记为 failed，并把最后一次错误留在任务上。',
  '3. 前端：拿到 taskId 后每 2 秒轮询一次任务状态，done 时把文件地址交给原来的下载逻辑；页面切走就停轮询，回来再续。',
  '',
  '风险与验证：轮询会让任务列表页多出读请求；任务超时上限设成 10 分钟，超时后释放并发位。测试补了队列抢占、租约过期、退避序列和超时释放四组用例，共 11 个。',
].join('\n');

const DEMO_TURN = {
  turn: 42,
  startSeq: 0,
  time: Date.UTC(2026, 9, 11, 1, 20),
  state: 'done',
  stateReason: '',
  decisions: 2,
  title: '导出报表改异步 + 失败重试',
  headline: '同步导出改成入队后立刻返回任务号、前端轮询取结果，重试按 1s / 4s / 16s 退避走三次。',
  prompt: '把导出报表的接口从同步改成异步任务，顺便补上失败重试。',
  promptMedia: 0,
  blocks: [
    { id: 'asks', items: [{ text: '并发上限沿用现在的 4，还是提到 8？' }, { text: '旧的同步接口要不要留一个版本兼容？' }] },
    {
      id: 'kpi',
      items: [
        { k: '改动文件', v: '6' },
        { k: '新增测试', v: '11' },
        { k: '重试上限', v: '3' },
        { k: '任务超时', v: '10 min' },
      ],
    },
    {
      id: 'files',
      items: [
        { path: 'server/api/report.ts', name: 'report.ts', dir: 'api', ext: 'TS' },
        { path: 'server/jobs/export-queue.ts', name: 'export-queue.ts', dir: 'jobs', ext: 'TS' },
        { path: 'server/jobs/retry-policy.ts', name: 'retry-policy.ts', dir: 'jobs', ext: 'TS' },
        { path: 'server/jobs/worker.ts', name: 'worker.ts', dir: 'jobs', ext: 'TS' },
        { path: 'web/report/export-button.tsx', name: 'export-button.tsx', dir: 'report', ext: 'TSX' },
        { path: 'web/report/poll-task.ts', name: 'poll-task.ts', dir: 'report', ext: 'TS' },
        { path: 'tests/export-queue.test.ts', name: 'export-queue.test.ts', dir: 'tests', ext: 'TS' },
      ],
    },
    {
      id: 'points',
      items: [
        { depth: 0, text: '入队后立刻返回任务号，前端改成 2 秒轮询' },
        { depth: 0, text: '失败重试按指数退避，超过三次标记为失败' },
        { depth: 1, text: '超时上限 10 分钟，超时后释放占用的并发位' },
      ],
    },
    {
      id: 'risks',
      items: [
        { text: '轮询间隔 2 秒，任务列表页在高峰期会多出约三成读请求' },
        { text: '重试期间同一个任务可能被两个 worker 同时取到，需要加租约' },
        { text: '旧的同步接口保留期间，两条链路的导出结果需要比对一次' },
      ],
    },
  ],
  full: DEMO_FULL,
  fullGone: false,
  truncated: false,
  counts: { files: 7, tools: 12, kpi: 4, points: 3, risks: 3, asks: 2 },
  steps: 12,
  chars: DEMO_FULL.length,
};

const written = [];
const produced = new Set();
// 先收集这一轮要产出的用例、再删旧页面：删除必须按「**真的产出了**」而不是按「用例在清单里」——
// 用例在清单里但语料里没有样本时会被跳过，上一轮的 `case-*.html` 就会继续被 shoot-pages 截成新图，
// 取证目录里于是躺着一张「已经不存在的用例的截图」（这次 `asks-risks` 就是这么留下的）。
for (const [id, predicate, queue] of CASES) {
  const turn = pick(predicate);
  if (turn === null) {
    console.log(`跳过 ${id}：语料里没有样本`);
    continue;
  }
  const cards = await renderOne(turn, queue);
  const caption = `case ${id} ｜ 第 ${turn.turn} 轮 ｜ 状态 ${turn.state}${turn.decisions > 0 ? ` · 待你定 ${turn.decisions}` : ''} ｜ 块 ${(turn.blocks ?? []).map((block) => block.id).join('/') || '无'} ｜ 全文 ${turn.full === '' ? '无（这轮较早）' : `${turn.full.length} 字`}`;
  const page = pageFor(`case-${id}`, cards, caption);
  const out = path.join(shotsDir, `case-${id}.html`);
  fs.writeFileSync(out, page, 'utf8');
  produced.add(`case-${id}.html`);
  written.push(`case-${id}（第 ${turn.turn} 轮 / ${turn.state} / 块 ${(turn.blocks ?? []).length}）`);
}
// 演示轮次的四个形态：叠压 / 展开只出标题行 / 点开产出文件（5 行 + 还有 2 个 + 收起这块）/ 铺开全部 7 行。
// 水印一律不带（caption 传空串）：这几张是给外面看的。
if (process.env.DEMO === '1') {
  for (const [id, queue] of [
    ['view-collapsed', [false, {}, {}]],
    ['view-blocks', [true, {}, {}]],
    ['view-open', [true, { files: true }, {}]],
    ['view-open-all', [true, { files: true }, { files: true }]],
  ]) {
    const cards = await renderOne(DEMO_TURN, queue);
    fs.writeFileSync(path.join(shotsDir, `demo-${id}.html`), pageFor(`demo-${id}`, cards, ''), 'utf8');
    produced.add(`demo-${id}.html`);
    written.push(`demo-${id}（演示轮次）`);
  }
}
// 删掉**这一轮没产出的**旧页面（用例被删掉、或语料里没样本而被跳过）：
// 否则上一轮的 .html 会继续被 shoot-pages 截成新图，看起来像「新用例也拍到了」。
for (const stale of fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((name) => /^(?:case|demo)-.*\.html$/.test(name)) : []) {
  if (produced.has(stale)) continue;
  fs.rmSync(path.join(shotsDir, stale));
  console.log(`  清理过期用例 ${stale}`);
}
console.log(`写出 ${written.length} 个取证页到 .tmp/shots/：`);
for (const line of written) console.log(`  ${line}`);
