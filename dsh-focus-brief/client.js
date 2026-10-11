/**
 * 重点卡片 + 专注视图 · 客户端半
 *
 * 两个座位，互不干扰：
 *
 * 1. `conversation.chat.turnTail`（v1 便宜版）：普通对话视图里那张折叠小卡，保留当兜底。
 * 2. `conversation.view` 的 `focus`（v2 专注视图）：注册一个平行视图，切过去之后
 *    官方那套一行行的画法完全不渲染，整页由「每轮一张结果卡」组成——
 *    总卡（状态点 + 标题 + 一句结论）+ 一摞信息块（点开纵向手风琴）+ 一行可点开的原始记录。
 *
 * 结构照 `竖版堆叠.html` 的设计：卡片是实底白面 + 发丝边 + 轻投影（不是毛玻璃），
 * 配色全部落在主题 token 上（含深色主题），所以深浅两套都成立。
 *
 * React 由浏览器模块表提供，除 `react` 之外不 require 任何包；不读别的插件的 DOM。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-focus-brief',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 宿主半注册的两个投影键，两边必须一致。 */
    const BRIEF_KEY = 'focusBrief';
    const VIEW_KEY = 'focusView';
    /** 本插件的 locale 命名空间。 */
    const NS = 'focus-brief';
    /** 专注视图的 id（View 标签里显示 label）。 */
    const VIEW_ID = 'focus';
    /** CSS 标签标识，避免重复注入。 */
    const CSS_TAG_ID = '@local/dsh-focus-brief/card.css';
    /** 空数组常量：`useProjection` 的返回值按引用比较，每次新建数组会让组件反复重渲染。 */
    const EMPTY_TURNS = [];

    /**
     * 投影选择器。
     * 必须保证“同一个输入 → 同一个引用”：`useProjection` 拿选择器的返回值按引用比较，
     * 每次新建数组就等于每次都说“变了”，会变成无限重渲染。数组直接透传（宿主给的是同一个引用），
     * 非数组则落到上面那个模块级常量上。
     */
    function selectTurns(value) {
      return Array.isArray(value) ? value : EMPTY_TURNS;
    }

    const zh = {
      'view.label': '专注',
      'view.empty': '这个会话还没有内容。',
      // v1 那张小卡用的键（两版共用一套字典）
      'card.badge': '重点',
      'card.expand': '展开重点',
      'card.collapse': '收起重点',
      'card.asked': '你问的',
      'card.points': '要点',
      'card.asks': '需要你确认',
      'card.countPoints': '要点 {count}',
      'card.countAsks': '待定 {count}',
      'card.empty': '（本轮没有正文可提炼）',
      'card.meta': '{tools} 次工具调用 · 正文 {chars} 字',
      'card.turnFallback': '第 {turn} 轮',
      'state.done': '完成',
      'state.run': '进行中',
      'state.wait': '待确认',
      'state.fail': '失败',
      'state.interrupt': '中断',
      'card.decide': '待你定 {count}',
      'reason.max-tokens': '超长停住',
      'reason.blocked': '被拦下',
      'reason.error': '出错',
      'reason.aborted': '已中止',
      'reason.interrupted': '已中断',
      'reason.forked': '已分叉',
      'reason.unknown': '未知原因',
      'block.kpi': '关键数据',
      'block.files': '产出文件',
      'block.points': '结论建议',
      'block.risks': '风险提醒',
      'block.asks': '需要你确认',
      'count.kpi': '{count} 项',
      'count.files': '{count} 个',
      'count.points': '{count} 条',
      'count.risks': '{count} 条',
      'count.asks': '{count} 条',
      'card.expandBlocks': '展开 {count} 个信息块',
      'card.collapseBlocks': '收起',
      'card.more': '还有 {count} 个 ›',
      'card.raw': '原始记录 {count} 条',
      'card.rawOmitted': '这轮较早，只保留提炼结果',
      'card.rawEmpty': '这一轮没有记录',
      'card.truncated': '正文过长已截断，切回对话视图看全文。',
      'card.followUp': '继续追问',
      'card.followUpSeed': '接着第 {turn} 轮（{title}）继续：',
      'raw.you': '你问的',
      'raw.said': '助手',
      'raw.tool': '工具',
      'raw.error': '失败',
      'raw.answer': '回答',
      'step.run': '进行中',
      'step.done': '完成',
      'step.fail': '失败',
      'a11y.block': '{label}，{count}',
      'a11y.raw': '原始记录，{count} 条',
      'time.minutes': '{hour}:{minute}',
    };

    const en = {
      'view.label': 'Focus',
      'view.empty': 'Nothing in this session yet.',
      // Keys used by the v1 card (both versions share one dictionary).
      'card.badge': 'Focus',
      'card.expand': 'Expand the focus brief',
      'card.collapse': 'Collapse the focus brief',
      'card.asked': 'You asked',
      'card.points': 'Key points',
      'card.asks': 'Needs your call',
      'card.countPoints': '{count} points',
      'card.countAsks': '{count} to decide',
      'card.empty': '(No prose to distill in this turn)',
      'card.meta': '{tools} tool calls · {chars} chars',
      'card.turnFallback': 'Turn {turn}',
      'state.done': 'Done',
      'state.run': 'Running',
      'state.wait': 'Needs you',
      'state.fail': 'Failed',
      'state.interrupt': 'Interrupted',
      'card.decide': '{count} to decide',
      'reason.max-tokens': 'Out of tokens',
      'reason.blocked': 'Blocked',
      'reason.error': 'Error',
      'reason.aborted': 'Aborted',
      'reason.interrupted': 'Interrupted',
      'reason.forked': 'Forked',
      'reason.unknown': 'Unknown reason',
      'block.kpi': 'Key figures',
      'block.files': 'Files produced',
      'block.points': 'Takeaways',
      'block.risks': 'Watch out',
      'block.asks': 'Needs your call',
      'count.kpi': '{count} items',
      'count.files': '{count} files',
      'count.points': '{count} points',
      'count.risks': '{count} risks',
      'count.asks': '{count} to decide',
      'card.expandBlocks': 'Expand {count} blocks',
      'card.collapseBlocks': 'Collapse',
      'card.more': '{count} more ›',
      'card.raw': 'Raw log · {count} rows',
      'card.rawOmitted': 'Older turn: digest only',
      'card.rawEmpty': 'No rows in this turn',
      'card.truncated': 'Answer truncated — switch to the Chat view for the full text.',
      'card.followUp': 'Follow up',
      'card.followUpSeed': 'Continuing turn {turn} ({title}):',
      'raw.you': 'You',
      'raw.said': 'Assistant',
      'raw.tool': 'Tool',
      'raw.error': 'Failure',
      'raw.answer': 'Answer',
      'step.run': 'running',
      'step.done': 'done',
      'step.fail': 'failed',
      'a11y.block': '{label}, {count}',
      'a11y.raw': 'Raw log, {count} rows',
      'time.minutes': '{hour}:{minute}',
    };

    /**
     * 样式。
     *
     * 结构照 `竖版堆叠.html`：实底卡面（不是半透明）、发丝边、轻投影、叠压一摞、展开纵向手风琴。
     *
     * 三条纪律（沿用 v1 的经验）：
     * 1. 面与文字一律用主题 token，所以深色主题自动成立。实测浅色主题下 bg-layer-1 / bg-layer-2 /
     *    bg-base 全是 #ffffff，卡片与页面同色——所以卡的分隔靠发丝边 + 投影，卡内分区靠 color-mix 派生的一点灰。
     * 2. 每个 `color-mix` 都在前一行留了不含它的兜底声明；引擎不支持时退回不透明外观，不会白板。
     * 3. 状态色只用在圆点、图标、时间线上，文字一律 label-primary：
     *    实测 warn #f59e0b 当文字在浅色主题下只有 2.15:1，根本读不清。
     *
     * 图标底色是设计稿里的“作品色”（插件规范允许 artwork 用自有颜色）。
     * 设计稿里那一档「步骤」图标已经不用了——执行日志不再进卡（见 TurnCard 里的 BLOCK_ALLOW）。
     */
    const CSS = [
      /* ---------- 根与围观者 ---------- */
      /* 这条规则一个字都别随手“简化”，它同时对付外壳的**两种**配置（源码里 viewArea 有 4 条规则）：
         外壳结构：scrollBody{display:flex;flex-direction:column;overflow-y:auto} >
                   viewArea{display:flex;flex-direction:column} > 我的视图 + 输入框座。
         · 活跃期：viewArea{flex:1 0 auto;min-height:auto} —— 它随内容长高，**由 scrollBody 滚**。
         · 有 composer overlay 时：viewArea{flex:1 1 0;min-height:0;overflow:hidden} —— 它被裁切，
           **必须由视图自己滚**。所以 flex:1 1 auto / min-height:0 / overflow-y:auto 三件都不能删
           （官方 chat 视图自己的滚动条也是这个写法）。
         另外 overscroll-behavior 必须是 **auto**（放回默认）：踩过的真坑——原先写成 `contain`，
         在活跃期我的根节点没有可滚内容却仍是滚动容器，`contain` 把滚轮吞掉又不许传给 scrollBody，
         于是用户报「专注界面滚轮没法用」。auto 让滚到头时链式交给外壳。 */
      '.dfv-root{box-sizing:border-box;flex:1 1 auto;min-height:0;height:auto;overflow-y:auto;overscroll-behavior:auto;padding:18px 18px 40px}',
      '.dfv-feed{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px}',
      '.dfv-empty{padding:40px 0;text-align:center;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',

      /* ---------- 一张结果卡 ---------- */
      '.dfv-card{box-sizing:border-box;background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.06);overflow:hidden}',
      '.dfv-head{padding:14px 16px 12px}',
      '.dfv-top{display:flex;align-items:center;gap:9px}',
      '.dfv-dot{flex:none;width:8px;height:8px;border-radius:50%;background-color:var(--dsw-alias-state-idle-primary)}',
      '.dfv-dot[data-state="done"]{background-color:var(--dsw-alias-state-success-primary)}',
      /* 进行中用“业务蓝”；这个 token 没在公开清单里，取不到时回退到品牌色，不会变成透明。 */
      '.dfv-dot[data-state="run"]{background-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.dfv-dot[data-state="wait"]{background-color:var(--dsw-alias-state-warn-primary)}',
      '.dfv-dot[data-state="fail"]{background-color:var(--dsw-alias-state-error-primary)}',
      '.dfv-title{flex:1 1 auto;min-width:0;font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfv-state{flex:none;font-size:11px;font-weight:600;line-height:18px;padding:1px 8px;border-radius:999px;background-color:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);white-space:nowrap}',
      /* 各状态的兜底底色：color-mix 不可用时药丸只是没有色相，文字照样清楚。 */
      '.dfv-state[data-state="done"],.dfv-state[data-state="run"],.dfv-state[data-state="wait"],.dfv-state[data-state="fail"],.dfv-state[data-state="interrupt"]{background-color:var(--dsw-alias-bg-layer-2)}',
      '.dfv-value{margin-top:9px;font-size:15px;line-height:1.55;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dfv-value[data-empty="true"]{color:var(--dsw-alias-label-secondary);font-size:13.5px}',

      /* ---------- 信息块：收起是叠压一摞，展开是纵向手风琴 ---------- */
      '.dfv-blocks{padding:10px 14px 14px;position:relative}',
      '.dfv-blocks[data-open="false"] .dfv-block{position:relative;border-radius:12px;background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 2px 8px rgba(0,0,0,.09);margin-bottom:-6px;transition:transform .18s ease,box-shadow .18s ease}',
      '.dfv-blocks[data-open="false"] .dfv-block:last-of-type{margin-bottom:0}',
      '.dfv-blocks[data-open="false"] .dfv-block:nth-child(1){z-index:6}',
      '.dfv-blocks[data-open="false"] .dfv-block:nth-child(2){z-index:5}',
      '.dfv-blocks[data-open="false"] .dfv-block:nth-child(3){z-index:4}',
      '.dfv-blocks[data-open="false"] .dfv-block:nth-child(4){z-index:3}',
      '.dfv-blocks[data-open="false"] .dfv-block:nth-child(5){z-index:2}',
      '.dfv-blocks[data-open="false"] .dfv-block:nth-child(n+6){z-index:1}',
      '.dfv-blocks[data-open="false"] .dfv-block:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.1)}',
      '.dfv-blocks[data-open="true"] .dfv-block{background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;margin-bottom:8px}',
      '.dfv-blocks[data-open="true"] .dfv-block:last-of-type{margin-bottom:0}',
      '.dfv-ghost{height:12px;margin:-6px auto 0;border-radius:0 0 12px 12px;background-color:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-top:0}',
      '.dfv-ghost-by1{width:calc(100% - 20px)}',
      '.dfv-ghost-by2{width:calc(100% - 40px);height:10px;margin-top:-11px}',

      /* ---------- 信息块的标题行 ---------- */
      '.dfv-row{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:10px 12px;border:0;border-radius:10px;background-color:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}',
      '.dfv-row:hover{background-color:var(--dsw-alias-bg-layer-2)}',
      '.dfv-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dfv-ico{flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#fff}',
      '.dfv-ico[data-id="kpi"]{background-color:#7c5cf0}',
      '.dfv-ico[data-id="files"]{background-color:#217346}',
      '.dfv-ico[data-id="points"]{background-color:#3b82f6}',
      '.dfv-ico[data-id="risks"]{background-color:#e5544b}',
      '.dfv-ico[data-id="asks"]{background-color:#c2410c}',
      '.dfv-block-title{flex:1 1 auto;min-width:0;font-size:13.5px;font-weight:600;overflow-wrap:anywhere}',
      '.dfv-block-count{flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dfv-arrow{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);transition:transform .2s ease}',
      '.dfv-block[data-closed="false"] .dfv-arrow{transform:rotate(90deg)}',

      /* ---------- 信息块的内容 ---------- */
      '.dfv-body{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 12px 12px}',
      '.dfv-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}',
      '.dfv-kv-cell{background-color:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px 10px}',
      '.dfv-kv-k{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dfv-kv-v{font-size:15px;font-weight:700;line-height:20px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
      '.dfv-file{display:flex;align-items:center;gap:9px;background-color:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:7px 9px;margin-bottom:6px;font-size:13px}',
      '.dfv-file:last-child{margin-bottom:0}',
      '.dfv-file-ico{flex:none;width:26px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:700;color:#fff;background-color:#61666b;letter-spacing:.02em}',
      '.dfv-file-name{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dfv-file-dir{flex:none;max-width:38%;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dfv-points{margin:0;padding:0;list-style:none}',
      '.dfv-point{position:relative;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfv-point + .dfv-point{margin-top:5px}',
      '.dfv-point:before{content:"·";color:var(--dsw-alias-label-secondary);margin-right:7px}',
      '.dfv-note{display:flex;gap:8px;font-size:13px;line-height:20px;padding:9px 11px;border-radius:9px;background-color:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dfv-note[data-tone="danger"],.dfv-note[data-tone="warn"]{background-color:var(--dsw-alias-bg-layer-2)}',
      '.dfv-note + .dfv-note{margin-top:6px}',
      /* 警示记号由 CSS 生成：它是装饰，不是文字，所以允许用警示色（文字部分一律 label-primary）。
         这样也把「warn 不能当文字色」那条回归闸门守住了。 */
      '.dfv-note[data-tone]::before{content:"!";flex:none;font-weight:700;color:var(--dsw-alias-state-error-primary)}',
      '.dfv-note[data-tone="warn"]::before{content:"?";color:var(--dsw-alias-state-warn-primary)}',
      '.dfv-note-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
      '.dfv-more{display:block;width:100%;margin-top:8px;padding:7px;border:0;border-radius:8px;background-color:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '.dfv-more:hover{background-color:var(--dsw-alias-border-l1)}',
      '.dfv-pill{display:flex;align-items:center;justify-content:center;gap:5px;margin:12px auto 0;width:fit-content;padding:6px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background-color:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}',
      '.dfv-pill:hover{color:var(--dsw-alias-label-primary)}',

      /* ---------- 底部：时间 / 计数 / 继续追问 ---------- */
      '.dfv-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 16px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dfv-meta{min-width:0;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dfv-btn{flex:none;font:inherit;font-size:12px;font-weight:600;padding:6px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dfv-btn:hover{color:var(--dsw-alias-label-primary)}',
      '.dfv-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dfv-btn-primary{border-color:var(--dsw-alias-brand-primary);background-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.dfv-btn-primary:hover{color:var(--dsw-alias-bg-base)}',

      /* ---------- 原始记录 ---------- */
      '.dfv-raw{margin:0 14px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}',
      '.dfv-raw-body{max-height:440px;overflow-y:auto;overscroll-behavior:auto;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dfv-raw-item{display:flex;gap:8px;padding:5px 0;font-size:12.5px;line-height:19px}',
      '.dfv-raw-item + .dfv-raw-item{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dfv-raw-kind{flex:none;width:46px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dfv-raw-text{flex:1 1 auto;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}',
      '.dfv-raw-text[data-kind="tool"]{font-size:12px}',
      '.dfv-raw-note{display:block;margin-top:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dfv-raw-hint{padding:8px 12px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',

      /* ---------- color-mix 增强：卡内分区与状态药丸的底色 ---------- */
      '@supports (color:color-mix(in srgb,red 50%,transparent)){',
      /* 浅色主题下 bg-layer-2 与卡面同为 #ffffff，卡内分区会消失；掺 4% 文字色得到一层极淡的灰。
         深色主题下这个结果与 bg-layer-2 几乎一致，所以两边都好看。 */
      '.dfv-kv-cell,.dfv-file,.dfv-note,.dfv-more,.dfv-pill{background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}',
      '.dfv-ghost{background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
      '.dfv-row:hover{background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.dfv-more:hover{background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}',
      /* 状态药丸：从状态色派生 14~18% 的淡底，文字仍是 label-primary（对比度见回归检查）。 */
      '.dfv-state[data-state="done"]{background-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent)}',
      '.dfv-state[data-state="run"]{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)) 16%,transparent)}',
      '.dfv-state[data-state="wait"]{background-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}',
      '.dfv-state[data-state="fail"]{background-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}',
      '.dfv-state[data-state="interrupt"]{background-color:color-mix(in srgb,var(--dsw-alias-state-idle-primary) 30%,transparent)}',
      /* 提醒条：照设计稿做成“有色的浅底 + 深色文字”，颜色只是分区提示，正文一律 label-primary。 */
      '.dfv-note[data-tone="danger"]{background-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}',
      '.dfv-note[data-tone="warn"]{background-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '}',

      /* ---------- 高对比模式与减少动效 ---------- */
      '@media (forced-colors:active){.dfv-card,.dfv-blocks[data-open="false"] .dfv-block,.dfv-blocks[data-open="true"] .dfv-block{border-color:CanvasText;box-shadow:none}.dfv-ico,.dfv-file-ico{background-color:Canvas;color:CanvasText;border:1px solid CanvasText}}',
      '@media (prefers-reduced-motion:reduce){.dfv-block,.dfv-arrow{transition:none}}',
    ].join('');

    /* ==================================================================== */
    /* 通用小工具                                                            */
    /* ==================================================================== */

    /** 注册用的翻译函数兜底：props.t 拿不到时用 apply 里 bind 出来的那个。 */
    let boundTranslate = null;

    function translateOf(props) {
      if (typeof props.t === 'function') return props.t;
      if (typeof boundTranslate === 'function') return boundTranslate;
      return (key) => key;
    }

    /** 秒级时间戳 → HH:MM（本地时区）。 */
    function clockOf(time, t) {
      if (typeof time !== 'number' || time <= 0) return '';
      const date = new Date(time);
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      return t('time.minutes', { hour, minute });
    }

    /** 短标签（块 id → 中文名与计数单位）。 */
    const BLOCK_LABEL = {
      kpi: 'block.kpi',
      files: 'block.files',
      points: 'block.points',
      risks: 'block.risks',
      asks: 'block.asks',
    };
    const BLOCK_COUNT = {
      kpi: 'count.kpi',
      files: 'count.files',
      points: 'count.points',
      risks: 'count.risks',
      asks: 'count.asks',
    };
    const BLOCK_GLYPH = { kpi: '▤', files: '▦', points: '◆', risks: '!', asks: '?' };
    /** 每个块默认露出几项，其余收进「还有 N 个」。 */
    const BLOCK_PREVIEW = { kpi: 4, files: 5, points: 5, risks: 3, asks: 4 };
    /**
     * 一张卡只画**回答本身**拆出来的块，执行日志一律不画。
     *
     * 这条白名单是必需的，不是摆设：宿主（index.js）与客户端是两半，客户端刷新一下就换新，
     * 宿主却要整个 DSH 重启才换新。中间那段时间旧宿主还会继续推 `steps`（工具调用时间线）过来，
     * 白名单让它一进门就被丢掉——「不要执行日志」刷新后立刻成立，不必等重启。
     */
    const BLOCK_ALLOW = new Set(['asks', 'kpi', 'files', 'points', 'risks']);
    /** 文件扩展名 → 图标底色（设计稿里的作品色）。 */
    const EXT_COLOR = {
      XLS: '#217346',
      XLSX: '#217346',
      CSV: '#217346',
      DOC: '#2b579a',
      DOCX: '#2b579a',
      PDF: '#c0392b',
      PPT: '#c0392b',
      PPTX: '#c0392b',
      PNG: '#7a5af5',
      JPG: '#7a5af5',
      JPEG: '#7a5af5',
      WEBP: '#7a5af5',
      GIF: '#7a5af5',
      SVG: '#7a5af5',
      HTML: '#c2410c',
      HTM: '#c2410c',
      MD: '#475569',
      TXT: '#475569',
      JSON: '#475569',
      JS: '#b45309',
      TS: '#b45309',
      PY: '#b45309',
      JAVA: '#b45309',
    };

    /**
     * 把一句话填进输入框（官方输入框的公开接口：captureInsertion + insertText）。
     * 版本已变或编辑器不可编辑时插入会被拒，此时安静地什么也不做——
     * 宁可按钮没反应，也不要把用户正在打的字搞乱。
     */
    function fillDraft(inputActions, text) {
      if (inputActions === undefined || inputActions === null) return;
      try {
        const span = typeof inputActions.captureInsertion === 'function' ? inputActions.captureInsertion() : undefined;
        if (typeof inputActions.insertText === 'function') inputActions.insertText(text, span);
      } catch {
        /* 接口形状变了就当按钮不存在 */
      }
    }

    /* ==================================================================== */
    /* v1：普通对话视图里的那张折叠小卡（保留当兜底）                          */
    /* ==================================================================== */

    /**
 * 滚动决策（纯函数，只吃数字，方便人读也方便复核）。
 *
 * 三种结果：
 * - `'self'`：自己是滚动容器，且读者本来就贴着底部 → 把 scrollTop 拉到底。
 * - `'none'`：什么都不做（读者没贴底 / 不在首次挂载 / 内容底部已经可见）。
 * - `'ancestor'`：自己不是滚动容器，而内容底部在视野外 → 只调一次 `scrollIntoView`，交给浏览器去滚最近的滚动祖先。
 *
 * 为什么要有这个函数：滚轮那条 bug 的教训是「只在浏览器里跑的逻辑没人验得到」。
 * 把它写成纯函数，条件全部摆在台面上：尤其 `rectBottom <= viewportHeight` 这一条——
 * 底部已经可见时绝不调 scrollIntoView，免得打开视图时顺便把别的滚动祖先也推一下。
 */
