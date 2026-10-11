/**
 * 一次性把验证要用的辅助资产备到 `.tmp/` 下（体积大、来自网络与 asar，所以不进版本库）。
 *
 *   node scripts/fetch-assets.mjs
 *
 * 三件事：
 * 1. 下载 React 18.3.1 的**开发版** UMD（真渲染回归用——开发版才会把告警打出来；浏览器版只有
 *    `renderToReadableStream`，用 `new Response(stream).text()` 收）。
 * 2. 下载 css-tree 2.3 的浏览器构建（严格解析插件注入的那段 CSS）。
 * 3. 从 DSH 的 app.asar 里抽出主题包的 `client.js`（对比度与 token 取值的唯一来源）与全部
 *    客户端 UI 包的 README（接口取证靠它们——包里没有 .d.ts）。
 *
 * asar 路径可用环境变量覆盖：`DSH_ASAR=... node scripts/fetch-assets.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASAR_REF, CSS_PARSER_DIR, DEFAULT_ASAR, REACT_DIR, ROOT } from './_paths.mjs';

const DOWNLOADS = [
  ['https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js', `${REACT_DIR}react.dev.js`],
  ['https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom-server.browser.development.js', `${REACT_DIR}react-dom-server.dev.js`],
  ['https://cdn.jsdelivr.net/npm/css-tree@2.3.1/dist/csstree.js', `${CSS_PARSER_DIR}csstree.js`],
];

const extractor = fileURLToPath(new URL('./extract-asar.mjs', import.meta.url));
const asar = process.env.DSH_ASAR ?? DEFAULT_ASAR;

let failed = 0;

for (const [url, dest] of DOWNLOADS) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log(`跳过（已存在）${path.relative(ROOT, dest)}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  process.stdout.write(`下载 ${url} … `);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, bytes);
    console.log(`${Math.round(bytes.length / 1024)} KB`);
  } catch (error) {
    failed++;
    console.log(`失败：${error.message}`);
  }
}

if (fs.existsSync(asar)) {
  // 主题包 client.js：对比度的唯一取值来源。
  run(['--extract', ASAR_REF, 'dsh-client-ui-theme/lib/client\\.js$'], '主题包 client.js');
  // 客户端 UI 包的 README：接口与座位契约的权威来源。
  run(['--extract', ASAR_REF, 'dsh-client-ui-[a-z0-9-]+/README\\.zh\\.md$'], '客户端 UI 包 README');
} else {
  failed++;
  console.log(`找不到 asar：${asar}（可用 DSH_ASAR 环境变量指定，例如安装目录改名后）`);
}

function run(args, label) {
  const result = spawnSync(process.execPath, [extractor, asar, ...args], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed++;
    console.log(`${label} 抽取失败（退出码 ${result.status}）`);
  }
}

console.log(failed === 0 ? '\n辅助资产就绪，可以跑验证脚本了' : `\n有 ${failed} 项没准备好`);
process.exit(failed === 0 ? 0 : 1);