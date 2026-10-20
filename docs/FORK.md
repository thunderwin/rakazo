# Fork 与产品化流水线

> 状态：V1 方向已确认，本地编排基础和单工具闭环已建立，其余能力分阶段迁移。
> 公开产品名已确定为 **ericBot**；域名、专用 Logo、登录方式、模型供应商和具体
> bot 模板仍待确认。

## 1. 为什么 fork

这个 fork 不是把 Rakazo 原样换个 logo，而是把它改造成 **单设备 local-first**
产品：

- 用户安装客户端，Agent 和工具在用户电脑上运行。
- 对话、bot、记忆和文件保存在客户端本地。
- 服务器只做账号、New API 映射、模型网关和监控；充值和额度由 New API 负责。
- 模型网关是主要收入路径。

V1 不做多设备、团队协作、团队电脑、移动端和本地模型。完整范围见
`docs/V1.md`。

客户端对外显示名为 `ericBot`，安装包标识为 `com.ericbot.desktop`。内部
`@rakazo/*` 包名、API 契约、IPC 名和本地存储键暂时保留，以减少无意义的迁移和
上游合并冲突。专用 ericBot Logo 提供前继续使用临时上游图标。

上游仍然提供可复用的基础：Web UI、Electron 壳、Pi runtime、工具协议和
部分 provider 代码。品牌和产品层放在 fork 中维护。

## 2. 远端和分支

```text
origin    https://github.com/thunderwin/rakazo.git
upstream  https://github.com/elie222/rakazo.git
```

约定：

- `main` 是自己的产品主线。
- `upstream/main` 只用于同步，不直接发布。
- 使用 merge 同步上游，不 rebase 已发布的提交。

```bash
git fetch upstream
git merge upstream/main
pnpm install --frozen-lockfile
pnpm lint
pnpm check
pnpm test
```

冲突应尽量集中在品牌文件、默认服务器配置和本地 runtime 接入点。如果核心文件
大面积冲突，说明定制层放错了位置。

## 3. 代码分区

V1 预期新增或维护：

```text
brand/                       品牌源文件和生成规则
config/bot-templates/        内置 bot 模板
config/prompts/              产品级 prompt
packages/local-runtime/      Agent、store、tool 端口和本地编排（基础已建立）
packages/local-db/           SQLite schema、迁移和 repository（v1 基础已建立）
apps/desktop/src/pi-local-agent-engine.ts
                             Pi engine adapter 和 Electron 组合根
apps/browser-extension/      Chrome/Edge MV3 扩展和本地浏览器工具
scripts/                     模板 seed、品牌生成、迁移脚本
docs/                        架构、V1 范围、fork 说明
```

原则：

- 能在本地配置层解决的，不改上游核心。
- 需要重构上游 executor 时，先抽接口，不复制整套代码。
- 不把用户数据、对话或记忆放到服务器。
- 不修改生成文件；修改源文件后重新生成。

## 4. 品牌改动清单

### 4.1 客户端

- `apps/desktop/package.json` 的 `productName`、`appId`、图标和发布仓库
- `packages/ui-tokens/src/index.ts` 的品牌色
- `packages/ui-tokens/assets/` 的图标源
- `packages/ui-tokens/scripts/export-brand.ts` 生成 favicon、ICO、PNG 和移动端图标
- `apps/desktop/src/setup.html`（如果保留首次设置页）
- `apps/web/public/` 的 favicon 和 PWA 图标
- `apps/www/` 的官网品牌和文案
- 安装包名称、更新源、发布说明
- 桌面更新 feed 必须指向 `thunderwin/rakazo`，不能沿用上游 `elie222/rakazo`

### 4.2 服务端

- `WEB_ORIGIN`、`API_URL`、`AUTH_URL`
- `SIGNUPS_ENABLED` 和 `SIGNUP_ALLOWLIST`
- OIDC/SSO（如启用）
- `NEW_API_BASE_URL`、`NEW_API_ADMIN_TOKEN`、`NEW_API_ADMIN_USER_ID`、
  `NEW_API_DEFAULT_MODEL`
- 崩溃/监控上报

### 4.3 不要改的东西

- 不要重命名内部存储 key（例如 `rakazo.*`），除非同时做迁移。
- 不要把品牌名写进 API 契约或数据库枚举。
- 不要在客户端放管理员 token、数据库密码或共享用户密码。
- 不要为了品牌化复制整套 UI 代码。