function scrollDecision(state) {
  if (state.scrollHeight > state.clientHeight + 1) return state.nearBottom ? 'self' : 'none';
  if (state.didInitialScroll) return 'none';
  return state.rectBottom <= state.viewportHeight + 1 ? 'none' : 'ancestor';
}

/** 一个带小标题的内容块。 */
    function Block(label, node) {
      return h('div', { className: 'dfb-block', key: label }, h('div', { className: 'dfb-label' }, label), node);
    }

    /**
     * 一轮回答的重点卡片。
     * @param props - TurnTail 座位给的 `turn`/`seq`/`openFile`、标准 hook 和绑定的 `t`。
     */
    function FocusBriefTail(props) {
      const turn = props.turn;
      // 座位给的是轮次记录，轮次号在 `turn.turn`（chat 源码 renderSlot 传 node.location.turn）。
      // 再向下探一层是为了兜住另一种可能的包装形状：猜错的话整张卡片会静默不显示。
      const turnNumber = turn === null || turn === undefined ? undefined : (turn.turn?.turn ?? turn.turn);
      const brief = props.useProjection(BRIEF_KEY, (value) => {
        if (!Array.isArray(value) || typeof turnNumber !== 'number') return undefined;
        for (const item of value) {
          if (item.turn === turnNumber) return item;
        }
        return undefined;
      });
      const [open, setOpen] = React.useState(false);

      if (brief === undefined) return null;
      // 兜底成数组：字段缺失会让组件抛错，而抛错的表现是座位直接变空白，很难排查。
      const bullets = Array.isArray(brief.bullets) ? brief.bullets : [];
      const asks = Array.isArray(brief.asks) ? brief.asks : [];
      if (brief.answerChars === 0 && bullets.length === 0 && asks.length === 0) return null;

      const t = translateOf(props);
      const headline = brief.headline === '' ? t('card.empty') : brief.headline;
      // 折叠时给一眼可判的计数：这轮有没有东西要看、有没有事要你拍板。
      // 展开后这些数字就是废话（内容就在眼前），所以只在折叠态显示。
      const counts = open
        ? null
        : h(
            'span',
            { className: 'dfb-counts' },
            bullets.length === 0 ? null : h('span', { className: 'dfb-count' }, t('card.countPoints', { count: bullets.length })),
            asks.length === 0
              ? null
              : h('span', { className: 'dfb-count', 'data-alert': 'true' }, t('card.countAsks', { count: asks.length })),
          );
      const toggle = h(
        'button',
        {
          type: 'button',
          className: 'dfb-toggle',
          'aria-expanded': open,
          'aria-label': open ? t('card.collapse') : t('card.expand'),
          onClick: () => setOpen((value) => !value),
        },
        open ? '▾' : '▸',
      );

      const body = open
        ? h(
            'div',
            { className: 'dfb-body' },
            brief.prompt === '' ? null : Block(t('card.asked'), h('div', { className: 'dfb-quote' }, brief.prompt)),
            bullets.length === 0
              ? null
              : Block(
                  t('card.points'),
                  h(
                    'ul',
                    { className: 'dfb-tree' },
                    bullets.map((item, index) =>
                      h(
                        'li',
                        { key: `${index}:${item.text}`, className: 'dfb-item', style: { paddingLeft: `${(item.depth ?? 0) * 14}px` } },
                        item.text,
                      ),
                    ),
                  ),
                ),
            asks.length === 0
              ? null
              : Block(
                  t('card.asks'),
                  h(
                    'ul',
                    { className: 'dfb-asks' },
                    asks.map((item, index) => h('li', { key: `${index}:${item}`, className: 'dfb-item' }, item)),
                  ),
                ),
            h('div', { className: 'dfb-meta' }, t('card.meta', { tools: brief.toolCalls, chars: brief.answerChars })),
          )
        : null;

      return h(
        'div',
        { className: 'dfb-card', 'data-focus-brief': brief.turn },
        h('div', { className: 'dfb-head' }, h('span', { className: 'dfb-badge' }, t('card.badge')), h('span', { className: 'dfb-headline' }, headline), counts, toggle),
        body,
      );
    }

    /** v1 的样式（与 v2 一起注入，前缀不同互不影响）。 */
    const BRIEF_CSS = [
      '.dfb-card{box-sizing:border-box;margin-top:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background-color:var(--dsw-alias-bg-layer-1);background-image:none;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.10)}',
      '.dfb-head{display:flex;align-items:flex-start;gap:8px;padding:10px 12px}',
      '.dfb-badge{flex:none;font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
      '.dfb-headline{flex:1 1 auto;min-width:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfb-counts{flex:none;display:inline-flex;align-items:center;gap:6px;padding-top:1px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dfb-count[data-alert="true"]{color:var(--dsw-alias-label-primary);padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
      '.dfb-toggle{flex:none;width:26px;height:26px;margin:-2px -4px 0 0;border:0;padding:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:26px;transition:background-color .15s ease,color .15s ease}',
      '.dfb-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dfb-toggle:active{background:var(--dsw-alias-bg-layer-2)}',
      '.dfb-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dfb-body{display:flex;flex-direction:column;gap:9px;padding:0 12px 12px}',
      '.dfb-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);margin-bottom:3px}',
      '.dfb-quote{font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:9px;overflow-wrap:anywhere}',
      '.dfb-tree,.dfb-asks{margin:0;padding:0;list-style:none}',
      '.dfb-item{font-size:12px;line-height:19px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfb-item:before{content:"·";color:var(--dsw-alias-label-secondary);margin-right:6px}',
      '.dfb-asks .dfb-item{color:var(--dsw-alias-label-primary)}',
      '.dfb-asks .dfb-item:before{color:var(--dsw-alias-state-warn-primary)}',
      '.dfb-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '@supports (color:color-mix(in srgb,red 50%,transparent)){',
      '.dfb-card{background-color:color-mix(in srgb,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,var(--dsw-alias-label-primary)) 72%,transparent);background-image:linear-gradient(color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent),transparent 45%);box-shadow:0 6px 20px rgba(0,0,0,.10),inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}',
      '.dfb-badge{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      '.dfb-count[data-alert="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.dfb-toggle:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}',
      '.dfb-toggle:active{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}',
      '.dfb-quote{border-left-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}',
      '}',
      '@supports (backdrop-filter:blur(1px)){',
      '.dfb-card{-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}',
      '}',
      '@media (forced-colors:active){.dfb-card{background:Canvas;border-color:CanvasText;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}.dfb-badge,.dfb-count[data-alert="true"]{border-color:CanvasText}}',
      '@media (prefers-reduced-motion:reduce){.dfb-toggle{transition:none}}',
    ].join('');

    /* ==================================================================== */
    /* v2：专注视图                                                          */
    /* ==================================================================== */

    /** 信息块的标题行。收起态点它是展开整摞，展开态点它是折叠/展开这一块（纵向手风琴）。 */
    function BlockRow(props) {
      const { block, count, label, closed, onToggle } = props;
      return h(
        'button',
        {
          type: 'button',
          className: 'dfv-row',
          'aria-expanded': !closed,
          'aria-label': props.ariaLabel,
          onClick: onToggle,
        },
        h('span', { className: 'dfv-ico', 'data-id': block.id, 'aria-hidden': 'true' }, BLOCK_GLYPH[block.id] ?? '·'),
        h('span', { className: 'dfv-block-title' }, label),
        count === '' ? null : h('span', { className: 'dfv-block-count' }, count),
        h('span', { className: 'dfv-arrow', 'aria-hidden': 'true' }, '›'),
      );
    }

    /** 信息块的具体内容。 */
    function BlockBody(props) {
      const { block, t, showAll, onShowAll } = props;
      const items = Array.isArray(block.items) ? block.items : [];
      const preview = BLOCK_PREVIEW[block.id] ?? 6;
      const visible = showAll ? items : items.slice(0, preview);
      const hidden = items.length - visible.length;
      const more =
        hidden <= 0
          ? null
          : h('button', { type: 'button', className: 'dfv-more', onClick: onShowAll }, t('card.more', { count: hidden }));

      if (block.id === 'kpi') {
        return h(
          'div',
          { className: 'dfv-body' },
          h(
            'div',
            { className: 'dfv-kv' },
            visible.map((item, index) =>
              h('div', { className: 'dfv-kv-cell', key: `${index}:${item.k}` }, h('div', { className: 'dfv-kv-k' }, item.k), h('div', { className: 'dfv-kv-v' }, item.v)),
            ),
          ),
          more,
        );
      }

      if (block.id === 'files') {
        return h(
          'div',
          { className: 'dfv-body' },
          visible.map((item, index) =>
            h(
              'div',
              { className: 'dfv-file', key: `${index}:${item.path}`, title: item.path },
              h('span', { className: 'dfv-file-ico', style: { backgroundColor: EXT_COLOR[item.ext] ?? '#61666b' }, 'aria-hidden': 'true' }, item.ext),
              h('span', { className: 'dfv-file-name' }, item.name),
              item.dir === '' ? null : h('span', { className: 'dfv-file-dir' }, item.dir),
            ),
          ),
          more,
        );
      }

      if (block.id === 'points') {
        return h(
          'div',
          { className: 'dfv-body' },
          h(
            'ul',
            { className: 'dfv-points' },
            visible.map((item, index) =>
              h(
                'li',
                { className: 'dfv-point', key: `${index}:${item.text}`, style: { paddingLeft: `${(item.depth ?? 0) * 14}px` } },
                item.text,
              ),
            ),
          ),
          more,
        );
      }

      // risks / asks：都是“一条提醒”，只是色调不同（记号由 CSS 生成，见 .dfv-note::before）。
      const tone = block.id === 'asks' ? 'warn' : 'danger';
      return h(
        'div',
        { className: 'dfv-body' },
        visible.map((item, index) =>
          h(
            'div',
            { className: 'dfv-note', 'data-tone': tone, key: `${index}:${item.text}` },
            h('span', { className: 'dfv-note-text' }, item.text),
          ),
        ),
        more,
      );
    }

    /** 原始记录：这一轮的提问、助手各条文字、每次工具调用、失败原因、最终回答全文。 */
    function RawLog(props) {
      const { turn, t, open, onToggle } = props;
      const rows = Array.isArray(turn.raw) ? turn.raw : [];
      const kindLabel = { you: 'raw.you', said: 'raw.said', tool: 'raw.tool', fail: 'raw.error', answer: 'raw.answer' };
      const statusLabel = { run: 'step.run', done: 'step.done', fail: 'step.fail' };

      const row = (item, index) =>
        h(
          'div',
          { className: 'dfv-raw-item', key: `${index}:${item.kind}` },
          h('span', { className: 'dfv-raw-kind' }, t(kindLabel[item.kind] ?? 'raw.said')),
          h(
            'span',
            { className: 'dfv-raw-text', 'data-kind': item.kind },
            item.kind === 'tool' ? `${item.text}${item.meta === '' ? '' : ` · ${t(statusLabel[item.meta] ?? 'step.done')}`}` : item.text,
            item.note === undefined || item.note === '' ? null : h('span', { className: 'dfv-raw-note' }, item.note),
          ),
        );

      return h(
        'div',
        { className: 'dfv-raw' },
        h(
          'button',
          {
            type: 'button',
            className: 'dfv-row',
            'aria-expanded': open,
            'aria-label': t('a11y.raw', { count: turn.rawTotal }),
            onClick: onToggle,
          },
          h('span', { className: 'dfv-ico', 'data-id': 'files', 'aria-hidden': 'true' }, '⧉'),
          h('span', { className: 'dfv-block-title' }, t('card.raw', { count: turn.rawTotal })),
          h('span', { className: 'dfv-arrow', 'aria-hidden': 'true' }, '›'),
        ),
        open
          ? h(
              'div',
              { className: 'dfv-raw-body' },
              rows.length === 0
                ? h('div', { className: 'dfv-raw-hint' }, turn.rawOmitted === true ? t('card.rawOmitted') : t('card.rawEmpty'))
                : rows.map(row),
              turn.rawOmitted === true && rows.length > 0 ? h('div', { className: 'dfv-raw-hint' }, t('card.rawOmitted')) : null,
              turn.truncated === true ? h('div', { className: 'dfv-raw-hint' }, t('card.truncated')) : null,
            )
          : null,
      );
    }

    /** 一轮 = 一张结果卡。 */
    function TurnCard(props) {
      const { turn } = props;
      const t = props.t;
      const [deckOpen, setDeckOpen] = React.useState(false);
      const [closed, setClosed] = React.useState({});
      const [showAll, setShowAll] = React.useState({});
      const [rawOpen, setRawOpen] = React.useState(false);

      const blocks = (Array.isArray(turn.blocks) ? turn.blocks : []).filter((block) => BLOCK_ALLOW.has(block.id));
      // 设计稿的边界规则：非完成态不叠、直接铺开（F1）；只有一两块也不叠（F3）。
      const fanned = turn.state !== 'done' || blocks.length <= 2;
      const open = deckOpen || fanned;

      const stateLabel = t(`state.${turn.state}`);
      // 「中断 · 已中断」这种同义重复别画两遍：理由去掉前缀「已」之后和状态名一样，就只留状态名。
      // 但「中断 · 已中止」「中断 · 已分叉」是不同信息，要留。
      const rawReason = turn.stateReason === '' ? '' : t(`reason.${turn.stateReason}`);
      const reason = rawReason === '' || stateLabel.includes(rawReason.replace(/^已/, '')) ? '' : rawReason;
      const headline = turn.headline === '' ? '' : turn.headline;
      // 完成 + 结尾有待办：点还是完成色（这一轮确实结束了），药丸转成琥珀并写明有几件事要你定。
      const decide = turn.state === 'done' && (turn.decisions ?? 0) > 0 ? t('card.decide', { count: turn.decisions }) : '';
      const pillState = decide === '' ? turn.state : 'wait';
      const pillText = [stateLabel, decide, reason].filter((part) => part !== '').join(' · ');

      const head = h(
        'div',
        { className: 'dfv-head' },
        h(
          'div',
          { className: 'dfv-top' },
          h('span', { className: 'dfv-dot', 'data-state': turn.state, 'aria-hidden': 'true' }),
          // 标题位永远不会放结论行：模型给了标题就用它，否则用宿主从提问里抽的那句，再否则「第 N 轮」。
          // 用结论行兜底会让同一句话在标题和结论行各出现一次，正是这张卡要消灭的重复。
          h('span', { className: 'dfv-title' }, turn.title !== '' ? turn.title : t('card.turnFallback', { turn: turn.turn })),
          h('span', { className: 'dfv-state', 'data-state': pillState }, pillText),
        ),
        h('div', { className: 'dfv-value', 'data-empty': headline === '' ? 'true' : 'false' }, headline === '' ? t('card.empty') : headline),
      );

      const rows = blocks.map((block) => {
        const items = Array.isArray(block.items) ? block.items : [];
        const count = items.length;
        const label = t(BLOCK_LABEL[block.id] ?? 'block.points');
        const countText = t(BLOCK_COUNT[block.id] ?? 'count.points', { count });
        const isClosed = closed[block.id] === true;
        // 内容按需渲染：收起时不进 DOM。一屏 30 轮的全量正文留在 DOM 里，
        // 与“看得清、轻”的目的正好相反。
        const expanded = open && !isClosed;
        return h(
          'div',
          { className: 'dfv-block', 'data-closed': expanded ? 'false' : 'true', key: block.id },
          h(BlockRow, {
            block,
            label,
            count: countText,
            closed: !expanded,
            ariaLabel: t('a11y.block', { label, count: countText }),
            onToggle: open ? () => setClosed((prev) => ({ ...prev, [block.id]: !isClosed })) : () => setDeckOpen(true),
          }),
          expanded
            ? h(BlockBody, {
                block,
                t,
                showAll: showAll[block.id] === true,
                onShowAll: () => setShowAll((prev) => ({ ...prev, [block.id]: true })),
              })
            : null,
        );
      });

      const blocksNode =
        blocks.length === 0
          ? null
          : h(
              'div',
              { className: 'dfv-blocks', 'data-open': open ? 'true' : 'false' },
              rows,
              open || blocks.length <= 2 ? null : h('div', { className: 'dfv-ghost dfv-ghost-by1', 'aria-hidden': 'true' }),
              open || blocks.length <= 2 ? null : h('div', { className: 'dfv-ghost dfv-ghost-by2', 'aria-hidden': 'true' }),
              fanned || blocks.length <= 2
                ? null
                : h(
                    'button',
                    { type: 'button', className: 'dfv-pill', onClick: () => setDeckOpen((value) => !value) },
                    open ? t('card.collapseBlocks') : t('card.expandBlocks', { count: blocks.length }),
                  ),
            );

      const canFollowUp = props.inputActions !== undefined && props.inputActions !== null;
      const titleForSeed = turn.title !== '' ? turn.title : t('card.turnFallback', { turn: turn.turn });
      const foot = h(
        'div',
        { className: 'dfv-foot' },
        h('span', { className: 'dfv-meta' }, [clockOf(turn.time, t), t('card.meta', { tools: turn.counts?.tools ?? 0, chars: turn.chars ?? 0 })].filter((part) => part !== '').join(' · ')),
        canFollowUp
          ? h(
              'button',
              {
                type: 'button',
                className: 'dfv-btn dfv-btn-primary',
                onClick: () => fillDraft(props.inputActions, t('card.followUpSeed', { turn: turn.turn, title: titleForSeed })),
              },
              t('card.followUp'),
            )
          : null,
      );

      return h(
        'div',
        { className: 'dfv-card', 'data-turn': turn.turn, 'data-state': turn.state },
        head,
        blocksNode,
        turn.rawTotal === 0 && turn.rawOmitted !== true ? null : h(RawLog, { turn, t, open: rawOpen, onToggle: () => setRawOpen((value) => !value) }),
        foot,
      );
    }

    /**
     * 专注视图本体。
     * 数据全部来自宿主折好的 `focusView` 投影：这里不做提炼，只负责画。
     */
    function FocusView(props) {
      const t = translateOf(props);
      const value = props.useProjection(VIEW_KEY, selectTurns);
      const turns = Array.isArray(value) ? value : EMPTY_TURNS;
      const rootRef = React.useRef(null);
      const nearBottom = React.useRef(true);
      /** 自己不是滚动容器时，只在首次对齐到底部——之后绝不跟用户抢滚动位置。 */
      const didInitialScroll = React.useRef(false);

      const last = turns.length === 0 ? null : turns[turns.length - 1];
      const signature = last === null ? '0' : `${last.turn}:${last.state}:${last.rawTotal}:${last.blocks?.length ?? 0}:${last.chars}`;

      React.useEffect(() => {
        const node = rootRef.current;
        if (node === null || node === undefined) return;
        const first = !didInitialScroll.current;
        didInitialScroll.current = true;
        const decision = scrollDecision({
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          rectBottom: node.getBoundingClientRect().bottom,
          viewportHeight: typeof window === 'undefined' ? 0 : window.innerHeight,
          nearBottom: nearBottom.current,
          didInitialScroll: !first,
        });
        if (decision === 'self') {
          node.scrollTop = node.scrollHeight;
          return;
        }
        // 自己滚不动（高度被内容撑开、滚动交给外壳）：只在首次、且底部确实在视野外时，
        // 用标准 API 让浏览器滚最近的滚动祖先；只对自己的元素调用，不读写别人的 DOM。
        if (decision === 'ancestor' && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'end', inline: 'nearest' });
        }
      }, [signature]);

      const onScroll = (event) => {
        const node = event.currentTarget;
        nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      };

      if (turns.length === 0) {
        return h('div', { className: 'dfv-root', ref: rootRef, onScroll }, h('div', { className: 'dfv-empty' }, t('view.empty')));
      }

      return h(
        'div',
        { className: 'dfv-root', ref: rootRef, onScroll },
        h(
          'div',
          { className: 'dfv-feed' },
          turns.map((turn) => h(TurnCard, { key: turn.turn, turn, t, inputActions: props.inputActions })),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        boundTranslate = ctx.locale.bind(NS);
        ctx.effect(
          () => {
            if (typeof document === 'undefined') return () => {};
            if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) !== null) return () => {};
            const tag = document.createElement('style');
            tag.dataset.plugin = '@local/dsh-focus-brief';
            tag.dataset.pluginCss = CSS_TAG_ID;
            tag.textContent = `${CSS}${BRIEF_CSS}`;
            document.head.appendChild(tag);
            return () => tag.remove();
          },
          'dsh-focus-brief: styles',
        );
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-focus-brief: dictionaries');

        // v2：平行视图。标签名走函数，跟随语言切换（View 标签栏在可用视图 ≥2 个时出现）。
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: VIEW_ID,
              order: 20,
              locale: NS,
              label: () => boundTranslate('view.label'),
            },
            FocusView,
          ),
        );

        // v1：普通对话视图里的折叠小卡，保留当兜底。
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: '@local/dsh-focus-brief',
              order: -10,
              locale: NS,
            },
            FocusBriefTail,
          ),
        );
      },
    };
  },
});