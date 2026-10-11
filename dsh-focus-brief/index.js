/**
 * 重点卡片 + 专注视图 · 宿主半
 *
 * 宿主侧只做三件事，都不产生额外的模型调用：
 *
 * 1. 注册 `focusBrief` 投影（v1 便宜版）：把会话日志按轮次折成
 *    「你问的 / 结论 / 要点 / 需要你确认 / 过程计数」，给普通对话视图里那张小卡片用。
 *
 * 2. 注册 `focusView` 投影（v2 专注视图）：把同一份日志折成“每轮一张完整结果卡”需要的原料——
 *    状态、标题、一句结论、产出文件、关键数据、结论建议、风险提醒。
 *    结论与那些块**不是猜出来的**：本地有一份骨架规格（契约段名），模型按同一份规格写回答，
 *    解析器照规格切段取内容（`splitAnswer` / `conclusionOf` / `*FromSection`）。
 *
 * 3. 通过 `ctx.systemPrompt.section()` 下发那份骨架规格（标题行 + 第一段结论 + 四个固定段名）。
 *    契约是接口，本地是解析器——不额外发模型请求，规格就写在模型本来要产出的那条回答里。
 *
 * 两条折叠都只读已提交的事件，不写任何新事件，因此不会污染会话记录。
 *
 * 依赖策略：本文件不 import 任何外部包（连 node 内置也不引）。投影注册表对
 * `stateSchema` / `wire.viewSchema` 只调用 `.parse()`，这里给一个不抛错的直通校验，
 * 于是本包既不需要联网装依赖，也不会因为 `peerDependencies` 撞上 DSH 0.2 的启动兼容门禁；
 * 也因为没有 `node:fs` 这类导入，插件在任何受限宿主里都能加载（代价：产出文件不显示大小）。
 */

/* ==================================================================== */
/* 共用小工具                                                             */
/* ==================================================================== */

/** 只保留最近多少轮：控制投影值与检查点体积，避免长会话把推送帧撑大。 */
const MAX_TURNS = 40;

/** 折叠时保留的正文上限（宿主侧状态，会进检查点，别开太大）。 */
const ANSWER_LIMIT = 3000;
const PROMPT_LIMIT = 300;

/** 提炼结果的逐项上限。 */
const HEADLINE_LIMIT = 200;
const BULLET_LIMIT = 100;
const MAX_BULLETS = 10;
const MAX_ASKS = 4;
const MAX_DEPTH = 3;

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

/**
 * 这行是 markdown 的**结构线**，不是内容。
 *
 * 真实语料里三种都漏进过卡片：一轮的「需要你确认」第一条是个 `---`（水平分隔线），
 * 另一轮围栏的第一行 ``` 被压成了一条孤零零的反引号。卡片是给人看结果的，
 * 模型排版用的线和标记不该占一行，更不该伪装成「要你拍板的事」。
 */
