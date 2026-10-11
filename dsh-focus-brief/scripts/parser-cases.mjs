/**
 * 解析器（契约 → 卡片原料）的定向用例。
 *
 * 为什么不能在别处复制一份逻辑来测：契约与解析器必须**同一份规格**，
 * 复制一份「期望值」就是复制了第二套规则。所以这里喂进去的都是**契约形态的回答原文**，
 * 再从捕获到的投影定义里，把真实的 viewTurnOf 结果读出来逐项对。
 *
 * 用法: node parser-cases.mjs
 */
import crypto from 'node:crypto';
import { apply } from '../index.js';

const definitions = [];
apply({ sessionProjections: { register: (definition) => definitions.push(definition) }, inject: () => {} });
const viewDefinition = definitions.find((definition) => definition.key === 'focusView');
const briefDefinition = definitions.find((definition) => definition.key === 'focusBrief');

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实得 ${JSON.stringify(actual)}`);
  }
}

/** 把一条回答原文喂成「一轮」投影值。 */
function turnOf(answer, end = 'completed') {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问一句' }] } },
    { type: 'assistant/message', seq: 3, time: 3, data: { step: 1, message: { content: [{ type: 'text', text: answer }] } } },
    { type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: end } } },
  ];
  let state = viewDefinition.init();
  for (const event of events) state = viewDefinition.apply(state, event);
  return viewDefinition.wire.view(state)[0];
}

function blockOf(turn, id) {
  return turn.blocks.find((block) => block.id === id);
}

/** 契约形态的完整回答（四个段都有）。 */
const FULL = [
  '【本轮】契约解析器跑通了',
  '',
  '整条回答先按契约切段，每一块只从自己那一段里取内容，卡片上不会再有「猜出来的」条目。',
  '',
  '## 需要你确认',
  '',
  '- 段名要不要允许中英文混写？',
  '- 关键数据表要不要支持三列？',
  '',
  '## 风险提醒',
  '',
  '- 段名写歪的时候，那一段会整段落回正文，卡片上少一个块——这是刻意的：宁可少一个块，也好过猜错。',
  '',
  '## 关键数据',
  '',
  '| 指标 | 值 |',
  '|---|---|',
  '| 契约字符数 | 320 |',
  '| 段名个数 | 4 |',
  '',
  '## 结论建议',
  '',
  '- 先看第一段那句结论，其余按块扫',
  '- 段名清单同时写进契约和解析器，两边必须一致',
  '',
  '结尾一句正文，不属于任何段。',
].join('\n');

console.log('— 契约形态的完整回答 —');
{
  const turn = turnOf(FULL);
  check('标题', turn.title, '契约解析器跑通了');
  check('结论 = 第一段', turn.headline, '整条回答先按契约切段，每一块只从自己那一段里取内容，卡片上不会再有「猜出来的」条目。');
  check('需要你确认块', blockOf(turn, 'asks').items, [{ text: '段名要不要允许中英文混写？' }, { text: '关键数据表要不要支持三列？' }]);
  check('风险提醒块', blockOf(turn, 'risks').items, [{ text: '段名写歪的时候，那一段会整段落回正文，卡片上少一个块——这是刻意的：宁可少一个块，也好过猜错。' }]);
  check('关键数据块', blockOf(turn, 'kpi').items, [{ k: '契约字符数', v: '320' }, { k: '段名个数', v: '4' }]);
  check('结论建议块', blockOf(turn, 'points').items, [
    { depth: 0, text: '先看第一段那句结论，其余按块扫' },
    { depth: 0, text: '段名清单同时写进契约和解析器，两边必须一致' },
  ]);
  check('结尾正文不进任何块', turn.blocks.some((block) => block.items.some((item) => String(item.text ?? '').includes('结尾一句正文'))), false);
  // 块顺序：要你确认排在最前（唯一看完必须动作的块），其余保持「数据 → 文件 → 建议 → 风险」的既有次序。
  // 这条只钉「asks 在最前」+ 四个块都在，不去钉后面三块的相对次序——次序属于卡片排布，不属于解析器。
  check('要你确认排在最前', turn.blocks[0].id, 'asks');
  check('四个块都在', turn.blocks.map((block) => block.id).slice().sort(), ['asks', 'kpi', 'points', 'risks']);
  check('块数', turn.blocks.length, 4);
}

console.log('— 段名写歪（一字之差就不算段） —');
{
  const turn = turnOf(['【本轮】段名写歪', '', '正文一段。', '', '## 需要你确认（3 条）', '', '- 这条会落回正文'].join('\n'));
  check('没有需要你确认块', blockOf(turn, 'asks'), undefined);
  check('结论仍是第一段', turn.headline, '正文一段。');
  check('整轮没有信息块', turn.blocks.length, 0);
  check('待定数不是 3', turn.decisions, 0);
}

console.log('— 加粗段头也要认 —');
{
  const turn = turnOf(['【本轮】加粗段头', '', '结论一句。', '', '**需要你确认**', '', '要不要提交？', '要不要推送？'].join('\n'));
  check('加粗段头切出的块', blockOf(turn, 'asks').items, [{ text: '要不要提交？' }, { text: '要不要推送？' }]);
}

console.log('— 段内纯文字按行成条（契约要求一条一行） —');
{
  const turn = turnOf(['【本轮】纯文字段', '', '结论一句。', '', '## 需要你确认', '', '第一件事：段名清单放哪', '第二件事：闸门怎么数'].join('\n'));
  check('两行两条', blockOf(turn, 'asks').items, [{ text: '第一件事：段名清单放哪' }, { text: '第二件事：闸门怎么数' }]);
}

console.log('— 同名段重复出现只认第一次 —');
{
  const turn = turnOf(['【本轮】重复段', '', '结论一句。', '', '## 风险提醒', '', '- 第一条风险描述够长', '', '## 风险提醒', '', '- 第二条风险描述也够长'].join('\n'));
  check('只认第一段', blockOf(turn, 'risks').items, [{ text: '第一条风险描述够长' }]);
}

console.log('— 围栏里的段头不算段 —');
{
  const turn = turnOf(['【本轮】围栏里的契约', '', '结论一句。', '', '```', '## 需要你确认', '```'].join('\n'));
  check('围栏里不算段', blockOf(turn, 'asks'), undefined);
}

