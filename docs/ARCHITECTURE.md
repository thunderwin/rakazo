# 系统架构

> 文档状态：当前代码基于上游 `main` 快照 `92214866`。2026-10-21 已 fetch 到
> `upstream/main@7e9365db`，但尚未 merge；该快照领先当前基线 114 个提交、725 个文件。
>
> **重要：本文把“V1 目标架构”和“当前上游实现”分开写。**
> V1 目标尚未全部实现；客户端已迁移本地 Pi 循环和 `shell`，其余服务器中心路径仍在。

## 1. 决策摘要

V1 采用 **单设备 local-first**：

| 能力                               | V1 位置                |
| ---------------------------------- | ---------------------- |
| 注册、登录、账号安全               | 服务器                 |
| 充值、订阅、额度、用量             | New API                |
| 模型网关                           | 服务器（主要收入路径） |
| 崩溃上报、监控、审计元数据         | 服务器                 |
| Agent 循环                         | 客户端                 |
| shell、文件、浏览器、应用控制      | 客户端                 |
| bot 配置、对话、记忆               | 客户端 SQLite          |
| 定时任务                           | 客户端                 |
| 多设备同步、共享团队频道、团队电脑 | **V1 不做**            |

服务器卖 AI 调用和账号服务；用户数据留在客户端。

## 2. V1 目标架构（计划）

```text
┌──────────────────────────────────────────────┐
│ Electron 客户端                              │
│                                              │
│  Web UI                                      │
│  Local API / IPC                             │
│  Local Agent Runtime (Pi)                    │
│    ├─ shell / files / launch_app             │
│    ├─ browser bridge (extension)             │
│    └─ local scheduler                        │
│  Local SQLite                                │
│  Device identity (Keychain / DPAPI)          │
└───────────────────┬──────────────────────────┘
                    │ 只走登录、模型调用、日志
                    ▼
┌──────────────────────────────────────────────┐
│ 你的服务器（薄控制面）                       │
│  Better Auth / 账号                          │
│  多企业 / 员工 / 管理员控制面                │
│  New API 用户映射                            │
│  Model Gateway                               │
│  Device registry                             │
│  Telemetry / crash / update feed             │
└──────────────────────────────────────────────┘
```

目标链路：

```text
用户消息
  -> 本地 Agent Runtime
  -> 服务器模型网关（鉴权、New API 令牌映射、转发）
  -> New API（额度与结算）
  -> 模型供应商
  -> 模型返回文本或工具调用
  -> 本地 Runtime 执行工具
  -> 结果写入本地 SQLite
  -> UI 渲染
```

模型网关会看到 prompt 和模型返回内容。这是计费、限流和风控的必要条件，V1 必须
在隐私政策中明确说明。服务器不保存对话正文作为业务数据。

## 3. 当前上游服务器路径（as-is）

上游默认产品路径不是 local-first，而是服务器中心架构：

```text
Desktop / Web / Mobile
          │
          ▼
API (Hono + oRPC) + Pi agent runtime
          │
          ├── PostgreSQL / Prisma
          ├── Worker（后台任务）
          └── Sandbox supervisor
                    │
                    ▼
          Docker / E2B / Daytona / Boat / Railway
                    │
                    ▼
                Bot Computer
```

当前事实：

- Pi agent runtime 运行在 API/Worker 进程，不在 sandbox 内。
- bot、thread、message、memory、routine 存在 PostgreSQL。
- Electron 是客户端壳，加载服务器的 Web UI。
- “本机电脑”模式只把 shell/文件等工具调用转发到用户电脑，Agent 循环仍在服务器。
- 本机电脑模式不暴露浏览器交互终端。
- 默认 Docker 电脑是非 root，但可以执行任意用户态命令。
- `shell` 默认在审批豁免列表中。

相关代码和文档：

- `apps/desktop/src/main.ts`、`apps/desktop/src/setup-config.ts`
- `packages/adapters/src/executor.ts`
- `packages/adapters/src/host-computer-server.ts`
- `docs/computer-runtime.md`

