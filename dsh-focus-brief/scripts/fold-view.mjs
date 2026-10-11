/**
 * 一次性验证：把 v2 的 focusView 投影拿真实会话日志离线折一遍。
 * 不经过 DSH，直接调 index.js 里注册的定义，检查卡片原料是否成形、有没有崩、投影有多大。
 *
 * 用法:
 *   node fold-view.mjs                 # 折 ~/.dsh/sessions 下所有会话，打印总览
 *   node fold-view.mjs --dump 12       # 额外把第 12 轮完整打出来（含原始记录）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { apply } from '../index.js';

const dumped = process.argv[2] === '--dump' ? Number(process.argv[3]) : null;
/** --samples N：把每种信息块抽 N 条真实样例打出来，用来判断抽取规则有没有在制造噪音。 */
const sampleMode = process.argv[2] === '--samples' ? Number(process.argv[3] ?? 5) : null;

/** 抓注册定义与提示词契约。 */
const definitions = [];
const contracts = [];
apply({
  sessionProjections: { register: (definition) => definitions.push(definition) },
  inject: (deps, callback) => {
    callback({ systemPrompt: { section: (section) => contracts.push(section) } });
  },
});

const viewDefinition = definitions.find((definition) => definition.key === 'focusView');
const briefDefinition = definitions.find((definition) => definition.key === 'focusBrief');
if (viewDefinition === undefined || briefDefinition === undefined) throw new Error('没抓到投影定义');
console.log(`投影: ${definitions.map((definition) => `${definition.key}@v${definition.stateVersion}`).join(', ')}`);
console.log(`契约: ${contracts[0]?.text.length ?? 0} 字符`);
console.log('');

/** 会话日志的路径列表（默认扫全机）。 */
function sessionFiles() {
  const root = path.join(os.homedir(), '.dsh', 'sessions');
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'session.v4.jsonl.zstd') out.push({ full, size: fs.statSync(full).size });
    }
  };
  walk(root);
  return out.sort((a, b) => b.size - a.size);
}

const files = sessionFiles();
let turns = 0;
let states = new Map();
let blocks = new Map();
let titleFromContract = 0;
let headlineEmpty = 0;
let questions = 0;
let kpiTurns = 0;
let riskTurns = 0;
let fileTurns = 0;
let biggest = { bytes: 0, file: '' };
let biggestBrief = { bytes: 0, file: '' };
let crashed = 0;
/** 回归闸门：结论建议块里不该出现和总卡结论一样的条目，那等于同一句话占两行。 */
let selfDup = 0;
/** 一个信息块都没有的轮次（按 mockup 的 F2，这时只剩总卡）。 */
let noBlocks = 0;
/** 有标题的轮次（契约标题，或从提问抽的兜底标题）。 */
let titled = 0;
/** 每轮有几个信息块（决定叠压还是铺开：>2 才叠）。 */
const blockHist = new Map();
/** 闸门：卡片里不该再有「执行过程」块——用户明确说过不要执行日志（那是官方「轨迹」视图的活）。 */
let stepsBlocks = 0;
/** 闸门：条目必须带「字」。剥掉 markdown 标记后只剩标点的条目（`---`、孤零零的反引号）不许上卡。 */
let junkItems = 0;
/**
 * 闸门：**带原始记录的轮次里必须有那一行 answer**。
 * 客户的「回答全文」就直接读这一行（不额外往投影里塞副本），所以它一旦被 RAW_MAX 截掉，
 * 卡片上就再也看不到全文——这正是最容易悄悄发生的一种退化。
 */
let missingAnswer = 0;
/**
 * 闸门：总卡那句结论不许是 markdown 表格/结构线压平出来的。
 * 截图里亲眼见过：`| 检查 | 结果 | |---|---|---| … | 28 / 32 / 31 —— 完全一致 | …`。
 */
