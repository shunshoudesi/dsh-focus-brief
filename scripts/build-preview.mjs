/**
 * 一次性产物生成：把「专注」视图用真实数据、真实主题取值渲染成一个自带脚本的静态 HTML。
 *
 * 为什么要有它：用户是用一份静态 HTML（竖版堆叠.html）来沟通格式的，所以回一份同样形态的东西最直观；
 * 而且它能把一直悬着的那件事摆出来对比——卡片放在**纯白页面**上（DSH 浅色主题的实际情况）
 * 与放在**灰页面**上（用户 mockup 的做法，可一键切换），一次看清差别。
 *
 * 产物：dsh-focus-brief/preview.html
 * 用法: node build-preview.mjs [会话序号] [轮次数]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { PREVIEW, REACT_DIR as dir, themeSource } from './_paths.mjs';
import { SECTION_NAMES } from '../index.js';
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

/* ---------- 真实语料 ---------- */
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

/** 把所有会话折一遍，按状态类别挑样本——预览要覆盖到几类不同的卡片，而不是同一个会话的连续三轮。 */
const pool = [];
for (const file of files) {
  let state = viewDefinition.init();
  for (const event of readSessionEvents(file.full)) state = viewDefinition.apply(state, event);
  for (const turn of viewDefinition.wire.view(state)) {
    pool.push({ ...turn, session: path.basename(path.dirname(file.full)), });
  }
}

const has = (predicate) => pool.filter(predicate);
/**
 * 取最后一轮，但**优先挑真的带「回答全文」的那种**：
 * 投影只给最近 8 轮带全文，挑到旧轮次的话，预览里第 ③ 格就只能显示「这轮较早，只保留提炼结果」——
 * 那等于用空壳演示一个功能。
 */
const firstOf = (list) => {
  if (list.length === 0) return null;
  const withFull = list.filter((turn) => typeof turn.full === 'string' && turn.full !== '');
  return (withFull.length > 0 ? withFull : list).at(-1);
};
const pickedTurns = [
  // 信息块最多的一轮：只有 >2 块才会叠成一摞，所以必须专门挑一轮来演示叠压。
  firstOf(has((turn) => turn.state === 'done' && turn.blocks.length >= 3)),
  // 1~2 块：这是**去掉执行日志之后的常见形态**（实测 176 轮里 149 轮只有 1~2 块），
  // 按设计它们不叠、直接铺开。预览里没有它，就把最常见的样子藏起来了。
  firstOf(has((turn) => turn.state === 'done' && turn.blocks.length === 2 && (turn.decisions ?? 0) === 0)),
  firstOf(has((turn) => turn.state === 'done' && (turn.decisions ?? 0) > 0)),
  firstOf(has((turn) => turn.state === 'fail' || turn.state === 'interrupt' || turn.state === 'run')),
  firstOf(has((turn) => turn.blocks.length === 0)),
  firstOf(has((turn) => turn.blocks.some((block) => block.id === 'kpi'))),
].filter((turn) => turn !== null);
const picked = [];
for (const turn of pickedTurns) if (!picked.some((item) => item.session === turn.session && item.turn === turn.turn)) picked.push(turn);

/* ---------- 插件 CSS + 真实主题取值 ---------- */
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
loaded
  .factory((name) => (name === 'react' ? fakeReact : (() => { throw new Error(name); })()))
  .apply({
    effect: (fn) => fn(),
    slots: { inject: (key, callback) => callback(), register: () => () => {} },
    locale: { register: () => () => {}, bind: () => (key) => key },
  });

const themeFile = themeSource();
const source = fs.readFileSync(themeFile, 'utf8');
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
/** 两个主题作用域里的 --dsw-* 原样抄出来（预览要长得和 DSH 一样，就得用它的真取值）。 */
const scopes = [];
for (const match of source.matchAll(/--dsw-alias-bg-layer-1\s*:/g)) {
  const body = enclosingBlock(source, match.index);
  const lines = [];
  for (const declaration of body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) lines.push(`${declaration[1]}:${declaration[2].trim()}`);
  scopes.push(lines.join(';'));
}
/** 全局里还有一层 var() 引用链，这里把用到的别名一起抄出来，避免预览里变量是空的。
 *  除了颜色，也抄 px 长度（`--dsw-radius-md` 这种）：回答气泡的圆角用的就是它，
 *  只抄颜色的话预览会静默退回兜底值、和真身长得不一样。 */
const globals = new Map();
for (const match of source.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|\d+(?:\.\d+)?px)/g)) globals.set(match[1], match[2]);
const globalCss = [...globals.entries()].map(([name, value]) => `${name}:${value}`).join(';');

/* ---------- 渲染 ---------- */
// client.js 是 ESM，第二次 import 会用缓存、不会再触发 __ModuleLoader__.load，
// 所以复用第一次导入时捕获到的那个模块对象。
const clientModule = loaded;
if (clientModule === null) throw new Error('没捕获到客户端半模块');
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

