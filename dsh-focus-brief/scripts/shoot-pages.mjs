/**
 * 一次性取证：把 .tmp/shots/case-*.html 逐个截成图（真 Chromium，绝对路径）。
 * 用法: node .tmp/shoot-cases.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './_paths.mjs';

const browser = [
  'C:\\Users\\lenovo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));
if (browser === undefined) {
  console.error('没找到 Chromium');
  process.exit(2);
}

const shotsDir = path.join(ROOT, '.tmp', 'shots');
const profile = path.join(ROOT, '.tmp', 'chrome-profile');
const height = Number(process.argv[2] ?? 1300);

const cases = fs.readdirSync(shotsDir).filter((name) => name.startsWith('case-') && name.endsWith('.html'));
let bad = 0;
for (const name of cases) {
  const source = path.join(shotsDir, name);
  const target = path.join(shotsDir, `${name.replace(/\.html$/, '')}.png`);
  const result = spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      `--window-size=760,${height}`,
      '--virtual-time-budget=3000',
      `--screenshot=${target}`,
      `file:///${source.replace(/\\/g, '/')}`,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
  if (size === 0) {
    bad++;
    console.log(`  ❌ ${name}（${(result.stderr ?? '').slice(0, 120)}）`);
  } else {
    console.log(`  ✅ ${name.replace(/\.html$/, '')}.png ${Math.round(size / 1024)} KB`);
  }
}
process.exit(bad === 0 ? 0 : 1);