let junkHeadlines = 0;
/** 闸门：产出文件里不该出现隐藏文件、`.tmp/`、`node_modules/`。 */
let junkFiles = 0;
/** 完成但结尾留下待办的轮次（这些轮不该被标成待确认）。 */
let withDecisions = 0;
/** 闸门：原始记录里不该出现“成功了”这类零信息量的样板说明。 */
let boilerplateNotes = 0;
/** 单轮 wire 体积预算（KB）：目的是钉住"卡片原料"的成本——放宽上限时不许悄悄翻倍。 */
const TURN_BUDGET = 24000;
let overBudget = 0;
let biggestTurn = 0;
/** 闸门：同一轮「产出文件」里不该出现两行同一个文件（相对/绝对写法各来一行踩过）。 */
let duplicateFiles = 0;
/** 闸门：结论建议不许重复「需要你确认」/「风险提醒」里已经列出的条目（同屏重复）。 */
let crossBlockDup = 0;
/** 闸门：原始记录的说明里不该夹着工具标记语言；工具名不该还是原始 snake_case。 */
let markupNotes = 0;
let rawLabels = 0;
/**
 * 闸门：关键数据的两条不变量（故意照抄宿主那两条规则——它们正是把噪音挡在外面的东西，
 * 放宽列数时全靠它们，所以值得单独钉住）。
 */
let kpiJunk = 0;
const offenders = [];
/** 每个会话的推送代价：状态变几次、每次多大（浏览器里看不到的东西，就用事件模型量出来）。 */
const cost = [];
const samples = [];
/** 每种块的样例池，用来做抽取质量的真实取数。 */
const blockSamples = { kpi: [], asks: [], risks: [], files: [], points: [] };