/** useState 垫片：一整屏渲染时 hook 顺序是每张卡的 4 个状态依次排列。 */
function useStateShim(queue) {
  let index = 0;
  return {
    ...react,
    useState: (initial) => {
      const value = queue[index];
      index++;
      return [value === undefined ? initial : value, () => {}];
    },
  };
}

async function renderTurns(turns, perCard) {
  const queue = [];
  for (let i = 0; i < turns.length; i++) queue.push(...perCard);
  const shim = useStateShim(queue);
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
    }),
  );
  return await new Response(stream).text();
}

const sections = [];
for (const turn of picked) {
  // 这一轮第一个信息块的 id：④ 那一格要「只点开它」。
  const firstBlock = turn.blocks[0]?.id;
  const openFirst = firstBlock === undefined ? {} : { [firstBlock]: true };
  const deck = await renderTurns([turn], [false, {}, {}, false]);
  // ③ 只点「展开 N 个信息块」：opened 传空表 → N 个标题行铺开、每块内容都不进 DOM。
  const expanded = await renderTurns([turn], [true, {}, {}, false]);
  // ④ 展开整摞之后再点开**其中一块**：`opened` 是白名单，所以只把这一块 id 放进去。
  const oneOpen = await renderTurns([turn], [true, openFirst, {}, false]);
  // 第 4 个 useState 是「展开回答全文」——原始记录模块删掉之后它是最后一个开关。
  const answerFull = await renderTurns([turn], [true, {}, {}, true]);
  const title = turn.title === '' ? `第 ${turn.turn} 轮` : turn.title;
  // >2 块才叠成一摞；1~2 块按设计直接铺开，两种形态的说明必须分开写，不然会让人以为抖不出叠压效果。
  const deckTag = turn.blocks.length > 2 ? '② 默认：信息块叠压成一摞' : `② 默认：只有 ${turn.blocks.length} 个块，直接铺开（不叠）`;
  const openTag = firstBlock === undefined ? '④ 这一轮没有信息块可点开' : `④ 再点开其中一块（${escapeHtml(zh[`block.${firstBlock}`] ?? firstBlock)}）：只有它把内容铺出来`;
  const hasAnswer = turn.full !== '';
  sections.push(`
  <section class="pv-section">
    <div class="pv-cap">会话 ${turn.session.slice(-8)} · 第 ${turn.turn} 轮 · 状态 ${turn.state}${turn.decisions > 0 ? ` · 待你定 ${turn.decisions}` : ''} · 正文 ${turn.chars} 字 · 工具 ${turn.counts.tools} 次 —— <b>${escapeHtml(title)}</b></div>
    <div class="pv-pair">
      <div><div class="pv-tag">① 点「展开回答全文」：回答区里换成全文${hasAnswer ? '' : '（这一轮没有全文可展开，这个按钮不出现）'}</div>${answerFull}</div>
      <div><div class="pv-tag">${deckTag}</div>${deck}</div>
      <div><div class="pv-tag">③ 点「展开 N 个信息块」后：<b>只铺开 N 个标题行，每块内容仍然收起</b>（内容按需进 DOM）</div>${expanded}</div>
      <div><div class="pv-tag">${openTag}</div>${oneOpen}</div>
    </div>
  </section>`);
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>专注视图 · 真实数据渲染预览</title>
<style>
/* DSH 主题的真实 token 取值（浅色作用域） */
:root{${globalsCssSafe(scopes[0], globalCss)}}
/* 深色作用域：DSH 自己在 body 上打 data-ds-dark-theme */
body[data-ds-dark-theme]{${globalsCssSafe(scopes[1], '')}}
/* 页面底色：左边那格模拟 DSH 浅色主题（纯白），右边那格换成 mockup 的灰（#f0f0f0） */
html,body{margin:0}
body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;font-size:14px;line-height:1.6}
body[data-gray-page="true"]{--dsw-alias-bg-base:#f0f0f0}
body[data-ds-dark-theme][data-gray-page="true"]{--dsw-alias-bg-base:#101012}

.pv-head{max-width:720px;margin:0 auto;padding:28px 16px 8px}
.pv-head h1{font-size:19px;margin:0 0 6px}
.pv-head p{margin:0 0 6px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.pv-ctl{max-width:720px;margin:14px auto 0;padding:10px 12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;font-size:12.5px;background:var(--dsw-alias-bg-layer-1)}
.pv-ctl button{font:inherit;font-size:12px;font-weight:600;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.pv-section{max-width:720px;margin:26px auto 0;padding:0 16px}
.pv-cap{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.pv-cap b{color:var(--dsw-alias-label-primary)}
.pv-tag{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:0 0 6px}
.pv-pair{display:flex;flex-direction:column;gap:18px}
.pv-note{max-width:720px;margin:34px auto 60px;padding:0 16px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.8}
/* ===== 插件实际注入的那段 CSS（v2 专注视图 + v1 小卡，一字未改） ===== */
${injected}
/* ===== 预览自己的覆盖：真身是「外壳容器里的滚动子项」，这里让整页自己滚 ===== */
.dfv-root{flex:none;overflow:visible;padding:0}
.dfv-feed{max-width:100%}
</style>
</head>
<body>
<div class="pv-head">
  <h1>专注视图 · 真实数据渲染预览</h1>
  <p>数据是真的（${picked.map((turn) => `会话 ${turn.session.slice(-8)} 第 ${turn.turn} 轮`).join('、')}），配色是 DSH 主题的真实 token 取值，样式是插件实际注入的那段 CSS。</p>
  <p>只差真实环境的三样：字体回退、外壳的列宽、以及输入框区域。真身在 DSH 会话标题栏的「专注」标签里。</p>
</div>
<div class="pv-ctl">
  <span>主题：<button type="button" data-act="theme">切换深色 / 浅色</button></span>
  <span>页面底色：<button type="button" data-act="page">在「白」（DSH 浅色实际）与「灰 #f0f0f0」（你那份 mockup）之间切换</button></span>
  <span id="pv-state">当前：浅色 · 白页面</span>
</div>
${sections.join('\n')}
<div class="pv-note">
  <b>看什么：</b>① <b>你输入的原话</b>就在每轮卡片上方那条蓝底黑字气泡里（官方气泡自己的 token，一字不改）；
  ② 卡片里是<b>回答</b>：默认一句话结论，点「展开回答全文」换成全文（markdown 渲染成元素，不是源码）；
  ③ 信息块超过 2 个时那一摞有没有「叠在一起」的感觉（层间只叠 6px，底下两层缩窄的纸边）；
  ④ <b>点一下「展开 N 个信息块」到底展开了什么</b>：只铺开 N 个标题行，每块内容仍是收起的，
  再点那一块（④ 那格）才把它的内容放进 DOM——每块内容都是按需渲染的，不点就不进页面；
  ⑤ 卡片边界在<b>白页面</b>下是否糊在背景里（实测发丝边对页面底只有 1.26:1，按上面的按钮自己比）。
  <br>卡片上<b>没有执行日志、也没有原始记录模块</b>：工具调用时间线在官方「轨迹」视图里；回答全文就在这块卡片上。
</div>
<script>
(function () {
  var body = document.body;
  var state = document.getElementById('pv-state');
  function sync() {
    state.textContent = '当前：' + (body.dataset.dsDarkTheme === undefined ? '浅色' : '深色') + ' · ' + (body.dataset.grayPage === 'true' ? '灰页面' : '白页面');
  }
  // 地址栏加 #dark / #gray（可组合成 #dark,gray）就能直接以某个形态打开——截图与分享都用得上。
  var hash = String(location.hash || '').replace(/^#/, '');
  for (var flag of hash.split(',')) {
    if (flag === 'dark') body.dataset.dsDarkTheme = '';
    if (flag === 'gray') body.dataset.grayPage = 'true';
  }
  document.querySelector('[data-act="theme"]').addEventListener('click', function () {
    if (body.dataset.dsDarkTheme === undefined) body.dataset.dsDarkTheme = '';
    else delete body.dataset.dsDarkTheme;
    sync();
  });
  document.querySelector('[data-act="page"]').addEventListener('click', function () {
    if (body.dataset.grayPage === 'true') delete body.dataset.grayPage;
    else body.dataset.grayPage = 'true';
    sync();
  });
  sync();
})();
</script>
</body>
</html>`;

/** 主题作用域里的 var() 引用要靠全局表展开，否则预览里会有一半变量取不到值。 */
function globalsCssSafe(scope, extra) {
  return [extra, scope].filter((part) => part !== '').join(';');
}

const out = PREVIEW;
fs.writeFileSync(out, html, 'utf8');
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`写出 ${out}：${kb} KB，${picked.length} 轮 × 4 种状态，CSS ${injected.length} 字符`);
// 轮次里带上「这轮有没有写契约段」——履历里绝大部分轮次是契约之前写的，
// 不打这个标记的话，看到「块 0」会以为是解析器坏了。
const contractMark = (turn) => {
  const raw = turn.full === '' ? '' : turn.full;
  const hit = SECTION_NAMES.filter((name) => new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'm').test(raw));
  return hit.length === 0 ? '' : `,契约${hit.length}段`;
};
const anyContractMark = (turn) => {
  // 最近 8 轮的全文在 wire 里；更早的轮次没有全文，用「块里有没有 points/risks」间接判断。
  if (turn.full !== '') return contractMark(turn);
  return turn.blocks.some((block) => block.id === 'points' || block.id === 'risks') ? ',契约段' : '';
};
console.log(`轮次：${picked.map((turn) => `${turn.session.slice(-8)}#${turn.turn}(${turn.state}${turn.decisions > 0 ? `,待你定${turn.decisions}` : ''},块${turn.blocks.length}${anyContractMark(turn)})`).join(' ')}`);
console.log(`缺少的字典键：${[...new Set((html.match(/MISSING:[a-z.]+/g) ?? []))].join(' ') || '无'}`);
console.log(`两套主题都有 token：浅 ${scopes[0].length} 字符 / 深 ${scopes[1].length} 字符`);