function isMarkdownNoise(line) {
  if (/^`{3,}/.test(line)) return true;
  // --- / *** / ___ / - - -（同一符号至少三次）
  if (/^([-*_])\s*(?:\1\s*){2,}$/.test(line)) return true;
  // markdown 表格分隔行 |---|---|
  if (/^\|[\s:|-]+\|$/.test(line)) return true;
  return false;
}

/**
 * 这条条目里有没有「字」——数字、字母或汉字（剥掉 markdown 标记之后再判断）。
 * 挡掉 `---`、孤零零的反引号、`·`、`→` 这类只剩标点的条目：它们对读的人没有任何信息。
 */
function hasWordChar(text) {
  return /[0-9A-Za-z\u3400-\u9fff]/.test(text);
}

/**
 * 把一条消息的内容块拼成纯文本，保留换行（要点提取依赖行结构）。
 * 只取 `text` 块；`reasoning`（思考）与图片等非文本块一律不进卡片——
 * 实测每条 assistant/message 里的 `reasoning` 都比正文长，带上就是自找噪音。
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

/* ==================================================================== */
/* 回答格式契约 · 骨架（本地写死）与解析器（本地确定性）                    */
/* ==================================================================== */

/**
 * 契约规定的四个段名，**一字不差**。骨架定义在本地（这里），内容由模型填。
 *
 * 为什么名字要钉死、而不是像以前那样按关键词去猜「这段算不算风险段」：
 * 在 15 个会话 / 370 条真实回答上数过（`.tmp/section-census.mjs`）——
 * 82% 的回答有小标题，但标题文本极度自由（「一句话回答你」18 次、「验证」15 次、「验收」8 次…），
 * 按关键词归类最多命中 29%（结论），风险段只命中 7%，而且那 7% 里混着解释性文字。
 * 换句话说：**模型自己写的段名太散，散到本地不可能猜准**；把名字写进契约之后，
 * 本地才有一个可靠的接口可以读——「契约是接口，本地是解析器」就是这个意思。
 *
 * 同时**导出**出去：闸门脚本要拿同一份清单来数「契约遵守度」，
 * 复制一份到脚本里就等于又多了一套会漂移的规则。
 */
export const SECTION_NAMES = ['需要你确认', '风险提醒', '关键数据', '结论建议'];

/** 契约段起点：整行就是 `## 需要你确认` 或 `**需要你确认**`（名字必须全等，多一个字就不算）。 */
const SECTION_LINE = /^(?:#{1,6}\s*|\*\*)([^*#\n]+?)(?:\*\*|)\s*[：:]?$/;

/** 从一行里认出契约段名；不是契约段就返回 ''。 */
function sectionNameOf(line) {
  const match = SECTION_LINE.exec(line.trim());
  if (match === null) return '';
  const name = match[1].trim().replace(/[。：:]+$/, '');
  return SECTION_NAMES.includes(name) ? name : '';
}

/**
 * 把整条回答切成「结论 + 若干契约段」。**这是解析器，不是提炼器**：
 * 它只认契约规定的段名，其余内容一律算正文，不再用关键词去猜哪段像风险、哪行像要点。
 *
 * 三种真实形态都要认（语料里都出现过）：
 * - `## 需要你确认`：标题形态（契约规定的主形态）；
 * - `**需要你确认**`：整行加粗形态（模型爱用，2 遍普查里都有）；
 * - `## 需要你确认（3 条）`：名字后面多写了字——**这不是合法段头**（契约要求一字不多），
 *   所以它不算段起点，会留在正文里；`fold-view.mjs` 有一条闸门专门数这种「走形的段头」，
 *   用来验证契约有没有被模型遵守。
 *
 * 段头在代码围栏里一律不算（回答里真出现过贴契约自身的围栏块）。
 */
function splitAnswer(text) {
  const lines = text.split('\n');
  const sections = new Map();
  const conclusion = [];
  /** 每一行属于哪一段（-1 = 结论段，其余 = 出现次序）。关键数据要靠它判断「表格在不在契约段里」。 */
  const ownership = [];
  let current = conclusion;
  let currentIndex = -1;
  let fenced = false;
  // 契约说好每段只写一次。真出现第二次时，**它连同下面的内容一起不要**（不是并进第一段）：
  // 并进去就等于在块的边界上留了一个说不清的缺口——那正是「解析器」不该做的事。
  let skipping = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^`{3,}/.test(line)) {
      fenced = !fenced;
      if (!skipping) current.push(raw);
      ownership.push(skipping ? -2 : currentIndex);
      continue;
    }
    if (!fenced) {
      const name = sectionNameOf(line);
      if (name !== '') {
        if (sections.has(name)) {
          skipping = true;
          ownership.push(-2);
          continue;
        }
        skipping = false;
        current = [];
        currentIndex = sections.size;
        sections.set(name, current);
        ownership.push(-2);
        continue;
      }
    }
    if (!skipping) current.push(raw);
    ownership.push(skipping ? -2 : currentIndex);
  }
  return {
    conclusion: conclusion.join('\n').trim(),
    section: (name) => (sections.get(name) ?? []).join('\n').trim(),
    /** 这个段名出现的位置（-1 = 整轮没这个段）；关键数据要靠它判「表格在不在契约段里」。 */
    sectionIndex: (name) => (sections.has(name) ? [...sections.keys()].indexOf(name) : -1),
    /** 第 N 行（trim 过）属于哪个契约段（-1 = 结论段，-2 = 段头行或被跳过的重复段）。 */
    ownerOf: (index) => ownership[index] ?? -1,
  };
}

/**
 * 结论行：契约第一段（正文里那个「直接给答案」的段落）。
 *
 * 它只做三件事，都是被真实语料与截图教出来的：
 * 1. 跳过 markdown 结构线。读真实语料时亲眼见过结论行被压成
 *    `| 检查 | 结果 | |---|---|---| 三块笔记数与旧库逐块对比 | 28 / 32 / 31 —— 完全一致 | …`，
 *    表格线、分隔行、竖线全挤进卡片第一行——所以表格行也不算；
 * 2. 段落只有一行列表时取第一条列表项，而不是把整张列表压平（`- a - b - c` 谁也没法读）；
 * 3. **小标题不算结论**。契约要求第一段就是答案，这段里冒出来的 `## 本轮进展` 是排版，
 *    不是结论；真的整篇只有标题没有正文时，这一行宁可空着（客户端显示「（这轮没写结论）」），
 *    也不拿一个标题冒充。
 */
function conclusionOf(text) {
  for (const part of text.split(/\n{2,}/)) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const firstLine = trimmed.split('\n')[0].trim();
    if (isMarkdownNoise(firstLine)) continue;
    if (trimmed.startsWith('|') || firstLine.startsWith('|')) continue;
    if (/^#{1,6}\s+\S/.test(firstLine)) continue;
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(firstLine);
    const candidate = plain(bullet === null ? trimmed : bullet[1]).replace(/\s+/g, ' ');
    if (candidate !== '' && hasWordChar(candidate)) return clip(candidate, HEADLINE_LIMIT);
  }
  return '';
}

/**
 * 一段契约正文 → 条目骨架。小标题建层级，列表项挂在它下面，缩进再叠一层。
 * 契约规定「段内可以用小标题和列表」，所以这里仍然要建树，而且**除了四个契约段名之外的小标题都算层级**
 * （`## 验证` 这种是内容，不是段）。
 */
function bulletsOf(text) {
  const out = [];
  const lines = text.split('\n');
  // 小标题普遍用 `##` 当顶层，直接用井号个数当层级会白白多缩进一层；先找出最浅的那层当第 0 层。
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
    if (isMarkdownNoise(line)) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      headingDepth = Math.min(MAX_DEPTH, heading[1].length - base);
      const item = clip(plain(heading[2]), BULLET_LIMIT);
      if (item !== '' && hasWordChar(item) && !out.some((entry) => entry.text === item)) {
        // `head` 只是给专注视图用的标记（小标题本身不是结论）：v1 只读 text/depth，不受影响。
        out.push({ depth: Math.max(0, headingDepth), text: item, head: true });
      }
      if (out.length >= MAX_BULLETS) break;
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet === null) continue;
    const item = clip(plain(bullet[1]), BULLET_LIMIT);
    if (item === '' || !hasWordChar(item)) continue;
    if (out.some((entry) => entry.text === item)) continue;
    const depth = (headingDepth < 0 ? 0 : headingDepth + 1) + Math.floor(indent / 2);
    out.push({ depth: Math.min(MAX_DEPTH, depth), text: item });
    if (out.length >= MAX_BULLETS) break;
  }
  return out;
}

/**
 * 某个契约段 → 条目列表。
 * - 有列表就按列表建骨架（`**需要你确认**` 那种整行加粗的段头已经在分段时被吃掉了）；
 * - 整段是纯文字（没有列表）时，**契约规定「每条一行」**，所以按行取——一行一条，
 *   这比 v1 那套「按句号切、按段压平」准得多，也不会把一段话压成一行。
 * - 只认契约段名之外的**小标题**若出现在段里：那是内容，当条目收下（`head` 标记）。
 */
function itemsOf(text, shape) {
  const out = [];
  const push = (value, head) => {
    const item = clip(shape.plainBody ? plain(value) : unwrapQuotes(plain(value)), shape.limit);
    if (item === '' || !hasWordChar(item) || item.length < shape.min) return;
    if (out.some((entry) => entry.text === item)) return;
    out.push(head ? { depth: 0, text: item, head: true } : { depth: 0, text: item });
  };
  const bullets = bulletsOf(text);
  if (bullets.length > 0) {
    for (const item of bullets) {
      if (item.text.length < shape.min) continue;
      if (out.some((entry) => entry.text === item.text)) continue;
      out.push(item);
      if (out.length >= shape.max) break;
    }
    return out;
  }
  for (const raw of text.split('\n')) {
    if (out.length >= shape.max) break;
    const line = raw.trim();
    if (line === '' || isMarkdownNoise(line)) continue;
    if (line.startsWith('|')) continue;
    push(line.replace(/^(?:[-*+]|\d+[.)])\s+/, ''), false);
  }
  return out;
}

/**
 * 结论建议：契约段里的骨架，去掉两类“占位置”的行——
 * 1. 与卡片第一行那句结论重复的条目（同一句话不该在卡片里出现两次）；
 * 2. 只有小标题、下面什么都没有的条目。
 */
function pointsFromSection(text, headline) {
  const base = itemsOf(text, { max: MAX_BULLETS, limit: BULLET_LIMIT, min: 0, plainBody: true });
  // 截断过的结论行末尾带「…」，直接比字符串会漏判，所以先抹掉尾部省略号与标点再比。
  const norm = (value) => value.replace(/…+$/, '').replace(/[。！？!?；;，,、\s]+$/, '').trim();
  const headlineKey = headline === '' ? '' : norm(headline);
  const duplicate = (item) => {
    if (headlineKey === '') return false;
    const key = norm(item.text);
    return key === headlineKey || headlineKey.startsWith(key) || key.startsWith(headlineKey);
  };
  return base.filter((item, index) => {
    if (item.head === true) {
      const next = base[index + 1];
      if (next === undefined || next.depth <= item.depth) return false;
    }
    return !duplicate(item);
  });
}

/**
 * 风险提醒 / 需要你确认：契约段里的条目，各自有长度门槛。
 * 风险条目太短（`**具体后果**` 这种伪小标题）不算内容；需要你确认则允许短句（「要不要提交？」）。
 */
function itemsFromSection(text, shape) {
  return itemsOf(text, shape);
}

/**
 * 关键数据的取数：只认「数字 + 可选单位」。
 *
 * 这条判据在 v1 是靠并排跑候选规则 + 打样例定下来的（`.tmp/kpi-variants.mjs`），
 * 它正是把「内容表格 / 目录」挡在外面的东西，所以**契约换了接口、判据不变**。
 *
 * `ownerOf` + `allowed` 用来把取数范围钉在契约段内：`splitAnswer` 会给每一行标出归属，
 * 只有归属落在允许的那几段里的行才算——所以同一篇里**段外**那张长得像表格的正文
 * （对照表、目录）不会被顺手收进来。
 * 少于两项就整块不显示（一个数字不值得占一个信息块）。
 */
function kpisIn(text, ownerOf, allowed) {
  const out = [];
  const lines = text.split('\n');
  const ok = (index) => allowed === undefined || allowed.has(ownerOf(index));
  const push = (key, value) => {
    const k = plain(key).trim();
    const v = clip(plain(value), KPI_VALUE_LIMIT);
    if (k.length < 2 || k.length > KPI_KEY_LIMIT || KPI_KEY_JUNK.test(k)) return;
    // 纯数字的“键”是表格的行标，不是指标名（实测漏进来过 `200 = ~0.99+`）；
    // 但带点号的版本号要留（`0.3.6 = 54942` 是版本对比，那是真数据）。
    if (/^[0-9]+$/.test(k)) return;
    if (!KPI_VALUE.test(v)) return;
    if (out.some((item) => item.k === k)) return;
    out.push({ k, v });
  };
  for (const [index, raw] of lines.entries()) {
    if (out.length >= KPI_MAX) break;
    const line = raw.trim();
    if (line === '' || line.startsWith('```') || !ok(index)) continue;
    if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '');
      if (cells.length < 2) continue;
      // 表头行（`| 指标 | 值 |`）不可能是数据：值那一格不是数字，会被下面这一句挡掉。
      const value = cells.slice(1).find((cell) => KPI_VALUE.test(clip(plain(cell), KPI_VALUE_LIMIT)));
      if (value === undefined) continue;
      push(cells[0], value);
      continue;
    }
    const kv = /^[-*+]?\s*\*\*([^*]{2,16})\*\*[：:]\s*(.+)$/.exec(line);
    if (kv !== null) push(kv[1], kv[2]);
  }
  return out;
}