**结论：这条上游服务器路径不能直接满足 V1 local-first。Fork 已在桌面客户端另建
本地编排路径，复用 Pi runtime，而不是把 Prisma executor 搬进客户端。**

## 4. 组件职责

### 4.1 服务器控制面

保留：

- Better Auth / 注册 / 登录 / 会话
- 账号、会话
- 多企业、员工、角色和成员；部门/Team 树后续再做
- 终端账号最多一个当前企业；客户端不提供企业切换器
- 管理员控制面与配置分发
- 模型网关
- 用量记录、错误和崩溃元数据
- 客户端版本检查、更新 feed

删除或不再承载：

- bot/thread/message 的业务存储
- Agent run 编排
- 电脑/沙箱生命周期
- 后台 Agent 定时任务
- 对话内容检索

### 4.2 客户端

客户端是 V1 的执行面：

- Electron + 本地 Web UI
- 本地 API 或 IPC
- Local Agent Runtime
- 本地工具（shell、文件、应用启动）
- 浏览器扩展桥接
- 本地调度器
- 本地 SQLite

Local Agent Runtime 应作为独立进程或 Electron utility process 运行，避免阻塞渲染进程，
也便于崩溃恢复和权限隔离。

当前已建立的最小实现（核实日期 2026-10-20）：

- `@rakazo/local-runtime` 把编排拆成 `LocalAgentEngine`、
  `LocalConversationStore`、`LocalToolProvider` 三个端口。
- `apps/desktop/src/pi-local-agent-engine.ts` 用现有 `PiAgentRuntime` 实现引擎端口。
- 模型连接固定为 OpenAI-compatible，base URL 由组合根指向服务器网关；bot 只选择
  model id，不能更改服务器地址或直接接触 New API。
- SQLite 实现当前保存 bot、thread/message、群聊、Memory、Routines、Fleet 工作项、
  artifacts、Knowledge/Skills、MCP server、run/tool activity 和 settings。
- 客户端设置（主题、默认模型、Enter 发送）和 bot 设置（名称、描述、instructions、
  模型、thinking level）保存在账号本地 SQLite；服务器不保存这些用户编辑数据。
- 本地数据按 Rakazo userId 隔离：
  `userData/local/accounts/<sha256(userId)>/rakazo.sqlite`，workspace 位于同一账号目录。
- 登录前不打开本地库；登录、退出或切换账号时先取消该账号的活动 run，再关闭并重开
  对应账号的 runtime。
- 旧预览版的共享 `local/rakazo.sqlite` 只迁移给升级后第一个登录账号。
- 本地 `shell` 工具已接入 Pi 工具循环，并在 Electron 中逐次请求用户批准；命令的
  工作目录限定在本地 workspace。
- `list_files`、`read_file`、`write_file` 已接入本地 workspace；只读工具不弹审批，
  写入和 shell 仍逐次审批。
- `web_search` / `web_fetch` 已通过 keyless web adapter 接入本地 runtime；搜索默认先试
  DuckDuckGo HTML，再回退到 Bing HTML。抓取拒绝 HTTP(S) 以外的协议、URL 内凭证、
  loopback/private/link-local 地址和超限响应。
- `render_plot` 使用 Observable Plot 生成 PNG，并把图片写入本地 artifact 和当前消息；
  `attach_file` 可以把 workspace 文件附到聊天。
- `generate_image` 只在配置了媒体供应商时向模型暴露；生成结果写入本地 artifact，
  且不自动重试不确定的付费提交。
- `generate_video` 仅在媒体供应商声明视频能力时出现；提交状态保存到本地
  `media_jobs`，后续只按 job id 轮询，不自动重复提交。
- `request_secret` / `list_secrets` / `secret_request` / `forget_secret` 已接入账号级
  `safeStorage` 加密 vault；认证只注入保存的精确 origin，拒绝重定向并脱敏响应。
- `ask_user` 使用本地选项弹窗；`message_user` 写入当前聊天；`open_path` / `launch_app`
  在用户批准后调用桌面默认程序。
- `computer_observe` / `computer_act` 使用本地屏幕和系统输入控制，并由操作系统管理屏幕与
  辅助功能权限；`request_takeover` 会暂停并邀请用户完成受保护步骤。
