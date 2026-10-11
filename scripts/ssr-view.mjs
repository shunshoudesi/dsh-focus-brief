/**
 * 一次性端到端验证：真 React（开发版，会报告警）+ 真实会话折叠数据 → 真渲染成 HTML。
 *
 * 覆盖两层：
 * 1. 真实语料：14 个会话、200+ 轮，每轮 4 种交互状态（叠压 / 展开 / 单块折叠 / 展开全部 / 展开回答全文）。
 * 2. 合成边界：没有信息块、只有 1~2 块、5 块、四种状态、更早的轮次没有全文、正文被截断、超长与怪异字符，
 *    以及「旧宿主还在推执行过程块」这一种过渡态。
 *
 * 断言：不抛错、无 React 告警、字典键不缺、状态与计数渲染正确、隐藏态真的没有正文、
 * 执行日志与原始记录模块都不出现（那是用户明确不要的东西）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { REACT_DIR as dir } from './_paths.mjs';

/** 载入 UMD 包（CJS 分支）。 */
function loadUmd(file, requireFn) {
  const code = fs.readFileSync(file, 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, requireFn);
  return module.exports;
}

const warnings = [];
console.error = (...args) => warnings.push(`error: ${args.map(String).join(' ')}`);
console.warn = (...args) => warnings.push(`warn: ${args.map(String).join(' ')}`);

const react = loadUmd(`${dir}react.dev.js`, () => {
  throw new Error('react 不该 require 别的包');
});
const server = loadUmd(`${dir}react-dom-server.dev.js`, (name) => {
  if (name === 'react') return react;
  throw new Error(`react-dom/server 需要 ${name}`);
});
console.log(`真 React ${react.version}`);

/* ---------------- 宿主半：折真实语料 ---------------- */
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
    else if (entry.name === 'session.v4.jsonl.zstd') files.push(full);
  }
};
walk(root);

const realTurns = [];
for (const file of files) {
  let state = viewDefinition.init();
  for (const event of readSessionEvents(file)) state = viewDefinition.apply(state, event);
  for (const turn of viewDefinition.wire.view(state)) realTurns.push(turn);
}
console.log(`真实语料折出 ${realTurns.length} 轮`);

/* ---------------- 客户端半：捕获组件与字典 ---------------- */
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (module) => (loaded = module) } };
await import(new URL('../client.js', import.meta.url).href);

/* 客户端那张「块白名单」直接按源码文本取出来跑 —— 测试里再抄一份就会漂移，
   而且这张表正是「不要执行日志」这条要求的落点，必须验的是真源码。 */
const allowSource = /const BLOCK_ALLOW = new Set\(\[[^\]]*\]\);/.exec(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'));
if (allowSource === null) throw new Error('client.js 里找不到 BLOCK_ALLOW —— 白名单被删掉了？');
const BLOCK_ALLOW = new Function(`${allowSource[0]}\n;return BLOCK_ALLOW;`)();
console.log(`块白名单（从 client.js 源码取出）: ${[...BLOCK_ALLOW].join(' ')}`);

const requireReact = (name) => {
  if (name === 'react') return react;
  throw new Error(`客户端半 require 了不该 require 的包: ${name}`);
};

const dictionaries = {};
const components = {};
const plugin = loaded.factory(requireReact);
plugin.apply({
  effect: (fn) => fn(),
  slots: {
    inject: (key, callback) => callback(),
    register: (options, component) => {
      components[options.name] = component;
      return () => {};
    },
  },
  locale: {
    register: (ns, dicts) => {
      dictionaries[ns] = dicts;
      return () => {};
    },
    bind: () => (key) => `MISSING:${key}`,
  },
});

const zh = dictionaries['focus-brief'].zh;
const interpolate = (text, params) =>
  text.replace(/\{(\w+)\}/g, (whole, key) => (params !== undefined && key in params ? String(params[key]) : whole));
const t = (key, params) => interpolate(zh[key] ?? `MISSING:${key}`, params);

const FocusView = components['conversation.view'];
const FocusBriefTail = components['conversation.chat.turnTail'];
if (FocusView === undefined || FocusBriefTail === undefined) throw new Error('没抓到两个组件');
console.log(`座位组件: conversation.view=${typeof FocusView}  conversation.chat.turnTail=${typeof FocusBriefTail}`);

/* ---------------- 渲染 ---------------- */
/**
 * 交互状态用“按下标返回固定值”的 useState 垫片驱动。
 * SSR 里 effect 不跑，而组件内的 hook 调用顺序是固定的，所以这在单卡渲染下是确定的。
 */
function useStateShim(queue) {
  let index = 0;
  return {
    ...react,
    useState: (initial) => {
      const value = index < queue.length ? queue[index] : initial;
      index++;
      return [value, () => {}];
    },
  };
}

async function renderView(turns, queue, withInput) {
  const shim = useStateShim(queue);
  const localPlugin = loaded.factory((name) => (name === 'react' ? shim : requireReact(name)));
  let View = null;
  localPlugin.apply({
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
      useProjection: (key, selector) => {
        // 顺手把选择器的“引用稳定性”也验一遍：同一个输入必须返回同一个引用，
        // 否则 useProjection（按引用比较）会把组件拖进无限重渲染。
        if (selector !== undefined) {
          const inputs = [turns, undefined, null, {}, 0, 'x'];
          for (const input of inputs) {
            const first = selector(input);
            const second = selector(input);
            check(`投影选择器对 ${JSON.stringify(input)?.slice(0, 12) ?? 'undefined'} 必须引用稳定`, first === second);
          }
        }
        return selector === undefined ? turns : selector(turns);
      },
      inputActions: withInput === false ? undefined : { captureInsertion: () => ({}), insertText: () => {} },
    }),
  );
  return await new Response(stream).text();
}

