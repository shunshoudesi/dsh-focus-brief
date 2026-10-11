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

const CASES = [
  ['answer-full', (turn) => (turn.full ?? '').length > 600, [true, {}, {}, true]],
  ['ask-only', (turn) => turn.prompt !== '' && (turn.blocks ?? []).length === 0, [false, {}, {}, false]],
  ['asks-risks', (turn) => has(turn, 'asks') && has(turn, 'risks'), [true, {}, {}, false]],
  ['decide-pill', (turn) => turn.state === 'done' && (turn.decisions ?? 0) > 0, [false, {}, {}, false]],
  ['block-collapsed', (turn) => has(turn, 'points') && (turn.blocks ?? []).length >= 3, [true, { points: true }, {}, false]],
  ['f2-no-blocks', (turn) => (turn.blocks ?? []).length === 0, [false, {}, {}, false]],
  ['interrupt', (turn) => turn.state === 'interrupt', [false, {}, {}, false]],
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

const written = [];
// 先删掉这一轮不再产出的旧页面：否则上一轮的 `case-*.html` 会继续被 shoot-pages 截成新图，
// 取证目录里就出现了「已经不存在的用例的截图」。
const liveIds = new Set(CASES.map(([id]) => `case-${id}.html`));
for (const stale of fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((name) => /^case-.*\.(html|png)$/.test(name)) : []) {
  if (stale.endsWith('.png') || liveIds.has(stale)) continue;
  fs.rmSync(path.join(shotsDir, stale));
  console.log(`  清理过期用例 ${stale}`);
}
for (const [id, predicate, queue] of CASES) {
  const turn = pick(predicate);
  if (turn === null) {
    console.log(`跳过 ${id}：语料里没有样本`);
    continue;
  }
  const cards = await renderOne(turn, queue);
  const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>case-${id}</title><style>
:root{${globalTokens};${scopeLines[0]}}
body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:"Microsoft YaHei",sans-serif}
.foot{max-width:720px;margin:0 auto;padding:8px 18px 40px;font-size:12px;color:var(--dsw-alias-label-secondary)}
${injected}
</style></head><body>
<div class="foot">case ${id} ｜ 第 ${turn.turn} 轮 ｜ 状态 ${turn.state}${turn.decisions > 0 ? ` · 待你定 ${turn.decisions}` : ''} ｜ 块 ${(turn.blocks ?? []).map((block) => block.id).join('/') || '无'} ｜ 全文 ${turn.full === '' ? '无（这轮较早）' : `${turn.full.length} 字`}</div>
${cards}
</body></html>`;
  const out = path.join(shotsDir, `case-${id}.html`);
  fs.writeFileSync(out, page, 'utf8');
  written.push(`case-${id}（第 ${turn.turn} 轮 / ${turn.state} / 块 ${(turn.blocks ?? []).length}）`);
}
console.log(`写出 ${written.length} 个取证页到 .tmp/shots/：`);
for (const line of written) console.log(`  ${line}`);