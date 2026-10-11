// 一次性工具：读取 Electron asar 头，列出/提取匹配路径的文件。
// 用法:
//   node extract-asar.mjs <app.asar> --list [正则]
//   node extract-asar.mjs <app.asar> --extract <输出目录> <正则>
import fs from 'node:fs';
import path from 'node:path';

const [, , asarPath, mode, a, b] = process.argv;
if (!asarPath || !mode) {
  console.error('usage: node extract-asar.mjs <app.asar> --list [re] | --extract <outDir> <re>');
  process.exit(2);
}
const outDir = mode === '--extract' ? a : null;
const pattern = (mode === '--extract' ? b : a) || null;
const re = pattern ? new RegExp(pattern, 'i') : null;

const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const strSize = head.readUInt32LE(8);
console.error(`[asar] field0=${head.readUInt32LE(0)} headerSize=${headerSize} strSize=${strSize}`);

const raw = Buffer.alloc(headerSize);
fs.readSync(fd, raw, 0, headerSize, 8);

// 头里是 [4字节长度][JSON][padding]，稳妥地按花括号配平切出 JSON 本体。
const text = raw.toString('latin1');
const start = text.indexOf('{');
if (start < 0) throw new Error('no JSON object in asar header');
let depth = 0;
let inStr = false;
let esc = false;
let end = -1;
for (let i = start; i < text.length; i++) {
  const c = text[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') inStr = true;
  else if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
if (end < 0) throw new Error('unbalanced asar header JSON');
const header = JSON.parse(text.slice(start, end + 1));
const baseOffset = 8 + headerSize;
console.error(`[asar] baseOffset=${baseOffset} fileCount(size)=${fs.statSync(asarPath).size}`);

const out = [];
let unpackedCount = 0;
let linkCount = 0;

function walk(node, prefix) {
  const files = node.files || {};
  for (const [name, entry] of Object.entries(files)) {
    const full = prefix ? `${prefix}/${name}` : name;
    if (entry.files) {
      walk(entry, full);
      continue;
    }
    if (entry.link) {
      linkCount++;
      continue;
    }
    if (entry.unpacked) unpackedCount++;
    const size = entry.size || 0;
    if (re && !re.test(full)) continue;
    out.push({ path: full, size, offset: entry.offset, unpacked: !!entry.unpacked });
  }
}
walk(header, '');

console.error(
  `[asar] matched=${out.length} unpacked=${unpackedCount} links=${linkCount} totalBytes=${out.reduce(
    (s, f) => s + f.size,
    0,
  )}`,
);

if (mode === '--list') {
  for (const f of out.slice(0, 400)) {
    console.log(`${String(f.size).padStart(9)}  ${f.unpacked ? 'U' : ' '}  ${f.path}`);
  }
  if (out.length > 400) console.log(`... 还有 ${out.length - 400} 条`);
} else {
  const buf = Buffer.alloc(1 << 20);
  for (const f of out) {
    const dest = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (f.unpacked) {
      const src = path.join(asarPath + '.unpacked', f.path);
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      else console.log(`SKIP(unpacked missing) ${f.path}`);
      continue;
    }
    if (f.offset === undefined) {
      console.log(`SKIP(no offset) ${f.path}`);
      continue;
    }
    let off = baseOffset + Number(f.offset);
    let left = f.size;
    const ws = fs.openSync(dest, 'w');
    while (left > 0) {
      const n = Math.min(left, buf.length);
      const got = fs.readSync(fd, buf, 0, n, off);
      if (got <= 0) break;
      fs.writeSync(ws, buf, 0, got);
      off += got;
      left -= got;
    }
    fs.closeSync(ws);
  }
  console.error(`[asar] extracted ${out.length} files into ${outDir}`);
}
fs.closeSync(fd);