async function renderTail(turn, open) {
  // v1 的卡片只有一个 useState(open)。
  const shim = useStateShim([open]);
  const localPlugin = loaded.factory((name) => (name === 'react' ? shim : requireReact(name)));
  let Tail = null;
  localPlugin.apply({
    effect: (fn) => fn(),
    slots: {
      inject: (key, callback) => callback(),
      register: (options, component) => {
        if (options.name === 'conversation.chat.turnTail') Tail = component;
        return () => {};
      },
    },
    locale: { register: () => () => {}, bind: () => t },
  });
  const stream = await server.renderToReadableStream(
    react.createElement(Tail, { turn: { turn: turn.turn }, t, useProjection: () => [turn] }),
  );
  return await new Response(stream).text();
}

/* ---------------- 合成边界轮次 ---------------- */
const synthetic = [];
const base = {
  turn: 900,
  startSeq: 1,
  time: Date.UTC(2026, 9, 10, 14, 30),
  state: 'done',
  stateReason: '',
  decisions: 0,
  title: '合成边界',
  headline: '这是一句合成的结论，用来验证边界。',
  prompt: '合成的提问',
  blocks: [],
  // 宿主现在直接送「回答全文」这一份，不再有原始记录那种行数组。
  full: '合成的正文',
  fullGone: false,
  truncated: false,
  counts: { files: 0, tools: 0, kpi: 0, points: 0, risks: 0, asks: 0 },
  steps: 1,
  chars: 6,
};
synthetic.push({ ...base, turn: 901, blocks: [], counts: { ...base.counts } });
const oneBlock = [{ id: 'points', items: [{ depth: 0, text: '只有一条建议' }] }];
synthetic.push({ ...base, turn: 902, blocks: oneBlock });
synthetic.push({ ...base, turn: 903, blocks: [...oneBlock, { id: 'files', items: [{ path: 'a/b/c.html', name: 'c.html', dir: 'b', ext: 'HTML' }] }], counts: { ...base.counts, files: 1 } });
const manyBlocks = [
  { id: 'asks', items: [{ text: '要你拍板的一件事' }] },
  { id: 'kpi', items: [{ k: '岗位总数', v: '386' }, { k: '匹配度', v: '57' }] },
  { id: 'files', items: Array.from({ length: 8 }, (_, index) => ({ path: `p/f${index}.xlsx`, name: `f${index}.xlsx`, dir: 'p', ext: 'XLSX' })) },
  { id: 'points', items: Array.from({ length: 7 }, (_, index) => ({ depth: index % 3, text: `建议 ${index}` })) },
  { id: 'risks', items: [{ text: '这是一个风险提醒' }] },
];
synthetic.push({ ...base, turn: 904, blocks: manyBlocks, state: 'wait', counts: { files: 8, tools: 12, kpi: 2, points: 7, risks: 1, asks: 1 } });
// 更早的轮次没有全文（只保留提炼结果）：`fullGone` 让卡片明说一句。
synthetic.push({ ...base, turn: 905, blocks: manyBlocks, state: 'run', full: '', fullGone: true, counts: { ...base.counts } });
synthetic.push({ ...base, turn: 906, blocks: manyBlocks, state: 'fail', stateReason: 'error', full: '', fullGone: true });
synthetic.push({ ...base, turn: 907, blocks: manyBlocks, state: 'interrupt', stateReason: 'max-tokens', truncated: true });
// 状态名和理由同义时不该画两遍（真实卡上出现过「中断 · 已中断」）。
synthetic.push({ ...base, turn: 912, title: '同义理由', blocks: oneBlock, state: 'interrupt', stateReason: 'interrupted' });
// 但「中断 · 已中止」是不同信息，要留。
synthetic.push({ ...base, turn: 913, title: '不同理由', blocks: oneBlock, state: 'interrupt', stateReason: 'aborted' });
synthetic.push({ ...base, turn: 908, title: '', headline: '', blocks: [], full: '', fullGone: false, chars: 0, decisions: 0 });
// 完成 + 结尾有待办：点仍是完成色，药丸转琥珀并写明几件事要你定。
synthetic.push({
  ...base,
  turn: 911,
  title: '完成但有待办',
  state: 'done',
  decisions: 2,
  blocks: [{ id: 'asks', items: [{ text: '要不要提交 git' }, { text: '圆点要不要加描边' }] }],
  counts: { ...base.counts, asks: 2 },
});
// 旧宿主（还没重启的那一半）会继续把 `steps` 块推过来。客户端必须**整块丢掉**：
// 用户的原话是「不要他的执行日志」，而客户端刷新一下就换新，这条要求不该等宿主重启才成立。
// 同时留一条正文块，证明丢的是那一块、不是整张卡。
synthetic.push({
  ...base,
  turn: 910,
  title: '旧宿主推来的执行日志',
  blocks: [
    {
      id: 'steps',
      items: [
        { label: 'MCP web · browser_click', detail: '', status: 'done', note: '', count: 3 },
        { label: '运行命令', detail: 'ls', status: 'done', note: '', count: 1 },
      ],
      total: 4,
    },
    { id: 'points', items: [{ depth: 0, text: '日志之外的正文还在' }] },
  ],
  counts: { ...base.counts, tools: 4, points: 1 },
});
synthetic.push({
  ...base,
  turn: 914,
  title: '',
  prompt: '',
  promptMedia: 1,
  blocks: oneBlock,
});
synthetic.push({
  ...base,
  turn: 909,
  title: '奇怪字符',
  headline: '<script>alert(1)</script> & "引号" 😀 \u0000 制表\u0009符',
  blocks: [{ id: 'points', items: [{ depth: 0, text: '<b>粗体注入</b> & 中文' }] }],
  full: '</div><script>bad</script>',
});