for (const file of files) {
  const events = readSessionEvents(file.full);
  let state = viewDefinition.init();
  let briefState = briefDefinition.init();
  /** 状态引用变了几次 = 这个投影会往外推几次更新（无关事件必须返回同一引用，这是它的省法）。 */
  let pushes = 0;
  for (const event of events) {
    const next = viewDefinition.apply(state, event);
    if (next === undefined) throw new Error(`apply 返回 undefined: ${event.type}`);
    if (next !== state) pushes++;
    state = next;
    briefState = briefDefinition.apply(briefState, event);
  }
  cost.push({
    session: path.basename(path.dirname(file.full)).slice(-8),
    events: events.length,
    turns: state.turns.length,
    pushes,
    wireBytes: JSON.stringify(viewDefinition.wire.view(state)).length,
    stateBytes: JSON.stringify(state).length,
  });
  let value;
  try {
    value = viewDefinition.wire.view(state);
  } catch (error) {
    crashed++;
    console.log(`!! wire.view 抛错 ${file.full}: ${error.message}`);
    continue;
  }
  const briefBytes = JSON.stringify(briefDefinition.wire.view(briefState)).length;
  if (briefBytes > biggestBrief.bytes) biggestBrief = { bytes: briefBytes, file: file.full };
  const bytes = JSON.stringify(value).length;
  if (bytes > biggest.bytes) biggest = { bytes, file: file.full };
  /** 闸门：单轮 wire 体积上限。目的是钉住“卡片原料”的成本——放宽上限时不许悄悄翻倍。 */
  for (const turn of value) {
    const turnBytes = JSON.stringify(turn).length;
    if (turnBytes > biggestTurn) biggestTurn = turnBytes;
    if (turnBytes > TURN_BUDGET) overBudget++;
  }
  for (const turn of value) {
    const bytes = JSON.stringify(turn).length;
    if (bytes > biggestTurn) biggestTurn = bytes;
    if (bytes > TURN_BUDGET) overBudget++;
  }
  for (const turn of value) {
    turns++;
    if (turn.blocks.length === 0) noBlocks++;
    // 闸门：结论建议不许把「需要你确认」「风险提醒」的内容再抄一遍（同屏重复）。
    const asksBlock = turn.blocks.find((block) => block.id === 'asks');
    const risksBlock = turn.blocks.find((block) => block.id === 'risks');
    const pointsBlock2 = turn.blocks.find((block) => block.id === 'points');
    if (pointsBlock2 !== undefined) {
      const others = new Set([
        ...(asksBlock?.items ?? []).map((item) => item.text),
        ...(risksBlock?.items ?? []).map((item) => item.text),
      ]);
      for (const item of pointsBlock2.items) {
        if (others.has(item.text)) crossBlockDup++;
      }
    }
    if (turn.state === 'done' && (turn.decisions ?? 0) > 0) withDecisions++;
    for (const row of turn.raw ?? []) {
      if (row.note !== undefined && /successfully|has been (updated|created|written|saved)|已(成功)?(写入|更新|保存|创建)/i.test(row.note)) boilerplateNotes++;
      // 闸门：说明里不该夹着工具自己的标记语言（`<path>…</path>` 之类）。
      if (row.note !== undefined && /<\/?[a-z][a-z0-9-]*>/i.test(row.note)) markupNotes++;
    }
    for (const block of turn.blocks ?? []) {
      if (block.id === 'steps') stepsBlocks++;
    }
    blockHist.set(turn.blocks.length, (blockHist.get(turn.blocks.length) ?? 0) + 1);
    // 闸门：卡片上**任何地方**的工具名都不该还是原始 snake_case ——
    // 原始记录里那几行同样属于日志行，所以美化规则也得管到它（`obsidian_move` → `obsidian · move`）。
    // 只看行首：详情里出现的 `mock_target.mjs` 这类文件名不算工具名。
    for (const row of turn.raw ?? []) {
      if (row.kind !== 'tool') continue;
      if (/^[a-z0-9]+_[a-z0-9_]+(?= ·|$)/.test(String(row.text))) rawLabels++;
    }
    if (turn.title !== '') titled++;
    // 结论行不许是表格压平的产物（竖线扎堆）、结构线、或整张列表压平（`- a - b - c`）。
    if (
      turn.headline !== '' &&
      (turn.headline.startsWith('|') ||
        (turn.headline.match(/\|/g) ?? []).length >= 2 ||
        /^(?:-{3,}|\*{3,}|_{3,})$/.test(turn.headline) ||
        /^(?:[-*+]|\d+[.)])\s+\S/.test(turn.headline))
    ) {
      junkHeadlines++;
    }
    // 客户端的「回答全文」直接读这一行，不许被 RAW_MAX=40 截掉。
    if (turn.rawOmitted !== true && turn.chars > 0 && !(turn.raw ?? []).some((row) => row.kind === 'answer')) missingAnswer++;
    for (const block of turn.blocks) {
      // 闸门：条目里必须有字。真被坑过——一轮的「需要你确认」第一条是个 `---`，
      // 另一轮是围栏那行压成的一条反引号，都被当成「要你拍板的事」摆到了卡片上。
      if (block.id === 'asks' || block.id === 'points' || block.id === 'risks') {
        for (const item of block.items) if (!/[0-9A-Za-z\u3400-\u9fff]/.test(String(item.text))) junkItems++;
      }
      if (block.id === 'files') {
        const keys = new Set();
        for (const item of block.items) {
          const normalized = String(item.path).replace(/\\/g, '/');
          if (item.name.startsWith('.') || /(^|\/)(node_modules|\.git|\.tmp)(\/|$)/.test(normalized)) junkFiles++;
          // 闸门：同一轮里同一个文件不能出现两行（相对/绝对两种写法曾经各来一行）。
          if (item.key !== undefined) {
            if (keys.has(item.key)) duplicateFiles++;
            keys.add(item.key);
          }
        }
      }
      if (block.id === 'kpi') {
        for (const item of block.items) {
          const valueOk = /^[~～≈≥≤<>约共]?\s*[0-9][0-9,./:%+\-]*\s*(?:%|个|条|家|次|秒|分钟|分|小时|天|周|月|年|倍|万|亿|人|元|页|项|轮|步|点|字|MB|KB|GB|k|K|tokens|token)?$/.test(item.v);
          const keyOk = item.k.length >= 2 && item.k.length <= 16 && !/[·、,，。:：|]/.test(item.k) && !/^[0-9]+$/.test(item.k);
          if (!valueOk || !keyOk) kpiJunk++;
        }
      }
    }
    const pointsBlock = turn.blocks.find((block) => block.id === 'points');
    if (pointsBlock !== undefined && turn.headline !== '') {
      const norm = (value) => value.replace(/…+$/, '').replace(/[。！？!?；;，,、\s]+$/, '').trim();
      const headKey = norm(turn.headline);
      for (const item of pointsBlock.items) {
        const key = norm(item.text);
        if (key === headKey || headKey.startsWith(key) || key.startsWith(headKey)) {
          selfDup++;
          if (offenders.length < 3) offenders.push({ turn: turn.turn, headline: turn.headline, items: pointsBlock.items.map((one) => one.text) });
        }
      }
    }
    states.set(turn.state, (states.get(turn.state) ?? 0) + 1);
    for (const block of turn.blocks) blocks.set(block.id, (blocks.get(block.id) ?? 0) + 1);
    if (turn.title !== '') titleFromContract++;
    if (turn.headline === '' && turn.chars > 0) headlineEmpty++;
    if (turn.prompt !== '' && turn.prompt.endsWith('？')) questions++;
    if (turn.counts.kpi > 0) kpiTurns++;
    if (turn.counts.risks > 0) riskTurns++;
    if (turn.counts.files > 0) fileTurns++;
    for (const block of turn.blocks) {
      if (blockSamples[block.id] === undefined) continue;
      if (blockSamples[block.id].length >= 40) continue;
      blockSamples[block.id].push({ turn: turn.turn, title: turn.title, headline: turn.headline, items: block.items });
    }
    samples.push({ file: file.full, turn });
  }
}

