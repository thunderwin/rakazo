# Fork 与品牌化流水线

> 状态：初始化文档。品牌名、域名、登录方式和 bot 模板内容仍待确认。
> 本文中的“当前代码”指本仓库从上游同步到的实现；“计划”表示尚未落地。

## 1. 为什么 fork

这个 fork 的目标不是重写 Rakazo，而是把上游的 Agent 平台包装成自己的产品：

- 自己的品牌、图标、颜色和安装包
- 自己的服务器地址和登录入口
- 自己的默认 bot 模板、prompt 和工具策略
- 自己的发布和更新渠道

上游仍然提供核心能力：Web UI、Electron 壳、API、Agent runtime、sandbox 和
电脑工具。这样可以在获得上游修复的同时，保持自己的产品层。

## 2. 远端和分支

```text
origin    https://github.com/thunderwin/rakazo.git
upstream  https://github.com/elie222/rakazo.git
```

推荐约定：

- `main` 跟踪自己的产品主线。
- `upstream/main` 只用于同步，不直接发布。
- 每次同步使用 merge，不要 rebase 已经发布的提交。

同步命令：

```bash
git fetch upstream
git merge upstream/main
pnpm install --frozen-lockfile
pnpm lint
pnpm check
pnpm test
```

如果冲突集中在品牌文件，说明分层是健康的；如果每个文件都在冲突，说明对上游核心的
修改过多，需要把定制收回到配置层。

## 3. 代码分区

新增或维护以下目录：

```text
brand/                    品牌源文件
config/bot-templates/     bot 模板和默认配置
config/prompts/           产品级 prompt（可选）
scripts/                  品牌生成、模板 seed 等脚本
docs/                     架构和 fork 说明
```

原则：

- 能在配置层解决的，不改核心代码。
- 能在服务端解决的，不写进客户端。
- 必须改上游文件时，改动尽量小，并在本文记录原因。
- 不手动修改生成文件；修改源文件后重新生成。

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

### 4.2 服务端

- `WEB_ORIGIN`、`API_URL`、`AUTH_URL`
- `SIGNUPS_ENABLED` 和 `SIGNUP_ALLOWLIST`
- OIDC/SSO（如启用）
- 默认 Space、角色和 bot 模板
- `shell` 审批规则和本机电脑开关
- 模型凭据和 sandbox provider

### 4.3 不要改的东西

- 不要重命名内部存储 key（例如 `rakazo.*`），除非同时做迁移。
- 不要把品牌名写进 API 契约或数据库枚举。
- 不要在客户端放管理员 token、数据库密码或共享用户密码。
- 不要为了品牌化复制整套 UI 代码。

## 5. 默认服务器和登录

目标体验：

```text
下载安装
  -> 客户端读取内置 serverUrl
  -> 打开服务器的登录页
  -> 用户注册或登录
  -> Electron 保存 session cookie
  -> 下次启动直接进入
```

实现方式：

1. 增加构建时配置，例如 `RAKAZO_DEFAULT_SERVER_URL`。
2. 修改 `resolveStartupTarget`：没有保存配置时返回默认服务器，而不是 setup。
3. 托管版本隐藏“Change Server”，保留 `RAKAZO_FORCE_SETUP=1` 作为支持入口。
4. 服务器保持正常注册策略；如果要限制用户，使用 allowlist。
5. 不内置管理员 token；每个用户使用自己的账号和 session。

相关代码：

- `apps/desktop/src/setup-config.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/setup-store.ts`

## 6. Bot 模板和 prompt

### 6.1 v1：配置文件 + seed 脚本

适合先上线。每个模板是一个 JSON 文件，例如：

```json
{
  "key": "researcher",
  "version": 1,
  "name": "Researcher",
  "title": "Research and verification",
  "description": "Finds sources, checks claims, and reports conclusions.",
  "instructions": "You are a careful researcher...",
  "color": "blue",
  "modelProvider": "openrouter",
  "modelId": "your-model-id",
  "thinkingLevel": "medium",
  "disabledBuiltinTools": ["shell"],
  "routines": []
}
```

seed 脚本要求：

- 幂等：重复执行不会创建重复 bot。
- 只影响新用户或新 bot，不覆盖用户已经修改的 instructions。
- 模板带 `key` 和 `version`，方便追踪。
- 失败时不留下半成品；最好使用事务。

### 6.2 v2：数据库模板和管理界面

当模板数量增加、需要运营后台时，增加 `BotTemplate` 表和 RPC：

- 模板列表、启用/停用
- 模板版本
- 对哪些用户或 Space 可见
- 从模板创建 bot
- 用户主动“恢复模板”

模板字段可以包含：

- 名称、标题、描述、颜色
- `instructions`
- 模型 provider/id、thinking level
- `disabledBuiltinTools`
- 默认 routine
- 初始消息或欢迎语

### 6.3 prompt 放置原则

- **单个 bot 的角色和行为**：放在模板的 `instructions`，创建后写入 `bot.instructions`。
- **产品级全局规则**：放在服务端 prompt 文件或单一注入点，不要散落在 UI。
- **安全策略**：不要只靠 prompt；用工具开关、审批规则、角色和 sandbox 隔离。

## 7. 构建和发布流水线

### 7.1 本地开发

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm dev
```

需要 Node 22.22.2+、24.x 或 26+，以及 Docker。

### 7.2 品牌构建

```text
修改 brand/ 和 ui-tokens
  -> 生成图标和 CSS
  -> 构建 web
  -> 构建 desktop
  -> 生成安装包
```

### 7.3 服务端发布

```text
构建 API/worker/computer 镜像
  -> 推送自己的镜像仓库
  -> 备份数据库
  -> 执行迁移
  -> 滚动更新 API/worker
  -> 健康检查
```

### 7.4 客户端发布

```text
打版本 tag
  -> CI 构建 web + desktop
  -> macOS 签名 + notarization
  -> Windows 签名（建议）
  -> Linux AppImage
  -> 上传安装包和更新 feed
  -> 小范围发布，再全量
```

自动更新必须改成自己的仓库或更新服务器，否则客户端会尝试从上游更新。

## 8. 上游同步检查表

- [ ] `git fetch upstream`
- [ ] `git merge upstream/main`
- [ ] 依赖安装成功
- [ ] `pnpm lint`
- [ ] `pnpm check`
- [ ] `pnpm test`
- [ ] 登录、建 bot、发消息、shell/文件工具至少跑一遍
- [ ] 检查品牌文案和默认服务器是否仍正确
- [ ] 检查安装包更新源和 appId 是否仍指向自己

## 9. 安全红线

- 客户端只放公开配置，不放长期密钥。
- 托管用户默认不能启用本机电脑模式。
- `shell` 默认免审批；发布前必须决定是否改成强制审批或白名单。
- 每个用户独立账号；禁止共享管理员账号。
- 生产环境使用 HTTPS、可信 origin、速率限制和审计。
- 多租户部署要验证 Space 隔离和 sandbox 隔离。

## 10. 待确认

- 品牌名、Logo、主色和域名
- 用户登录方式：邮箱密码、邀请码、OIDC/SSO
- 首发平台：macOS、Windows、Linux
- 服务端部署位置和 sandbox provider
- 首批 bot 模板的名称、prompt 和可用工具
- 是否保留“本机电脑”模式给高级用户