const allTurns = [...realTurns, ...synthetic];
console.log(`待渲染轮次：真实 ${realTurns.length} + 合成 ${synthetic.length}`);

const queues = [
  ['叠压（默认）', [false, {}, {}, false]],
  ['展开整摞', [true, {}, {}, false]],
  ['单块折叠', [true, { points: true }, {}, false]],
  ['展开全部项', [true, {}, { points: true, files: true }, false]],
  // 第 4 个 useState 是「展开回答全文」——原始记录模块删掉之后，它是最后一个开关。
  ['展开回答全文', [true, {}, {}, true]],
];

let renders = 0;
let bad = 0;
const problems = [];
/** React 会转义文本里的 & < > " '，断言前要按同一套规则转义（否则含 & 的标题永远比不中）。 */
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
function check(label, ok, detail) {
  renders++;
  if (ok) return;
  bad++;
  if (problems.length < 12) problems.push(`${label}：${detail ?? ''}`);
}

for (const turn of allTurns) {
  for (const [stateName, queue] of queues) {
    let html = '';
    try {
      html = await renderView([turn], queue, true);
    } catch (error) {
      check(`渲染抛错 第${turn.turn}轮/${stateName}`, false, error.message);
      continue;
    }
    const tag = `第${turn.turn}轮/${stateName}`;
    check(`${tag} 不应出现未替换的字典键`, !html.includes('MISSING:'), html.match(/MISSING:\w+/)?.[0]);
    check(`${tag} 不应出现 undefined 文本`, !/>(undefined|NaN)</.test(html), html.match(/>(undefined|NaN)</)?.[0]);
    check(`${tag} 不应出现 undefined 属性`, !/="undefined"/.test(html));
    const blocks = (Array.isArray(turn.blocks) ? turn.blocks : []).filter((block) => BLOCK_ALLOW.has(block.id));
    const fanned = turn.state !== 'done' || blocks.length <= 2;
    const open = queue[0] === true || fanned;
    // 四个开关的下标：deckOpen=0 / closed=1 / showAll=2 / fullOpen=3（原始记录删掉后它是最后一个）。
    const fullOpen = queue[3] === true;
    check(`${tag} 折叠态不应渲染正文`, !(open === false && html.includes('dfv-body')));
    if (blocks.length > 0) check(`${tag} 展开态应有标题行`, html.includes('dfv-row'));
    if (blocks.length > 0) {
      check(`${tag} 每块都有图标', `, (html.match(/dfv-ico/g) ?? []).length >= blocks.length);
    }
    if (turn.title !== '') check(`${tag} 应渲染标题`, html.includes(escapeHtml(turn.title.slice(0, 8))));
    if (turn.title === '' && turn.headline !== '' && blocks.length <= 2 && fullOpen === false) {
      // 标题位只在该轮没有标题时才用「第 N 轮」兜底，绝不拿结论行去填——那会让同一句话出现两次。
      check(`${tag} 无标题时标题位用「第 N 轮」`, html.includes(escapeHtml(zh['card.turnFallback'].replace('{turn}', String(turn.turn)))));
      const needle = escapeHtml(turn.headline.slice(0, 10));
      // 三段的边界：卡片头（标题位）→ 回答区 → 信息块。
      // **不能**从 html 开头切：提问气泡排在卡片前面，而你的提问里完全可能正好含结论那句话。
      const cardAt = html.indexOf('class="dfv-card"');
      const answerAt = html.indexOf('class="dfv-answer"');
      const blocksAt = html.indexOf('dfv-blocks');
      check(`${tag} 标题位／卡片头部不许复制结论行`, cardAt < 0 || answerAt < 0 || !html.slice(cardAt, answerAt).includes(needle));
      const inAnswer = answerAt < 0 ? '' : html.slice(answerAt, blocksAt < 0 ? html.length : blocksAt);
      const occurrences = inAnswer.split(needle).length - 1;
      check(`${tag} 回答区里结论只该出现一次`, occurrences === 1, `${occurrences} 次`);
    }
    if (turn.title === '' && turn.headline === '' && blocks.length === 0 && turn.chars === 0) {
      check(`${tag} 全空轮次应显示占位`, html.includes(zh['card.turnFallback'].replace('{turn}', String(turn.turn))));
    }
    if (blocks.length > 2 && turn.state === 'done' && queue[0] === false) {
      check(`${tag} 叠压态应有展开胶囊`, html.includes(zh['card.expandBlocks'].replace('{count}', String(blocks.length))));
    }
    if (blocks.length > 2 && turn.state === 'done' && queue[0] === true) {
      check(`${tag} 展开态应有收起胶囊`, html.includes(zh['card.collapseBlocks']));
    }
    // 原始记录模块被整个去掉了：任何一轮都不该再出现它的骨架。
    // 只查结构（`class="dfv-raw`）——真实回答的正文里会提到「原始记录」这四个字（我自己的轮次就是）。
    check(`${tag} 不该再有原始记录模块`, !html.includes('class="dfv-raw'));
    if (turn.state !== 'done') {
      check(`${tag} 状态药丸应显示对应状态`, html.includes(zh[`state.${turn.state}`]));
    }
    if (turn.state === 'done' && (turn.decisions ?? 0) > 0) {
      check(`${tag} 完成但有待办时药丸应写「待你定 N」`, html.includes(zh['card.decide'].replace('{count}', String(turn.decisions))));
      check(`${tag} 完成但有待办时状态点仍是完成色`, html.includes('data-state="done"'));
      check(`${tag} 药丸转成琥珀（data-state=wait）`, html.includes('data-state="wait"'));
    }
    check(`${tag} 应渲染底部元信息`, html.includes('dfv-foot'));
    check(`${tag} 应有继续追问按钮`, html.includes(zh['card.followUp']));
    if (turn.stateReason !== '') {
      // 理由和状态名同义时不画（见 client 里的同义判断），其余必须显示。
      const reasonLabel = zh[`reason.${turn.stateReason}`] ?? `?${turn.stateReason}`;
      const stateLabel = zh[`state.${turn.state}`] ?? '';
      const suppressed = stateLabel.includes(reasonLabel.replace(/^已/, ''));
      check(`${tag} 失败原因该显示就显示、同义就不显示`, suppressed ? !html.includes(reasonLabel) : html.includes(reasonLabel), `${reasonLabel} suppressed=${suppressed}`);
    }
    // 「不要执行日志」是硬要求：宿主推来的执行过程块必须整块消失——时间线、圆点、图标都不许出现。
    // 这里只查**结构标记**（class / 属性），不查裸字符串：真实回答的正文里会提到 `dfv-step-open` 这种
    // 插件自己的类名（第 32 轮就是），用裸字符串查会把它误判成"渲染了执行日志"。
    check(`${tag} 不该渲染执行日志的时间线`, !html.includes('class="dfv-step'));
    check(`${tag} 不该渲染执行日志的图标`, !html.includes('data-id="steps"'));
    // 回答：这一轮的回答就在卡里（宿主直接送 `full`，原始记录模块已经删掉）。
    // （踩过的坑：这里原先写的是 queue[4]，而当时「打开原始记录」的开关是下标 3，
    //   于是那几条断言**一次都没跑过**。现在四个开关下标摆明：fullOpen=3。）
    const fullText = typeof turn.full === 'string' ? turn.full : '';
    check(`${tag} 回答应放在卡片里（.dfv-answer）`, html.includes('dfv-answer'));
    // 用户输入单独摆出来、**原样**：不改写、不剥标记、换行保留（CSS 用 pre-wrap）。
    const media = typeof turn.promptMedia === 'number' ? turn.promptMedia : 0;
    if (turn.prompt !== '') {
      check(`${tag} 应有单独的提问气泡`, html.includes('class="dfv-ask-text"'));
      check(`${tag} 提问内容应原样出现`, html.includes(escapeHtml(turn.prompt)));
    } else if (media > 0) {
      // 只有附件没有文字（图片）：不能空着，画一个占位标记。
      check(`${tag} 只有附件时应有占位提问气泡`, html.includes('class="dfv-ask-text"') && html.includes('data-media="true"'));
      check(`${tag} 占位应说明几个附件`, html.includes(escapeHtml(zh['card.askMedia'].replace('{count}', String(media)))));
    } else {
      check(`${tag} 没有提问的轮次不该有提问气泡`, !html.includes('class="dfv-ask-text"'));
    }
    if (fullText !== '') {
      check(`${tag} 回答全文按钮应带无障碍名称`, html.includes(escapeHtml(zh['a11y.full'].replace('{count}', String(fullText.length)))));
      if (fullOpen) {
        // 注意：`dfv-full-toggle`（按钮）里也含 `dfv-full` 这几个字母，所以这里查的是 class 名本身。
        check(`${tag} 展开回答全文应渲染全文`, html.includes('class="dfv-full"'));
        // 回答正文要渲染成**元素**，不是把 markdown 源码铺出来（177 轮真实语料里出现过的结构都要覆盖）。
        // 期望值必须按**去掉围栏内容之后**的行来数：围栏里是原样保留的代码/目录树，
        // 里面的 `##`、`- `、`|---|` 都不是结构（踩过：拿全文数标题，得到 14 对 9）。
        const fenceLines = fullText.split('\n').filter((line) => /^```/.test(line.trim())).length;
        const outsideLines = [];
        let inFence = false;
        for (const line of fullText.split('\n')) {
          if (/^```/.test(line.trim())) {
            inFence = !inFence;
            continue;
          }
          if (!inFence) outsideLines.push(line);
        }
        const outside = outsideLines.join('\n');
        const countIn = (re) => (outside.match(re) ?? []).length;
        const countOut = (re) => (html.match(re) ?? []).length;
        check(`${tag} 小标题数量对得上`, countIn(/^#{1,6}\s+\S/gm) === countOut(/class="dfv-md-h"/g), `${countIn(/^#{1,6}\s+\S/gm)} vs ${countOut(/class="dfv-md-h"/g)}`);
        // 围栏行是奇数时（真实语料里有一条孤零零的 ```），renderer 会把后面全部当代码吃进去，
        // 所以期望值是 ceil 不是 floor。
        check(`${tag} 围栏代码块数量对得上`, Math.ceil(fenceLines / 2) === countOut(/class="dfv-pre"/g), `${Math.ceil(fenceLines / 2)} vs ${countOut(/class="dfv-pre"/g)}`);
        check(`${tag} 表格数量对得上`, countIn(/^\|[\s:|-]+\|$/gm) === countOut(/class="dfv-table"/g), `${countIn(/^\|[\s:|-]+\|$/gm)} vs ${countOut(/class="dfv-table"/g)}`);
        check(`${tag} 分隔线数量对得上`, countIn(/^([-*_])\s*(?:\1\s*){2,}$/gm) === countOut(/class="dfv-md-rule"/g), `${countIn(/^([-*_])\s*(?:\1\s*){2,}$/gm)} vs ${countOut(/class="dfv-md-rule"/g)}`);
        if (/^(?:[-*+]|\d+[.)])\s+\S/m.test(outside)) check(`${tag} 列表应渲染成列表`, countOut(/class="dfv-md-list"/g) >= 1);
        if (/^>\s?\S/m.test(outside)) check(`${tag} 引用应渲染成引用`, countOut(/class="dfv-md-quote"/g) >= 1);
        // 反向：源码标记不许原样露出来（围栏内部原样保留，所以先摘掉 <pre>）。
        // 区间只取到「收起全文」那个按钮为止：按钮文案和它的 aria-label 不属于回答正文，
        // 混进来会让下面的字数不变量凭空多出十几个字。
        const toggleAt = html.indexOf('class="dfv-full-toggle"');
        const bubbleEnd = toggleAt >= 0 ? toggleAt : html.indexOf('dfv-blocks') < 0 ? html.length : html.indexOf('dfv-blocks');
        const fullAt = html.indexOf('class="dfv-full"');
        // 从外层 <div 开始切：从 class 中间切会把 `class="dfv-full"` 这几个字留在文本里，
        // 字数不变量会凭空多出十几个「字母」。
        const bubble = html.slice(html.lastIndexOf('<div', fullAt), bubbleEnd);
        const outsidePre = bubble.replace(/<pre[\s\S]*?<\/pre>/g, '');
        // 先把块级元素的收尾换成换行，这样「行首」判断才成立（否则段落会被拼成一行）。
        const bubbleText = outsidePre.replace(/<\/(?:p|div|li|tr|h[1-6])>/g, '\n$&').replace(/<[^>]*>/g, '');
        check(`${tag} 气泡里不该残留表格分隔行`, !/^\|[\s:|-]+\|$/m.test(bubbleText));
        // 只查**行首**的围栏：真实回答的正文里会直接把「```json 围栏能剥出来」写进句子里（第 88 轮就是），
        // 那不是渲染漏了，是内容本身。
        check(`${tag} 气泡里不该残留行首代码围栏`, !/^```/m.test(bubbleText));
        // 内容没丢：从回答里挑几条**不含任何 markdown 标记**的行，断言它们真的出现了
        // （在**完整**气泡文本里找，不能只看去掉 <pre> 的那部分——目录树这类内容就在围栏里）。
        // 先把 HTML 实体还原再数字数：`&quot;` 里的 quot 会被当成 4 个字母，凭空多算。
        const unescapeHtml = (value) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const allText = unescapeHtml(bubble.replace(/\s[a-z-]+="[^"]*"/g, '').replace(/<\/(?:p|div|li|tr|pre|h[1-6])>/g, '\n$&').replace(/<[^>]*>/g, ''));
        let sampled = 0;
        // 从回答的**开头／中间／结尾**各挑一条不含 markdown 标记的行，断言它们真的出现了：
        // 只抽开头会漏掉「渲染到一半断掉」这类错误。
        const candidates = fullText
          .split('\n')
          .map((line) => line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
          .filter((content) => content.length >= 14 && !/[#*`|>[\]]/.test(content));
        const picks = [...new Set([candidates[0], candidates[Math.floor(candidates.length / 2)], candidates.at(-1)])].filter((item) => item !== undefined);
        for (const content of picks) {
          const needleText = content.slice(0, 12);
          sampled++;
          check(`${tag} 回答正文内容没丢（第 ${sampled} 条抽样）`, allText.includes(needleText), needleText);
        }
        // 总量只做**下界**：链接地址在真实渲染里不以文字出现（只进 title），
        // 所以「原文去掉地址之后的字数」是渲染结果的下界；上界不比——链接标签、
        // 表格单元格这些在两边算出来的字母数本来就不同口径，卡死上界只会制造假失败。
        const lettersOf = (value) => (value.match(/[0-9A-Za-z\u3400-\u9fff]/g) ?? []).length;
        const expectedLetters = lettersOf(fullText.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
        check(`${tag} 渲染出来的正文没有丢内容`, lettersOf(allText) >= expectedLetters * 0.9, `下界 ${Math.round(expectedLetters * 0.9)} 实得 ${lettersOf(allText)}`);
        // 展开时只画全文：全文本来就从那句结论开始，两处都画就是同屏重复。
        check(`${tag} 展开全文时不该再画那句结论`, !html.includes('dfv-value'));
        check(`${tag} 展开全文时应给「收起全文」`, html.includes(zh['card.fullClose']));
      } else {
        check(`${tag} 未展开时应给「展开回答全文」`, html.includes(zh['card.fullOpen'].replace('{count}', String(fullText.length))));
        check(`${tag} 未展开时应只有那句结论`, html.includes('dfv-value') && !html.includes('class="dfv-full"'));
        // 闸门：**结论那一行不许被截断**（用户要求「这个部分不设字符上限」）。
        // 两条都要有，因为历史上这里有两道裁切：
        // ① 宿主的字符上限（结论超过上限会带「…」）——这里断言渲染出来的那段结论是**原样的完整内容**；
        // ② 客户端 CSS 的 `-webkit-line-clamp:2`（只显示两行，超出无声裁掉）——这里断言那条规则里
        //    没有任何隐藏欲裁的声明（line-clamp / box-orient / overflow:hidden）。
        // 只断言「文字在 HTML 里」是不够的：CSS 裁切时文字照样在 HTML 里，只是不显示。
        if (turn.headline !== '') {
          const answerAt = html.indexOf('dfv-answer');
          const valueAt = html.indexOf('dfv-value', answerAt < 0 ? 0 : answerAt);
          const valueEnd = valueAt < 0 ? -1 : html.indexOf('</div>', valueAt);
          const valueHtml = valueAt < 0 ? '' : html.slice(valueAt, valueEnd < 0 ? valueAt + 400 : valueEnd);
          const plainValue = valueHtml.replace(/<[^>]*>/g, '');
          check(`${tag} 结论行渲染的是完整内容（没被字符上限裁断）`, plainValue.includes(escapeHtml(turn.headline)), turn.headline.slice(0, 40));
        }
      }
    } else {
      check(`${tag} 没有全文时不该给「展开回答全文」`, !html.includes('dfv-full-toggle'));
      // 更早的轮次：明说一句「这轮较早，只保留提炼结果」，而不是留一个点不动的死按钮。
      if (turn.fullGone === true && turn.chars > 0) {
        check(`${tag} 更早的轮次应说明只保留提炼结果`, html.includes(zh['card.fullGone']));
      } else {
        check(`${tag} 没有全文时不该有那句说明`, !html.includes(zh['card.fullGone']));
      }
    }
    // 截断提示现在挂在回答区下面（原先挂在原始记录面板里）。
    if (turn.truncated === true && fullOpen) {
      check(`${tag} 截断提示应出现`, html.includes(zh['card.truncated']));
    }
  }
  // 没有输入框接口时不该出现死按钮。
  const htmlNoInput = await renderView([turn], [false, {}, {}, false], false);
  check(`第${turn.turn}轮 无输入框接口时不渲染继续追问`, !htmlNoInput.includes(zh['card.followUp']));
}

