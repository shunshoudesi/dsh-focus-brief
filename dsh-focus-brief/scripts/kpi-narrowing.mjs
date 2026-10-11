/**
 * 一次性对照：以前「关键数据 / 风险提醒」块是从整篇回答里扫出来的，
 * 现在只从契约段里取。这条脚本把两种来源都打出来，用来看「收窄之后丢了什么、留下的对不对」。
 *
 * 做法：对每条真实回答，既跑现在的解析器（`splitAnswer` + `kpisFromSection`），
 * 也统计「整篇里像数字表格的行」有多少——两者的差就是收窄的代价。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';
import { readSessionEvents } from './zstd-frames.mjs';

const defs = [];
apply({ sessionProjections: { register: (d) => defs.push(d) }, inject: () => {} });
const view = defs.find((d) => d.key === 'focusView');

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

const root = path.join(os.homedir(), '.dsh', 'sessions');
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'session.v4.jsonl.zstd') files.push(full);
  }
};
walk(root);

/** 整篇扫出来的「数字表格行 + **键**：值」有多少条（= 旧规则会看到的原料）。 */
const NUMBER_CELL = /^[~～≈≥≤<>约共]?\s*[0-9][0-9,./:%+\-]*\s*(?:%|个|条|家|次|秒|分钟|分|小时|天|周|月|年|倍|万|亿|人|元|页|项|轮|步|点|字|MB|KB|GB|k|K|tokens|token)?$/;
function looseKpiRows(text) {
  let count = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
      if (cells.length >= 2 && cells.slice(1).some((c) => NUMBER_CELL.test(c))) count++;
    }
  }
  return count;
}

let turns = 0;
let kpiRuns = [];
let looseTurns = 0;
let headStyle = new Map();
const offenders = [];
for (const file of files) {
  let state = view.init();
  for (const event of readSessionEvents(file)) state = view.apply(state, event);
  const value = view.wire.view(state);
  for (const [index, turn] of value.entries()) {
    turns++;
    const answer = state.turns[index]?.answer ?? '';
    const loose = looseKpiRows(answer);
    if (loose > 0) looseTurns++;
    const kpi = turn.blocks.find((b) => b.id === 'kpi');
    if (kpi !== undefined) kpiRuns.push({ turn: turn.turn, items: kpi.items });
    else if (loose >= 2 && offenders.length < 12) offenders.push({ turn: turn.turn, loose, title: turn.title, head: turn.headline.slice(0, 40) });
    // 段头形态统计：`## 名字` / `## 名字（注释）` / 整行加粗
    for (const raw of answer.split('\n')) {
      const line = raw.trim();
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading !== null) {
        const t = heading[2].trim();
        const key = /^需要你确认|^风险提醒|^关键数据|^结论建议/.test(t) ? `契约名·形态=${/^[^（(\s]+$/.test(t) ? '精确' : '多写了字'}` : '其它标题';
        headStyle.set(key, (headStyle.get(key) ?? 0) + 1);
      }
      const bold = /^\*\*([^*]+)\*\*[：:]?$/.exec(line);
      if (bold !== null && /^需要你确认|^风险提醒|^关键数据|^结论建议/.test(bold[1].trim())) {
        const key = '契约名·整行加粗';
        headStyle.set(key, (headStyle.get(key) ?? 0) + 1);
      }
    }
  }
}

console.log(`${turns} 轮真实回答`);
console.log(`现在（只认契约段）出现关键数据块的轮次：${kpiRuns.length}`);
console.log(`整篇里「有数字的表格行 >= 1」的轮次：${looseTurns} 轮，其中 >=2 行的：${offenders.length === 12 ? '12+' : offenders.length}`);
console.log('');
console.log('段头形态：', [...headStyle.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
console.log('');
console.log('收窄掉的那些轮（整篇有数字表格、但没有契约段，所以现在不显示关键数据块）：');
for (const o of offenders) {
  console.log(`  第 ${o.turn} 轮  ${o.title === '' ? '(无标题)' : o.title}  数字行 ${o.loose}  结论=「${o.head}」`);
}
if (kpiRuns.length > 0) {
  console.log('');
  console.log('现在成块的关键数据：');
  for (const run of kpiRuns) console.log(`  第 ${run.turn} 轮  ${JSON.stringify(run.items)}`);
}