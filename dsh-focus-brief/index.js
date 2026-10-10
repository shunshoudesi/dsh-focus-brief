/**
 * 重点卡片（Focus Brief）· 宿主半
 *
 * 宿主侧只做两件事，都不产生额外的模型调用：
 *
 * 1. 注册 `focusBrief` 会话投影单元：把会话日志按轮次折叠成
 *    「你问的 / 结论 / 要点 / 需要你确认 / 过程计数」，通过 `wire` 块交给客户端读。
 *    折叠只读已提交的事件，不写任何新事件，因此不会污染会话记录。
 *
 * 2. 通过 `ctx.systemPrompt.section()` 追加一条回答格式约定（结论先行、不贴日志）。
 *
 * 依赖策略：本文件不 import 任何外部包。投影注册表对 `stateSchema` / `wire.viewSchema`
 * 只调用 `.parse()`，这里给一个不抛错的直通校验，于是本包既不需要联网装依赖，
 * 也不会因为 `peerDependencies` 而撞上 DSH 0.2 的启动兼容门禁。
 */

/** 投影键；客户端用 `useProjection('focusBrief')` 读取，两边必须一致。 */
const PROJECTION_KEY = 'focusBrief';

/** 字段或折叠语义一变更就必须递增（注册表要求同键同版本才能共享单元）。 */
const STATE_VERSION = 4;

/** 只保留最近多少轮：控制投影值与检查点体积，避免长会话把推送帧撑大。 */
const MAX_TURNS = 40;

/** 折叠时保留的正文上限（宿主侧状态，会进检查点，别开太大）。 */
const ANSWER_LIMIT = 3000;
const PROMPT_LIMIT = 300;

/** 提炼结果的逐项上限。 */
const HEADLINE_LIMIT = 200;
/** 结论行的最小长度：比这还短的段落基本都是“整理完了。”这类状态句，不值得占第一行。 */
const MIN_HEADLINE = 12;
const BULLET_LIMIT = 100;
const MAX_BULLETS = 10;
const MAX_FALLBACK_POINTS = 6;
const MAX_ASKS = 4;
const MAX_DEPTH = 3;

/** 模型自己标出「要你拍板」的小标题。实测真实回答里常见：需要你确认 / 需要你拍板的 / 请你回答这五个问题。 */
const DECISION_HEADING = /需要你|请你|由你|需要(确认|拍板|定)/;

/**
 * 极简 schema：注册表只用到 `.parse()`。
 * 直通返回而不抛错，是为了让一个意外形状的事件永远不能把投影驱动打断。
 */
const passthroughSchema = {
  parse: (value) => value,
};

/** 按空白折叠并截断。 */
function clip(text, limit) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * 去掉行内 markdown 标记。
 * 卡片显示的是纯文本，`**强调**` 和反引号会原样露出来，必须先剥掉。
 */
function plain(text) {
  return text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2')
    .replace(/`+(.+?)`+/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s?/, '')
    .trim();
}

/** 这一段是不是"只有一行小标题"。小标题是标题，不是结论。 */
function isHeadingOnly(part) {
  const trimmed = part.trim();
  return /^#{1,6}\s+\S/.test(trimmed) && !trimmed.includes('\n');
}

/**
 * 把一条消息的内容块拼成纯文本，保留换行（要点提取依赖行结构）。
 * 只取 `text` 块；图片等非文本块在此只贡献一个占位空行。
 */
function contentText(content, limit) {
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    if (text.length >= limit) break;
    const room = limit - text.length;
    const chunk = block.text.length > room ? block.text.slice(0, room) : block.text;
    text += text === '' ? chunk : `\n${chunk}`;
    if (chunk.length < block.text.length) break;
  }
  return text;
}

/**
 * 结论：优先取第一个“够长”的非标题段落，压成一行。
 * 实测 177 个真实轮次里，开头最常见的是 `## 本轮进展` 这种标题，其次就是
 * “整理完了。”这类 5 个字符的状态句——两个都不该占结论行，所以要跳过。
 * 全都够短时退回第一个正文段落，再退回第一个标题，保证这行不空着。
 */
function headlineOf(text) {
  let firstProse = '';
  let firstHeading = '';
  let fallback = '';
  for (const part of text.split(/\n{2,}/)) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const line = plain(trimmed);
    if (line === '') continue;
    if (fallback === '') fallback = line;
    if (isHeadingOnly(part)) {
      if (firstHeading === '') firstHeading = line;
      continue;
    }
    if (firstProse === '') firstProse = line;
    if (line.length >= MIN_HEADLINE) return clip(line, HEADLINE_LIMIT);
  }
  if (firstProse !== '') return clip(firstProse, HEADLINE_LIMIT);
  if (firstHeading !== '') return clip(firstHeading, HEADLINE_LIMIT);
  return fallback === '' ? '' : clip(fallback, HEADLINE_LIMIT);
}

