/**
 * 一次性工具：按 zstd 魔数切帧，解开 DSH 的 session.v4.jsonl.zstd。
 * DSH 是追加写帧的，单个 zstdDecompressSync 只会解出第一帧（204 字节的会话头）。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** @returns {string} 解压后的 JSONL 全文。 */
export function readSessionText(file) {
  const raw = fs.readFileSync(file);
  const starts = [];
  for (let index = 0; ; ) {
    index = raw.indexOf(MAGIC, index);
    if (index === -1) break;
    starts.push(index);
    index += MAGIC.length;
  }
  const chunks = [];
  let frames = 0;
  for (let i = 0; i < starts.length; i++) {
    let end = i + 1 < starts.length ? starts[i + 1] : raw.length;
    let decoded = null;
    while (decoded === null && end <= raw.length) {
      try {
        decoded = zlib.zstdDecompressSync(raw.subarray(starts[i], end));
      } catch {
        if (i + 1 >= starts.length) break;
        i++;
        end = i + 1 < starts.length ? starts[i + 1] : raw.length;
      }
    }
    if (decoded === null) continue;
    frames++;
    chunks.push(decoded.toString('utf8'));
  }
  return { text: chunks.join(''), frames, magics: starts.length, bytes: raw.length };
}

/** @returns {object[]} 解析后的事件数组。 */
export function readSessionEvents(file) {
  const { text, frames } = readSessionText(file);
  const events = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* 坏行跳过 */
    }
  }
  return events;
}