/**
 * 关键数据的两种来源：**契约优先，本地兜底**。
 *
 * - 契约段在 → 只认那一段里的表。这是「内容由模型判」的正路：哪个数字值得上卡，模型说了算；
 *   本地只负责按表格取数、按「数字 + 可选单位」过滤。范围靠行归属钉死，
 *   所以段外那些长得像表格的正文（对照表、目录）不会被顺手收进来。
 * - 契约段不在 → 扫整篇。这是给**契约之前的老轮次**的兼容，不是替代品：实测 208 轮语料里
 *   有 14 轮带着货真价实的数字表（HNSW 参数、提交文件数、压测结果），而契约段一个都没有
 *   （契约是这一版才下发的）。不放兜底，这些轮的数字会一起消失。
 *
 * 两路都要求至少两项，否则整块不显示。
 */
function kpisFrom(parsed, answer) {
  const kpiIndex = parsed.sectionIndex('关键数据');
  // 契约段在 → 只认归属等于那一段的行。段内另起一张表也算这一段（同一节里分两块写没问题），
  // 但**别的段里的表格不算**——这一条有意识：模型把数字写在「结论建议」里，说明它的判断是
  // 「那不是关键数据」，本地不该越权替它改判。段里不够两项就整块不显示（一个数字不值得占一块），
  // 也不拿正文里的数字去凑。
  if (kpiIndex !== -1) {
    const fromSection = kpisIn(answer, parsed.ownerOf, new Set([kpiIndex]));
    return fromSection.length >= 2 ? fromSection : [];
  }
  // 契约段不在 → 扫结论段（= 老轮次没写段头，数字就写在正文里）。
  // 这是给契约之前那批历史轮次的兼容，不是替代品：实测 208 轮语料里有 14 轮带着货真价实的
  // 数字表（HNSW 参数、提交文件数、压测结果），而契约段一个都没有（契约是这一版才下发的）。
  const fallback = kpisIn(answer, parsed.ownerOf, new Set([-1]));
  return fallback.length >= 2 ? fallback : [];
}