console.log(`扫描会话 ${files.length} 个，折叠轮次 ${turns} 轮`);
console.log(`状态分布: ${[...states.entries()].map(([key, count]) => `${key}=${count}`).join('  ')}`);
console.log(`出现过的信息块: ${[...blocks.entries()].map(([key, count]) => `${key}=${count}`).join('  ')}`);
console.log(
  `块数分布: ${[...blockHist.entries()].sort((a, b) => a[0] - b[0]).map(([count, n]) => `${count}块=${n}轮`).join('  ')}（>2 块才叠成一摞，其余直接铺开）`,
);
console.log(`有标题的轮次 ${titleFromContract} / ${turns}（契约标题或从提问抽的兜底标题）｜有正文但结论行抽不出 ${headlineEmpty} 轮`);
console.log(`关键数据块 ${kpiTurns} 轮 | 风险块 ${riskTurns} 轮 | 产出文件块 ${fileTurns} 轮 | 提问以问号结尾 ${questions} 轮`);
console.log(`最大投影值 ${biggest.bytes} 字节（${path.basename(path.dirname(biggest.file))}）`);
console.log(`同会话 v1 投影最大值 ${biggestBrief.bytes} 字节`);
console.log(`结论建议块里与总卡结论重复的条目 ${selfDup} 条（回归闸门：应为 0）`);
console.log(`一个信息块都没有的轮次 ${noBlocks} 轮（这些轮只剩总卡）`);
console.log(`带「执行过程」块的轮次 ${stepsBlocks} 轮（回归闸门：应为 0——执行日志不进卡）`);
console.log(`结论行是表格/结构线压平的轮次 ${junkHeadlines} 轮（回归闸门：应为 0）`);
console.log(`带原始记录却没有 answer 行的轮次 ${missingAnswer} 轮（回归闸门：应为 0——「回答全文」就靠这一行）`);
console.log(`没有「字」的条目 ${junkItems} 条（回归闸门：应为 0——分隔线与孤零零的反引号不许上卡）`);
console.log(`完成但结尾有待办的轮次 ${withDecisions} 轮（药丸显示「完成 · 待你定 N」，不再标成待确认）`);
console.log(`产出文件里的隐藏/临时文件 ${junkFiles} 个（回归闸门：应为 0）`);
console.log(`产出文件里的重复行 ${duplicateFiles} 行（回归闸门：应为 0）`);
console.log(`结论建议重复别块条目 ${crossBlockDup} 条（回归闸门：应为 0）`);
console.log(`说明里夹着工具标记语言的 ${markupNotes} 条｜还是原始 snake_case 的工具名 ${rawLabels} 个（回归闸门：均应为 0）`);
console.log(`原始记录里的样板成功语 ${boilerplateNotes} 条（回归闸门：应为 0）`);
console.log(`关键数据里不成样的项 ${kpiJunk} 项（回归闸门：应为 0）`);
console.log(`单轮 wire 最大 ${Math.round(biggestTurn / 1024)} KB｜超过预算 ${TURN_BUDGET / 1024} KB 的轮次 ${overBudget} 轮（回归闸门：应为 0）`);
{
  // 推送代价：把“浏览器里看不到”的部分用事件模型量出来。
  // 关键不变式是**无关事件返回同一 state 引用**（Object.is 闸门）——所以流式增量不会触发重算，
  // 只有已提交的事件才推一次更新。
  const byPush = [...cost].sort((a, b) => b.pushes - a.pushes);
  const wire = [...cost].map((item) => item.wireBytes).sort((a, b) => a - b);
  const median = wire[Math.floor(wire.length / 2)] ?? 0;
  const totalEvents = cost.reduce((sum, item) => sum + item.events, 0);
  const totalPushes = cost.reduce((sum, item) => sum + item.pushes, 0);
  console.log(
    `推送代价：${cost.length} 个会话共 ${totalEvents} 条事件 → 只推 ${totalPushes} 次更新（每 ${(totalEvents / Math.max(1, totalPushes)).toFixed(1)} 条事件推一次）`,
  );
  console.log(
    `  单次推送体积：中位 ${Math.round(median / 1024)} KB｜最大 ${Math.round((wire.at(-1) ?? 0) / 1024)} KB｜最小 ${Math.round((wire[0] ?? 0) / 1024)} KB`,
  );
  console.log(`  推送最多的会话：${byPush.slice(0, 3).map((item) => `${item.session} ${item.pushes} 次/${item.turns} 轮`).join('、')}`);
}
for (const offender of offenders) {
  console.log(`  第 ${offender.turn} 轮  结论=「${offender.headline.slice(0, 60)}」`);
  for (const text of offender.items) console.log(`      ${text === offender.headline ? '>>' : '  '} ${text.slice(0, 70)}`);
}
console.log(`wire.view 抛错 ${crashed} 次`);

