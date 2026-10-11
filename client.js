/**
 * 重点卡片 + 专注视图 · 客户端半
 *
 * 两个座位，互不干扰：
 *
 * 1. `conversation.chat.turnTail`（v1 便宜版）：普通对话视图里那张折叠小卡，保留当兜底。
 * 2. `conversation.view` 的 `focus`（v2 专注视图）：注册一个平行视图，切过去之后
 *    官方那套一行行的画法完全不渲染，整页由「每一轮」组成——
 *    上方一条**你自己输入的原话**（官方那条蓝底黑字气泡，原样），下面一张结果卡
 *    （状态点 + 标题 + 白底回答区，点开换全文 + 一摞信息块：展开整摞只铺开标题行，
 *    每块的内容要再点那一块才出来）。
 *    卡片上**没有执行日志、也没有原始记录模块**：日志在官方「轨迹」视图里。
 *
 * 结构照 `竖版堆叠.html` 的设计：卡片是实底白面 + 发丝边 + 轻投影（不是毛玻璃），
 * 配色全部落在主题 token 上（含深色主题），所以深浅两套都成立。
 *
 * React 由浏览器模块表提供，除 `react` 之外不 require 任何包；不读别的插件的 DOM。
 */

window.__ModuleLoader__.load({
  id: 'dsh-focus-brief',
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
    const CSS_TAG_ID = 'dsh-focus-brief/card.css';
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
      'card.headlineLines': '这一句较长（约 {count} 行）——让助手把第一段收到 60 字内更清爽',
      'card.fullOpen': '展开回答全文 {count} 字',
      'card.fullClose': '收起全文',
      'card.askMedia': '（你发来 {count} 个附件，没有文字）',
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
      'card.less': '只看前 {count}',
      'card.collapseBlock': '收起这块',
      'a11y.collapseBlock': '收起「{label}」这一块',
      'card.fullGone': '这轮较早，只保留提炼结果',
      'card.truncated': '正文过长已截断，切回对话视图看全文。',
      'card.followUp': '继续追问',
      'card.followUpSeed': '接着第 {turn} 轮（{title}）继续：',
      'a11y.block': '{label}，{count}',
      'a11y.full': '回答全文，共 {count} 字',
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
      'card.headlineLines': 'This line is long (~{count} lines) — ask for a first paragraph under 60 chars',
      'card.fullOpen': 'Show the full answer ({count} chars)',
      'card.fullClose': 'Collapse the answer',
      'card.askMedia': '({count} attachment(s), no text)',
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
      'card.less': 'First {count}',
      'card.collapseBlock': 'Collapse block',
      'a11y.collapseBlock': 'Collapse the “{label}” block',
      'card.fullGone': 'Older turn: digest only',
      'card.truncated': 'Answer truncated — switch to the Chat view for the full text.',
      'card.followUp': 'Follow up',
      'card.followUpSeed': 'Continuing turn {turn} ({title}):',
      'a11y.block': '{label}, {count}',
      'a11y.full': 'Full answer, {count} characters',
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
      '.dfv-feed{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:26px}',
      /* 一轮 = 你的提问（原样，官方那条蓝底气泡）+ 回答卡片。 */
      '.dfv-turn{display:flex;flex-direction:column;gap:10px}',
      '.dfv-ask{display:flex;flex-direction:column;align-items:flex-end;max-width:82%;align-self:flex-end}',
      /* 你输入的内容**原样**显示：白底换成官方气泡的蓝底、字是 label-primary（浅色下即黑字），
         `white-space:pre-wrap` 保住你自己敲的换行与空格，不做任何改写、不剥 markdown 标记。 */
      '.dfv-ask-text{max-width:100%;background-color:var(--dsw-specific-bubble,#edf3fe);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-xl,20px);padding:9px 13px;font-size:14px;line-height:21px;white-space:pre-wrap;overflow-wrap:anywhere}',
      /* 只有附件、没有文字的那一轮：占位是标记，不是用户原话，所以压淡一档。 */
      '.dfv-ask-text[data-media="true"]{color:var(--dsw-alias-label-secondary)}',
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
      /* 结论那一行：**不设任何长度上限**（用户要求「这个部分不设字符上限」）。
         原先这里是 display:-webkit-box + -webkit-line-clamp:2 —— 只显示两行、超出直接裁掉，
         实测就是这么把一轮的结论从「…已提交推送：7d535c3。」后面裁断的（卡片明明有地方，
         却先切一刀，读的人只会以为助手没写完）。现在整段照排，换行交给容器宽度。 */
      '.dfv-value{margin:0;font-size:15px;line-height:1.55;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfv-value[data-empty="true"]{color:var(--dsw-alias-label-secondary);font-size:13.5px}',
      /* ---------- 回答：就在卡片里 ---------- */
      /* 回答**不再**用蓝底：官方那边蓝底是「你的消息」，这一版按用户要求把提问单独摆出来、
         保持官方的蓝底黑字，回答则留在卡片里、白底（要改回蓝底就一行 CSS）。 */
      '.dfv-answer{margin:0 16px 12px}',
      '.dfv-full{font-size:13.5px;line-height:21px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      /* 回答正文里的 markdown 元素（自己渲染的那一层，见 markdownNodes）。 */
      '.dfv-full > :first-child{margin-top:0}',
      '.dfv-md-p{margin:8px 0 0}',
      '.dfv-md-h{margin:12px 0 0;font-weight:700;line-height:20px}',
      '.dfv-md-h[data-level="1"]{font-size:15px}',
      '.dfv-md-h[data-level="2"]{font-size:14px}',
      '.dfv-md-h[data-level="3"],.dfv-md-h[data-level="4"],.dfv-md-h[data-level="5"],.dfv-md-h[data-level="6"]{font-size:13.5px}',
      '.dfv-md-list{margin:8px 0 0;padding-left:20px}',
      '.dfv-md-item{margin-top:3px}',
      '.dfv-md-quote{margin:8px 0 0;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.dfv-md-rule{margin:12px 0 0;border:0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dfv-pre{margin:8px 0 0;padding:8px 10px;border-radius:8px;background-color:rgba(0,0,0,.05);background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dfv-inline-code{padding:1px 4px;border-radius:4px;background-color:rgba(0,0,0,.05);background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px}',
      /* 链接不做成可点击的（拿不到系统打开接口），只加下划线提示这是链接，地址在 title 里。 */
      '.dfv-link{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}',
      '.dfv-table{width:100%;margin:8px 0 0;border-collapse:collapse;font-size:12.5px;line-height:18px}',
      '.dfv-table th,.dfv-table td{padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:top}',
      '.dfv-table th{background-color:rgba(0,0,0,.03);background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);font-weight:600}',
      '.dfv-full-toggle{margin-top:8px;border:0;padding:0;background-color:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:18px;cursor:pointer}',
      /* 「这轮较早，只保留提炼结果」/「正文过长已截断」这类说明（原先挂在原始记录面板里）。 */
      '.dfv-full-hint{margin-top:8px;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dfv-full-toggle:hover{color:var(--dsw-alias-label-primary)}',
      '.dfv-full-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',

      /* ---------- 信息块：收起是叠压一摞，展开后纵向排开一列标题行（内容再点才出） ---------- */
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
      /* 块底部那一行（只在「项数多到要折叠」时才渲染，所以短块的底边仍是干净的）：
         左边管**项数**（还有 N 个 › ⇄ 只看前 M 个），右边管**这一块**（收起这块）。
         为什么右边还要一个：块内容变长之后标题行已经滚出视野，收起不该要求你再滚回去找它。 */
      '.dfv-block-foot{display:flex;align-items:stretch;gap:6px;margin-top:8px}',
      '.dfv-more{flex:1 1 auto;min-width:0;padding:7px 8px;border:0;border-radius:8px;background-color:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '.dfv-more:hover{background-color:var(--dsw-alias-border-l1)}',
      '.dfv-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dfv-collapse{flex:none;padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background-color:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '.dfv-collapse:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.dfv-collapse:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
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
      '@media (forced-colors:active){.dfv-card,.dfv-blocks[data-open="false"] .dfv-block,.dfv-blocks[data-open="true"] .dfv-block{border-color:CanvasText;box-shadow:none}.dfv-ico,.dfv-file-ico{background-color:Canvas;color:CanvasText;border:1px solid CanvasText}.dfv-ask-text,.dfv-collapse{border:1px solid CanvasText}}',
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
    /* 回答正文的极简 markdown 渲染                                          */
    /* ==================================================================== */

    /**
     * 为什么自己写这一层：官方那套 markdown 渲染器住在 `@deepseek-ai/*` 包里，
     * 而客户端插件**禁止 require 任何 `@deepseek-ai/*`**（见 README 的接口限制）；
     * 直接把原文铺进气泡里，看到的就是 `## 一、…`、`| 旧名 | 标准名 |`、`|---|---|`、
     * ``` 围栏、`**加粗**` 这些**写作格式**——等于把模型写给人看的东西又还原成源码。
     *
     * 覆盖范围按真实语料定（177 轮里实际出现过的东西）：小标题、无序/有序列表、
     * 表格、围栏代码块、行内加粗与行内代码、链接、引用、分隔线、普通段落。
     * **不做的**：嵌套列表的层级（只按行内的缩进加一点左边距）、HTML 直通、脚注、任务列表的勾选框。
     * 链接不做成可点击的：客户端插件拿不到系统打开接口，画一个能点却没反应的链接比不给更糟。
     */
    const INLINE_MARK = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]*\))/g;

    /** 行内：加粗 / 行内代码 / 链接（链接只显示文字，地址放进 title）。 */
    function inlineNodes(text, keyBase) {
      const out = [];
      let last = 0;
      for (const match of String(text).matchAll(INLINE_MARK)) {
        if (match.index > last) out.push(String(text).slice(last, match.index));
        const token = match[0];
        if (token.startsWith('**')) out.push(h('strong', { key: `${keyBase}-${out.length}` }, token.slice(2, -2)));
        else if (token.startsWith('`')) out.push(h('code', { className: 'dfv-inline-code', key: `${keyBase}-${out.length}` }, token.slice(1, -1)));
        else {
          const label = /^\[([^\]]+)\]/.exec(token)[1];
          out.push(h('span', { className: 'dfv-link', title: token, key: `${keyBase}-${out.length}` }, label));
        }
        last = match.index + token.length;
      }
      if (last < String(text).length) out.push(String(text).slice(last));
      return out;
    }

    /** 表格行 → 单元格数组（去掉首尾的空竖线与分隔用的竖线）。 */
    function cellsOf(line) {
      const parts = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      return parts.length === 0 ? [''] : parts;
    }

    const isFence = (line) => /^```/.test(line.trim());
    const isRule = (line) => /^([-*_])\s*(?:\1\s*){2,}$/.test(line.trim());
    const isBullet = (line) => /^(?:[-*+]|\d+[.)])\s+\S/.test(line.trim());
    const isHeading = (line) => /^#{1,6}\s+\S/.test(line.trim());

    /** 正文 → 元素数组。只认上面那几种结构，其余按段落。 */
    function markdownNodes(text) {
      const lines = String(text).split('\n');
      const nodes = [];
      const push = (node) => {
        nodes.push(node);
        return nodes.length;
      };
      let index = 0;
      while (index < lines.length) {
        const trimmed = lines[index].trim();
        if (trimmed === '') {
          index++;
          continue;
        }
        const key = String(nodes.length);

        // 围栏代码块：``` 之间的内容原样进 <pre>（保留缩进与换行）。
        if (isFence(lines[index])) {
          const body = [];
          index++;
          while (index < lines.length && !isFence(lines[index])) {
            body.push(lines[index]);
            index++;
          }
          index++;
          push(h('pre', { className: 'dfv-pre', key }, body.join('\n')));
          continue;
        }

        // 表格：本行以 | 开头、下一行是 |---|---| 才算（否则只是一行普通文字）。
        if (trimmed.startsWith('|') && index + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[index + 1].trim())) {
          const head = cellsOf(trimmed);
          index += 2;
          const rows = [];
          while (index < lines.length && lines[index].trim().startsWith('|')) {
            rows.push(cellsOf(lines[index].trim()));
            index++;
          }
          push(
            h(
              'table',
              { className: 'dfv-table', key },
              h('thead', null, h('tr', null, head.map((cell, cellIndex) => h('th', { key: String(cellIndex) }, inlineNodes(cell, `${key}-h-${cellIndex}`))))),
              h(
                'tbody',
                null,
                rows.map((row, rowIndex) =>
                  h('tr', { key: String(rowIndex) }, row.map((cell, cellIndex) => h('td', { key: String(cellIndex) }, inlineNodes(cell, `${key}-${rowIndex}-${cellIndex}`)))),
                ),
              ),
            ),
          );
          continue;
        }

        const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
        if (heading !== null) {
          push(h('div', { className: 'dfv-md-h', 'data-level': heading[1].length, key }, inlineNodes(heading[2], `${key}-h`)));
          index++;
          continue;
        }

        if (isRule(trimmed)) {
          push(h('hr', { className: 'dfv-md-rule', key }));
          index++;
          continue;
        }

        if (isBullet(lines[index])) {
          const ordered = /^\d+[.)]\s+/.test(trimmed);
          const items = [];
          while (index < lines.length && isBullet(lines[index])) {
            // 续行（缩进更深的非空行）挂回上一条，别丢内容。
            let item = lines[index].trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '');
            index++;
            while (index < lines.length && lines[index].trim() !== '' && !isBullet(lines[index]) && !isHeading(lines[index]) && !isFence(lines[index]) && /^\s{2,}\S/.test(lines[index])) {
              item += ` ${lines[index].trim()}`;
              index++;
            }
            items.push(item);
          }
          push(
            h(
              ordered ? 'ol' : 'ul',
              { className: 'dfv-md-list', key },
              items.map((item, itemIndex) => h('li', { className: 'dfv-md-item', key: String(itemIndex) }, inlineNodes(item, `${key}-${itemIndex}`))),
            ),
          );
          continue;
        }

        if (trimmed.startsWith('>')) {
          const quoted = [];
          while (index < lines.length && lines[index].trim().startsWith('>')) {
            quoted.push(lines[index].trim().replace(/^>\s?/, ''));
            index++;
          }
          push(h('div', { className: 'dfv-md-quote', key }, inlineNodes(quoted.join(' '), `${key}-q`)));
          continue;
        }

        // 段落：连着吃到下一个空行或下一个结构开头。
        const paragraph = [trimmed];
        index++;
        while (index < lines.length) {
          const next = lines[index].trim();
          if (next === '' || isFence(lines[index]) || isHeading(lines[index]) || isBullet(lines[index]) || isRule(next) || next.startsWith('>') || (next.startsWith('|') && index + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[index + 1].trim()))) break;
          paragraph.push(next);
          index++;
        }
        push(h('p', { className: 'dfv-md-p', key }, inlineNodes(paragraph.join(' '), `${key}-p`)));
      }
      return nodes;
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

