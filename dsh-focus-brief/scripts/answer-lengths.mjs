/**
 * 一次性测量：每轮「最终回答」的真实长度分布，用来定投影里正文的保留上限。
 * 结论必须建立在真实分布上——上限开小了，卡片里的「原文」就是残的。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
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

/** 每轮最后一条非空助手文字 = 最终回答。 */
const lengths = [];
let turns = 0;
for (const file of files) {
  const events = readSessionEvents(file);
  const byTurn = new Map();
  for (const event of events) {
    if (event?.type !== 'assistant/message') continue;
    const turn = event.data?.turn;
    if (typeof turn !== 'number') continue;
    const text = textOf(event.data.message?.content);
    if (text === '') continue;
    byTurn.set(turn, text);
  }
  for (const text of byTurn.values()) {
    turns++;
    lengths.push(text.length);
  }
}

lengths.sort((a, b) => a - b);
const at = (q) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * q))];
console.log(`会话 ${files.length} 个，最终回答 ${turns} 条`);
console.log(`长度分位: min=${lengths[0]} p25=${at(0.25)} p50=${at(0.5)} p75=${at(0.75)} p90=${at(0.9)} p95=${at(0.95)} p99=${at(0.99)} max=${lengths.at(-1)}`);
for (const limit of [2000, 3000, 4000, 6000, 8000, 12000, 16000, 24000]) {
  const over = lengths.filter((value) => value > limit).length;
  console.log(`  上限 ${String(limit).padStart(5)}: 会被截断 ${String(over).padStart(3)} 条（${((over / lengths.length) * 100).toFixed(1)}%），保留总量 ${(lengths.reduce((sum, value) => sum + Math.min(value, limit), 0) / 1024).toFixed(0)} KB`);
}