if (sampleMode !== null) {
  for (const [id, pool] of Object.entries(blockSamples)) {
    console.log(`\n============ ${id} 真实样例（${pool.length} 轮里有这个块） ============`);
    for (const sample of pool.slice(0, sampleMode)) {
      console.log(`\n-- 第 ${sample.turn} 轮  ${sample.title === '' ? '(无契约标题)' : sample.title}`);
      console.log(`   结论行: ${sample.headline.slice(0, 90)}`);
      for (const item of sample.items) console.log(`   · ${JSON.stringify(item)}`);
    }
  }
}

if (dumped !== null && samples[dumped] !== undefined) {
  const { turn } = samples[dumped];
  console.log(`\n============ 第 ${dumped} 条样本的完整卡片 ============`);
  console.log(
    JSON.stringify(
      { ...turn, raw: `${turn.raw.length} 条`, blocks: turn.blocks.map((block) => `${block.id}(${block.items.length})`) },
      null,
      2,
    ),
  );
  console.log('\n---- 信息块内容 ----');
  for (const block of turn.blocks) {
    console.log(`\n[${block.id}]`);
    for (const item of block.items) console.log(`   ${JSON.stringify(item)}`);
  }
  console.log('\n---- 原始记录 ----');
  for (const row of turn.raw) {
    console.log(`   ${row.kind.padEnd(5)} ${row.meta}  ${row.text.slice(0, 110)}`);
    if (row.note !== undefined && row.note !== '') console.log(`         note: ${row.note.slice(0, 110)}`);
  }
}

// 闸门直接决定退出码：结论重复、卡片里混进执行日志、产出文件里混进垃圾、样板成功语、关键数据不成样、产出文件重复行。
// 外加一条成本闸门：单轮 wire 体积不许超过预算。
if (selfDup + stepsBlocks + junkItems + missingAnswer + junkHeadlines + junkFiles + boilerplateNotes + kpiJunk + duplicateFiles + crossBlockDup + markupNotes + rawLabels + overBudget > 0) process.exit(1);