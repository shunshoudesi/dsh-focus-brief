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

// `case-` = v2（专注视图）各形态，`brief-` = v1 小卡（折叠/展开 × 浅/深）。
// 两类都拍：改样式这类工作只有肉眼能验。
const cases = fs.readdirSync(shotsDir).filter((name) => (name.startsWith('case-') || name.startsWith('brief-')) && name.endsWith('.html'));
// 先清掉没有对应 .html 的旧图：用例改名/删掉之后，上一轮留下的 PNG 会继续躺在那里，
// 看起来像是「新用例也拍到了」——取证目录里最不能忍的就是这种假证据。
const liveNames = new Set(cases.map((name) => name.replace(/\.html$/, '')));
for (const stale of fs.readdirSync(shotsDir).filter((name) => /^(?:case|brief)-.*\.png$/.test(name))) {
  if (liveNames.has(stale.replace(/\.png$/, ''))) continue;
  fs.rmSync(path.join(shotsDir, stale));
  console.log(`  清理过期截图 ${stale}`);
}
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