# 插件市场收录材料

这份文件是**面向收录**的：一半是仓库侧要满足的硬条件（勾选表），一半是可以直接粘贴到 Issue 的提交模板。
两个市场用的是同一套发现机制：**GitHub 仓库加 `dsh-plugin` topic**。

- DSH 内置的插件市场（「设置 → 插件市场」）：按 topic 搜 GitHub 仓库，卡片显示仓库描述、Star、语言、更新时间；
  详情面板取 README 的**前 1200 字符**并显示安装命令；一键安装固定执行 `dsh plugin --profile web add <仓库名>`
  （仓库名即 npm 包名），并从 npm 读 `dsh.bundle.patch` 判断是不是标准 bundle 插件。
- 官网 [dsh-plugin.org](https://dsh-plugin.org/zh/submit)：同一个 topic 自动发现，人工复核后标 `verified`。

## 仓库侧（勾选表）

- [x] 公开仓库：<https://github.com/shunshoudesi/dsh-focus-brief>
- [x] 插件导出 `apply(ctx)` 模块（`index.js` 的 `export function apply(ctx)`）
- [x] README 含安装命令（`dsh plugin --profile web add github:shunshoudesi/dsh-focus-brief`，且落在前 1200 字符内）
- [x] 仓库描述（一句话价值，插件市场卡片直接显示它）
- [x] GitHub topic：`dsh-plugin`（另加 `deepseek-harness`、`dsh`、`focus-view`）——已实测被市场的同款查询命中
- [x] 许可证：Apache-2.0（`LICENSE` + `package.json` 的 `license`）
- [x] **只从 GitHub 源码发布**（`dsh plugin add github:...`，已实测可用）；npm registry 不发
- [ ] 收录后把 README「收录」一节里的徽章链接换成正式详情页地址

### 当前形态：只上 GitHub，不占 npm

插件市场的一键安装写死了 `dsh plugin --profile web add <仓库名>`，也就是**必须有同名 npm 包**。
本仓库选择不发 npm，代价与对策：

- 市场里**能搜到、能看 README**（topic 起效），但详情面板里那行一键安装会报「取不到包」；
- 对策就是 README 顶部那条 `dsh plugin --profile web add github:shunshoudesi/dsh-focus-brief`——
  这条已经实测过：pnpm 能取到 `dsh-focus-brief@0.3.0`，且 `files` 白名单生效（只装 7 个文件）。

### （可选）发布 npm 包，换回一键安装

```bash
cd <本仓库根>
npm login                 # 浏览器授权，只需一次
npm publish               # 0.3.0；72h 内可 unpublish，之后不可撤回
```

验收（这条命令要能返回含 `dsh.bundle.patch` 的 JSON，市场据此判定「标准 bundle 插件」）：

```bash
npm view dsh-focus-brief version
curl -s https://registry.npmjs.org/dsh-focus-brief/latest | findstr dsh
```

## 提交模板（可直接粘贴）

**标题**

```
[插件提交] shunshoudesi/dsh-focus-brief — 把 agent 每轮的回答压成一张结果卡
```

**正文**

```markdown
### 仓库地址
https://github.com/shunshoudesi/dsh-focus-brief

### 一句话价值
装完之后，会话多出一个「专注」视图：每轮不是一段又长又平的正文，而是一张结果卡——一句结论 +
几个默认收起的信息块（需要你确认 / 关键数据 / 产出文件 / 结论建议 / 风险提醒）。重点从「正文里」
变成「卡上固定位置」，要你拍板的事永远排第一。

### 能力分类
界面与体验

### 安装命令
dsh plugin --profile web add github:shunshoudesi/dsh-focus-brief
（桌面端：dsh plugin --profile desktop add github:shunshoudesi/dsh-focus-brief）

### 兼容与运行要求
DSH 0.2.0-rc.2（0.2.x，仅在此版本验证过）；profile：web / desktop；Node ≥ 20.18；无运行时依赖。

### 许可证
Apache-2.0

### 截图 / 演示
仓库 `docs/screenshots/`：整摞收起 / 展开整摞 / 点开产出文件（含「还有 N 个 + 收起这块」）/ 重点小卡。
另有免安装预览：`preview.html`（真实数据 + 真实主题 token）。

### 补充说明
- 发布形态：只从 GitHub 源码发布（`github:` 安装命令）；npm registry 上暂无同名包，插件市场的「一键安装」因此不可用。
- 权限：只读取会话事件与系统提示；不读工作区文件、不发网络请求、无遥测。
- 契约靠模型自觉：模型不按契约写时，那一轮退化成「标题 + 一句话结论 + 回答全文」，信息不丢。
- 卡片上不显示执行日志（工具调用时间线仍在官方「轨迹」视图里）。

### 提交前自查
- [x] 仓库已公开
- [x] 已添加 GitHub topic：dsh-plugin
- [x] README 包含安装命令
- [x] 插件导出 apply(ctx) 模块

## 收录徽章（收录后贴进 README）

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/shunshoudesi/dsh-focus-brief)
```