/**
 * 那句结论大约占几行。
 *
 * 为什么要估：用户的要求是「尽量保证在两行」，同时又要求这一段**不设字符上限**
 * （裁会无声吃掉内容）。两条一起满足的唯一办法是让模型把第一段写短，于是契约里写了「60 字内」，
 * 而这里给出**上屏后的即时反馈**——比两行长了就明说一句「这一句较长（约 N 行）」，
 * 而不是把它裁掉。反馈既是给「下一次让助手收短」的信号，也让「为什么这块看着变长了」有个解释。
 *
 * 估法：卡片里那句结论是 15px、`overflow-wrap:anywhere`，一行的容宽约 44 个全角字
 * （720px 上限的卡片、两边 16px 内边距、15px 字号）；半角字符按半个字宽算。
 * 这是**估算**：字号、字体、卡片宽度任何一项变了都会漂，所以文案写「约」，
 * 而且只用它决定「要不要提一句」，不做任何裁切。
 */
function estimateLines(text) {
  const half = (text.match(/[\x20-\x7f]/g) ?? []).length;
  const width = text.length - half + half / 2;
  return Math.max(1, Math.ceil(width / 44));
}

/** 超过两行才提示（两行是目标，不是上限）。 */
const HEADLINE_LINE_TARGET = 2;

