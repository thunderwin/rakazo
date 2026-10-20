# 系统架构

> 文档状态：基于 `thunderwin/rakazo` fork，上游 `main` 提交
> `9221486`，核实日期 2026-10-20。
>
> 本文区分“当前代码事实”和“本 fork 计划”。标注为“计划”的部分尚未实现。

## 1. 产品形态

Rakazo 是一个持久化 AI Agent 平台，不是单机聊天客户端。一个 bot 拥有自己的
对话、记忆、定时任务、文件和一台“电脑”；这台电脑可以运行 shell、浏览器、
文件工具和图形桌面。

本 fork 的目标形态是：

```text
用户下载品牌桌面客户端
  -> 客户端打开运营方托管的 Rakazo 服务器
  -> 用户在服务器上注册或登录
  -> 服务器给用户创建独立账号和默认 Space
  -> 用户使用自己的权限操作 bot、文件和电脑
```

客户端只负责展示和连接，权限、数据隔离和工具审批由服务器负责。

## 2. 系统上下文

```text
┌────────────────────┐        HTTPS          ┌─────────────────────┐
│ Desktop (Electron) │ ────────────────────> │ API (Hono + oRPC)   │
│ Web (React/Vite)   │ <──── SSE / RPC ───── │ + Pi agent runtime  │
│ Mobile (Expo)      │                       └──────────┬──────────┘
└────────────────────┘                                  │
                                                        │
                         ┌──────────────────────────────┼──────────────────────┐
                         │                              │                      │
                   PostgreSQL                     Worker                 Sandbox supervisor
                   (Prisma)                  (Graphile Worker)        (Docker control)
                         │                              │                      │
                         └──────────────────────────────┴──────────┬───────────┘
                                                                    │
                                              Docker / E2B / Daytona / Boat / Railway
                                                                    │
                                                              Bot Computer
                                                         (shell, files, browser,
                                                          X11 desktop, PTY)
```

核心边界：

- **客户端**：Electron、Web、Expo。它们共享 API 和产品契约。
- **控制面**：API 负责认证、授权、会话、run 编排和事件流。
- **执行面**：Worker 和 Sandbox supervisor 负责后台任务与电脑生命周期。
- **电脑**：Docker 容器或远程 provider 中的 Linux 工作环境。
- **模型**：通过 Pi 接入用户或运营方配置的模型凭据。

## 3. 仓库结构

```text
apps/
  api/       HTTP API、认证、run 编排、SSE
  worker/    后台任务和 durable jobs
  web/       React + Vite Web UI
  desktop/   Electron 客户端、安装包、自动更新
  mobile/    Expo iOS / Android 客户端
  www/       官网和营销页面

packages/
  core/         共享领域逻辑、事件、工具协议
  adapters/     Pi 运行时、模型适配、sandbox provider、工具执行
  contracts/    客户端/服务端共享的类型和 RPC 契约
  db/           Prisma schema、迁移、数据访问
  auth/         Better Auth、OIDC、注册策略
  chat-ui/      共享聊天 UI
  ui-web/       Web/Electron 组件
  ui-tokens/    语义颜色、品牌 token、图标生成
  testkit/      测试工具和端到端 harness

infra/
  compose/              Docker Compose 部署
  sandboxes/computer/   Bot 电脑镜像
  sandboxes/supervisor/ Docker sandbox 控制面

docs/                   架构、运维、发布和验证文档
```

## 4. 运行时组件

### 4.1 Web、Desktop、Mobile

三者都是同一套 API 的客户端。Electron 不是独立后端，它加载服务器的 Web UI：

- 连接已有服务器时，Electron 直接加载该服务器的页面。
- 使用“本机服务器”模式时，Electron 才使用打包的 Web renderer，并通过
  Docker Compose 启动本地服务。
- 每个服务器 origin 使用独立的 `persist:` session partition，因此 Cookie
  和本地存储在重启后保留。

相关代码：`apps/desktop/src/setup-config.ts`、`apps/desktop/src/main.ts`。

### 4.2 API 和 Worker

API 是控制面：

- Better Auth 处理注册、登录、会话和 OIDC。
- oRPC 暴露 bot、Space、文件、电脑、模板等接口。
- SSE 把 run 的文本、工具调用和状态推送给客户端。
- Pi agent runtime 在 API/Worker 进程内运行，不在 sandbox 内运行。

Worker 执行后台任务，例如定时任务、run 恢复、电脑维护和持久化任务。

### 4.3 PostgreSQL

Postgres 是持久化事实来源，保存：

- 用户、组织、Space、成员和角色
- bot、instructions、模型选择和工具开关
- thread、message、run、事件
- 文件元数据、artifact、routine
- 电脑记录、控制租约和审批规则

Prisma schema 和迁移在 `packages/db/prisma/`。

### 4.4 Sandbox supervisor 和 Bot Computer

默认本地 provider 是 Docker：

- `sandbox-supervisor` 通过 Docker socket 管理 bot 电脑。
- 每台电脑运行 Linux 镜像，包含 shell、文件工具、Chromium、X11 和 PTY。
- 电脑默认以非 root 用户（uid 1000）运行。
- 工作区通过 Rakazo 管理的 home 目录持久化。

远程 provider 包括 E2B、Daytona、Boat、CreateOS 和 Railway。它们的生命周期、
文件、命令和屏幕能力都通过 `SandboxProvider` 抽象接入。

详见 `docs/computer-runtime.md`。

### 4.5 模型和工具

模型通过 Pi 接入。内置工具包括：

- `shell`：在 bot 电脑里执行命令
- `read_file` / `write_file` / `list_files`
- `browser_*`：浏览器导航、快照和操作
- `computer_observe` / `computer_act`：图形桌面观察和操作
- `open_path` / `launch_app`
- `request_takeover`：请求用户接管屏幕
- 记忆、定时任务、子 bot 和集成工具