/**
 * 要点：小标题建层级，列表项挂在当前小标题下面，缩进再叠一层。
 * 这样出来的才是真的树，而不是标题和列表项混在同一层。
 */
function bulletsOf(text) {
  const out = [];
  const lines = text.split('\n');
  // 因为 markdown 回答普遍用 `##` 当顶层标题，直接用井号个数当层级会白白多缩进一层。
  // 先找出这篇回答里最浅的小标题，把它当第 0 层。
  let shallowest = 7;
  for (const raw of lines) {
    const heading = /^(#{1,6})\s+\S/.exec(raw.trim());
    if (heading !== null) shallowest = Math.min(shallowest, heading[1].length);
  }
  const base = shallowest === 7 ? 1 : shallowest;
  let headingDepth = -1;
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      headingDepth = Math.min(MAX_DEPTH, heading[1].length - base);
      const item = clip(plain(heading[2]), BULLET_LIMIT);
      if (item !== '' && !out.some((entry) => entry.text === item)) {
        out.push({ depth: Math.max(0, headingDepth), text: item });
      }
      if (out.length >= MAX_BULLETS) break;
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet === null) continue;
    const item = clip(plain(bullet[1]), BULLET_LIMIT);
    if (item === '') continue;
    if (out.some((entry) => entry.text === item)) continue;
    const depth = (headingDepth < 0 ? 0 : headingDepth + 1) + Math.floor(indent / 2);
    out.push({ depth: Math.min(MAX_DEPTH, depth), text: item });
    if (out.length >= MAX_BULLETS) break;
  }
  return out.length > 0 ? out : paragraphPoints(text);
}

/**
 * 兜底骨架：整段纯文字、既没有列表也没有小标题时，用每一段的第一句当要点。
 * 实测 177 个真实轮次里有 14% 属于这一类，而这正是“单调的文字”最劝退的地方。
 */
function paragraphPoints(text) {
  const out = [];
  for (const part of text.split(/\n{2,}/)) {
    if (isHeadingOnly(part)) continue;
    const line = plain(part).replace(/\s+/g, ' ');
    if (line === '') continue;
    const match = /^[^。！？!?；;]*[。！？!?；;]/.exec(line);
    const item = clip(match === null ? line : match[0], BULLET_LIMIT);
    if (item === '') continue;
    if (out.some((entry) => entry.text === item)) continue;
    out.push({ depth: 0, text: item });
    if (out.length >= MAX_FALLBACK_POINTS) break;
  }
  return out;
}

/**
 * 需要你确认：两种来源合起来。
 *
 * 1. 模型自己用小标题划出的决策段（`## 需要你拍板的`、`## 请你回答这五个问题`）——段里的列表项和正文行都算。
 *    实测这比在正文里扫关键词准得多：扫「建议/推荐」会命中 28% 的轮次，但抽样一看全是解释性文字。
 * 2. 正文里带问号的句子——补上没被划进决策段的决策点。
 *
 * 小标题本身不入列（会和卡片上的「需要你确认」标题重复），只用来划定范围。
 */
/** 去掉整条内容外面裹的一对引号，避免卡片里出现 `"…"` 这种残留。 */
function unwrapQuotes(text) {
  return text.replace(/^["“”']|["“”']$/g, '').trim();
}

/**
 * 表格行取值：挑带问号的单元格，没有就挑最长的。
 * 否则整行 `| 1 | "…" | 设计权衡 |` 会被原样塞进卡片——实测这种回答不少。
 */
function cellOf(line) {
  if (!line.startsWith('|')) return line;
  const cells = line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '' && !/^-{2,}$/.test(cell));
  if (cells.length === 0) return line;
  const withMark = cells.find((cell) => /[？?]/.test(cell));
  if (withMark !== undefined) return withMark;
  return cells.reduce((best, cell) => (cell.length > best.length ? cell : best), '');
}

function asksOf(text) {
  const out = [];
  const push = (item) => {
    if (item === '' || out.includes(item)) return;
    out.push(item);
  };
  let decisionLevel = -1;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      // 决策段内部的子标题不结束该段；同级或更高级的标题才结束。
      if (decisionLevel !== -1 && level > decisionLevel) continue;
      decisionLevel = DECISION_HEADING.test(heading[2]) ? level : -1;
      continue;
    }
    const inDecision = decisionLevel !== -1;
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    const source = cellOf(line);
    if (bullet !== null) {
      // 列表项只走决策段那条路：否则没带决策含义的问句列表项会和「要点」重复一遍。
      if (inDecision) push(clip(unwrapQuotes(plain(bullet[1])), BULLET_LIMIT));
    } else if (/[？?]/.test(line)) push(clip(unwrapQuotes(plain(source)), BULLET_LIMIT));
    else if (inDecision) push(clip(unwrapQuotes(plain(source)), BULLET_LIMIT));
    if (out.length >= MAX_ASKS) break;
  }
  return out;
}

