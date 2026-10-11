/**
 * 一次性验证：把 v2 的 focusView 投影拿真实会话日志离线折一遍。
 * 不经过 DSH，直接调 index.js 里注册的定义，检查卡片原料是否成形、有没有崩、投影有多大。
 *
 * 用法:
 *   node fold-view.mjs                 # 折 ~/.dsh/sessions 下所有会话，打印总览
 *   node fold-view.mjs --dump 12       # 额外把第 12 轮完整打出来（提问、回答全文、信息块）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { apply, SECTION_NAMES } from '../index.js';

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
/** 提问为空的轮次（这些轮卡片上方没有提问气泡）。 */
let emptyPrompt = 0;
/** 只有附件、没有文字的提问（图片）——这些轮靠客户端画占位。 */
let mediaPrompts = 0;
/** 最近多少轮该带全文（与宿主里的 FULL_TURN_LIMIT 一致；这里只用来判闸门）。 */
const FULL_WINDOW = 8;
/** 每轮有几个信息块（决定叠压还是铺开：>2 才叠）。 */
const blockHist = new Map();
/** 闸门：总卡标题不许是提问的截断——提问现在原样摆在卡片上方，再抄一遍就是同屏重复。 */
let titleDup = 0;
/** 闸门：卡片里不该再有「执行过程」块——用户明确说过不要执行日志（那是官方「轨迹」视图的活）。 */
let stepsBlocks = 0;
/** 闸门：条目必须带「字」。剥掉 markdown 标记后只剩标点的条目（`---`、孤零零的反引号）不许上卡。 */
let junkItems = 0;
/**
 * 闸门：**最近 FULL_WINDOW 轮里，有正文的轮次必须带全文**。
 * 客户端的「展开回答全文」就靠这个字段，它一旦悄悄没了，卡片上就没有任何提示。
 */
let missingFull = 0;
/** 闸门：更早的轮次没有全文时必须明说（`fullGone`），不能让人以为按钮被吞了。 */
let missingFullGone = 0;
/**
 * 闸门：总卡那句结论不许是 markdown 表格/结构线压平出来的。
 * 截图里亲眼见过：`| 检查 | 结果 | |---|---|---| … | 28 / 32 / 31 —— 完全一致 | …`。
 */
let junkHeadlines = 0;
/** 闸门：产出文件里不该出现隐藏文件、`.tmp/`、`node_modules/`。 */
let junkFiles = 0;
/** 完成但结尾留下待办的轮次（这些轮不该被标成待确认）。 */
let withDecisions = 0;
/** 闸门：工具说明里不该出现“成功了”这类零信息量的样板话（过滤发生在折叠时，结果存在 state 里）。 */
let boilerplateNotes = 0;
/** 单轮 wire 体积预算（KB）：目的是钉住"卡片原料"的成本——放宽上限时不许悄悄翻倍。 */
const TURN_BUDGET = 24000;
let overBudget = 0;
let biggestTurn = 0;
/** 闸门：同一轮「产出文件」里不该出现两行同一个文件（相对/绝对写法各来一行踩过）。 */
let duplicateFiles = 0;
/** 闸门：结论建议不许重复「需要你确认」/「风险提醒」里已经列出的条目（同屏重复）。 */
let crossBlockDup = 0;
/**
 * 「尽量保证在两行」的观测：按卡片真实排版折算，有多少轮的结论超过两行。
 * 与客户端 `estimateLines` 同口径（44 个全角字/行，半角算半个字宽）——契约里写「60 字内」，
 * 超了**不裁**，只在卡片上提示一句；这个数字就是「提示会出现多少次」的预期值。
 */
const LINE_WIDTH = 44;
function linesOfHeadline(text) {
  const half = (text.match(/[\x20-\x7f]/g) ?? []).length;
  return Math.max(1, Math.ceil((text.length - half + half / 2) / LINE_WIDTH));
}
let headlineOver2 = 0;
const headlineLines = new Map();
/** 闸门：工具说明里不该夹着工具标记语言；工具名不该还是原始 snake_case。 */
let markupNotes = 0;
let rawLabels = 0;
/**
 * 契约遵守度：这几条量的是**接口有没有被模型按规格写**。
 * 它们是「契约是接口」这件事的唯一观测面——模型不按规格写，块就会消失，而卡片不会报错。
 */
let contractSections = new Map();
let withContractSection = 0;
/**
 * 段名写得不精确的标题（`## 需要你确认（3 条）`、`## 三个需要你确认的点`）——契约要求一字不差。
 * 这类标题**不算段头**，整段内容会落回正文，卡片上少一个块。
 * 为什么只报告、不当硬闸门：语料里真有两个这种标题，而它们都是**内容标题**
 * （「三、还剩一件事需要你确认（我查不到）」），按精确规则处理正是对的。
 * 数量涨了就该拿出来看一眼——所以连原样一起打出来。
 */
