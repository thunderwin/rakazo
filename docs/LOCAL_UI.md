# 本地客户端 UI

> 状态：已替换旧 `local.html` 预览，核实日期 2026-10-21。

## 1. 结构

正式本地界面是 `apps/web` 中的独立 React renderer：

```text
apps/web/src/local-main.tsx
  -> LocalApp
  -> window.rakazoDesktop.local IPC
  -> Local Runtime / SQLite / browser bridge
```

它不使用服务端路由或 oRPC。Vite 用 `vite.local.config.ts` 把它构建到
`apps/web/dist-local`，桌面构建再复制到 `apps/desktop/dist/local-web`。Electron 只加载
这份打包资源，聊天不再依赖服务器 Web UI。

首次启动默认直接进入本地界面，不显示“这台电脑 / Existing instance”的服务器选择页。
开发态默认连接 `http://127.0.0.1:3100`；生产构建必须通过受控的
`RAKAZO_SERVER_URL` 配置账号和模型网关。只有已保存旧服务器配置，或显式设置
`RAKAZO_LEGACY_SETUP=1` 时，才显示旧版 Existing instance 设置页。

## 2. 复用的原版 UI 能力

- `@rakazo/ui-web` 的 `BotAvatar`、Button、Input、Textarea 和 Dialog。
- `@rakazo/core` 的 mention 构建、候选过滤、键盘选择和 chip key。
- `@rakazo/chat-ui/web` 的 `ChatMarkdown`，包括 GFM、代码块、表格和安全链接。
- `GROK_COLOR_LIST` 和 `resolvePersonaColorDef` 的 bot 身份色系统。
- 原版 `ScratchpadSection`、`BoardPage` 和 `ArtifactsPage`。这些组件增加可注入的
  数据源；服务端入口继续使用原 RPC 数据源，本地入口只替换为 IPC 适配器，没有维护
  第二套页面布局。

旧 `local.html`、`local.js`、`local.css` 和对应手写测试已删除，不再维护第二套 UI。

## 3. 交互细节

### 设置分层

- 左下角账户菜单统一承载个人中心和全局操作；应用设置从该菜单打开，包含语言、
  外观、默认模型、浏览器访问和诊断。
- 退出登录也只放在左下角账户菜单中，不占用聊天标题栏的上下文控制。
- 聊天标题栏的设置按钮只管理当前 Bot；群聊中同一位置只打开当前群组设置。
- 应用设置在 Bot 和群聊状态下都可访问，不再与当前聊天配置混在同一个弹窗。

### 语言

- 本地客户端默认使用简体中文；用户可在“应用设置 → 语言”中切换简体中文和
  English，保存后立即生效，无需重启。
- 选择保存在本地 `localStorage` 的 `rakazo.uiLocale`，下次启动优先使用该选择。
- 本地界面目前只开放已完整覆盖的中文和英文，避免出现部分未翻译的界面。

### Bot 身份

- 侧栏、标题、消息作者、mention 候选和 mention chip 使用同一个 BotAvatar。
- Bot 颜色使用共享身份色；设置页可以修改颜色。
- 消息作者显示真实 bot 名，而不是统一的 “Bot”。
- 运行中的 bot avatar 使用原版工作状态。
- Bot 和群组支持自定义 section 与置顶；侧栏按 section 分组，Pinned 项排在最前。
- Fleet 归档的 Bot 从活动侧栏隐藏，可从“Archived bots”恢复或二次确认后永久删除。

### Mention

- 在输入框中输入空白后的 `@` 会打开候选列表。
- 支持名称前缀过滤、上下键、Enter/Tab、Escape 和鼠标选择。
- 中文输入法组合输入期间不触发选择。
- 选中后成为 composer chip；Backspace 可在空输入时删除最后一个 chip。
- 发送时生成 `@Name` 文本，消息气泡内使用对应 bot 身份的 inline mention 样式。

### 错误

- 可恢复错误显示在输入框上方的 error banner，包含标题、说明、Retry 和 Dismiss。
- 模型失败后 composer 内容保留，用户可以直接重试。
- 历史消息中的失败记录使用独立错误卡片；Stop 使用中性“Run stopped”卡片。
- 登录错误留在认证表单内，设置错误留在设置弹窗内，不混用全局 status。

### 消息

- Bot 消息使用 `ChatMarkdown`，支持标题、列表、表格、代码块和链接。
- 用户消息保持纯文本，但会对已知 bot 的 `@Name` 做身份高亮。
- 流式回复继续使用 Markdown streaming 渲染。
- 工具调用以可折叠的次要信息显示，不抢占正文层级。
- 群聊使用 GroupAvatar；每条 bot 消息显示真实成员身份，handoff 使用独立事件卡片。
- 群聊 mention picker 只选择当前群成员，并支持 `@everyone`。

