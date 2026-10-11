/**
 * 一次性测量：整屏渲染的开销。
 * 这个视图取代了整块会话正文，所以“一轮两张卡”的默认态必须够轻——
 * 信息块内容与原始记录都是按需渲染的，这一步就是用数字证明这个设计真的省。
 *
 * 用法: node render-cost.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { REACT_DIR as dir } from './_paths.mjs';
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

const root = path.join(os.homedir(), '.dsh', 'sessions');
const files = [];
const walk = (folder) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'session.v4.jsonl.zstd') files.push({ full, size: fs.statSync(full).size });
  }
};
walk(root);
files.sort((a, b) => b.size - a.size);

let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (module) => (loaded = module) } };
await import(new URL('../client.js', import.meta.url).href);
const requireReact = (name) => {
  if (name === 'react') return react;
  throw new Error(`require 了不该 require 的包: ${name}`);
};
const dictionaries = {};
const plugin = loaded.factory(requireReact);
plugin.apply({
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

/** useState 垫片：整屏一次渲染时，hook 调用顺序 = 每张卡的 4 个状态依次排列。 */
function shimmed(count, makeValue) {
  let index = 0;
  return {
    ...react,
    useState: (initial) => {
      const value = makeValue(Math.floor(index / 4), index % 4) ?? initial;
      index++;
      return [value, () => {}];
    },
  };
}

async function render(turns, makeValue, label) {
  const shim = shimmed(turns.length, makeValue);
  let View = null;
  loaded
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
  const started = process.hrtime.bigint();
  const stream = await server.renderToReadableStream(
    react.createElement(View, {
      t,
      useProjection: (key, selector) => (selector === undefined ? turns : selector(turns)),
      inputActions: { captureInsertion: () => ({}), insertText: () => {} },
      inspectCall: () => {},
    }),
  );
  const html = await new Response(stream).text();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const elements = (html.match(/<[a-zA-Z]/g) ?? []).length;
  console.log(
    `  ${label.padEnd(18)} HTML ${String(Math.round(html.length / 1024)).padStart(4)} KB ｜ 元素 ${String(elements).padStart(5)} 个 ｜ ${ms.toFixed(0)} ms`,
  );
  return { bytes: html.length, elements, ms };
}

for (const file of files.slice(0, 3)) {
  let state = viewDefinition.init();
  for (const event of readSessionEvents(file.full)) state = viewDefinition.apply(state, event);
  const turns = viewDefinition.wire.view(state);
  const tools = turns.reduce((sum, turn) => sum + (turn.counts?.tools ?? 0), 0);
  console.log(`\n会话 ${path.basename(path.dirname(file.full))}：${turns.length} 轮 / ${tools} 次工具调用`);
  // 默认态：信息块收起（只有状态是 done 且块数 > 2 的才真的是收起态）。makeValue(卡序, 状态位) → 值。
  await render(turns, (card, slot) => (slot === 0 ? false : slot === 1 ? {} : slot === 2 ? {} : false), '默认（叠压）');
  // 全部展开：每张卡都铺开，但原始记录仍关着（slot 3 必须显式 false——传 {} 是 truthy，会误开）。
  await render(turns, (card, slot) => (slot === 0 ? true : slot === 3 ? false : {}), '全部展开');
  // 连原始记录也打开：最坏情况。
  await render(turns, (card, slot) => (slot === 0 || slot === 3 ? true : {}), '展开 + 原始记录');
}