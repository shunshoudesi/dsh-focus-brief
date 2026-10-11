/**
 * 一次性验证（最强的一招）：活体宿主写下的投影检查点与离线折叠同一份日志的结果逐字段比对。
 * 缓存结构：C:\Users\lenovo\.dsh\storages\session_projcache\sessions\<sessionId>.json
 *           { version, record: { rows: { <投影键>: { ver, seq, val } } } }
 * 实测（拿 focusView 的 val 打出来看过）：检查点存的是**折叠状态**（v2 是 `{turns:[…]}`，
 * v1 是 `{entries,draft,draftTools}`），不是 wire.view 的输出。所以要拿离线 state 去比。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents } from './zstd-frames.mjs';
import { apply } from '../index.js';

const cacheDir = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
const sessionsRoot = path.join(os.homedir(), '.dsh', 'sessions');

const definitions = [];
apply({ sessionProjections: { register: (definition) => definitions.push(definition) }, inject: () => {} });
const viewDefinition = definitions.find((definition) => definition.key === 'focusView');
const briefDefinition = definitions.find((definition) => definition.key === 'focusBrief');

/** sessionId → 日志文件。 */
function logOf(sessionId) {
  for (const workspace of fs.readdirSync(sessionsRoot)) {
    const candidate = path.join(sessionsRoot, workspace, sessionId, 'session.v4.jsonl.zstd');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let checked = 0;
let matches = 0;
let problems = 0;
/** 宿主还在跑旧版本（检查点 ver 落后）的会话：这不是不一致，而是“需要重启”。 */
const behind = [];
for (const name of fs.readdirSync(cacheDir)) {
  if (!name.endsWith('.json')) continue;
  const raw = fs.readFileSync(path.join(cacheDir, name), 'utf8');
  if (!raw.includes('"focusView"')) continue;
  const sessionId = name.replace(/\.json$/, '');
  const cache = JSON.parse(raw);
  const row = cache.record?.rows?.focusView;
  if (row === undefined) continue;
  const log = logOf(sessionId);
  checked++;
  if (log === null) {
    console.log(`?? ${sessionId}：缓存里有 focusView，但找不到会话日志`);
    problems++;
    continue;
  }
  // 检查点版本落后 = 宿主还跑着旧代码。这时不一致是必然的，不是 bug——直接报“需要重启”。
  if (row.ver !== viewDefinition.stateVersion) {
    behind.push(`${sessionId}（检查点 ver=${row.ver}，代码是 v${viewDefinition.stateVersion}）`);
    console.log(`⏳ ${sessionId}  检查点 ver=${row.ver} ≠ 代码 v${viewDefinition.stateVersion} —— 宿主还是在跑旧版本，需要重启才生效`);
    continue;
  }
  const events = readSessionEvents(log);
  let state = viewDefinition.init();
  let seen = 0;
  for (const event of events) {
    if (typeof event.seq === 'number' && event.seq > row.seq) break;
    const next = viewDefinition.apply(state, event);
    if (next === undefined) throw new Error('apply 返回 undefined');
    state = next;
    seen++;
  }
  const offline = state;
  const online = row.val;
  const same = JSON.stringify(offline) === JSON.stringify(online);
  const onlineTurns = Array.isArray(online?.turns) ? online.turns.length : -1;
  const offlineTurns = Array.isArray(offline.turns) ? offline.turns.length : -1;
  console.log(
    `${same ? '✅' : '❌'} ${sessionId}  ver=${row.ver}  seq=${row.seq}  离线折叠事件 ${seen} 条  轮次 ${offlineTurns} vs ${onlineTurns}`,
  );
  if (!same) {
    problems++;
    // 找出第一处不同的轮次，把两边的关键字段打出来。
    const offlineTurnsList = offline.turns ?? [];
    const onlineTurnsList = online?.turns ?? [];
    for (let index = 0; index < Math.max(offlineTurnsList.length, onlineTurnsList.length); index++) {
      if (JSON.stringify(offlineTurnsList[index]) === JSON.stringify(onlineTurnsList[index])) continue;
      console.log(`   第一处不同在第 ${index + 1} 条：`);
      for (const key of ['turn', 'end', 'prompt', 'promptMedia', 'title', 'chars', 'steps', 'toolsTotal', 'pending']) {
        if (JSON.stringify(offlineTurnsList[index]?.[key]) === JSON.stringify(onlineTurnsList[index]?.[key])) continue;
        console.log(`     ${key}: 离线 ${JSON.stringify(offlineTurnsList[index]?.[key])?.slice(0, 60)} vs 宿主 ${JSON.stringify(onlineTurnsList[index]?.[key])?.slice(0, 60)}`);
      }
      console.log(`     离线 工具 ${offlineTurnsList[index]?.tools?.length} 个 / 文件 ${offlineTurnsList[index]?.files?.length} 个 / said ${offlineTurnsList[index]?.said?.length} 条 / 正文 ${offlineTurnsList[index]?.answer?.length} 字`);
      console.log(`     宿主 工具 ${onlineTurnsList[index]?.tools?.length} 个 / 文件 ${onlineTurnsList[index]?.files?.length} 个 / said ${onlineTurnsList[index]?.said?.length} 条 / 正文 ${onlineTurnsList[index]?.answer?.length} 字`);
      break;
    }
  } else {
    matches++;
  }
}

// 顺带确认 v1 的投影也还在正常写（宿主两版共存）。
let briefFiles = 0;
for (const name of fs.readdirSync(cacheDir)) {
  if (!name.endsWith('.json')) continue;
  if (fs.readFileSync(path.join(cacheDir, name), 'utf8').includes('"focusBrief"')) briefFiles++;
}

console.log(`\n检查了 ${checked} 个含 focusView 的缓存，逐字段一致 ${matches} 个，不一致 ${problems} 个`);
if (behind.length > 0) console.log(`宿主版本落后（要重启才生效）：${behind.length} 个 —— ${behind.join('、')}`);
console.log(`含 focusBrief（v1）的缓存 ${briefFiles} 个 —— 两版在同一宿主里共存`);
// 只有“版本已经对上的会话”还不一致才算失败；版本落后只是待重启。
process.exit(problems === 0 && (matches > 0 || behind.length > 0) ? 0 : 1);