# 系统架构

> 文档状态：基于 `thunderwin/rakazo` fork，上游 `main` 提交
> `9221486`，核实日期 2026-10-20。
>
> **重要：本文把“V1 目标架构”和“当前上游实现”分开写。**
> V1 目标尚未实现；当前代码仍然是服务器中心架构。

## 1. 决策摘要

V1 采用 **单设备 local-first**：

| 能力 | V1 位置 |
|---|---|
| 注册、登录、账号安全 | 服务器 |
| 充值、订阅、额度、用量 | 服务器 |
| 模型网关 | 服务器（主要收入路径） |
| 设备注册和撤销 | 服务器 |
| 崩溃上报、监控、审计元数据 | 服务器 |
| Agent 循环 | 客户端 |
| shell、文件、浏览器、应用控制 | 客户端 |
| bot 配置、对话、记忆 | 客户端 SQLite |
| 定时任务 | 客户端 |
| 多设备同步、团队协作 | **V1 不做** |

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
                    │ 只走登录、额度、模型调用、日志
                    ▼
┌──────────────────────────────────────────────┐
│ 你的服务器（薄控制面）                       │
│  Better Auth / 账号                          │
│  订阅 / 充值 / 额度                          │
│  Model Gateway                               │
│  Device registry                             │
│  Telemetry / crash / update feed             │
└──────────────────────────────────────────────┘
```

目标链路：

```text
用户消息
  -> 本地 Agent Runtime
  -> 服务器模型网关（鉴权、扣额度、转发）
  -> 模型供应商
  -> 模型返回文本或工具调用
  -> 本地 Runtime 执行工具
  -> 结果写入本地 SQLite
  -> UI 渲染
```

模型网关会看到 prompt 和模型返回内容。这是计费、限流和风控的必要条件，V1 必须
在隐私政策中明确说明。服务器不保存对话正文作为业务数据。

## 3. 当前上游实现（as-is）

当前 Rakazo 不是 local-first，而是服务器中心架构：

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

**结论：当前代码只能作为本地工具执行的起点，不能直接满足 V1 local-first。**

## 4. 组件职责

### 4.1 服务器控制面

保留：

- Better Auth / 注册 / 登录 / 会话
- 账号、订阅、充值、额度
- 模型网关
- 设备注册、撤销、短期 token
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
- 本地 SQLite、备份和导出

Local Agent Runtime 应作为独立进程或 Electron utility process 运行，避免阻塞渲染进程，
也便于崩溃恢复和权限隔离。

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
- 敏感字段加密；备份也加密。
- 升级时执行迁移并保留备份。
- 提供导出/恢复；V1 不做云端同步。
- 本地数据库是唯一事实来源。

### 4.4 模型网关

协议见 `docs/MODEL_GATEWAY.md`。

```text
Local Runtime
  -> POST /v1/model/...
  -> 鉴权、额度、provider 选择
  -> 供应商
  -> SSE 流式返回
```

要求：

- 短期设备 token，可撤销。
- 按用户、设备、模型、token 用量限额。
- 供应商长期 key 只存在服务器。
- 记录用量元数据，不把对话正文作为业务数据保存。
- 对共享账号、异常频率和滥用做风控。

### 4.5 浏览器桥接

用户现有浏览器的登录态不能靠复制 Cookie 文件。推荐：

- 浏览器扩展运行在用户现有 Chrome/Edge 中。
- 本地 Runtime 通过 Native Messaging 或本地 WebSocket 与扩展通信。
- 按站点授权，提供暂停、撤销和活动指示。
- 网页内容按不可信数据处理。

### 4.6 本地工具

- `shell`：在用户电脑执行命令，需要显式授权和停止入口。
- 文件：读写用户选择的工作区。
- 应用启动和屏幕控制：按平台能力提供，并明确权限。
- 高风险工具不能仅靠 prompt 约束，必须有工具级权限和服务端/本地审批策略。

## 5. 认证、设备和计费

```text
用户在客户端登录
  -> 服务器返回 session
  -> 客户端注册设备（device id + public key）
  -> 服务器返回设备绑定的短期 token
  -> 客户端把 token 存入 OS keychain
  -> 模型网关按 token 扣额度
```

原则：

- 客户端不可信；额度和权限判断必须在服务器。
- 设备可单独撤销。
- 不在客户端做唯一扣费判断。
- 多设备在 V1 不共享本地数据；每台设备是独立本地库。

## 6. 数据边界

| 数据 | 服务器 | 客户端 |
|---|---|---|
| 账号、密码哈希、session | 是 | 只存 session/token |
| 订阅、充值、额度、用量 | 是 | 只存展示缓存 |
| bot 配置、instructions | 否 | 是 |
| thread、message | 否 | 是 |
| memory、routines | 否 | 是 |
| 本地文件、浏览器内容 | 否 | 是 |
| 崩溃/错误元数据 | 是 | 可上报 |
| 对话正文（模型网关） | 经过，不持久化 | 是 |

V1 不存在服务器端的跨设备恢复。用户换机或重装需要本地导出/导入。

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
- 一个小型控制面数据库（用户、额度、设备、用量）
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

这是重构，不是配置开关：

1. 把 `packages/adapters/src/executor.ts` 从 Prisma 解耦，改为 repository 接口。
2. 新增本地 SQLite repository，实现 bot/thread/message/memory/routine。
3. 新增 Local Agent Runtime 入口（Electron utility process 或本地 API）。
4. 让 Web UI 连接本地 API/IPC，而不是远程 API。
5. 服务器 API 只保留 auth、billing、model gateway、devices、telemetry。
6. 把 bot 模板和 prompt 打包到客户端，seed 到本地 SQLite。
7. 浏览器扩展 + Native Messaging。
8. 本地备份、导出、迁移和崩溃恢复。
9. 最后做打包、签名、自动更新和小范围测试。

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
- 设备 token 短期化、可撤销、存 OS keychain。
- 本地数据库加密；备份加密。
- 浏览器扩展按站点授权，不静默读取所有页面。
- 网页、工具输出和其他 bot 的内容都按不可信数据处理。
- shell、文件写入、应用启动和屏幕控制需要审批或白名单。
- 服务器不信任客户端上报的额度或权限。
- 遥测默认只收集元数据，避免对话正文和文件内容。

## 12. V1 非目标

- 多设备同步
- 团队 Space / 团队电脑 / 多人协作
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
