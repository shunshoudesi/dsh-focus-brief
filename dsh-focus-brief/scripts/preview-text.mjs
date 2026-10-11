/**
 * 一次性检视：把 preview.html 剥成纯文本读一遍。
 * 交付物也要“当用户读一遍”——上一个这么干的动作（读卡片）抓到了 9 个真问题。
 *
 * 用法: node preview-text.mjs [起始字符] [长度]
 */
import fs from 'node:fs';
import { PREVIEW as file } from './_paths.mjs';
const html = fs.readFileSync(file, 'utf8');
const start = Number(process.argv[2] ?? 0);
const length = Number(process.argv[3] ?? 3500);

const withoutStyle = html.replace(/<style[\s\S]*?<\/style>/g, '');
const text = withoutStyle
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '')
  .join('\n');

console.log(`preview.html 全文 ${text.length} 字符，从 ${start} 起打印 ${length} 字符：\n`);
console.log(text.slice(start, start + length));