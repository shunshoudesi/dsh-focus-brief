/**
 * 重点卡片（Focus Brief）· 客户端半
 *
 * 在 `conversation.chat.turnTail`（每轮结束时、动作行之前的官方座位）注册一张折叠卡片：
 * 最上面一行是结论，展开后是树状要点、「需要你确认」和过程计数。
 *
 * 这是纯新增座位，不替换任何自带渲染，也不读别的插件的 DOM；
 * React 由浏览器模块表提供，除 `react` 之外不 require 任何包。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-focus-brief',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 宿主半注册的投影键，两边必须一致。 */
    const PROJECTION_KEY = 'focusBrief';
    /** 本插件的 locale 命名空间。 */
    const NS = 'focus-brief';
    /** CSS 标签标识，避免重复注入。 */
    const CSS_TAG_ID = '@local/dsh-focus-brief/card.css';

    const zh = {
      'card.badge': '重点',
      'card.expand': '展开重点',
      'card.collapse': '收起重点',
      'card.asked': '你问的',
      'card.points': '要点',
      'card.asks': '需要你确认',
      'card.empty': '（本轮没有正文可提炼）',
      'card.meta': '本轮 {tools} 次工具调用 · 正文 {chars} 字',
      'card.countPoints': '要点 {count}',
      'card.countAsks': '待定 {count}',
    };

    const en = {
      'card.badge': 'Focus',
      'card.expand': 'Expand the focus brief',
      'card.collapse': 'Collapse the focus brief',
      'card.asked': 'You asked',
      'card.points': 'Key points',
      'card.asks': 'Needs your call',
      'card.empty': '(No prose to distill in this turn)',
      'card.meta': '{tools} tool calls this turn · {chars} chars of prose',
      'card.countPoints': '{count} points',
      'card.countAsks': '{count} to decide',
    };

    /**
     * 卡片样式：苹果手机那种毛玻璃。
     * 视觉上由四件东西共同撑起 —— 半透明底 + 发丝边 + 顶部内高光 + 柔和投影；
     * `backdrop-filter` 的模糊只在背后有内容纹理时才看得出来，所以不能只靠它。
     *
     * 两条纪律：
     * 1. 语义色一律用主题 token，并用 `color-mix` 从 token 派生透明度 —— 深浅色主题自动跟随，
     *    且 token 日后改名最多让观感退化，不会把渲染弄坏。
     * 2. 每个 `color-mix` 所在属性都先有一条不含它的兜底声明；引擎不支持时自动退回不透明外观。
     *
     * 唯一的字面色是投影里那个中性黑（`rgba(0,0,0,.10)`）：阴影不是语义色，两种主题下都成立；
     * 它放在 `color-mix` 的 @supports 分支里，所以不支持时连阴影一起没有。
     */
    const CSS = [
      /* ---- 兜底外观：不含 color-mix / backdrop-filter 也站得住 ---- */
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
      /* 「需要你确认」的条目文字用 label-primary：warn 色在浅色主题下当文字只有 2.15:1，
         实测不可读。警示色改由前面那个圆点承担（装饰性，不承担文字对比度）。 */
      '.dfb-asks .dfb-item{color:var(--dsw-alias-label-primary)}',
      '.dfb-asks .dfb-item:before{color:var(--dsw-alias-state-warn-primary)}',
      '.dfb-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      /* ---- 毛玻璃：从 token 派生半透明 + 顶部内高光 + 柔和投影 ---- */
      '@supports (color:color-mix(in srgb,red 50%,transparent)){',
      /* 底色：先往 layer 色里掺一点 label 色 —— 浅色主题下 bg-layer-1 与页面底同为 #ffffff，
         不掺的话卡片和背景一模一样、只剩一条发丝边；深色主题下则把卡片略微提亮。再整体给 72% 透明度。
         发丝边直接用 border-l2 自己的 alpha（浅 #0000001a / 深 #ffffff1f），不要再用 color-mix 削弱它。 */
      '.dfb-card{background-color:color-mix(in srgb,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,var(--dsw-alias-label-primary)) 72%,transparent);background-image:linear-gradient(color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent),transparent 45%);box-shadow:0 6px 20px rgba(0,0,0,.10),inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}',
      '.dfb-badge{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      '.dfb-count[data-alert="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.dfb-toggle:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary)}',
      '.dfb-toggle:active{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}',
      '.dfb-quote{border-left-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}',
      '}',
      /* ---- 真正的模糊：只负责 backdrop-filter，不和上面的属性互相覆盖 ---- */
      '@supports (backdrop-filter:blur(1px)){',
      '.dfb-card{-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%)}',
      '}',
      /* ---- 高对比模式与减少动效 ---- */
      '@media (forced-colors:active){.dfb-card{background:Canvas;border-color:CanvasText;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}.dfb-badge,.dfb-count[data-alert="true"]{border-color:CanvasText}}',
      '@media (prefers-reduced-motion:reduce){.dfb-toggle{transition:none}}',
    ].join('');

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
      const brief = props.useProjection(PROJECTION_KEY, (value) => {
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

      const t = props.t;
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

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => {
            if (typeof document === 'undefined') return () => {};
            if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) !== null) return () => {};
            const tag = document.createElement('style');
            tag.dataset.plugin = '@local/dsh-focus-brief';
            tag.dataset.pluginCss = CSS_TAG_ID;
            tag.textContent = CSS;
            document.head.appendChild(tag);
            return () => tag.remove();
          },
          'dsh-focus-brief: styles',
        );
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-focus-brief: dictionaries');
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