/* ---------------- 滚动决策：把只在浏览器里跑的纯逻辑也验一遍 ---------------- */
/* 滚轮那条 bug 的教训：只在浏览器里跑的逻辑没人验得到。所以把 client.js 里那个纯函数
   **按源码文本取出来跑**（不是抄一份），用真源码查表——既不漂移，也不需要在浏览器里跑。 */
{
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const match = /function scrollDecision\(state\) \{[\s\S]*?\n\}/.exec(source);
  check('能从源码里取到 scrollDecision', match !== null);
  if (match !== null) {
    const scrollDecision = new Function(`${match[0]}\n;return scrollDecision;`)();
    const base = { scrollHeight: 1000, clientHeight: 400, rectBottom: 900, viewportHeight: 800, nearBottom: true, didInitialScroll: false };
    const cases = [
      ['自己是滚动容器 + 贴底 → self', { ...base }, 'self'],
      ['自己是滚动容器 + 读者滚上去了 → none', { ...base, nearBottom: false }, 'none'],
      ['自己不是滚动容器 + 首次 + 底部在视野外 → ancestor', { ...base, scrollHeight: 400, rectBottom: 1200 }, 'ancestor'],
      ['自己不是滚动容器 + 首次 + 底部已可见 → none（绝不推别的滚动祖先）', { ...base, scrollHeight: 400, rectBottom: 700 }, 'none'],
      ['自己不是滚动容器 + 已经对齐过 → none（不跟用户抢位置）', { ...base, scrollHeight: 400, rectBottom: 1200, didInitialScroll: true }, 'none'],
      ['高度相等（无可滚内容）按“不是滚动容器”处理', { ...base, scrollHeight: 401, clientHeight: 400 }, 'ancestor'],
      ['无可滚内容且底部已可见 → none', { ...base, scrollHeight: 400, rectBottom: 800 }, 'none'],
    ];
    for (const [label, state, expected] of cases) {
      const actual = scrollDecision(state);
      check(`滚动决策：${label}`, actual === expected, `期望 ${expected} 实得 ${actual}`);
    }
  }
}

