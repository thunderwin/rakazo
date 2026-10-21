# 本地客户端 UI

> 状态：已替换旧 `local.html` 预览，核实日期 2026-10-20。

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

## 2. 复用的原版 UI 能力

- `@rakazo/ui-web` 的 `BotAvatar`、Button、Input、Textarea 和 Dialog。
- `@rakazo/core` 的 mention 构建、候选过滤、键盘选择和 chip key。
- `@rakazo/chat-ui/web` 的 `ChatMarkdown`，包括 GFM、代码块、表格和安全链接。
- `GROK_COLOR_LIST` 和 `resolvePersonaColorDef` 的 bot 身份色系统。

旧 `local.html`、`local.js`、`local.css` 和对应手写测试已删除，不再维护第二套 UI。

## 3. 交互细节

### Bot 身份

- 侧栏、标题、消息作者、mention 候选和 mention chip 使用同一个 BotAvatar。
- Bot 颜色使用共享身份色；设置页可以修改颜色。
- 消息作者显示真实 bot 名，而不是统一的 “Bot”。
- 运行中的 bot avatar 使用原版工作状态。

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

- Knowledge and skills 按钮打开同一个本地资源面板。
- Knowledge 文档支持新建、编辑、删除；managed 文档只读。
- Skills 展示 built-in、user、managed 来源；只有 user skill 可编辑。

## 4. 开发和验证

```bash
pnpm --filter @rakazo/web build:local
pnpm --filter @rakazo/web check
pnpm --filter @rakazo/web test
pnpm --filter @rakazo/desktop build
```

组件测试覆盖 mention 选择与发送、BotAvatar/Markdown 渲染、模型额度错误、Retry
保留输入、群聊与 handoff 展示、Memory/Routine/附件展示以及设置/浏览器状态。桌面构建继续由
`@rakazo/desktop` 的 `prebuild` 自动生成 `dist-local`。