console.log('— 没有契约段的老回答：只给结论，不猜块 —');
{
  const turn = turnOf(['## 本轮进展', '', '我把三处规则都改完了。', '', '- 契约在 index.js', '- 解析器也在 index.js'].join('\n'));
  check('结论取第一段正文，不拿小标题当结论', turn.headline, '我把三处规则都改完了。');
  check('没有信息块（不猜）', turn.blocks.length, 0);
  check('正文不空（全文照旧可展开）', turn.full.length > 0, true);
}

console.log('— 整篇只有标题、没有正文：结论留空，不拿标题顶替 —');
{
  const turn = turnOf(['【本轮】只有标题', '', '## 本轮进展'].join('\n'));
  check('结论为空', turn.headline, '');
}

console.log('— 关键数据少于两项不显示 —');
{
  const turn = turnOf(['【本轮】一个数字', '', '结论一句。', '', '## 关键数据', '', '| 指标 | 值 |', '|---|---|', '| 只有一个 | 1 |'].join('\n'));
  check('单项不成块', blockOf(turn, 'kpi'), undefined);
}

console.log('— 关键数据：契约段优先，本地兜底只补缺席的轮次 —');
{
  // 有契约段时，只认那一段（段内分两张表写也算这一段）。
  const withSection = turnOf([
    '【本轮】两种来源',
    '',
    '结论一句。',
    '',
    '## 关键数据',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    '| 契约里的甲 | 11 |',
    '| 契约里的乙 | 22 |',
    '',
    '段内另起一张表：',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    '| 契约里的丙 | 33 |',
  ].join('\n'));
  check('只取契约段里的表', blockOf(withSection, 'kpi').items, [
    { k: '契约里的甲', v: '11' },
    { k: '契约里的乙', v: '22' },
    { k: '契约里的丙', v: '33' },
  ]);
  // 结论段里的数字表 + 一个只写了一项的「关键数据」段：两者不许混在一起。
  // 段里不够两项时宁可不显示——模型既然把它写进那一段，取的就是那一段的内容。
  const thinSection = turnOf([
    '【本轮】段里只有一项',
    '',
    '结论一句。',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    '| 正文里的甲 | 11 |',
    '| 正文里的乙 | 22 |',
    '',
    '## 关键数据',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    '| 段里只有这一项 | 33 |',
  ].join('\n'));
  check('段里不够两项就不显示（不拿正文的数凑）', blockOf(thinSection, 'kpi'), undefined);
  // 没有契约段（契约之前的老轮次）：扫正文兜底，数字不能白丢。
  const noSection = turnOf([
    '【本轮】老轮次',
    '',
    '结论一句。',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    '| 正文里的甲 | 11 |',
    '| 正文里的乙 | 22 |',
  ].join('\n'));
  check('没有契约段时扫正文', blockOf(noSection, 'kpi').items, [{ k: '正文里的甲', v: '11' }, { k: '正文里的乙', v: '22' }]);
}

