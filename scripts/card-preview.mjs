/**
 * 一次性检视：把真实轮次渲染成 HTML 后剥掉标签，按“肉眼读一遍卡片”的方式打印出来。
 * SSR 断言只能证明“渲染没坏”，证明不了“读起来像样”——这一步补的就是后者。
 *
 * 用法: node card-preview.mjs [会话序号] [轮次数量] [--state wait|run|fail|interrupt|done] [--full]
 *   --state  只看某个状态的轮次（默认看最后一轮）
 *   --full   连「回答全文」一起打开
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

// 挑文件按大小降序，默认看最大的那个会话（内容最丰富）。
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
// 位置参数先做数字校验：`--state done` 会让 argv[2] 变成 '--state'，
// 直接 Number() 会得到 NaN，打印出来的成了「打印最后 NaN 轮」。
const numeric = (value, fallback) => (/^\d+$/.test(value ?? '') ? Number(value) : fallback);
const file = files[numeric(process.argv[2], 0)]?.full ?? files[0].full;
const count = numeric(process.argv[3], 4);
const stateIndex = process.argv.indexOf('--state');
const wantedState = stateIndex === -1 ? null : process.argv[stateIndex + 1];
const withFull = process.argv.includes('--full');

let state = viewDefinition.init();
for (const event of readSessionEvents(file)) state = viewDefinition.apply(state, event);
const allTurns = viewDefinition.wire.view(state);
const turns = wantedState === null ? allTurns : allTurns.filter((turn) => turn.state === wantedState);
console.log(`会话 ${path.basename(path.dirname(file))}，共 ${allTurns.length} 轮${wantedState === null ? '' : `（其中 ${turns.length} 轮是 ${wantedState}）`}，打印最后 ${count} 轮${withFull ? '（回答全文已打开）' : ''}\n`);

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

/**
 * 「每一块都点开」的标记：客户端的 `opened` 只看 `opened[block.id] === true`，
 * 所以一个对任何键都答 true 的 Proxy 就等于「N 块全开」，不用把块 id 抄一遍（抄了会漂移）。
 * （2026-10 起「展开整摞」不再等于「展开内容」，这里要的是后者。）
 */
const ALL_OPEN = new Proxy({}, { get: (target, key) => (key === 'toString' ? () => 'ALL_OPEN' : true) });

/** 固定展开态：每块内容都可见（--full 时连回答全文一起打开）。 */
function shimmed() {
  const queue = [true, ALL_OPEN, {}, withFull];
  let index = 0;
  const shim = { ...react, useState: (initial) => [index < queue.length ? queue[index++] : initial, () => {}] };
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
  return View;
}

function textOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/(div|p|li|section|button|span)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

for (const turn of turns.slice(-count)) {
  const View = shimmed();
  const stream = await server.renderToReadableStream(
    react.createElement(View, {
      t,
      useProjection: (key, selector) => (selector === undefined ? [turn] : selector([turn])),
      inputActions: { captureInsertion: () => ({}), insertText: () => {} },
      inspectCall: () => {},
    }),
  );
  const html = await new Response(stream).text();
  console.log(`\n${'='.repeat(72)}\n第 ${turn.turn} 轮 ｜ 状态 ${turn.state}${turn.stateReason === '' ? '' : ` · ${turn.stateReason}`} ｜ 正文 ${turn.chars} 字 ｜ 工具 ${turn.counts.tools} 次\n${'='.repeat(72)}`);
  console.log(textOf(html).replace(/^(◷|!|\?|▤|▦|◆|⧉)/gm, '  [$1]'));
}