/**
 * 一次性取证：在**真浏览器**里量「滚轮到底能不能滚」。
 *
 * 为什么要有它：滚轮那条 bug 靠读源码定位，但「布局假设」这类问题整套回归都验不到
 * （SSR 不做布局）。这里把外壳真实的容器链抄进一个页面，再用真 Chromium 一量：
 * 四个组合 = {新 CSS, 旧 CSS} × {活跃期, 有输入框浮层}。旧 CSS + 活跃期应当复现 bug，
 * 否则说明我的因果判断错了。
 *
 * 产物：.tmp/layout-harness.html（页面自己把结论写进 <pre id="report"> 与 document.title）
 * 用法: node .tmp/build-layout-harness.mjs && node .tmp/probe-layout.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { REACT_DIR as dir, themeSource } from './_paths.mjs';

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

/* ---------- 真实卡片 HTML（最大的那个会话，默认叠压态） ---------- */
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
let state = viewDefinition.init();
for (const event of readSessionEvents(files[0].full)) state = viewDefinition.apply(state, event);
const turns = viewDefinition.wire.view(state);

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

const queue = [];
for (let i = 0; i < turns.length; i++) queue.push(false, {}, {}, false);
let hookIndex = 0;
const shim = { ...react, useState: (initial) => [queue[hookIndex++] ?? initial, () => {}] };
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
    useProjection: (key, selector) => (selector === undefined ? turns : selector(turns)),
    inputActions: { captureInsertion: () => ({}), insertText: () => {} },
    inspectCall: () => {},
  }),
);
const cards = await new Response(stream).text();

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

/** 一个模拟视口：外壳真实容器链 + 真实卡片。 */
const stack = (title, extraClass, probeId) => `
<div class="stack ${extraClass}">
  <h2>${title}</h2>
  <div class="shell-root" data-probe="${probeId}">
    <div class="shell-body">
      <div class="shell-scrollBody">
        <div class="shell-viewArea">${cards}</div>
        <div class="shell-composerSeat"></div>
      </div>
    </div>
  </div>
</div>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>layout-harness</title>
<style>
:root{${globalTokens};${scopeLines[0]}}
/* ===== 外壳真实容器链（规则照 ui-conversation 的 client.js 抄） ===== */
.shell-root{background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex;position:relative}
.shell-body{flex-direction:column;flex:1;min-height:0;display:flex;position:relative}
.shell-scrollBody{scrollbar-gutter:stable;flex-direction:column;flex:1;min-height:0;margin-right:2px;display:flex;overflow-y:auto}
.shell-viewArea{flex-direction:column;flex:1;min-height:0;display:flex}
.stack-active .shell-viewArea{flex:1 0 auto;min-height:auto}
.stack-overlay .shell-viewArea{flex:1 1 0;min-height:0;overflow:hidden}
.shell-composerSeat{flex:none;height:120px;position:sticky;bottom:0;background:var(--dsw-alias-bg-base)}
/* 复现用的旧写法（特异性高于插件那条，所以能覆盖） */
.stack-old .dfv-root{height:100%;overflow-y:auto;overscroll-behavior:contain}
body{margin:0;font-family:"Microsoft YaHei",sans-serif;background:#888}
.stack{height:460px;margin:10px;border:2px solid #000;overflow:hidden;position:relative}
.stack h2{margin:0;padding:2px 6px;font-size:12px;background:#000;color:#fff;position:absolute;z-index:99;left:0;top:0}
.cap{padding:3px 6px;font-size:12px;background:#ffd;border-bottom:1px solid #999}
${injected}
</style>
</head>
<body>
<div class="cap">真浏览器布局取证：每格 460px 高的模拟视口，里面是外壳真实容器链 + 真实卡片（${turns.length} 轮）</div>
${stack('A 新 CSS · 活跃期', 'stack-active stack-new', 'active-new')}
${stack('B 旧 CSS · 活跃期（应当复现滚轮失效）', 'stack-active stack-old', 'active-old')}
${stack('C 新 CSS · 有输入框浮层', 'stack-overlay stack-new', 'overlay-new')}
${stack('D 旧 CSS · 有输入框浮层', 'stack-overlay stack-old', 'overlay-old')}
<pre id="report" style="background:#111;color:#0f0;padding:8px;font-size:12px">（脚本还没跑）</pre>
<script>
function probe(id) {
  const stackNode = document.querySelector('[data-probe="' + id + '"]');
  const rootNode = stackNode.querySelector('.dfv-root');
  const scrollBody = stackNode.querySelector('.shell-scrollBody');
  const viewArea = stackNode.querySelector('.shell-viewArea');
  const rootStyle = getComputedStyle(rootNode);
  const canScroll = (el) => el.scrollHeight > el.clientHeight + 1;
  let node = rootNode.parentElement;
  let ancestor = null;
  while (node !== null) {
    const style = getComputedStyle(node);
    if (canScroll(node) && style.overflowY !== 'hidden' && style.overflowY !== 'visible') {
      ancestor = node.className;
      break;
    }
    node = node.parentElement;
  }
  const rootScrolls = canScroll(rootNode);
  const blocksChain = !rootScrolls && rootStyle.overscrollBehaviorY === 'contain';
  const wheelScrolls = rootScrolls ? 'self' : blocksChain ? 'BLOCKED' : ancestor !== null ? 'ancestor' : 'nowhere';
  const outerBefore = scrollBody.scrollTop;
  scrollBody.scrollTop = 99999;
  const outerAfter = scrollBody.scrollTop;
  scrollBody.scrollTop = outerBefore;
  const innerBefore = rootNode.scrollTop;
  rootNode.scrollTop = 99999;
  const innerAfter = rootNode.scrollTop;
  rootNode.scrollTop = innerBefore;
  return {
    id,
    rootOverflowY: rootStyle.overflowY,
    rootOverscroll: rootStyle.overscrollBehaviorY,
    rootScrolls,
    viewAreaH: Math.round(viewArea.getBoundingClientRect().height),
    viewAreaOverflow: getComputedStyle(viewArea).overflowY,
    outerScrolls: canScroll(scrollBody),
    outerScrollableByWrite: Math.round(outerAfter) > 0,
    innerScrollableByWrite: Math.round(innerAfter) > 0,
    wheelScrolls,
  };
}
const report = ['active-new', 'active-old', 'overlay-new', 'overlay-old'].map(probe);
document.getElementById('report').textContent = JSON.stringify(report, null, 1);
document.title = 'HARNESS ' + report.map((entry) => entry.id + '=' + entry.wheelScrolls).join(' ');
</script>
</body>
</html>`;

const out = '.tmp/layout-harness.html';
fs.writeFileSync(out, html, 'utf8');
console.log(`写出 ${out}：${Math.round(html.length / 1024)} KB｜卡片 ${turns.length} 轮｜外壳链：scrollBody{overflow-y:auto} > viewArea > 视图`);