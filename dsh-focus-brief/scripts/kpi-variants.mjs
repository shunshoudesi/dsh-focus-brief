/**
 * 一次性测量：「关键数据」的抽取规则到底该多紧。
 * 现在的规则（恰好两列 + 值必须是“数字+可选单位”）在 163 轮里只命中 2 轮，太罕见；
 * 但上一版宽松规则（表格行 + 值里出现过数字）抽出来的全是内容表格和目录。
 * 这个脚本把几种候选规则在真实语料上并排跑，把样例打出来，用眼睛决定——而不是拍脑袋。
 *
 * 用法: node kpi-variants.mjs [每种规则打几条样例]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { apply } from '../index.js';

const samplesPerRule = Number(process.argv[2] ?? 4);

const definitions = [];
apply({ sessionProjections: { register: (definition) => definitions.push(definition) }, inject: () => {} });
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

/* ---------- 与宿主同源的清洗 ---------- */
const plain = (text) =>
  text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2')
    .replace(/`+(.+?)`+/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s?/, '')
    .trim();
const clip = (text, limit) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
};

const STRICT_VALUE = /^[~～≈≥≤<>约共]?\s*[0-9][0-9,./:%+\-]*\s*(?:%|个|条|家|次|秒|分钟|分|小时|天|周|月|年|倍|万|亿|人|元|页|项|轮|步|点|字|MB|KB|GB|k|K|tokens|token)?$/;
const LOOSE_VALUE = /^[0-9][0-9,.\s]*\s*(?:%|个|条|家|次|秒|分钟|分|小时|天|周|月|年|倍|万|亿|人|元|页|项|轮|步|点|字|MB|KB|GB|k|K|tokens?)?(?:\s*[A-Za-z\u4e00-\u9fa5]{0,4})?$/;
const KEY_JUNK = /[·、,，。:：|]/;

/** 通用抽取器：靠开关切换“几列 / 认不认普通键值行”。 */
function extract(text, options) {
  const out = [];
  const push = (key, value) => {
    const k = plain(key).trim();
    const v = clip(plain(value), 40);
    if (k.length < 2 || k.length > 16 || KEY_JUNK.test(k)) return;
    if (!options.value.test(v)) return;
    if (out.some((item) => item.k === k)) return;
    out.push({ k, v });
  };
  for (const raw of text.split('\n')) {
    if (out.length >= 4) break;
    const line = raw.trim();
    if (line === '' || line.startsWith('```')) continue;
    if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '');
      if (options.exactTwoCols && cells.length !== 2) continue;
      if (cells.length < 2) continue;
      const value = cells.slice(1).find((cell) => options.value.test(clip(plain(cell), 40)));
      if (value === undefined) continue;
      push(cells[0], value);
      continue;
    }
    if (options.kvPattern === null) continue;
    const kv = options.kvPattern.exec(line);
    if (kv !== null) push(kv[1], kv[2]);
  }
  return out.length >= 2 ? out : [];
}

const RULES = [
  {
    label: 'V1 现行：恰好两列 + 严格数字值',
    options: { exactTwoCols: true, value: STRICT_VALUE, kvPattern: /^[-*+]?\s*\*\*([^*]{2,16})\*\*\s*[：:]\s*(.+)$/ },
  },
  {
    label: 'V2 放宽列数：任意列 + 严格数字值',
    options: { exactTwoCols: false, value: STRICT_VALUE, kvPattern: /^[-*+]?\s*\*\*([^*]{2,16})\*\*\s*[：:]\s*(.+)$/ },
  },
  {
    label: 'V3 放宽取值：任意列 + 数字开头且短',
    options: { exactTwoCols: false, value: LOOSE_VALUE, kvPattern: /^[-*+]?\s*\*\*([^*]{2,16})\*\*\s*[：:]\s*(.+)$/ },
  },
  {
    label: 'V4 再加普通键值行（不要求加粗）',
    options: { exactTwoCols: false, value: STRICT_VALUE, kvPattern: /^[-*+]?\s*([^*\s][^：:]{1,15})\s*[：:]\s*(.+)$/ },
  },
];

const hits = new Map(RULES.map((rule) => [rule.label, { turns: 0, items: 0, samples: [] }]));

for (const file of files) {
  let state = viewDefinition.init();
  for (const event of readSessionEvents(file)) state = viewDefinition.apply(state, event);
  for (const entry of state.turns) {
    if (entry.answer === '') continue;
    for (const rule of RULES) {
      const items = extract(entry.answer, rule.options);
      if (items.length === 0) continue;
      const bucket = hits.get(rule.label);
      bucket.turns++;
      bucket.items += items.length;
      if (bucket.samples.length < samplesPerRule) {
        bucket.samples.push({ turn: entry.turn, items });
      }
    }
  }
}

console.log(`扫描 ${files.length} 个会话\n`);
for (const rule of RULES) {
  const bucket = hits.get(rule.label);
  console.log(`===== ${rule.label}：命中 ${bucket.turns} 轮 / ${bucket.items} 项 =====`);
  for (const sample of bucket.samples) {
    console.log(`  第 ${sample.turn} 轮`);
    for (const item of sample.items) console.log(`    ${item.k} = ${item.v}`);
  }
  console.log('');
}