### Memory 和 Activity

- 当前 bot 的 Brain 按钮打开本地 Memory，分为 `This bot` 和 `Shared`。
- 文档可以查看、编辑、删除和下载；保存携带 revision，避免静默覆盖新内容。
- Activity 展示本地 run/tool 状态、耗时、参数、结果和错误。
- Routines 按钮管理当前 bot 的定时任务，支持 schedule 编辑、启停、立即运行和最近运行。

### 附件

- Composer 支持文件选择、拖放、粘贴、图片缩略图和发送前移除。
- 直接聊天和群聊都可以只发送附件。
- 消息中显示图片或文件卡片，并可从本地 artifact 下载。

### Knowledge 和 Skills

- Knowledge 和 Skills 是账号级资源，从“应用设置 → 账户资源”打开，不放在单个 Bot 标题栏。
- Knowledge 文档支持新建、编辑、删除；managed 文档只读。
- Skills 展示 built-in、user、managed 来源；只有 user skill 可编辑。
- User skill 可以编辑脚本文件、运行时、超时和联网声明；执行仍由 `skill_run`
  在聊天中逐次请求批准。
- `web_search`、`web_fetch`、`render_plot`、`attach_file` 和配置媒体供应商后出现的
  `generate_image` 都通过本地 runtime 执行；图表和图片会作为消息附件显示。

### Scratchpad、Ticket Board 和 Artifacts

- 当前 Bot 的聊天设置复用原版 Scratchpad 区域，增删、完成和搁置都写入本地 SQLite。
- 标题栏的 Board 按钮打开原版 Ticket Board。列、Ticket 弹窗、Owner、状态、优先级和
  评论布局均复用上游组件；本地适配器把 `ownerBotId/reference` 映射为上游
  `assigneeBotId/ref`。
- 标题栏和“应用设置 → 账户资源”都可打开原版 Artifact Library。卡片/列表视图、搜索、
  日期和 Bot 筛选、附件预览及删除操作复用上游组件。
- 本地 Artifact 目前没有上游的版本族数据，因此 `versionCount` 固定为 1，版本选择器
  不出现；这是数据能力差异，不是隐藏现有本地数据。删除会直接移除本地 SQLite 中的
  artifact。
- `Cmd/Ctrl+K` 打开原版 Bot 切换命令面板，搜索、头像、快捷键和键盘选择复用上游组件；
  本地入口只把 `DesktopLocalBot` 映射成面板需要的最小 Bot 字段。

### Memory

- Bot 标题栏的 Memory 只打开当前 Bot 私有记忆。
- 账号共享 Memory 从“应用设置 → 账户资源 → Shared memory”打开。

## 4. 开发和验证

```bash
pnpm --filter @rakazo/web build:local
pnpm --filter @rakazo/web check
pnpm --filter @rakazo/web test
pnpm --filter @rakazo/desktop build
```

当前 Electron 开发命令会先完成一次本地 UI 构建，再启动桌面窗口；修改 renderer
源码后需要重新执行 `pnpm --filter @rakazo/desktop dev`。语言切换属于运行时状态，
不需要重启窗口。

组件测试覆盖 mention 选择与发送、BotAvatar/Markdown 渲染、模型额度错误、Retry
保留输入、群聊与 handoff 展示、Memory/Routine/附件展示、本地 Artifact Library 与
Ticket Board 的挂载，以及设置/浏览器状态。桌面构建继续由 `@rakazo/desktop` 的
`prebuild` 自动生成 `dist-local`。

## 5. 尚未迁移的前端

以下上游界面仍不在本地入口中，不能视为已有功能：

- MCP 管理面板。本地 runtime 已能保存和连接 per-bot MCP server，但上游面板按账号级
  server + Bot assignment 建模，并包含 OAuth；需要先统一数据模型和 OAuth 边界。
- 上游 Team Computer 工作区。本地电脑能力由本机屏幕与系统输入控制提供，和远端
  sandbox 的 terminal/files 数据协议不同，不能只替换 RPC。
- Bot 完整右键菜单、拖拽分组和群组归档、头像编辑器、sidebar density、时区设置、
  应用更新界面、交互图表块和完整 ask/approval cards。
- 账单、用量和账号安全页面。它们属于控制平面，不是本地 SQLite 资源。

这些项目继续采用“复用页面组件 + 注入适配器”的方式；数据协议不一致时先收敛契约，
不复制上游页面。