console.log('— 结论建议不许重复卡片那句结论 —');
{
  const turn = turnOf(['【本轮】不重复', '', '同一句话不该出现两次。', '', '## 结论建议', '', '- 同一句话不该出现两次。', '- 另一条真建议'].join('\n'));
  check('重复项被去掉', blockOf(turn, 'points').items, [{ depth: 0, text: '另一条真建议' }]);
}

console.log('— v1 小卡共用同一解析器 —');
{
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: FULL }] } } },
    { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  let state = briefDefinition.init();
  for (const event of events) state = briefDefinition.apply(state, event);
  const brief = briefDefinition.wire.view(state)[0];
  check('小卡结论', brief.headline, '整条回答先按契约切段，每一块只从自己那一段里取内容，卡片上不会再有「猜出来的」条目。');
  check('小卡要你确认', brief.asks, ['段名要不要允许中英文混写？', '关键数据表要不要支持三列？']);
  check('小卡要点', brief.bullets.map((item) => item.text), ['先看第一段那句结论，其余按块扫', '段名清单同时写进契约和解析器，两边必须一致']);
}

console.log('— 闸门：契约里的段名必须和解析器认的名字完全一致（防两边漂移） —');
{
  // 抓活体契约文本，把里面出现的 `## 名字` 全摘出来，跟解析器认的清单比。
  const sections = [];
  apply({ sessionProjections: { register: () => {} }, inject: (deps, callback) => callback({ systemPrompt: { section: (section) => sections.push(section) } }) });
  const named = [...sections[0].text.matchAll(/`## ([^`]+)`/g)].map((match) => match[1].trim());
  check('契约里列出的段名', named, ['需要你确认', '风险提醒', '关键数据', '结论建议']);
  // 真喂一条按契约段名写的回答，四个段都要被认出来（名字错了这里就会掉块）。
  // 段名从契约文本里来，所以契约改了名字、解析器没跟上，这条会立刻红。
  const body = [];
  for (const name of named) {
    body.push(`## ${name}`, '');
    if (name === '关键数据') {
      body.push('| 指标 | 值 |', '|---|---|', '| 契约字符数 | 320 |', '| 段名个数 | 4 |');
    } else {
      body.push('- 一条够长的内容条目');
    }
    body.push('');
  }
  const turn = turnOf(['【本轮】名字一致', '', '结论。', '', ...body].join('\n'));
  check('四个段名全部被认出来', turn.blocks.map((block) => block.id).slice().sort(), ['asks', 'kpi', 'points', 'risks']);
}

console.log('');
console.log(`${checks} 项检查，${failures} 项失败`);
if (failures > 0) process.exit(1);
// crypto 只是用来确认脚本跑在真实 node 上（顺手挡住被当成静态文件解析）。
void crypto.createHash;