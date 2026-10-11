/**
 * 一次性测量：每条真实回答的**第一段**有多长。
 * 用途是给「结论那一行要不要设字符上限」定一个不裁断真实内容的阈值
 * （原先 200，卡在这种长度上；现在按这份分布定）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';

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

const lengths = [];
for (const file of files) {
  let current = '';
  for (const event of readSessionEvents(file)) {
    if (event.type === 'turn/start') current = '';
    else if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content);
      if (text.trim() !== '') current = text;
    } else if (event.type === 'turn/end') {
      if (current === '') continue;
      // 与宿主解析器同一判据：第一段 = 第一个非空段落，压平空白后的长度。
      const body = current.replace(/^[ \t]*(?:【本轮】|\[本轮\]|本轮[：:]).*\n/, '');
      const part = body.split(/\n{2,}/).find((piece) => piece.trim() !== '' && !piece.trim().startsWith('|') && !/^#{1,6}\s+\S/.test(piece.trim()));
      if (part === undefined) continue;
      lengths.push(part.trim().replace(/\s+/g, ' ').length);
      current = '';
    }
  }
}

lengths.sort((a, b) => a - b);
const at = (q) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * q))];
console.log(`有第一段的回答 ${lengths.length} 条`);
console.log(`中位 ${at(0.5)}｜p75 ${at(0.75)}｜p90 ${at(0.9)}｜p95 ${at(0.95)}｜p99 ${at(0.99)}｜最长 ${lengths.at(-1)}`);
for (const cap of [200, 300, 400, 600, 800]) {
  const cut = lengths.filter((len) => len > cap).length;
  console.log(`上限 ${cap}：会被裁断 ${cut} 条（${(cut / lengths.length * 100).toFixed(1)}%）`);
}