const malformedHeads = [];
/** 同一个段名写了两遍（第二遍连同内容一起被丢掉，但值得知道模型在重复写）。 */
let repeatedSections = 0;
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
  for (const [index, turn] of value.entries()) {
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
    // 说明文字与工具名的过滤**发生在折叠时**（结果存在 state 里）。原始记录模块删掉之后 wire 里
    // 没有这些行了，所以这几条闸门改成直接查 state —— 它们守的是「折进去的东西干不干净」。
    for (const tool of state.turns[index]?.tools ?? []) {
      if (/successfully|has been (updated|created|written|saved)|已(成功)?(写入|更新|保存|创建)/i.test(String(tool.note))) boilerplateNotes++;
      // 闸门：说明里不该夹着工具自己的标记语言（`<path>…</path>` 之类）。
      if (/<\/?[a-z][a-z0-9-]*>/i.test(String(tool.note))) markupNotes++;
      // 闸门：工具名不该还是原始 snake_case（`obsidian_move` → `obsidian · move`）。
      if (/^[a-z0-9]+_[a-z0-9_]+$/.test(String(tool.label))) rawLabels++;
    }
    for (const block of turn.blocks ?? []) {
      if (block.id === 'steps') stepsBlocks++;
    }
    // 闸门：最近 FULL_TURN_LIMIT 轮里，有正文的轮次必须带全文（否则「展开回答全文」会莫名消失）。
    if (index >= value.length - FULL_WINDOW && turn.chars > 0 && turn.full === '') missingFull++;
    // 闸门：更早的轮次如果没有全文，必须明说（`fullGone`），不能让人以为按钮被吞了。
    if (index < value.length - FULL_WINDOW && turn.chars > 0 && turn.fullGone !== true) missingFullGone++;
    blockHist.set(turn.blocks.length, (blockHist.get(turn.blocks.length) ?? 0) + 1);
    if (turn.title !== '') titled++;
    // 标题不许是提问的截断（提问已经单独摆在卡片上方）。
    if (turn.title !== '' && turn.prompt !== '') {
      const norm = (value) => value.replace(/^\/[a-zA-Z-]+\s+/, '').replace(/\s+/g, ' ').trim();
      if (norm(turn.prompt).startsWith(norm(turn.title))) titleDup++;
    }
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
    if (turn.prompt === '') emptyPrompt++;
    if ((turn.promptMedia ?? 0) > 0) mediaPrompts++;
    // 「尽量两行」的实测：只数有正文的轮次（没有结论行的轮次不参与）。
    if (turn.headline !== '') {
      const lines = Math.min(6, linesOfHeadline(turn.headline));
      headlineLines.set(lines, (headlineLines.get(lines) ?? 0) + 1);
      if (lines > 2) headlineOver2++;
    }
    // 契约遵守度：直接从**这一轮的原文**里数段头（原文在 state 里，wire 里那份全文只有最近 8 轮）。
    {
      const raw = state.turns[index]?.answer ?? '';
      const seen = new Set();
      let hitAny = false;
      let fenced = false;
      for (const rawLine of raw.split('\n')) {
        const line = rawLine.trim();
        if (/^`{3,}/.test(line)) {
          fenced = !fenced;
          continue;
        }
        if (fenced) continue;
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        const bold = heading === null ? /^\*\*([^*]+)\*\*[：:]?$/.exec(line) : null;
        const text = (heading === null ? bold?.[1] : heading[2])?.trim();
        if (text === undefined) continue;
        const exact = SECTION_NAMES.find((name) => text === name);
        if (exact !== undefined) {
          if (seen.has(exact)) repeatedSections++;
          seen.add(exact);
          hitAny = true;
          contractSections.set(exact, (contractSections.get(exact) ?? 0) + 1);
          continue;
        }
        // 名字包含但不等：契约要求一字不差，这类标题不算段头（内容会落回正文）。
        const loose = SECTION_NAMES.find((name) => text.includes(name));
        if (loose !== undefined && malformedHeads.length < 8) malformedHeads.push(text);
      }
      if (hitAny) withContractSection++;
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
console.log(`提问为空的轮次 ${emptyPrompt} 轮｜其中「只有附件、没有文字」的 ${mediaPrompts} 轮（客户端画占位标记）`);
console.log(
  `契约遵守度：${withContractSection} / ${turns} 轮至少写了一个契约段（${[...contractSections.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}=${count}`).join('  ') || '一个都没有'}）`,
);
console.log(`段名写得不精确的标题 ${malformedHeads.length} 处｜同名段写了两遍的 ${repeatedSections} 处（契约要求一字不差、每段一次）`);
for (const text of malformedHeads) console.log(`  · 段名不精确的标题：${JSON.stringify(text)}（不算段头，内容落回正文）`);
console.log(`有契约标题的轮次 ${titleFromContract} / ${turns}（拿不到就显示「第 N 轮」——提问已经原样摆在卡片上方，不再从提问抽标题）｜有正文但结论行抽不出 ${headlineEmpty} 轮`);
console.log(`总卡标题与提问重复的轮次 ${titleDup} 轮（回归闸门：应为 0——提问已经单独摆出来了）`);
console.log(
  `结论行超过两行的轮次 ${headlineOver2} 轮（按 ${LINE_WIDTH} 全角字/行折算；行数分布 ${[...headlineLines.entries()].sort((a, b) => a[0] - b[0]).map(([line, n]) => `${line === 6 ? '6+' : line}行=${n}`).join('  ')}）——超了不裁，只在卡片上提示一句`,
);
console.log(`关键数据块 ${kpiTurns} 轮 | 风险块 ${riskTurns} 轮 | 产出文件块 ${fileTurns} 轮 | 提问以问号结尾 ${questions} 轮`);
console.log(`最大投影值 ${biggest.bytes} 字节（${path.basename(path.dirname(biggest.file))}）`);
console.log(`同会话 v1 投影最大值 ${biggestBrief.bytes} 字节`);
console.log(`结论建议块里与总卡结论重复的条目 ${selfDup} 条（回归闸门：应为 0）`);
console.log(`一个信息块都没有的轮次 ${noBlocks} 轮（这些轮只剩总卡）`);
console.log(`带「执行过程」块的轮次 ${stepsBlocks} 轮（回归闸门：应为 0——执行日志不进卡）`);
console.log(`结论行是表格/结构线压平的轮次 ${junkHeadlines} 轮（回归闸门：应为 0）`);
console.log(`最近 ${FULL_WINDOW} 轮里有正文却没有全文的 ${missingFull} 轮（回归闸门：应为 0——「展开回答全文」就靠它）`);
console.log(`更早的轮次没有全文却没明说的 ${missingFullGone} 轮（回归闸门：应为 0）`);
console.log(`没有「字」的条目 ${junkItems} 条（回归闸门：应为 0——分隔线与孤零零的反引号不许上卡）`);
console.log(`完成但结尾有待办的轮次 ${withDecisions} 轮（药丸显示「完成 · 待你定 N」，不再标成待确认）`);
console.log(`产出文件里的隐藏/临时文件 ${junkFiles} 个（回归闸门：应为 0）`);
console.log(`产出文件里的重复行 ${duplicateFiles} 行（回归闸门：应为 0）`);
console.log(`结论建议重复别块条目 ${crossBlockDup} 条（回归闸门：应为 0）`);
console.log(`说明里夹着工具标记语言的 ${markupNotes} 条｜还是原始 snake_case 的工具名 ${rawLabels} 个（回归闸门：均应为 0）`);
console.log(`工具说明里的样板成功语 ${boilerplateNotes} 条（回归闸门：应为 0）`);
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

/**
 * 闸门：段名清单本身没漂移。
 * 契约文本、解析器、这个脚本三边读的是同一份 `SECTION_NAMES`——这里再确认一遍它没被改小/改空，
 * 否则「契约遵守度」那几行会悄悄退化成「一个都没命中」。
 */
const missingNames = SECTION_NAMES.filter((name) => typeof name !== 'string' || name === '');
if (SECTION_NAMES.length !== 4 || missingNames.length > 0) {
  console.log(`!! 契约段名清单异常：${JSON.stringify(SECTION_NAMES)}`);
  process.exit(1);
}

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
      { ...turn, full: `${turn.full.length} 字${turn.fullGone === true ? '（这轮没有全文）' : ''}`, blocks: turn.blocks.map((block) => `${block.id}(${block.items.length})`) },
      null,
      2,
    ),
  );
  console.log('\n---- 信息块内容 ----');
  for (const block of turn.blocks) {
    console.log(`\n[${block.id}]`);
    for (const item of block.items) console.log(`   ${JSON.stringify(item)}`);
  }
  console.log('\n---- 提问（原样，卡片上方那条） ----');
  console.log(`   ${turn.prompt === '' ? '（这一轮没有用户消息）' : turn.prompt.slice(0, 300)}`);
  console.log('\n---- 回答全文（点「展开回答全文」看到的那份） ----');
  console.log(`   ${turn.full === '' ? '（这轮较早，只保留提炼结果）' : `${turn.full.slice(0, 300)}…`}`);
}

// 闸门直接决定退出码：结论重复、卡片里混进执行日志、产出文件里混进垃圾、样板成功语、关键数据不成样、产出文件重复行。
// 外加一条成本闸门：单轮 wire 体积不许超过预算。
if (selfDup + stepsBlocks + junkItems + missingFull + missingFullGone + junkHeadlines + titleDup + junkFiles + boilerplateNotes + kpiJunk + duplicateFiles + crossBlockDup + markupNotes + rawLabels + overBudget > 0) process.exit(1);