/**
 * 把「哪几块被点开了 / 哪几块铺开了全部项」这类**白名单**翻一位（纯函数）。
 *
 * 为什么抽出来：SSR 回归只能按固定值渲染，**点下去之后状态怎么变**是它的盲区；
 * 而信息块现在有两个开关（块本身、块内项数），翻位逻辑正是它们双双「能开也能收」的地方。
 * 抽成纯函数就能像 `scrollDecision` 那样被真的跑一遍（见 `ssr-view.mjs` 里的真源码查表）。
 * 顶格写是为了被 `\n}` 的正则整段抠出来——和上面两个纯函数同一套做法。
 */
function toggleFlag(map, key) {
  return { ...map, [key]: !(map[key] === true) };
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
      // 展开按钮：**只有一个小箭头**（无文字）。试过写「展开重点」四个字，在 760px 的取证页上直接被挤出卡片——
// 普通对话视图里这张卡本来就窄，右侧多一个字就够把结论挤成两行。
      const toggle = h('button', {
        type: 'button',
        className: 'dfb-toggle',
        'aria-expanded': open,
        'aria-label': open ? t('card.collapse') : t('card.expand'),
        onClick: () => setOpen((value) => !value),
      });

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
        // 标题行：小圆点（装饰）+ 一句结论 + 折叠态计数 + 展开按钮。**都不带框**——
        // 原先那个「重点」胶囊和带边框的「待定 N」是这张卡最花的两处，重做时整条删掉。
        h('div', { className: 'dfb-head' }, h('span', { className: 'dfb-mark', 'aria-hidden': 'true' }), h('span', { className: 'dfb-headline' }, headline), counts, toggle),
        body,
      );
    }

    /**
     * v1 的样式（与 v2 一起注入，前缀不同互不影响）。
     *
     * 这一版是**重做的「简约大气」**：用户看过一眼就要求改。原先那版是毛玻璃
     * （`backdrop-filter:blur(20px)` + 半透明底 + 顶部渐层 + 内高光 + 「重点」胶囊 + 「待定 N」带框胶囊），
     * 信息在四五个小圆角框里打架。现在照 v2 那张卡的语汇重排：
     * - **一个实底面 + 一条发丝边 + 一层极轻投影**（v2 的写法），去掉 blur / 渐层 / 内高光；
     * - 标题行只做三件事：一个小圆点（品牌色，纯装饰）+ 一句结论 + 一个展开按钮，**都不带框**；
     * - 「待定 N」只在真有事要拍板时出现，且是**无色相的软底**——warn 色只用来点圆点，
     *   不用来写字（实测 `#f59e0b` 当文字在浅色主题下只有 2.15:1）。
     */
    const BRIEF_CSS = [
      /* ---------- 卡面 ---------- */
      '.dfb-card{box-sizing:border-box;margin-top:10px;background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.06);overflow:hidden}',
      /* ---------- 标题行：一句结论 + 计数 + 展开 ---------- */
      '.dfb-head{display:flex;align-items:flex-start;gap:9px;padding:12px 14px}',
      /* 小圆点：纯装饰（8px 实心圆，和 v2 状态点同尺寸），让「重点」两个字闭嘴也能认出这是重点卡。 */
      '.dfb-mark{flex:none;width:8px;height:8px;margin-top:5px;border-radius:50%;background-color:var(--dsw-alias-brand-primary)}',
      '.dfb-headline{flex:1 1 auto;min-width:0;font-size:13.5px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfb-counts{flex:none;display:inline-flex;align-items:center;gap:6px;margin-top:1px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      /* 要你拍板那一个：软底、无边框、字仍是主文字色（warn 只用来给圆点上色）。
         先给一条**不含 color-mix** 的兜底（引擎不支持时只是没有底色，字照样清楚），再给带色相的那条。 */
      '.dfb-count[data-alert="true"]{color:var(--dsw-alias-label-primary);padding:0 7px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}',
      '.dfb-count[data-alert="true"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}',
      '.dfb-toggle{flex:none;position:relative;width:24px;height:24px;margin:-2px -5px 0 0;border:0;padding:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .15s ease,color .15s ease}',
      '.dfb-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dfb-toggle:active{background:var(--dsw-alias-bg-layer-2)}',
      '.dfb-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      /* 箭头用 CSS 生成（`˅` 是文字字形，跟随 currentColor，不引图标依赖），展开时翻过来。 */
      '.dfb-toggle:before{content:"˅";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;transform:translateY(-1px);transition:transform .15s ease}',
      '.dfb-toggle[aria-expanded="true"]:before{transform:translateY(1px) rotate(180deg)}',
      /* ---------- 展开体：一条分隔线把它和标题分开 ---------- */
      '.dfb-body{display:flex;flex-direction:column;gap:10px;padding:12px 14px 13px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dfb-label{font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-secondary);margin-bottom:4px}',
      '.dfb-quote{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:9px;overflow-wrap:anywhere}',
      '.dfb-tree,.dfb-asks{margin:0;padding:0;list-style:none}',
      '.dfb-item{font-size:12px;line-height:19px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dfb-item:before{content:"·";color:var(--dsw-alias-label-secondary);margin-right:6px}',
      /* 要拍板的那几条：圆点用 warn 色，字仍是主文字色（同前：warn 不当文字色）。 */
      '.dfb-asks .dfb-item:before{color:var(--dsw-alias-state-warn-primary)}',
      '.dfb-meta{margin-top:1px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '@supports (color:color-mix(in srgb,red 50%,transparent)){',
      '.dfb-toggle:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}',
      '.dfb-toggle:active{background:color-mix(in srgb,var(--dsw-alias-label-primary) 11%,transparent)}',
      '.dfb-quote{border-left-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent)}',
      '}',
      /* 系统强制色：把装饰收干净，只留边框与文字。 */
      '@media (forced-colors:active){.dfb-card{background:Canvas;border-color:CanvasText;box-shadow:none}.dfb-mark{background:CanvasText}}',
      '@media (prefers-reduced-motion:reduce){.dfb-toggle,.dfb-toggle:before{transition:none}}',
    ].join('');

    /* ==================================================================== */
    /* v2：专注视图                                                          */
    /* ==================================================================== */

    /** 信息块的标题行。收起态点它是展开整摞；展开态点它是把**这一块的内容**放出来／收回去。 */
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
      const { block, t, label, showAll, onToggleAll, onCollapse } = props;
      const items = Array.isArray(block.items) ? block.items : [];
      const preview = BLOCK_PREVIEW[block.id] ?? 6;
      const visible = showAll ? items : items.slice(0, preview);
      const hidden = items.length - visible.length;
      // 底部这一行只在「项数多到要折叠」时才出现——也就是用户说的「像这种比较多的」。
      // 两件事分开做，因为它们是两件事：
      //   ① 左边那个按钮管**项数**：「还有 N 个 ›」原来是单向门，点开就再也回不到预览条数，
      //      现在它同时是「只看前 M 个」；
      //   ② 右边那个按钮管**这一块**：块内容变长之后标题行已经滚出视野，
      //      收起不该要求你再滚回上面去找它（用户原话：「展开后也要有收起按钮」）。
      const foot =
        items.length <= preview
          ? null
          : h(
              'div',
              { className: 'dfv-block-foot' },
              h(
                'button',
                { type: 'button', className: 'dfv-more', 'aria-expanded': showAll === true, onClick: onToggleAll },
                showAll
                  ? t('card.less', { count: t(BLOCK_COUNT[block.id] ?? 'count.points', { count: preview }) })
                  : t('card.more', { count: hidden }),
              ),
              h(
                'button',
                { type: 'button', className: 'dfv-collapse', 'aria-label': t('a11y.collapseBlock', { label }), onClick: onCollapse },
                t('card.collapseBlock'),
              ),
            );

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
          foot,
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
          foot,
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
          foot,
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
        foot,
      );
    }

    /** 一轮 = 一张结果卡。 */
    function TurnCard(props) {
      const { turn } = props;
      const t = props.t;
      const [deckOpen, setDeckOpen] = React.useState(false);
      // 每块**默认收起**，`opened` 记的是「哪几块被点开了」。展开整摞只把 N 个标题行铺开，
      // 具体内容要再点那一块才进 DOM（用户 2026-10 的要求：「展开后默认里面的每个模块的详细信息
      // 还是收起的，需要用户再次点击对应的模块才会展开」）。这条规则对 1~2 块（不叠）的轮次同样生效——
      // 不留分支，只有一条规则。（前身是 `closed` 黑名单，语义正好相反：以前展开整摞 = 全部铺开。）
      const [opened, setOpened] = React.useState({});
      const [showAll, setShowAll] = React.useState({});
      // 回答全文是否展开。**这个 hook 必须排在最后**：SSR 回归用「按下标返回固定值」的垫片驱动交互状态，
      // 加在末尾，前三个下标才对得上。
      const [fullOpen, setFullOpen] = React.useState(false);

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
      );

      // 「回答」就在卡里：默认是那句话结论，点开换成全文（白底，不用气泡——蓝底留给你的提问）。
      // 全文由宿主直接送（`turn.full`），**只给最近 8 轮**；更早的轮次只留提炼结果，这里明说一句。
      const full = typeof turn.full === 'string' ? turn.full : '';
      const showFull = fullOpen && full !== '';
      // 展开时只画全文：全文本来就从那句结论开始，两行都画就是同屏重复。
      const answer = h(
        'div',
        { className: 'dfv-answer', 'data-open': showFull ? 'true' : 'false' },
        showFull
          ? h('div', { className: 'dfv-full' }, markdownNodes(full))
          : h('div', { className: 'dfv-value', 'data-empty': headline === '' ? 'true' : 'false' }, headline === '' ? t('card.empty') : headline),
        // 目标两行、但**不裁**：比两行长了就明说一句（见 estimateLines 的注释）。
        !showFull && headline !== '' && estimateLines(headline) > HEADLINE_LINE_TARGET
          ? h('div', { className: 'dfv-full-hint' }, t('card.headlineLines', { count: estimateLines(headline) }))
          : null,
        full === ''
          ? turn.fullGone === true
            ? h('div', { className: 'dfv-full-hint' }, t('card.fullGone'))
            : null
          : h(
              'button',
              {
                type: 'button',
                className: 'dfv-full-toggle',
                'aria-expanded': showFull,
                'aria-label': t('a11y.full', { count: full.length }),
                onClick: () => setFullOpen((value) => !value),
              },
              showFull ? t('card.fullClose') : t('card.fullOpen', { count: full.length }),
            ),
        // 正文被截断（超过 8000 字上限）时说明一句——原先这句话挂在原始记录面板里。
        showFull && turn.truncated === true ? h('div', { className: 'dfv-full-hint' }, t('card.truncated')) : null,
      );

      const rows = blocks.map((block) => {
        const items = Array.isArray(block.items) ? block.items : [];
        const count = items.length;
        const label = t(BLOCK_LABEL[block.id] ?? 'block.points');
        const countText = t(BLOCK_COUNT[block.id] ?? 'count.points', { count });
        const isOpen = opened[block.id] === true;
        // 内容按需渲染：收起时不进 DOM。一屏 30 轮的全量正文留在 DOM 里，
        // 与“看得清、轻”的目的正好相反。
        // `open &&` 这一半不是多余的：整摞收起来时任何块的内容都不画，重新点开整摞时也回到全收起。
        const expanded = open && isOpen;
        return h(
          'div',
          { className: 'dfv-block', 'data-closed': expanded ? 'false' : 'true', key: block.id },
          h(BlockRow, {
            block,
            label,
            count: countText,
            closed: !expanded,
            ariaLabel: t('a11y.block', { label, count: countText }),
            onToggle: open ? () => setOpened((prev) => toggleFlag(prev, block.id)) : () => setDeckOpen(true),
          }),
          expanded
            ? h(BlockBody, {
                block,
                t,
                label,
                showAll: showAll[block.id] === true,
                // 左边那个按钮是**双向**的：项数多时「还有 N 个 ›」，全铺开后变成「只看前 M 个」。
                onToggleAll: () => setShowAll((prev) => toggleFlag(prev, block.id)),
                // 右边那个按钮：把**这一块**收回去（等价于点标题行，但不用滚回去找它）。
                // 这里写死 `false` 而不是翻位——它的语义是「收起」，不该依赖当前是什么状态。
                onCollapse: () => setOpened((prev) => ({ ...prev, [block.id]: false })),
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
                    {
                      type: 'button',
                      className: 'dfv-pill',
                      // 收起整摞时把「点开过哪几块、哪几块铺开了全部项」也清掉：下次展开又是 N 个收起的标题行，
                      // 而不是把上次看过的内容原样倒回来（点开一块是「这次要看」，不是永久设置）。
                      onClick: () => {
                        if (deckOpen) {
                          setOpened({});
                          setShowAll({});
                        }
                        setDeckOpen((value) => !value);
                      },
                    },
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
        answer,
        blocksNode,
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
      const signature = last === null ? '0' : `${last.turn}:${last.state}:${last.fullGone === true}:${last.blocks?.length ?? 0}:${last.chars}`;

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
          turns.map((turn) => {
            // 用户输入单独摆出来、**原样**显示（不改写、不折叠、不剥标记）。
            // 只有附件没有文字的那一轮（图片）画一个占位标记，不然卡片上方会空着、看不出你发过东西。
            const media = typeof turn.promptMedia === 'number' ? turn.promptMedia : 0;
            const askText = turn.prompt !== '' ? turn.prompt : media > 0 ? t('card.askMedia', { count: media }) : '';
            return h(
              'div',
              { className: 'dfv-turn', key: turn.turn },
              askText === ''
                ? null
                : h('div', { className: 'dfv-ask' }, h('div', { className: 'dfv-ask-text', 'data-media': turn.prompt === '' ? 'true' : 'false' }, askText)),
              h(TurnCard, { turn, t, inputActions: props.inputActions }),
            );
          }),
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
            tag.dataset.plugin = 'dsh-focus-brief';
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
              id: 'dsh-focus-brief',
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
