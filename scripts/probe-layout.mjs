/**
 * 用真 Chromium（Chrome / Edge 的 headless）跑布局取证页，并把结论抠出来。
 *
 *   node .tmp/probe-layout.mjs
 *
 * 做两件事：
 * 1. `--dump-dom` 跑 .tmp/layout-harness.html，读页面自己写好的结论（四个组合里滚轮会去滚谁）。
 * 2. `--screenshot` 给 preview.html 的三个形态截图，落盘到 .tmp/shots/（供人／模型直接看）。
 *
 * 用独立的 user-data-dir（.tmp/chrome-profile），不碰用户自己的浏览器配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PREVIEW, ROOT } from './_paths.mjs';

const BROWSERS = [
  'C:\\Users\\lenovo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
if (browser === undefined) {
  console.error('没找到 Chromium（Chrome / Edge）');
  process.exit(2);
}
console.log(`用 ${path.basename(browser)}`);

const profile = path.join(ROOT, '.tmp', 'chrome-profile');
const shots = path.join(ROOT, '.tmp', 'shots');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(shots, { recursive: true });

const COMMON = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars=false',
  `--user-data-dir=${profile}`,
];

function fileUrl(target) {
  return `file:///${target.replace(/\\/g, '/')}`;
}

/* ---------- 1. 布局取证：dump-dom 抠 <pre id="report"> ---------- */
const harness = path.join(ROOT, '.tmp', 'layout-harness.html');
if (!fs.existsSync(harness)) {
  console.error('先跑 node .tmp/build-layout-harness.mjs');
  process.exit(2);
}
/**
 * Windows 上 Chromium 不会把 `--dump-dom` 交给父进程的管道（stdout 恒为 0），
 * 但给它一个**真实文件句柄**就会正常写盘。所以这里用 fd 当 stdout，而不是捕获管道。
 */
const dumpPath = path.join(ROOT, '.tmp', 'layout-dom.html');
const dumpFd = fs.openSync(dumpPath, 'w');
spawnSync(browser, [...COMMON, '--virtual-time-budget=4000', '--dump-dom', fileUrl(harness)], {
  stdio: ['ignore', dumpFd, 'inherit'],
});
fs.closeSync(dumpFd);
const dom = fs.readFileSync(dumpPath, 'utf8');
const reportMatch = /<pre id="report"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
if (reportMatch === null) {
  console.error(`没抠到报告（dump ${dom.length} 字符）`);
  process.exit(1);
}
const report = JSON.parse(reportMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
console.log('\n=== 滚轮会去滚谁（真 Chromium 实测）===');
let bad = 0;
const EXPECT = { 'active-new': 'ancestor', 'active-old': 'BLOCKED', 'overlay-new': 'self', 'overlay-old': 'self' };
for (const entry of report) {
  const expected = EXPECT[entry.id];
  const ok = entry.wheelScrolls === expected;
  if (!ok) bad++;
  console.log(
    `  ${ok ? '✅' : '❌'} ${entry.id.padEnd(12)} 判定=${entry.wheelScrolls.padEnd(8)} 期望=${expected.padEnd(8)} | 根节点 overflow-y=${entry.rootOverflowY} overscroll=${entry.rootOverscroll} 自己可滚=${entry.rootScrolls} | viewArea 高=${entry.viewAreaH} overflow=${entry.viewAreaOverflow} | 外层可滚=${entry.outerScrolls} | 写入实测：外层=${entry.outerScrollableByWrite} 内层=${entry.innerScrollableByWrite}`,
  );
}
console.log(bad === 0 ? '\n布局判定与预期一致：旧写法在活跃期把滚轮吞掉（BLOCKED），新写法自己滚或交给外壳' : `\n有 ${bad} 处与预期不符`);

/* ---------- 2. 截图：三个形态 ---------- */
const variants = [
  ['light-white', ''],
  ['light-gray', '#gray'],
  ['dark-white', '#dark'],
  ['dark-gray', '#dark,gray'],
];
console.log('\n=== 截图 ===');
const written = [];
for (const [name, hash] of variants) {
  const target = path.join(shots, `${name}.png`);
  const result = spawnSync(
    browser,
    [...COMMON, '--window-size=820,1400', '--virtual-time-budget=4000', `--screenshot=${target}`, `${fileUrl(PREVIEW)}${hash}`],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
  if (size === 0) {
    console.log(`  ❌ ${name}：没生成（${(result.stderr ?? '').slice(0, 200)}）`);
    bad++;
  } else {
    console.log(`  ✅ ${name}：${Math.round(size / 1024)} KB → ${path.relative(ROOT, target)}`);
    written.push(target);
  }
}

process.exit(bad === 0 ? 0 : 1);