/** 一整个轮次的原始折叠结果。 */
function emptyTurn(turn, startSeq) {
  return { turn, startSeq, prompt: '', answer: '', toolCalls: 0 };
}

/** 只保留最近 MAX_TURNS 轮。 */
function trim(entries) {
  return entries.length > MAX_TURNS ? entries.slice(entries.length - MAX_TURNS) : entries;
}

/**
 * 折叠一条已提交的会话事件。
 * 与单元无关的事件必须返回同一个引用——引用不变意味着下游零工作量。
 */
function foldEvent(state, event) {
  switch (event.type) {
    case 'turn/start': {
      const last = state.entries.at(-1);
      // 不前进的边界（重试）落在已有条目上，保持数组按轮次严格递增。
      if (last !== undefined && event.data.turn <= last.turn) return state;
      return {
        entries: trim([...state.entries, emptyTurn(event.data.turn, event.seq)]),
        draft: '',
        draftTools: 0,
      };
    }
    case 'user/message': {
      // 只有人类真发的消息才算“你问的”；转向、goal 注入等都不算。
      if (event.data.source?.kind !== 'user') return state;
      const last = state.entries.at(-1);
      if (last === undefined || last.prompt !== '') return state;
      const prompt = clip(contentText(event.data.content, PROMPT_LIMIT), PROMPT_LIMIT);
      if (prompt === '') return state;
      return {
        ...state,
        entries: [...state.entries.slice(0, -1), { ...last, prompt }],
      };
    }
    case 'assistant/message': {
      // 一轮里可能有多条助手消息（多步）；最新的那条文本在 turn/end 时落定。
      const answer = contentText(event.data.message?.content, ANSWER_LIMIT);
      if (answer === '' || answer === state.draft) return state;
      return { ...state, draft: answer };
    }
    case 'tool/call': {
      return { ...state, draftTools: state.draftTools + 1 };
    }
    case 'turn/end': {
      if (state.draft === '' && state.draftTools === 0) return state;
      const last = state.entries.at(-1);
      if (last === undefined) return { ...state, draft: '', draftTools: 0 };
      const answer = state.draft;
      const toolCalls = last.toolCalls + state.draftTools;
      if (last.answer === answer && last.toolCalls === toolCalls) {
        return { ...state, draft: '', draftTools: 0 };
      }
      return {
        ...state,
        entries: [...state.entries.slice(0, -1), { ...last, answer, toolCalls }],
        draft: '',
        draftTools: 0,
      };
    }
    default:
      return state;
  }
}

/**
 * 把折叠状态投影成客户端值。
 * 只带提炼结果，不带完整正文——正文已由聊天界面渲染，重复携带会白白撑大推送帧。
 */
function briefOf(entry, text, toolCalls) {
  return {
    turn: entry.turn,
    startSeq: entry.startSeq,
    prompt: entry.prompt,
    headline: headlineOf(text),
    bullets: bulletsOf(text),
    asks: asksOf(text),
    toolCalls,
    answerChars: text.length,
  };
}

const projectionDefinition = {
  key: PROJECTION_KEY,
  stateVersion: STATE_VERSION,
  stateSchema: passthroughSchema,
  init: () => ({ entries: [], draft: '', draftTools: 0 }),
  apply: foldEvent,
  wire: {
    viewSchema: passthroughSchema,
    view: (state) => {
      // 正在进行的最后一轮也用草稿预览，否则最常见的“刚问完”那一轮卡片是空的。
      const last = state.entries.at(-1);
      return state.entries.map((entry) =>
        entry === last && state.draft !== ''
          ? briefOf(entry, state.draft, entry.toolCalls + state.draftTools)
          : briefOf(entry, entry.answer, entry.toolCalls),
      );
    },
  },
};

/** 回答格式约定；只加一段静态文本，不碰工具、不动其它插件的贡献。 */
const CONTRACT_NAME = 'dsh-focus-brief:answer-format';
const CONTRACT_ORDER = 9000;
const CONTRACT_TEXT = [
  '回答格式约定（优先级高于风格偏好）：',
  '1. 第一段必须直接回答用户这次的问题本身：先给结论或答案，不要复述问题、不要铺垫背景，也不要用「已完成」「整理好了」这类状态句开头。',
  '2. 正文只写结论与必要推理；禁止把工具输出、命令回显、日志、文件内容整段粘进回答，需要引用时只写结论与路径。',
  '3. 除此之外的内容用短列表一行一条；有拿不准或需要用户决定的事，单独列成「需要你确认」。',
].join('\n');

/** 投影注册表是宿主半的核心目的；缺了它这个 fiber 就保持挂起。 */
export const inject = ['sessionProjections'];

/**
 * @param {object} ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  ctx.sessionProjections.register(projectionDefinition);
  // 提示词服务在别的装配里可能缺席，用可选注入，避免整插件起不来。
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: CONTRACT_NAME,
      order: CONTRACT_ORDER,
      text: CONTRACT_TEXT,
    });
  });
}