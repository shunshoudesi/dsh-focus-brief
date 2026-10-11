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
/** 每条回答的第一段原文也留着：折算行数要看半角/全角，不能只看字数。 */
const rawAnswers = [];
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
      const first = part.trim().replace(/\s+/g, ' ');
      lengths.push(first.length);
      rawAnswers.push({ first });
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

/**
 * 「尽量保证在两行」这条要求的取数：把每条结论按卡片上的真实排版折成行数。
 *
 * 容宽是拿截图校出来的：卡片一句 126 字的结论在真实浏览器里排成三行（`.tmp/shots/case-conclusion-longest.png`
 * 里 291 字那条排五行），也就是一行约 42~58 个全角字。这里取 **44 个全角字/行** 当保守值
 * （半角按半个字宽），于是「两行」≈ 88 字——与契约里写的「控制在 60 字内」留了约 30% 余量。
 */
const LINE_WIDTH = 44;
function linesOf(text) {
  const half = (text.match(/[\x20-\x7f]/g) ?? []).length;
  const width = text.length - half + half / 2;
  return Math.max(1, Math.ceil(width / LINE_WIDTH));
}
const lineHist = new Map();
let over2 = 0;
for (const raw of rawAnswers) {
  const lines = Math.min(6, linesOf(raw.first));
  lineHist.set(lines, (lineHist.get(lines) ?? 0) + 1);
  if (lines > 2) over2++;
}
console.log('');
console.log(`按 ${LINE_WIDTH} 全角字/行折算的行数分布：${[...lineHist.entries()].sort((a, b) => a[0] - b[0]).map(([line, n]) => `${line === 6 ? '6+' : line}行=${n}`).join('  ')}`);
console.log(`超过两行的 ${over2} 条（${(over2 / lengths.length * 100).toFixed(1)}%）——契约里写「60 字内」，超了不裁，只在卡片上提示一句`);