- `add_mcp_server` 支持 streamable HTTP、SSE 和 stdio MCP server，发现的工具在下一轮以
  `mcp__<server>__<tool>` 暴露。
- Scratchpad 和任务目录写入本地 SQLite；Fleet 支持 section/pin、归档、恢复和永久删除。
  Ticket 数据和表保留，但看板入口及 Ticket 模型工具默认隐藏。
- `save_memory` / `recall_memory` / `forget_memory` 和 `search_history` / `read_history`
  已迁移到本地 SQLite；历史搜索只限当前 Bot 或群聊线程。
- Skills 可携带最多 20 个声明式脚本文件；`skill_run` 只执行声明入口，每次经用户批准，
  在工作区独立 run 目录运行，限制超时/输出/环境变量并校验 SHA-256。
- `run_subagent` 已接入 Pi 现有嵌套 Agent 循环；它是一次 run 内的临时助手，不创建
  独立 bot、thread 或电脑。
- `message_bot` 已支持持久 bot 之间的私聊委派：请求和回复写入本地
  `peer_messages`，目标 bot 在自己的 DM thread 中执行，调用链最大 6 个 bot 并阻止
  循环。
- 本地群聊已支持 2–10 个 bot、共享 group thread、`@BotName`/`@everyone` 唤醒、
  `handoff_to_bot`、loop/6-hop 限制、真实 bot 作者身份和 Stop 清理。
- 原版 React 视觉组件已接入独立本地 renderer：electron 打包 `apps/web/dist-local`，
  UI 通过本地 IPC 使用 SQLite/runtime，不访问服务端 oRPC。
- 本地 renderer 复用 `BotAvatar`、原版 mention picker/键盘逻辑、`ChatMarkdown` 和共享
  UI primitives；bot 名称、颜色、头像、mention chip、Markdown 和错误卡片保持统一身份。
- Scratchpad 直接复用原版页面组件和本地 SQLite IPC。Ticket Board 和 Artifact Library 的
  组件、适配层和数据表保留，但默认不进入本地导航；聊天附件继续使用 artifact 存储。
- run 事件已通过 IPC 流到本地 React UI，并支持按 run id 停止当前模型或工具执行。
- 模型、工具或浏览器操作失败时仍保存已经生成的文本和工具调用，并附带错误块；
  `onRunEnd` 统一清理活动 run、审批缓存和浏览器 Agent Window。Stop 同样进入该清理路径。
- 本地设置页可以复制诊断信息，包含版本、平台、登录状态、活动 run、浏览器桥和
  更新状态；不包含消息正文、session token、New API token 或浏览器 Cookie。
- 本地 run 和 tool activity 写入 SQLite；UI 可查看状态、耗时、参数、结果和错误。
- bot/账号 Memory 写入本地 SQLite；直聊注入 32 KiB 上下文，群聊不暴露私有 Memory。
- 本地 Routines 支持 cron/interval/一次性 schedule、在线调度、补跑、运行历史和
  `schedule_create/list/cancel`。
- 本地附件存 SQLite artifact；图片作为当前轮视觉输入，其他文件以类型/大小提示交给 Agent。
- Knowledge 使用本地文档库和关键词检索；Skills 使用 `SKILL.md` catalog、强制引用和本地
  user/managed 缓存。
- 服务器提供组织/member、版本化 Client Manifest、Ed25519 签名和 `/admin` 内部管理页；
  客户端每 5 分钟验证并同步 managed presets。

应用启动和桌面操作已通过 `open_path`、`launch_app`、`computer_observe` 和
`computer_act` 接入。仍待迁移的是 Fleet 的完整拖拽/右键菜单和 section/pin 编辑界面；
服务器专属的团队、电脑、账号管理页面不会进入本地 renderer。

### 4.3 本地数据库

使用 `better-sqlite3`（SQLite，WAL 模式，本地 runtime 作为唯一写入口），最低包含：

- bots
- threads
- messages
- memory
- routines
- tool runs
- settings
- schema migrations

要求：