/** 去掉整条内容外面裹的一对引号，避免卡片里出现 `"…"` 这种残留。 */
function unwrapQuotes(text) {
  return text.replace(/^["“”']|["“”']$/g, '').trim();
}

/** 只保留最近 MAX_TURNS 轮。 */
function trim(entries) {
  return entries.length > MAX_TURNS ? entries.slice(entries.length - MAX_TURNS) : entries;
}

/* ==================================================================== */
/* v1：focusBrief —— 普通对话视图里的那张小折叠卡（保留当兜底）             */
/* ==================================================================== */

/** 投影键；客户端用 `useProjection('focusBrief')` 读取，两边必须一致。 */
const PROJECTION_KEY = 'focusBrief';

/**
 * 字段或折叠语义一变更就必须递增（注册表要求同键同版本才能共享单元）。
 * v5 = 小卡片也改读契约段（结论 = 第一段，要点 = 「结论建议」段，要你确认 = 「需要你确认」段），
 * 不再跑 v1 自己那套「决策段 + 任何问号句」的启发式——两张卡从此共用同一个解析器。
 */
const STATE_VERSION = 5;

/** 一整个轮次的原始折叠结果。 */
function emptyTurn(turn, startSeq) {
  return { turn, startSeq, prompt: '', answer: '', toolCalls: 0 };
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
  // v1 与专注视图共用同一个解析器（同一份契约规格）：结论 = 契约第一段，要点 = 「结论建议」段，
  // 要你确认 = 「需要你确认」段。这里也要先剥掉契约标题行，否则标题会顶在结论位上。
  const split = text === '' ? { title: '', text: '' } : splitTitleLine(text);
  const answer = split.text === '' ? null : splitAnswer(split.text);
  const headline = answer === null ? '' : conclusionOf(answer.conclusion);
  return {
    turn: entry.turn,
    startSeq: entry.startSeq,
    prompt: entry.prompt,
    headline,
    bullets: answer === null ? [] : pointsFromSection(answer.section('结论建议'), headline),
    asks: answer === null ? [] : itemsFromSection(answer.section('需要你确认'), { max: MAX_ASKS, limit: BULLET_LIMIT, min: 0, plainBody: false }).map(({ text: value }) => value),
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

/* ==================================================================== */
/* v2：focusView —— 「专注」视图用的每轮完整结果卡                          */
/* ==================================================================== */

/** 投影键；客户端用 `useProjection('focusView')` 读取。 */
const VIEW_KEY = 'focusView';
/**
 * 折叠语义变更史（改了状态里存的东西就必须递增）：
 * v2 = 工具名美化（MCP）+ 产出文件过滤；v3 = 产出文件改存去重键 `key`（并改存完整路径）；
 * v4 = 工具名美化扩到 snake_case（存的是 label）+ 结果说明挡掉带标记语言的短结果；
 * v5 = 去掉「执行过程」块（纯 wire 改动，递增只为让宿主落后能被检测到）；
 * v6 = 新增 `promptMedia`（用户只发了附件、没有文字时记附件个数）；
 * v7 = **契约解析器**：卡片原料从「本地关键词猜段」改成「按契约段名切段取内容」。
 *      这一版 state 里存的东西其实没变（照旧是整条回答原文 + 事件），所以按规矩本不必递增；
 *      递增的理由和 v5 一样：让 `verify-view.mjs` 能报出「宿主还在跑旧解析器」——
 *      不递增的话它会一脸绿地说「逐字段一致」，而屏幕上老轮次的块少了一半。
 */
const VIEW_STATE_VERSION = 7;

/** 专注视图保留的轮次数（比 v1 少：每轮带的原料多得多）。 */
const VIEW_TURN_LIMIT = 30;

/** 每轮各项上限。总的原则：原始记录要够定位轮次，但不能把工具输出整段搬进投影。 */
const VIEW_PROMPT_LIMIT = 240;
const VIEW_SAID_LIMIT = 600;
const VIEW_SAID_MAX = 4;
const VIEW_TITLE_LIMIT = 30;
const TOOL_DETAIL_LIMIT = 80;
const TOOL_NOTE_LIMIT = 200;
const SHORT_NOTE_LIMIT = 120;
const TOOL_MAX = 30;
const FILE_MAX = 12;
const KPI_MAX = 4;
const KPI_KEY_LIMIT = 16;
const KPI_VALUE_LIMIT = 40;
const RISK_MAX = 3;
const RISK_ITEM_LIMIT = 120;
const RISK_MIN_ITEM = 8;

/**
 * 「成功了」这类样板话。
 * 短结果本来值得留（`No files found` 这种是真信息），但每次 `edit` 都回的
 * “The file … has been updated successfully.” 是零信息量——留着只会把原始记录铺满。
 */
const SUCCESS_BOILERPLATE = /successfully|has been (updated|created|written|saved|added)|(updated|created|wrote|saved) (file|the file)|saved successfully|已(成功)?(写入|更新|保存|创建)|操作成功|^done\.?$/i;

/**
 * 结果的说明里夹着工具自己的标记语言（实测 `write` 回的是
 * `<path>…</path> <type>file</type> <content> Updated file </content>`）——那是给模型看的信封，
 * 不是给人看的说明。带标签的短结果一律不留。
 */
const TOOL_RESULT_MARKUP = /<\/?[a-z][a-z0-9-]*>/i;

/** 把工具结果的标记语言剥掉（留下里面的文字），用于必须保留的说明（报错）。 */
function stripMarkup(text) {
  return text.replace(/<\/?[a-z][a-z0-9-]*>/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** 标题行约定：模型按契约写在回答最开头的固定格式。 */
const TITLE_LINE = /^[ \t]*(?:【本轮】|\[本轮\]|本轮[：:])\s*(.+?)\s*$/;

/**
 * 投影里保留多少轮的「原始记录」。
 * 实测本机 309 条真实回答：中位 1968 字、p99 4916 字、最长 7057 字，所以 8000 字上限能完整装下全部真实回答。
 * 但 30 轮 × 8000 字太大，所以只有最近这些轮带完整原文，更早的轮次只留提炼结果——
 * 「原始记录」本来就是拿来定位最近在干嘛的，回看很久以前的原文可以切回对话视图。
 */
/** 最近多少轮带「回答全文」（更早的轮次只留提炼结果，`fullGone` 会说明）。 */
const FULL_TURN_LIMIT = 8;
const VIEW_ANSWER_LIMIT = 8000;

/** 每条工具结果的说明最多留几份（一轮可能几十次工具调用，全留会把投影撑大）。 */
const NOTE_MAX = 6;

/**
 * 工具名 → 一句人话。这是纯本地映射，写死在这里：
 * 卡片上显示「运行命令 · Get-ChildItem …」比「pwsh」有用得多，而数据仍然是真事件里的。
 */
const TOOL_LABELS = {
  pwsh: '运行命令',
  bash: '运行命令',
  terminal_open: '开终端',
  terminal_read: '读终端',
  terminal_close: '关终端',
  terminal_list: '列终端',
  terminal_signal: '给终端发信号',
  read: '读文件',
  read_image: '看图片',
  write: '写文件',
  edit: '改文件',
  glob: '找文件',
  grep: '搜索',
  present: '交付文件',
  todo_write: '更新清单',
  ask_user_question: '问你',
  skill: '加载技能',
  web_search: '联网搜索',
  web_fetch: '打开网页',
  subagent: '派子代理',
  subagent_fork: '派子代理',
  send_message: '给子代理发消息',
  list_agents: '看子代理',
  wait_agent: '等子代理',
  interrupt_agent: '停子代理',
  workflow: '跑工作流',
  memory_get: '读记忆',
  memory_save: '存记忆',
  memory_list: '列记忆',
  cordis_inspect_list: '查契约',
  cordis_inspect_query: '查契约',
  cordis_define: '定义插件',
  cordis_run: '跑插件',
  cordis_stop: '停插件',
  cordis_undefine: '删插件',
  job_list: '看后台任务',
  job_output: '读后台任务',
  job_kill: '停后台任务',
  update_goal: '改目标',
  create_goal: '建目标',
  get_goal: '读目标',
  plugin_manager: '管插件',
  session_search: '搜会话',
  session_event_read: '读会话日志',
  session_event_search: '搜会话日志',
  schedule_create: '建定时',
  schedule_list: '列定时',
  schedule_update: '改定时',
  schedule_delete: '删定时',
  lsp: '查代码',
  ralph: 'ralph',
};

function toolLabel(name) {
  const known = TOOL_LABELS[name];
  if (known !== undefined) return known;
  // MCP 工具的真名形如 `mcp__web__browser_click`：露面时拆成「MCP 服务 · 工具」，
  // 否则卡片上是一串带双下划线的机器名（实测 129 步的那一轮里全屏都是它）。
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (mcp !== null) return `MCP ${mcp[1]} · ${mcp[2]}`;
  // 其它没进映射表的名字（例如 MCP 服务器自己注册的 `obsidian_move`）：把第一段当下缀分隔开，
  // `obsidian_move` → `obsidian · move`，比一串下划线好读，也仍然看得出原名。
  const snake = /^([a-z0-9]+)_(.+)$/.exec(name);
  if (snake !== null) return `${snake[1]} · ${snake[2].replace(/_/g, ' ')}`;
  return name;
}

/**
 * 产出文件的去重键：规范化路径的**最后两段**（含父目录名，所以 `scripts/a.mjs` 与 `results/a.mjs` 不会合并）。
 *
 * 为什么要单独一个键，而不是直接拿路径比：实测同一个文件会以两种写法先后出现
 * （相对 `scripts/mock-target.mjs` 与绝对 `D:\…\scripts\mock-target.mjs`），
 * 而卡片上显示的路径是**截断过的**（带 `…`），拿截断值去做后缀比较根本比不中——
 * 结果就是「产出文件」里同一个文件出现两三行。
 */
function pathKey(path) {
  const parts = String(path).replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.');
  return parts.slice(-2).join('/').toLowerCase();
}

/**
 * 这个路径算不算「产出文件」。
 * 实测一轮里卡片会混进 `.gitignore` 和 `.tmp/dbg.mjs` —— 那是随手改的配置和临时脚本，不是交付物。
 * 只挡明显不是交付物的：隐藏文件、`.tmp/`、`node_modules/`、`.git/`、锁文件与日志。
 * `dist/` 不挡（打包产物就放那儿）。
 */
function isDeliverable(path) {
  const normalized = String(path).replace(/\\/g, '/');
  if (/(^|\/)(node_modules|\.git|\.tmp)(\/|$)/.test(normalized)) return false;
  const name = basenameOf(normalized);
  if (name === '' || name.startsWith('.')) return false;
  if (/\.(lock|log|tmp)$/i.test(name)) return false;
  if (name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock') return false;
  return true;
}

/** 取路径最后一段（Windows 与 POSIX 分隔符都认）。 */
function basenameOf(path) {
  const parts = String(path).split(/[\\/]/);
  const last = parts.at(-1);
  return last === undefined || last === '' ? String(path) : last;
}

/** 取路径的父目录名，用来在卡片上区分同名文件。 */
function dirOf(path) {
  const parts = String(path).split(/[\\/]/);
  parts.pop();
  return parts.at(-1) ?? '';
}

/** 扩展名标签：XLS / DOC / PDF / PNG / 其它取前 4 个大写字母。 */
function extOf(path) {
  const name = basenameOf(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '文件';
  const raw = name.slice(dot + 1).toUpperCase();
  return raw === '' ? '文件' : raw.slice(0, 4);
}

/** 安全地解析工具参数（`arguments` 是一段 JSON 字符串，不是对象）。 */
function parseArgs(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 原始记录里那一行的小字：从真实参数里挑一个最有辨识度的字段。
 * 排在前面的优先：命令 > 文件路径 > 搜索词 > 其它。
 */
function toolDetail(name, args) {
  if (args === null) return '';
  const firstText = (value) => (typeof value === 'string' && value !== '' ? value : '');
  if (name === 'pwsh' || name === 'bash') {
    const command = firstText(args.command);
    if (command !== '') return clip(command.split('\n')[0], TOOL_DETAIL_LIMIT);
  }
  const path = firstText(args.file_path) || firstText(args.path);
  if (path !== '') return clip(basenameOf(path), TOOL_DETAIL_LIMIT);
  const pattern = firstText(args.pattern);
  if (pattern !== '') return clip(pattern, TOOL_DETAIL_LIMIT);
  const query = firstText(args.query);
  if (query !== '') return clip(query, TOOL_DETAIL_LIMIT);
  const url = firstText(args.url);
  if (url !== '') return clip(url.replace(/^https?:\/\//, ''), TOOL_DETAIL_LIMIT);
  const skill = firstText(args.name);
  if (skill !== '') return clip(skill, TOOL_DETAIL_LIMIT);
  if (Array.isArray(args.files)) return `${args.files.length} 个文件`;
  if (Array.isArray(args.questions)) {
    const question = args.questions[0]?.question;
    if (typeof question === 'string') return clip(question, TOOL_DETAIL_LIMIT);
  }
  return '';
}

/** 这个工具调用产出了哪些文件：write / edit / present 三种会真写盘。 */
function filesOfTool(name, args) {
  if (args === null) return [];
  if (name === 'write' || name === 'edit') {
    const path = args.file_path;
    return typeof path === 'string' && path !== '' ? [path] : [];
  }
  if (name === 'present' && Array.isArray(args.files)) {
    const out = [];
    for (const item of args.files) {
      const path = typeof item === 'string' ? item : item?.path;
      if (typeof path === 'string' && path !== '') out.push(path);
    }
    return out;
  }
  return [];
}

/**
 * 关键数据的判据（**契约换了接口，判据不变**）。
 * 值只认「数字 + 可选单位」——这条规则在 v1 是靠并排跑候选规则 + 打样例定下来的
 * （`.tmp/kpi-variants.mjs`）：只要求「表格行里出现过数字」时抽出来的是内容表格和目录
 * （`1 · 止血 → 12:00 评分链路崩了`、`十、上下文预算 → Q29-Q34`）；收紧到值时才全是真数据。
 * 少于两项就整块不显示（一个数字不值得占一个信息块）。
 */
const KPI_VALUE = /^[~～≈≥≤<>约共]?\s*[0-9][0-9,./:%+\-]*\s*(?:%|个|条|家|次|秒|分钟|分|小时|天|周|月|年|倍|万|亿|人|元|页|项|轮|步|点|字|MB|KB|GB|k|K|tokens|token)?$/;
const KPI_KEY_JUNK = /[·、,，。:：|]/;

/**
 * 从一条助手文字里剥出契约标题行。
 * 只认前三行里的固定格式，避免正文里偶然出现的「本轮：」被误当标题。
 */
function splitTitleLine(text) {
  const lines = text.split('\n');
  const depth = Math.min(lines.length, 3);
  for (let index = 0; index < depth; index++) {
    const match = TITLE_LINE.exec(lines[index]);
    if (match === null) continue;
    const title = clip(plain(match[1]), VIEW_TITLE_LIMIT);
    const rest = lines.slice(0, index).concat(lines.slice(index + 1)).join('\n');
    return { title, text: rest };
  }
  return { title: '', text };
}

/** 按长度截断但保留换行（原始记录要原样显示，不能像 clip 那样把换行压掉）。 */
function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

/** 一整个轮次的原始折叠结果（专注视图版）。 */
function emptyViewTurn(turn, startSeq, time) {
  return {
    turn,
    startSeq,
    time,
    prompt: '',
    /** 用户消息里没有文字、只有附件（实测 2 轮是图片）时的附件个数——客户端据此画个占位。 */
    promptMedia: 0,
    // answer = 这一轮最后一条助手文字（就是最终回答）；said = 之前那些进度消息。
    answer: '',
    title: '',
    said: [],
    lastStep: -1,
    tools: [],
    toolsTotal: 0,
    notes: 0,
    files: [],
    steps: 0,
    end: null,
    endSeq: null,
    failure: '',
    pending: 0,
  };
}

/** 把一条新记录推进数组，超出上限就丢掉最旧的（最新的一轮最重要）。 */
function pushCapped(list, item, limit) {
  const next = [...list, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * `turn/end` 的原因 → 卡片状态。
 * 实测的真实取值（TurnEndReasonMap）：completed / aborted / blocked / error / max-tokens / interrupted / forked。
 */
const END_STATE = {
  completed: 'done',
  aborted: 'interrupt',
  interrupted: 'interrupt',
  forked: 'interrupt',
  blocked: 'fail',
  'max-tokens': 'fail',
  error: 'fail',
};

/** 专注视图的折叠：与单元无关的事件必须返回同一个 state 引用。 */
function foldViewEvent(state, event) {
  const turns = state.turns;
  const last = turns.at(-1);
  const data = event.data ?? {};
  switch (event.type) {
    case 'turn/start': {
      if (typeof data.turn !== 'number') return state;
      // 重试会用同一个轮次号重发 turn/start，此时保持已有条目不动。
      if (last !== undefined && data.turn <= last.turn) return state;
      const trimmed = [...turns, emptyViewTurn(data.turn, event.seq, event.time)];
      return { turns: trimmed.length > VIEW_TURN_LIMIT ? trimmed.slice(trimmed.length - VIEW_TURN_LIMIT) : trimmed };
    }
    case 'user/message': {
      if (last === undefined) return state;
      if (last.prompt !== '' || last.promptMedia > 0) return state;
      if (data.source?.kind !== 'user') return state;
      const text = contentText(data.content, VIEW_PROMPT_LIMIT);
      // 没文字的纯附件消息（实测语料里有 2 轮，用户直接贴了图片）：卡片上方不能空着，
      // 记一个标记让客户端画「你发来 N 个附件，没有文字」。客户端插件拿不到附件渲染接口（没有这个 service），
      // 所以只能给标记，不能把图贴出来。
      const media = Array.isArray(data.content)
        ? data.content.filter((block) => block !== null && typeof block === 'object' && block.type !== 'text').length
        : 0;
      if (text === '' || text.startsWith('<system-reminder')) {
        if (text !== '' || media === 0) return state;
        return { turns: [...turns.slice(0, -1), { ...last, promptMedia: media }] };
      }
      return { turns: [...turns.slice(0, -1), { ...last, prompt: clip(text, VIEW_PROMPT_LIMIT) }] };
    }
    case 'assistant/message': {
      if (last === undefined) return state;
      const text = contentText(data.message?.content, VIEW_ANSWER_LIMIT);
      if (text === '') return state;
      const step = typeof data.step === 'number' ? data.step : last.steps;
      const split = splitTitleLine(text);
      let said = last.said;
      // 同一步重复推送（改写/重发）时替换而不是追加，避免出现两条一样的记录。
      if (last.answer !== '' && step !== last.lastStep) {
        said = pushCapped(said, { step: last.lastStep, text: truncate(last.answer, VIEW_SAID_LIMIT) }, VIEW_SAID_MAX);
      }
      return {
        turns: [
          ...turns.slice(0, -1),
          {
            ...last,
            said,
            answer: truncate(split.text, VIEW_ANSWER_LIMIT),
            title: split.title === '' ? last.title : split.title,
            lastStep: step,
            steps: Math.max(last.steps, step),
          },
        ],
      };
    }
    case 'tool/call': {
      if (last === undefined) return state;
      const name = typeof data.name === 'string' ? data.name : '(未知工具)';
      const args = parseArgs(data.arguments);
      const callId = typeof data.callId === 'string' ? data.callId : '';
      const tool = {
        callId,
        label: toolLabel(name),
        detail: toolDetail(name, args),
        status: 'run',
        note: '',
      };
      let files = last.files;
      for (const path of filesOfTool(name, args)) {
        if (!isDeliverable(path)) continue;
        const key = pathKey(path);
        if (key === '' || files.some((item) => item.key === key)) continue;
        // path 存**完整**路径：卡片上是 name + dir，悬停才看完整路径，所以不需要截断，
        // 截断反而会让去重键和显示都失真（这个坑刚踩过）。
        files = pushCapped(files, { key, path, name: basenameOf(path), dir: dirOf(path), ext: extOf(path) }, FILE_MAX);
      }
      return {
        turns: [
          ...turns.slice(0, -1),
          {
            ...last,
            tools: pushCapped(last.tools, tool, TOOL_MAX),
            toolsTotal: last.toolsTotal + 1,
            files,
            steps: Math.max(last.steps, typeof data.step === 'number' ? data.step : last.steps),
          },
        ],
      };
    }
    case 'tool/result': {
      if (last === undefined) return state;
      const callId = data.message?.toolCallId ?? data.message?.source?.callId;
      if (typeof callId !== 'string' || callId === '') return state;
      const index = last.tools.findIndex((tool) => tool.callId === callId);
      if (index === -1) return state;
      const isError = data.message?.isError === true;
      // 报错优先用事件里的结构化字段（name/code/reason），它比结果正文本身短而准。
      const structured = data.error ?? {};
      const structuredText = [structured.name, structured.code, structured.reason]
        .filter((part) => typeof part === 'string' && part !== '')
        .join(' / ');
      const output = clip(contentText(data.message?.content, TOOL_NOTE_LIMIT), TOOL_NOTE_LIMIT);
      // 只留“能说明问题”的结果说明：报错一定留；短结果也留，但要把“成功了”这种零信息的样板话挡掉
      // （否则每次 edit 都会在原始记录里贴一句 The file … has been updated successfully.）。
      // 长结果一律不留——一次 grep 就能把投影撑大几十倍。而且一轮最多留 NOTE_MAX 份。
      const wanted = isError
        // 报错一定留，但把信封式标记语言剥掉（留下里面的文字），别把 `<path>…</path>` 贴到卡片上。
        ? stripMarkup(structuredText === '' ? output : structuredText)
        : output.length <= SHORT_NOTE_LIMIT && !SUCCESS_BOILERPLATE.test(output) && !TOOL_RESULT_MARKUP.test(output)
          ? output
          : '';
      const note = wanted === '' || last.notes >= NOTE_MAX ? '' : truncate(wanted, TOOL_NOTE_LIMIT);
      const tools = [...last.tools];
      tools[index] = { ...tools[index], status: isError ? 'fail' : 'done', note };
      return { turns: [...turns.slice(0, -1), { ...last, tools, notes: note === '' ? last.notes : last.notes + 1 }] };
    }
    case 'approval/asked': {
      if (last === undefined) return state;
      return { turns: [...turns.slice(0, -1), { ...last, pending: last.pending + 1 }] };
    }
    case 'approval/decided': {
      if (last === undefined || last.pending === 0) return state;
      return { turns: [...turns.slice(0, -1), { ...last, pending: last.pending - 1 }] };
    }
    case 'turn/end': {
      if (last === undefined) return state;
      if (typeof data.turn === 'number' && data.turn !== last.turn) return state;
      const kind = typeof data.reason?.kind === 'string' ? data.reason.kind : 'unknown';
      // error 的失败信息在 `reason.error`（LlmFailure），不是 `reason.failure`——写错就永远抓不到失败原因。
      const failure = typeof data.reason?.error?.message === 'string' ? clip(data.reason.error.message, TOOL_NOTE_LIMIT) : '';
      if (last.end === kind && last.failure === failure) return state;
      return { turns: [...turns.slice(0, -1), { ...last, end: kind, endSeq: event.seq, failure }] };
    }
    default:
      return state;
  }
}

/**
 * 把一轮的折叠状态整理成客户端要的那张卡。
 * 这里做全部提炼，客户端只负责画——客户端越笨，样式与逻辑的回归越好做。
 *
 * @param entry - 一轮的折叠状态。
 * @param isLast - 是不是最新一轮（决定“跑着”还是“被打断”）。
 * @param withFull - 这一轮带不带回答全文（只有最近 FULL_TURN_LIMIT 轮带）。
 */
function viewTurnOf(entry, isLast, withFull) {
  const answer = entry.answer;
  // 一条回答先按契约切成「结论 + 四个契约段」，每一块只从它自己那一段里取内容。
  // 这一步是整张卡的接口：**骨架在本地**（段名 + 各块的形状与上限），**内容由模型填**。
  // 在此之前这里是四套关键词启发式（哪段像风险段、哪行像要点），在 370 条真实回答上最多命中 29%。
  const parsed = answer === '' ? null : splitAnswer(answer);
  const headline = parsed === null ? '' : conclusionOf(parsed.conclusion);
  const points = parsed === null ? [] : pointsFromSection(parsed.section('结论建议'), headline);
  const kpis = parsed === null ? [] : kpisFrom(parsed, answer);
  const risks = parsed === null ? [] : itemsFromSection(parsed.section('风险提醒'), { max: RISK_MAX, limit: RISK_ITEM_LIMIT, min: RISK_MIN_ITEM, plainBody: false });
  const asks = parsed === null ? [] : itemsFromSection(parsed.section('需要你确认'), { max: MAX_ASKS, limit: BULLET_LIMIT, min: 0, plainBody: false });

  // 状态：跑着 > 待你拍板 > 失败/中断 > 完成。没有 turn/end 但后面又开了一轮，说明这轮被打断了。
  // 「待确认」只留给**真的在等你**的情况（有一次没答复的审批）。回答里带「需要你确认」段不算——
  // 那一轮其实已经完成，只是结尾有事要你定；把它标成待确认会让人以为 agent 卡住了。
  // 实测本会话 17 轮里 15 轮都有那个段，全都标成待确认等于把状态信号冲淡了。
  // 这种情况由药丸上的「完成 · 待你定 N」和置顶的提醒块承担。
  let state = 'done';
  if (entry.end === null) state = isLast ? 'run' : 'interrupt';
  else state = END_STATE[entry.end] ?? 'fail';
  if (state === 'done' && entry.pending > 0) state = 'wait';

  const blocks = [];
  // 这张卡只放**回答本身**拆出来的东西：要你拍板的事、关键数据、产出文件、结论建议、风险提醒。
  // 执行日志（工具调用时间线）不进卡——那是官方「轨迹」视图的活，卡片里放它等于把答案淹掉。
  // 要你拍板的事排在最前面：这是唯一“看完必须动手”的块。
  if (asks.length > 0) blocks.push({ id: 'asks', items: asks.map(({ text }) => ({ text })) });
  if (kpis.length > 0) blocks.push({ id: 'kpi', items: kpis });
  if (entry.files.length > 0) blocks.push({ id: 'files', items: entry.files });
  if (points.length > 0) blocks.push({ id: 'points', items: points });
  if (risks.length > 0) blocks.push({ id: 'risks', items: risks.map(({ text }) => ({ text })) });

  return {
    turn: entry.turn,
    startSeq: entry.startSeq,
    time: typeof entry.time === 'number' ? entry.time : 0,
    state,
    stateReason: entry.end === null || entry.end === 'completed' ? '' : entry.end,
    /** 这一轮结尾留下的待办事项数（完成但有「需要你确认」段时 > 0，卡片上显示成「完成 · 待你定 N」）。 */
    decisions: asks.length,
    // 标题位只认**模型给的契约标题**，拿不到就留给客户端显示「第 N 轮」。
    // 原先拿提问兜底（从提问抽第一小句），但用户要求「把输入的内容单独摆出来、原样显示」之后，
    // 提问已经完整地摆在卡片上方了——再在标题位重复它一遍就是同屏重复（截图里亲眼见到两行一模一样的字）。
    // **也不要**拿结论行当标题：同样会让同一句话出现两次。
    title: entry.title,
    headline,
    prompt: entry.prompt,
    /** 只有附件、没有文字的提问（图片）——客户端画个占位，不然卡片上方会空着。 */
    promptMedia: entry.promptMedia,
    blocks: blocks.slice(0, 5),
    // 「展开回答全文」要的那段原文：**只给最近 FULL_TURN_LIMIT 轮**（更早的轮次只留提炼结果）。
    // 原先它是原始记录里的一行；用户把原始记录整个模块去掉之后，这里就直接送这一份。
    full: withFull ? answer : '',
    /** 这一轮有没有全文（没有时客户端明说「这轮较早，只保留提炼结果」）。 */
    fullGone: !withFull && answer !== '',
    truncated: answer.length >= VIEW_ANSWER_LIMIT,
    counts: {
      files: entry.files.length,
      tools: entry.toolsTotal,
      kpi: kpis.length,
      points: points.length,
      risks: risks.length,
      asks: asks.length,
    },
    steps: entry.steps,
    chars: answer.length,
  };
}

const viewDefinition = {
  key: VIEW_KEY,
  stateVersion: VIEW_STATE_VERSION,
  stateSchema: passthroughSchema,
  init: () => ({ turns: [] }),
  apply: foldViewEvent,
  wire: {
    viewSchema: passthroughSchema,
    view: (state) => {
      const last = state.turns.at(-1);
      return state.turns.map((entry, index) =>
        viewTurnOf(entry, entry === last, index >= state.turns.length - FULL_TURN_LIMIT),
      );
    },
  },
};

/* ==================================================================== */
/* 回答格式约定（骨架的一半，另一半是上面的解析器 SECTION_NAMES）           */
/* ==================================================================== */

/**
 * 提示词契约 = **卡片骨架的规格书**。模块的骨架预先定死（本地），模块里的内容由模型判——
 * 但不额外发一次模型请求：这一段写进模型本来就要产出的那条回答里，本地再按同一份规格解析。
 *
 * 三段结构，每一段都直接决定卡片上的一处：
 * 1. `【本轮】…` 标题行 —— 本地剥掉，当卡片标题（正文里不留残留）；
 * 2. 第一段 —— 直接给答案，本地拿它当卡片里那句结论；
 * 3. `## 段名` —— 本地按**一字不差的段名**切块，同名段进同名块。
 *
 * 代价是每次请求多这段固定文本；它是稳定前缀，通常命中 KV 缓存。
 * 措辞上有三处是刻意写死的，改任何一处都要同步改解析器：
 * - 段名清单（`SECTION_NAMES`）；
 * - 「一字不差」——`## 需要你确认（3 条）` 这种走形段头**不算**段，会留在正文里（有闸门在数）；
 * - 「没有就整段省掉」——空段不许靠写「无」来凑，否则卡片会被空块撑满。
 */
const CONTRACT_NAME = 'dsh-focus-brief:answer-format';
const CONTRACT_ORDER = 9000;
const CONTRACT_TEXT = [
  '回答格式约定（优先级高于风格偏好）：',
  '1. 第一行固定写成 `【本轮】不超过 20 字的标题`，只放标题，别在这一行写别的。',
  '2. 第一段直接给答案：不复述问题、不铺垫背景，也不用「已完成」「整理好了」这类状态句开头。本地会拿这一段当卡片上那句结论。',
  '3. 需要分类的内容写成固定小标题段，**段名必须一字不差**：`## 需要你确认`（要用户拍板的事，一条一行）、`## 风险提醒`、`## 关键数据`（一张 `| 指标 | 值 |` 表，值写数字）、`## 结论建议`。段内可以用小标题和列表。',
  '4. 没有内容的段整段省掉，不要写「无」。',
  '5. 正文只写结论与必要推理：不整段粘工具输出、命令回显、日志或文件内容，要引用只写结论与路径。',
].join('\n');

/** 投影注册表是宿主半的核心目的；缺了它这个 fiber 就保持挂起。 */
export const inject = ['sessionProjections'];

/**
 * @param {object} ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  ctx.sessionProjections.register(projectionDefinition);
  ctx.sessionProjections.register(viewDefinition);
  // 提示词服务在别的装配里可能缺席，用可选注入，避免整插件起不来。
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: CONTRACT_NAME,
      order: CONTRACT_ORDER,
      text: CONTRACT_TEXT,
    });
  });
}
