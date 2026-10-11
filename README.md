# dsh-focus-brief

**把 agent 每轮的回答压成一张结果卡**：一句结论（点开换全文）+ 几个默认收起的信息块——
**需要你确认 / 关键数据 / 产出文件 / 结论建议 / 风险提醒**。块的骨架写死在本地，
内容由模型按同一份回答格式契约填，**不额外调用模型**。

安装（npm）：

```
dsh plugin --profile web add dsh-focus-brief
```

桌面端把 `--profile web` 换成 `--profile desktop`；也可以在 DSH 的「设置 → 插件市场」里
搜 `dsh-focus-brief` 一键安装。装完**重启 DSH**，会话标题栏就会多出一个「专注」标签。

![专注视图：整摞收起](https://raw.githubusercontent.com/shunshoudesi/dsh-focus-brief/main/docs/screenshots/focus-view-collapsed.png)

## 为什么需要它

agent 的回答是一段又长又平的正文：结论埋在中间，要你拍板的事散在末尾，产出文件混在叙述里。
你于是要么全读，要么漏。这个插件的做法**不是**再问一次模型「帮我总结一下」——那是一条额外的调用、
一份额外的等待、一份可能不准的摘要；它把「哪里是重点」写进模型**本来就要产出的那条回答**的格式契约里，
本地再按同一份规格解析。契约是接口，本地是解析器。原本要写的字还是那些字，只是按固定的骨架摆好。

## 两个座位

| 座位 | 出现在哪 | 长什么样 |
|---|---|---|
| 会话视图「专注」 | 会话标题栏，官方「对话」「轨迹」旁边多一个「专注」标签 | 整页每轮一张结果卡：你的原话（官方那条蓝底黑字气泡，一字不改）+ 一张回答卡 |
| 重点小卡 | 普通对话视图里，每轮回答下方 | 折叠的一行：契约标题 + 要点 / 待你确认 计数；点开看要点与被问到的事 |

两边读同一份解析结果（同一份契约规格），互不干扰，随时切回「对话」。

## 三级展开

1. **整摞收起（默认）**：五个块叠成一摞标题行；只有「需要你确认」永远排在第一位——它是唯一「看完必须动手」的块。
2. **展开整摞**：「展开 N 个信息块」只把**标题行**铺开，**每块内容仍然收起**：没点开就不进 DOM。
3. **点开一块**：只有那一块把内容放出来。项数超过预览条数的块（需要你确认 4 / 关键数据 4 / 产出文件 5 / 结论建议 5 / 风险提醒 3），
   底部多出一行两颗按钮——左边「还有 N 个 ›」⇄「只看前 M 个」（可来回），右边「收起这块」。

![展开整摞：每块仍收起](https://raw.githubusercontent.com/shunshoudesi/dsh-focus-brief/main/docs/screenshots/focus-view-blocks.png)
![点开产出文件：还有 N 个 + 收起这块](https://raw.githubusercontent.com/shunshoudesi/dsh-focus-brief/main/docs/screenshots/focus-view-block-open.png)

普通对话视图里的重点小卡（第二张座位）：

![重点小卡（展开态）](https://raw.githubusercontent.com/shunshoudesi/dsh-focus-brief/main/docs/screenshots/brief-card.png)

## 安装

npm（推荐，插件市场的「一键安装」走的也是这条）：

```
dsh plugin --profile web add dsh-focus-brief
dsh plugin --profile desktop add dsh-focus-brief   # 桌面端
```

用本仓库源码装（本地开发，不经过 npm）：

```
plugin_manager { action: "install_bundle", target: "<本仓库根的绝对路径>" }
```

装完**重启 DSH**：宿主半（投影 + 契约 + 解析器）要重启进程才加载；之后只改客户端半时，
刷新页面即可（`focusView` 仍是 v7，不用清缓存）。

不想装也能先看效果：[`preview.html`](https://github.com/shunshoudesi/dsh-focus-brief/blob/main/preview.html)
是一份独立预览（不用开 DSH），数据来自真实会话、配色是 DSH 主题 token 的真实取值、样式是插件实际注入的那份 CSS。

## 兼容与运行要求

| 项 | 值 |
|---|---|
| DSH | `0.2.0-rc.2`（0.2.x）——只在 0.2.0-rc.2 上验过，其它预发行版未验证 |
| profile | web / desktop |
| Node | ≥ 20.18 |
| 运行时依赖 | 无（只用官方的会话投影、slots、locale 服务与 react） |
| 权限 | 只读取会话事件与系统提示。不读工作区文件、不发网络请求、无遥测 |
| 数据来源 | 产出文件、状态、工具调用次数来自真实会话事件，不靠模型复述 |

## 仓库结构

```
.
├── index.js            # 宿主半：两条会话投影 + 回答格式契约 + 契约解析器
├── client.js           # 客户端半：专注视图的座位、卡片渲染、自己的极简 markdown 渲染
├── cordis.patch.yml    # bundle patch
├── package.json        # 插件清单（dsh.bundle / dsh.client / dsh.compatibility）
├── preview.html        # 不用开 DSH 也能看的独立预览（真实数据 + 真实主题 token）
├── docs/
│   ├── screenshots/    # README 与插件市场用的截图（演示轮次，不含真实会话内容）
│   └── submission.md   # 插件市场收录：提交模板与仓库侧待办
├── scripts/            # 全部验证脚本（可复跑；`node scripts/<name>.mjs`）
├── .tmp/               # 一次性中间产物（截图页、抽取的主题包）——已 gitignore
├── LICENSE             # Apache-2.0
├── README.md           # 本文件
├── MANUAL.md           # 实现与验证手册：卡片结构、契约与解析器、十道闸门与实测数字、边界
└── CHANGELOG.md        # 版本记录
```

## 已知限制

- **契约靠模型自觉**。模型不按契约写（或按得不精确）时，那一轮卡片退化成「标题 + 一句结论 + 回答全文」，
  信息不丢，只是没有块。本机 208 轮历史语料大多是契约下发**之前**写的，所以块很少（29/208 轮写过契约段，
  82 轮一个块都没有）——看旧轮次时这是预期行为，不是坏了。
- **只在 `0.2.0-rc.2` 上验过**。宿主换大版本时，投影与座位 API 需要重新对齐。
- **卡片上不带执行日志**。工具调用时间线仍在官方的「轨迹」视图里，这里只留「N 次工具调用」这类计数。
- **块内超过预览条数的项默认不渲染**，点「还有 N 个 ›」才铺开（这是故意的：把默认体积压住）。
- **附件图不渲染**。客户端座位拿不到附件渲染接口，只有图片没有文字的轮次会留一个占位标记。

## 详细文档

- [`MANUAL.md`](https://github.com/shunshoudesi/dsh-focus-brief/blob/main/MANUAL.md) —— 卡片结构、契约与解析器的全部规则、
  十道回归闸门与它们的实测数字、体积与对比度实测、已知边界、重启刷新后的验收清单。
- [`CHANGELOG.md`](https://github.com/shunshoudesi/dsh-focus-brief/blob/main/CHANGELOG.md) —— 版本记录。
- [`docs/submission.md`](https://github.com/shunshoudesi/dsh-focus-brief/blob/main/docs/submission.md) —— 插件市场收录用的提交材料。

## 收录

仓库已加 [`dsh-plugin` topic](https://github.com/topics/dsh-plugin)：DSH 内置的「设置 → 插件市场」按这个 topic
搜仓库、按仓库名到 npm 取包（所以仓库名与 npm 包名一致：`dsh-focus-brief`），官网
[dsh-plugin.org](https://dsh-plugin.org) 数据同源。收录要求、提交模板与仓库侧待办见
[`docs/submission.md`](https://github.com/shunshoudesi/dsh-focus-brief/blob/main/docs/submission.md)。

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/shunshoudesi/dsh-focus-brief)

## 许可证

[Apache-2.0](LICENSE)