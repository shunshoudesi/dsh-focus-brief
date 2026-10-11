/**
 * 一次性测量：把主题包里两个作用域（浅色/深色）的全部 alias token 取值打出来。
 * 卡片配色必须建立在这些真实取值上——凭感觉挑色，浅色主题下就会挑出看不见的灰。
 */
import fs from 'node:fs';
import { themeSource } from './_paths.mjs';

const file = themeSource();
const source = fs.readFileSync(file, 'utf8');

const globalPairs = new Map();
for (const match of source.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
  globalPairs.set(match[1], match[2]);
}

function enclosingBlock(text, index) {
  const open = text.lastIndexOf('{', index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { header: text.slice(Math.max(0, open - 120), open), body: text.slice(open + 1, i) };
    }
  }
  return null;
}

function resolve(name, seen = 0) {
  const raw = globalPairs.get(name);
  if (raw === undefined || seen > 4) return null;
  const reference = /^var\((--[\w-]+)\)$/.exec(raw.trim());
  return reference !== null ? resolve(reference[1], seen + 1) : raw;
}

const scopes = [];
for (const match of source.matchAll(/--dsw-alias-bg-layer-1\s*:/g)) {
  const block = enclosingBlock(source, match.index);
  if (block === null) continue;
  const tokens = new Map();
  for (const declaration of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const value = declaration[2].trim();
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    const resolved = reference !== null ? resolve(reference[1]) : value;
    if (resolved !== null && /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(resolved)) tokens.set(declaration[1], resolved);
  }
  const header = block.header.replace(/\s+/g, ' ').trim();
  scopes.push({ header: header.slice(Math.max(0, header.length - 60)), tokens });
}

for (const [index, scope] of scopes.entries()) {
  console.log(`\n=== 作用域 ${index + 1}：…${scope.header} ===`);
  for (const [name, value] of [...scope.tokens.entries()].sort()) {
    console.log(`  ${name.padEnd(38)} ${value}`);
  }
  for (const name of [...globalPairs.keys()].filter((key) => key.startsWith('--dsw-alias-')).sort()) {
    if (scope.tokens.has(name)) continue;
    console.log(`  ${name.padEnd(38)} ${globalPairs.get(name)}  (全局)`);
  }
}