- 仅当前用户可读。
- session 和 credential vault 使用 OS secure storage 加密。
- 升级时执行 schema migration。
- V1 不提供 SQLite 整库加密、产品级导出/恢复或云端同步。
- 本地数据库是唯一事实来源。

当前 schema 已有 bots、threads、messages、chat_groups、group_members、group_threads、
group_messages、peer_messages、runs、tool_runs、memory_documents、memory_revisions、
routine_runs、artifacts、settings 和 routines 表；repository 覆盖 bots、threads、
messages、群聊、peer_messages、run/tool activity、Memory、Routines、附件和 settings。
Knowledge document 与 Agent Skills 另有本地 repository；当前 schema 已包含
`knowledge_documents` 和 `agent_skills`，其中 `agent_skills.scripts` 保存受控脚本包。

`peer_messages` 表记录持久 bot 之间的请求、最终回复、状态和错误，用于本地协作
审计；它不保存到服务器。

账号间隔离是目录和数据库文件隔离，不是磁盘加密。同一 OS 用户仍可直接读取这些 SQLite
文件；这是 V1 明确接受的残余风险，不是待办功能。

### 4.4 模型网关

协议见 `docs/MODEL_GATEWAY.md`。

```text
Local Runtime
  -> POST /v1/model/openai/chat/completions
  -> Better Auth session 鉴权 + New API 用户令牌映射
  -> New API /v1/chat/completions
  -> 供应商
  -> OpenAI SSE 原样返回
```

要求：

- New API 负责额度、倍率、渠道、充值和结算。
- Rakazo 负责 session 鉴权和 Rakazo userId -> New API token 映射。
- New API token 在 Rakazo 控制面加密存储，客户端从不接触。
- 透传 `tools`、`tool_calls` 和其他 OpenAI 字段；流式请求强制
  `stream_options.include_usage=true`。
- 供应商 key 只存在 New API。
- New API 和 Rakazo 都能看到 prompt/回复；生产要求 `DEBUG=false`。

### 4.5 浏览器桥接

用户现有浏览器的登录态不能靠复制 Cookie 文件。当前实现（核实日期 2026-10-20）：

- 浏览器扩展运行在用户现有 Chrome/Edge 中。
- 本地 Runtime 通过 `ws://127.0.0.1` 与扩展通信；桌面端只监听 loopback。
- 首次连接使用一次性六位配对码，扩展只保存本地桥接令牌，不接触模型 session 或 New API token。
- 默认在独立 Agent Window 打开页面；已有标签页必须显式借用，run 完成后归还。
- Pi 当前可调用 `browser_list_tabs`、`browser_open`、`browser_observe`、`browser_navigate`、
  `browser_click`、`browser_type`、`browser_scroll`、`browser_borrow_tab`、
  `browser_return_tab` 和 `browser_close`。
- 观察返回短期 `eN` 引用；页面变化后必须重新观察。
- 按站点授权，提供暂停、撤销和活动指示。
- 网页内容按不可信数据处理。

协议、权限和限制见 `docs/BROWSER.md`。当前仅支持顶层 frame；任意 JavaScript evaluate、
文件上传下载和远程 CDP 不在 V1。

### 4.6 本地工具

- `shell`：已通过 `LocalToolRegistry` 在用户电脑执行命令；Electron 每次弹出
  “Allow once”授权，拒绝后不运行。本地 React UI 已有停止按钮。
- 文件：`list_files` 和 `read_file` 在 workspace 内只读执行；`write_file` 写入
  workspace 并逐次审批。符号链接路径和路径逃逸会被拒绝。
- 网页：`web_search` / `web_fetch` 只读、有限流；`web_fetch` 不执行页面 JavaScript。
- 数据和媒体：`render_plot` / `attach_file` 把结果存为本地 artifact；配置媒体供应商后
  可使用 `generate_image`。
- Skills：`skill_run` 只接受 Skill 包中声明的脚本入口，并在每次运行前审批。脚本的
  文件写入和联网声明受本地执行器约束；macOS 对 `network: false` 使用系统沙箱，
  其他平台尚缺同等网络隔离。