## 5. 登录、会话和模型网关

目标流程：

```text
客户端打开你的网站/登录页
  -> 用户注册或登录
  -> 客户端保存 Better Auth session token
  -> 本地 Runtime 使用 session token 调 Rakazo 网关
  -> Rakazo 映射到 New API token
  -> New API 扣额度并转发给模型供应商
```

要求：

- 客户端内置公开的 `serverUrl`，不内置任何长期密钥。
- session token 和 Rakazo userId 一起存在 OS keychain/DPAPI；设备级撤销是后续工作。
- 旧版只保存 token 的 session 会在升级后要求重新登录一次，以免打开错误的共享本地库。
- 客户端登录窗口支持注册和登录；V1 不建设独立 Web 产品。
- 模型供应商 key 只在服务器。
- 额度、限流和风控以 New API 为准。
- 模型网关会看到 prompt/回复；隐私政策必须说明。

## 6. 本地 runtime 和数据库

### 6.1 本地 runtime

- 运行在 Electron utility process 或独立本地进程。
- 当前运行在 Electron 主进程；utility process 拆分仍待完成。
- `@rakazo/local-runtime` 定义 Agent、store、tool 三个端口，不依赖 Prisma。
- `PiLocalAgentEngine` 复用现有的 `PiAgentRuntime`，没有复制服务器 executor。
- `shell`、`list_files`、`read_file`、`write_file` 已接入 Pi tool loop；写操作和
  shell 逐次授权，只读文件工具直接执行。浏览器工具已通过 loopback bridge 接入；
  应用启动和桌面操作待迁移。
- 预览 UI 已接收实时 run 事件并可停止当前执行；完整 Web UI 尚未接入。
- 所有高风险工具都要有授权、可见状态和停止入口。

### 6.2 本地数据库

- `better-sqlite3`（SQLite，WAL）是唯一事实来源；本地 runtime 是唯一写入口。
- 本地库和 workspace 按 Rakazo userId 放在
  `local/accounts/<sha256(userId)>/`；登录前不打开任何账号数据库，退出或切换账号时
  先取消活动 run。
- 存储 bot、thread、message、memory、routine、settings 和工具记录。
- 升级时执行迁移；失败保留备份。
- 提供导出/导入；V1 不做云端同步。
- 敏感字段和备份加密。

### 6.3 浏览器状态

- 优先使用用户现有浏览器 + 扩展，不复制 Cookie 文件。
- 扩展通过 loopback WebSocket 与 Electron runtime 通信，不开放公网监听的 CDP。
- 用户用一次性配对码连接；扩展只保存本地桥接令牌。
- 默认使用 Agent Window；已有标签页借用和归还，任务结束自动清理。
- 设置页显示实时连接状态，提供主动断开和撤销。
- 网页内容按不可信数据处理。

实现和限制见 `docs/BROWSER.md`。

## 7. Bot 模板和 prompt

模板和 prompt 是产品的一部分，但属于本地内容：

- 打包在客户端 `config/bot-templates/` 和 `config/prompts/`。
- 首次创建 bot 时 seed 到本地 SQLite。
- 模板带 `key` 和 `version`。
- 只影响新 bot，不覆盖用户编辑过的 instructions。
- 服务器以后可以下发签名的模板更新，但不保存用户 bot 数据。

每个模板至少包含：

- `key`、`version`
- 名称、标题、描述、颜色
- `instructions`
- 模型 provider/id 和 thinking level
- 禁用工具
- 可选 routine 和初始消息

prompt 不是安全边界。工具权限、审批、沙箱和本地权限要独立实现。

## 8. 构建和发布流水线

### 8.1 本地开发

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Node 版本使用 `.nvmrc` 的 24.x。当前上游仍需要 Postgres/Docker 才能跑完整服务；
local-first 改造完成后，客户端开发应尽量不依赖服务器业务库。

本地窗口预览：

```bash
RAKAZO_LOCAL_UI=1 pnpm --filter @rakazo/desktop dev
```

构建并测试浏览器扩展：

```bash
pnpm --filter @rakazo/browser-extension build
pnpm --filter @rakazo/browser-extension check
pnpm --filter @rakazo/browser-extension test
pnpm --filter @rakazo/browser-extension test:e2e
```

扩展的 `dist/` 可在 `chrome://extensions` 中通过“加载已解压的扩展程序”进行本地验证。