工具定义在 `packages/adapters/src/builtin-tools.ts`，执行和权限判断在
`packages/adapters/src/executor.ts`。

## 5. 一次对话的执行链路

```text
客户端发送消息
  -> API 创建 run
  -> Worker/API 加载 bot、Space、模型和工具配置
  -> Pi 生成模型请求
  -> 模型返回文本或工具调用
  -> executor 校验工具、审批规则和权限
  -> SandboxProvider 在 bot 电脑执行命令/文件/屏幕操作
  -> 结果写回 run 和 thread
  -> SSE 将文本、工具状态和最终消息推送给客户端
```

关键点：**模型不能直接访问宿主机**。它只能调用 executor 暴露的工具；工具再通过
sandbox provider 访问电脑。

## 6. 认证、租户和权限

- 认证使用 Better Auth。
- 支持邮箱密码和 OIDC/SSO；OIDC 的 client secret 只在服务器环境变量中。
- `SIGNUPS_ENABLED` 默认开启；可以通过 `SIGNUP_ALLOWLIST` 限制注册邮箱。
- Space 是数据隔离边界；bot、thread、文件和电脑都属于某个 Space。
- 所有授权判断在服务端完成。客户端隐藏按钮不等于权限控制。

本 fork 的默认策略：

- 每个用户独立账号，不共享账号。
- 新用户注册后加入默认 Space，并获得预设角色。
- 不把管理员 token 或共享 service token 打进客户端。

## 7. 数据持久化

- PostgreSQL 保存结构化状态。
- `DATA_DIR` 保存电脑 home、工作区快照和必要的本地文件。
- 远程 provider 的工作区通过 checkpoint/restore 持久化。
- 生产环境必须把 `DATA_DIR` 放在持久卷上，并做备份和静态加密。

## 8. 终端和电脑控制边界

需要区分三种“终端”：

1. **AI 的 shell 工具**：模型执行命令，通常每个调用是一个新的 shell 进程。
2. **用户的交互式 Shell**：Web/Desktop 的 Computer 视图里的 xterm + PTY。
3. **本机电脑模式**：bot 在用户电脑上以用户账号权限执行命令。

安全事实：

- 默认 Docker 电脑是非 root，但可以执行任意用户态命令。
- 用户交互终端需要控制租约，且只在 Docker/E2B/Daytona/Boat 等 provider 上开放。
- 本机电脑模式默认需要用户明确授权；命令可以访问工作区之外的文件。
- `shell` 默认在审批豁免列表中；可以在 Space 层配置 `require_approval`。

因此，面向普通用户的托管部署不应默认启用本机电脑模式，并应对 `shell` 增加审批
或命令白名单。

## 9. 部署形态

### 9.1 托管服务器 + 瘦客户端（推荐）

```text
用户电脑：Electron 客户端
运营方：API + Worker + PostgreSQL + Sandbox supervisor
```

优点：用户不需要 Docker；客户端可以做得很小；升级和权限集中管理。

### 9.2 自托管服务器

使用 `infra/compose/` 部署完整服务。需要处理 PostgreSQL、持久卷、HTTPS、
密钥、备份和 sandbox provider。

### 9.3 本机一体化

Electron 的“This computer”模式会在应用数据目录下启动 Docker Compose。它适合
开发者和技术用户，不适合作为普通消费者的默认安装方式。

## 10. 本 fork 的品牌和模板层（计划）

当前 fork 只初始化了目录和文档。以下内容尚未实现：

- 构建时注入默认服务器地址并跳过首次 setup。
- `brand/` 品牌源文件和自动生成图标。
- `config/bot-templates/` 的 bot 模板和幂等 seed 脚本。
- 注册后自动创建默认 Space 和 bot。
- 前端品牌文案和安装包更新源替换。

这些改动应尽量集中在品牌层、配置层和少数接入点，避免修改上游核心逻辑。

## 11. 发布流水线

### 客户端

- Web 构建：`pnpm --filter @rakazo/web build`
- Desktop 构建：`pnpm --filter @rakazo/desktop build`
- 安装包：electron-builder（macOS DMG/ZIP、Windows NSIS、Linux AppImage）
- macOS 需要 Developer ID 签名和 notarization
- Windows 建议使用 Authenticode 签名
- 自动更新源必须指向自己的仓库或更新服务器

### 服务端

- 构建 API/worker 镜像和 computer 镜像
- 推送自己的镜像仓库
- 部署 PostgreSQL、API、Worker、Sandbox supervisor
- 先跑迁移，再滚动更新
- 保留上一版本用于回滚

### 质量门禁

- `pnpm lint`
- `pnpm check`
- `pnpm test`
- 关键路径的 integration/E2E 测试
- 发布前在 staging 做一次真实登录、建 bot、发消息和工具调用

## 12. 安全边界和已知风险

- 客户端是不可信环境；任何内置的长期密钥都会被提取。
- 多租户部署必须验证 Space 级隔离，不能只依赖 UI 过滤。
- `shell` 默认免审批；开启本机电脑模式会显著放大风险。
- 沙箱不是多租户的强安全边界；Team Computer 内的 bot 共享用户、工作区和
  X11 访问。需要强隔离时使用独立电脑。
- 生产环境需要 HTTPS、可信 origin、速率限制、审计日志、备份和密钥轮换。

## 13. 相关文档

- `docs/computer-runtime.md`：电脑、终端、屏幕和 provider 生命周期。
- `docs/self-host.md`：部署、备份、升级。
- `docs/desktop-release.md`：桌面端签名和发布。
- `docs/FORK.md`：fork 策略、品牌化、模板和上游同步。