- 组织策略：Client Manifest 的 `featurePolicy.disabledTools` 由
  `LocalToolPolicyProvider` 合并进 Bot 级禁用列表，实际影响模型可见工具。
- 应用启动和屏幕控制：按平台能力提供，并明确权限。
- 高风险工具不能仅靠 prompt 约束，必须有工具级权限和服务端/本地审批策略。

当前的 cwd 限制只约束命令的起始目录，不是文件系统沙箱；shell 的隔离边界仍是
用户对每次执行的明确批准。

桌面 computer use 仍是设计阶段，边界见 `docs/COMPUTER_USE.md`。

## 5. 认证、会话和计费

```text
用户在客户端登录
  -> 服务器返回 session
  -> 客户端把 session token + Rakazo userId 存入 OS keychain
  -> 模型网关映射到用户的 New API token
  -> New API 按该用户额度结算

V1 继续使用 Better Auth session token；设备注册和短期设备 token 是后续工作。
```

原则：

- 客户端不可信；额度和权限判断由 New API 和 Rakazo 服务端校验。
- V1 通过 session 撤销访问；设备级撤销尚未实现。
- 本地数据库按已保存的 Rakazo userId 选择；旧版仅 token session 需要重新登录一次。
- 不在客户端做唯一扣费判断。
- 多设备在 V1 不共享本地数据；每台设备是独立本地库。

## 6. 数据边界

| 数据                      | 服务端 / New API | 客户端             |
| ------------------------- | ---------------- | ------------------ |
| 账号、密码哈希、session   | 是               | 只存 session/token |
| 订阅、充值、额度、用量    | New API          | 只存展示缓存       |
| bot 配置、instructions    | 否               | 是                 |
| thread、message           | 否               | 是                 |
| bot/账号 Memory、routines | 否               | 是                 |
| 本地文件、浏览器内容      | 否               | 是                 |
| 崩溃/错误元数据           | 是               | 可上报             |
| 对话正文（模型网关）      | 经过，不持久化   | 是                 |

V1 不存在服务器端或产品级的跨设备恢复。用户换机或重装可能丢失本地数据；这是明确接受的
local-first 限制。

## 7. 终端、电脑和浏览器

### 7.1 当前上游

- Docker/E2B/Daytona/Boat 电脑提供 Linux shell、文件、浏览器和 X11。
- 用户可以在 Computer 视图里打开交互式 Shell。
- 本机电脑模式只执行本地 shell/文件，不提供浏览器 shell。

### 7.2 V1 目标

- Agent 和工具都在用户电脑上运行。
- 不再需要服务器 sandbox supervisor 或 Docker 电脑。
- shell、文件和浏览器操作通过本地 runtime 执行。
- 浏览器优先使用用户现有浏览器 + 扩展；Electron 内置浏览器作为备选。
- 所有本地工具都要有可见状态、授权和停止能力。

## 8. 部署和打包

### 8.1 服务器

服务器只需要：

- 一个 API 服务
- 一个小型控制面数据库（用户、New API 映射、审计元数据）
- 模型网关
- 监控和更新 feed

不需要为 V1 部署 PostgreSQL 业务库、Worker 和 sandbox supervisor。

### 8.2 客户端

客户端会变大，因为包含：

- Electron/Chromium
- Agent runtime
- SQLite
- 本地工具和浏览器桥接
- 自动更新

V1 不打包本地模型权重。模型走服务器网关，因此安装包不会因为模型权重变成几个 GB；
如果以后加入 Ollama/llama.cpp，本地模型才会成为主要体积来源。

## 9. 从当前代码迁移

这是重构，不是配置开关。V1 不迁移服务器端约一万行的 Prisma executor，而是在本地
建立清晰的编排端口，并直接复用已经独立出来的 `PiAgentRuntime`：

1. 已定义本地 engine/store/tool 端口，并用 Pi adapter 组合；不复制 executor。
2. SQLite store 已覆盖 bot/thread/message、Memory、Routines 和 tool run。
3. 本地 runtime 已接入 Electron 主进程；独立 utility process 仍待拆分。
4. 原版 React 组件已通过 `apps/web/src/local-main.tsx` 和 `dist-local` 接入本地
   IPC；旧 `local.html` 预览和手工 JS/CSS 已删除。