接真实服务器登录：

```bash
RAKAZO_LOCAL_UI=1 \
RAKAZO_SERVER_URL=https://your-api.example.com \
pnpm --filter @rakazo/desktop dev
```

客户端通过 `/api/auth/sign-in/email` 登录，session token 由 Electron `safeStorage`
加密后保存在本地；本地 runtime 再把它作为 Bearer token 调
`/v1/model/openai/chat/completions`。

开发时如果要接模型网关：

```bash
RAKAZO_LOCAL_UI=1 \
RAKAZO_MODEL_GATEWAY_URL=https://your-api.example.com \
RAKAZO_DEV_MODEL_GATEWAY_TOKEN=dev-only-token \
pnpm --filter @rakazo/desktop dev
```

`RAKAZO_DEV_MODEL_GATEWAY_TOKEN` 只用于本地开发，生产必须由登录后的 session token
替代，不能打进安装包。开发模拟器现在实现 OpenAI 兼容端点。

没有真实模型网关时，可以启动开发用模拟器：

```bash
pnpm dev:gateway
```

另一个终端：

```bash
RAKAZO_LOCAL_UI=1 \
RAKAZO_MODEL_GATEWAY_URL=http://127.0.0.1:8787 \
RAKAZO_DEV_MODEL_GATEWAY_TOKEN=dev-token \
pnpm --filter @rakazo/desktop dev
```

模拟器只做 OpenAI 兼容 SSE 回显，不会调用真实模型，也不会写任何远端数据。

### 8.2 客户端构建

```text
修改 brand/ 和 ui-tokens
  -> 生成图标和 CSS
  -> 构建 web
  -> 构建 local runtime
  -> 构建 desktop
  -> 生成安装包
```

### 8.3 服务器发布

```text
构建 API 镜像
  -> 推送自己的镜像仓库
  -> 备份控制面数据库
  -> 执行迁移
  -> 更新 API
  -> 健康检查
```

V1 服务器不需要为客户端用户运行 Agent 电脑，因此不需要 sandbox supervisor
和 computer 镜像。模型网关仍然需要高可用和限流。

### 8.4 客户端发布

```text
打版本 tag
  -> CI 构建 web + runtime + desktop
  -> macOS 签名 + notarization
  -> Windows 签名（建议）
  -> Linux AppImage
  -> 上传安装包和更新 feed
  -> 小范围发布，再全量
```

自动更新必须指向自己的仓库或更新服务器。客户端升级还要处理本地 SQLite 迁移。

更新分层见 `docs/UPDATES.md`：

- 配置、prompt、bot 模板走签名配置包，立即生效。
- runtime 后台下载，V1 下次启动生效。
- Electron/Chromium 退出时安装，必须重启。
- 数据库迁移在副本上执行，失败保留旧库。

## 9. 上游同步检查表

- [ ] `git fetch upstream`
- [ ] `git merge upstream/main`
- [ ] 依赖安装成功
- [ ] `pnpm lint`
- [ ] `pnpm check`
- [ ] `pnpm test`
- [ ] 登录、模型网关、建 bot、发消息、至少一个本地工具跑通
- [ ] 本地数据库迁移和备份可用
- [ ] 配置包签名和回滚可用
- [ ] 品牌文案和默认服务器仍正确
- [x] 安装包更新源指向 `thunderwin/rakazo`，appId 为 `com.ericbot.desktop`

## 10. 安全红线

- 客户端只放公开配置，不放长期密钥。
- 模型供应商 key 只在服务器。
- New API 负责用户额度、渠道和扣费；Rakazo 不信任客户端上报的额度，管理员
  access token 只存在服务器。
- 本地数据库和备份加密。
- 浏览器扩展只响应用户发起的本地任务，不后台遍历页面；页面正文进入模型前仍受任务意图约束。
- 本地 `shell` 已改为逐次审批；仍需补齐任务停止入口和更细的工具策略。
- 遥测只回传元数据，默认不回传对话正文和文件内容。

## 11. 待确认

- 品牌名、Logo、主色和域名
- 登录方式：邮箱密码、邀请码、OIDC/SSO
- 模型供应商、模型列表和定价
- 充值/额度单位（token、次数或积分）
- 首发平台：macOS、Windows、Linux
- 首批 bot 模板的名称、prompt 和可用工具
- 浏览器扩展的首发渠道（Chrome Web Store / 企业安装）