/* ---------------- 空会话 + v1 小卡 ---------------- */
const emptyHtml = await renderView([], [false, {}, {}, false], true);
check('空会话应显示空态', emptyHtml.includes(zh['view.empty']));
// 连续重复的调用：一行 + ×N，而不是铺三行。
// 同义理由只画一遍；不同理由要留。
const sameReason = synthetic.find((turn) => turn.turn === 912);
const sameHtml = await renderView([sameReason], [false, {}, {}, false], true);
check('同义理由不该画两遍（不应出现「中断 · 已中断」）', !sameHtml.includes(`${zh['state.interrupt']} · ${zh['reason.interrupted']}`));
check('同义理由仍要显示状态名', sameHtml.includes(zh['state.interrupt']));
const otherReason = synthetic.find((turn) => turn.turn === 913);
const otherHtml = await renderView([otherReason], [false, {}, {}, false], true);
check('不同理由要保留（中断 · 已中止）', otherHtml.includes(`${zh['state.interrupt']} · ${zh['reason.aborted']}`));

/* ---------------- 「不要执行日志」：那一块被整块丢掉 ---------------- */
// 字典里连这个块名都不该再存在（少了它，宿主万一还推 steps 也不会翻译出一个「执行过程」标题）。
check('字典里不该再有「执行过程」这个块名', !('block.steps' in zh) && !('count.steps' in zh));
const oldHost = synthetic.find((turn) => turn.turn === 910);
const oldHostHtml = await renderView([oldHost], [true, {}, {}, false], true);
check(
  '旧宿主推来的执行过程块应当整块消失在卡片上',
  !oldHostHtml.includes('browser_click') && !oldHostHtml.includes('dfv-step') && !oldHostHtml.includes('data-id="steps"'),
);
// 关键：丢的是那一块，不是整张卡——正文块必须还在。
check('丢掉执行日志之后，同一轮的正文块仍然渲染', oldHostHtml.includes('日志之外的正文还在') && oldHostHtml.includes('dfv-point'));
// 也不留空壳（不许出现「展开 0 个信息块」这种废话）。
check(
  '执行日志块不占位、不生成空壳',
  !oldHostHtml.includes(zh['card.expandBlocks'].replace('{count}', '0')) && !oldHostHtml.includes(zh['card.more'].replace('{count}', '0')),
);
for (const turn of realTurns.slice(0, 40)) {
  for (const open of [false, true]) {
    let html = '';
    try {
      html = await renderTail(turn, open);
    } catch (error) {
      check(`v1 小卡渲染抛错 第${turn.turn}轮`, false, error.message);
      continue;
    }
    check(`v1 第${turn.turn}轮/${open ? '展开' : '折叠'} 不应有未替换键`, !html.includes('MISSING:'), html.match(/MISSING:\w+/)?.[0]);
    check(`v1 第${turn.turn}轮 折叠态不应有正文`, open || !html.includes('dfb-body'));
  }
}

console.log(`\n检查项 ${renders}，失败 ${bad} 项`);
for (const problem of problems) console.log(`  ❌ ${problem}`);
if (warnings.length > 0) {
  console.log(`\nReact 告警 ${warnings.length} 条`);
  for (const warning of warnings.slice(0, 8)) console.log(`  ${warning.slice(0, 240)}`);
}
process.exit(bad === 0 && warnings.length === 0 ? 0 : 1);