5. 服务器 API 只保留 auth、New API 映射、model gateway、telemetry。
6. 把 bot 模板和 prompt 打包到客户端，seed 到本地 SQLite。
7. 浏览器扩展和 loopback bridge 已接入；商店发布和复杂站点兼容仍待完成。
8. 本地迁移和崩溃恢复。
9. 最后做打包、配置包更新和小范围测试。

在 1-4 完成前，不要开始多设备、团队或移动端。

## 10. 更新与版本

高频更新采用分层策略，详见 `docs/UPDATES.md`：

- 配置、prompt、bot 模板和模型目录：签名包，下载后立即生效。
- Web UI：版本化资源，下次页面加载或轻量 reload 使用新版本。
- 本地 runtime：后台下载并校验，V1 下次启动生效；后续可做进程热切换。
- Electron/Chromium/原生模块：替换二进制，必须重启。
- 本地 SQLite：在副本上迁移，成功后原子替换。

当前 `apps/desktop/src/auto-update.ts` 只实现“后台下载 + `quitAndInstall()`”，因此
当前代码的更新需要重启。V1 先实现配置热更新和下次启动生效的 runtime 更新，不把
完整 Launcher/热切换作为阻塞项。

## 11. 安全边界

- 客户端拥有用户级权限，必须默认最小权限并提供停止按钮。
- 模型网关能看到 prompt/回复；隐私政策必须披露。
- V1 的 session token 存 OS keychain；设备级撤销是后续工作。
- session 和 credential vault 使用 OS secure storage 加密。
- 浏览器扩展只响应用户发起的本地任务，不后台遍历页面；模型读取仍受当前任务目标约束。
- 网页、工具输出和其他 bot 的内容都按不可信数据处理。
- shell、文件写入、应用启动和屏幕控制需要审批或白名单。
- 服务器不信任客户端上报的额度或权限。
- 遥测默认只收集元数据，避免对话正文和文件内容。

## 12. V1 非目标

- 多设备同步
- 共享团队频道 / 团队电脑 / 多端实时协作
- 移动端
- 本地模型权重
- 服务器端 Agent 执行
- 服务器端对话历史
- 模型/插件市场
- 复杂灰度发布
- runtime 热切换和完整 Launcher 版本目录

## 13. 相关文档

- `docs/V1.md`：V1 范围、验收标准和非目标。
- `docs/UPDATES.md`：更新分层、签名、回滚和数据库迁移。
- `docs/FORK.md`：fork 策略、品牌化、模板和发布流水线。
- `docs/computer-runtime.md`：当前上游的 sandbox/terminal 行为。
- `docs/self-host.md`：当前上游部署方式。
- `docs/desktop-release.md`：桌面端签名和发布。
- `docs/BROWSER.md`：浏览器扩展、配对、工具和权限边界。
- `docs/COMPUTER_USE.md`：桌面 computer use 设计草案。
- `docs/LOCAL_UI.md`：本地 React UI 的组件来源、mention、错误和验证。
- `docs/GROUPS.md`：本地群聊、群消息和 `handoff_to_bot`。
- `docs/ACTIVITY.md`：本地 run/tool 活动记录和隐私边界。
- `docs/MEMORY.md`：本地 bot/账号 Memory、工具、修订和隐私边界。
- `docs/ROUTINES.md`：本地 routine 定义、调度、补跑和运行历史。
- `docs/ATTACHMENTS.md`：本地附件存储、模型输入和交互边界。
- `docs/KNOWLEDGE_SKILLS.md`：Knowledge 检索、Skills 格式、工具和分发边界。
- `docs/LOCAL_TOOLS.md`：本地工具清单、条件、上游差异和迁移状态。
- `docs/ADMIN.md`：组织、成员、manifest、签名和内部管理面板。
- `docs/CONTROL_PLANE.md`：多企业、管理员面板、内容分发和日志边界。
- `docs/BEST_PRACTICES.md`：基于当前代码的使用最佳实践和已知差异。
