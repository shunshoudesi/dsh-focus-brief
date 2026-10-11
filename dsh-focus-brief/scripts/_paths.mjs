/**
 * 验证脚本共用的路径解析。
 *
 * 脚本要用的辅助资产（React 的 UMD 构建、css-tree 的浏览器构建、从 DSH 的 app.asar 里抽出来的
 * 主题包与各客户端包 README）体积大、且都是下载/抽取来的，所以不进版本库，统一放在仓库根的 `.tmp/` 下。
 * 换一台机器（或清理过 .tmp 之后）先跑一次：
 *
 *   node scripts/fetch-assets.mjs
 *
 * 这些脚本都假定**在仓库根目录**执行（产物路径按仓库根写死），例如：
 *
 *   node dsh-focus-brief/scripts/fold-view.mjs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 仓库根（本文件在 <repo>/dsh-focus-brief/scripts/ 下）。 */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TEMP = `${ROOT}.tmp/`;
export const REACT_DIR = `${TEMP}react/`;
export const CSS_PARSER_DIR = `${TEMP}css-parser/`;
export const ASAR_REF = `${TEMP}asar-ref/`;
export const PREVIEW = `${ROOT}dsh-focus-brief/preview.html`;
export const PLUGIN_DIR = `${ROOT}dsh-focus-brief/`;

/** 本机 DSH 的安装路径（asar 在这里；`D:\DSH` 那套已随安装目录改名废弃）。 */
export const DEFAULT_ASAR = 'D:\\deepseekherness\\resources\\app.asar';

/** 缺文件就说清楚缺什么、怎么补，而不是抛一个 ENOENT 让人猜。 */
export function requireFile(path, hint) {
  if (fs.existsSync(path)) return path;
  console.error(`缺少 ${path}`);
  console.error(`先跑一次：node scripts/fetch-assets.mjs${hint === undefined ? '' : `（${hint}）`}`);
  process.exit(2);
}

/** 主题包 client.js：对比度与 token 取值都从它里面读真实取值。 */
export function themeSource() {
  return requireFile(`${ASAR_REF}dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`, '需要 asar 抽取');
}

/** css-tree 的浏览器构建（`var csstree=(()=>{…})()` 形式的普通脚本，不是 UMD）。 */
export function cssTreeSource() {
  return requireFile(`${CSS_PARSER_DIR}csstree.js`, '需要下载');
}