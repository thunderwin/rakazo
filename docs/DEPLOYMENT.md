# ericBot 上线与持续交付方案

> 状态：单机预发布环境已部署；尚未形成正式生产 release。核实日期：2026-10-21。
>
> 本文只把已经核实的现状、计划中的架构和仍需验证的事项分开记录。域名、账号、机器或
> secret 的任何实际值都不应提交到仓库。

## 1. 决策摘要

首发采用以下架构：

| 层           | 首发选择                                           | 原因                                                                  |
| ------------ | -------------------------------------------------- | --------------------------------------------------------------------- |
| Edge         | Cloudflare                                         | DNS、TLS、WAF、限流、Access、R2 和下载分发                            |
| 服务器执行面 | DigitalOcean Droplet                               | 现有 API 是长运行 Node/Postgres/Worker 服务，直接迁移到 Worker 风险高 |
| 数据库       | DigitalOcean Managed PostgreSQL                    | 控制面数据和凭据密文不应只依赖单机容器卷                              |
| New API      | 使用运营方已有部署                                 | 已由产品所有者确认可用，Rakazo 只通过服务器端配置接入                 |
| Admin        | `api.example.com/admin`                            | 当前代码是固定 `/admin/` 的同 origin 页面                             |
| Mac          | Developer ID 直接分发                              | 本地 shell、文件和浏览器能力不适合依赖 Mac App Store 沙箱             |
| 浏览器扩展   | Chrome Web Store 首发，Edge Add-ons 随后           | 消费级安装不能由桌面端静默完成                                        |
| 下载与更新   | R2 + Cloudflare 域名，GitHub Releases 作为构建来源 | 减少中国大陆访问 GitHub 的不确定性                                    |
| Agent 执行   | 用户桌面客户端                                     | V1 服务器不运行 Agent，也不保存对话正文                               |

首发不使用 Cloudflare Workers 承载 Rakazo API。当前服务依赖 Hono Node server、Postgres、
Prisma migration 和 Graphile Worker；在 Cloudflare Worker 中重建会扩大上线风险，也不会改善
模型供应商连接。Cloudflare 只承担边缘和控制面保护。

## 2. 已核实现状

### 2.1 域名和云账号

部署前应只读确认域名 zone、TLS 模式和云账号权限。任何真实域名、账号 ID、机器名称或计费
信息只保存在私有运维记录中，不写入本仓库。生产部署应新建独立资源，不复用用途未确认的机器。

### 2.2 源码和发布链路

- 当前功能分支已有本地提交，但尚未形成带版本 tag、可追溯 digest 和完整验收记录的生产
  release；不能直接以工作区状态作为生产来源。
- 服务端已有单 VM 生产 Compose、Caddy、备份、迁移和回滚基础，见
  [self-host.md](./self-host.md)。
- 服务端镜像 workflow 已生成多架构 GHCR 镜像，并包含 SBOM、provenance 和
  source-addressed tag，见 [publish-server-image.yml](../.github/workflows/publish-server-image.yml)。
- Mac workflow 已支持 universal 构建、Developer ID 签名、公证、staple 和原生模块验证，
  但目前同时构建 Linux，见 [release-desktop.yml](../.github/workflows/release-desktop.yml)。
- 桌面自动更新通过 `electron-updater` 读取 GitHub Releases 的 `latest-mac.yml`，见
  [apps/desktop/package.json](../apps/desktop/package.json)。
- Admin SPA 由 API 从 `/admin/` 提供，管理写请求目前拒绝跨 origin 调用，见
  [client-control-plane-http.ts](../apps/api/src/client-control-plane-http.ts)。
- 浏览器扩展已有构建和本地 E2E，但没有正式发布 workflow、商店材料、固定 ID 或公开隐私
  说明，见 [BROWSER.md](./BROWSER.md)。
- New API fork 已实现 `POST /api/user/:id/token`，但对应改动仍未提交；生产镜像必须从
  干净提交构建，不能发布当前未跟踪的本地二进制。
- 产品所有者于 2026-10-21 确认 New API 已部署并可用。公网状态端点只读检查返回 HTTP 200；
  为遵守公开仓库不记录私有生产 URL 的规则，本文不写入实际地址。
- 官网已有 Privacy、Terms 和 Support 页面，但部分品牌和法律链接仍指向上游 Rakazo，需要
  替换后再公开。

## 3. 区域选择与网络证据

### 3.1 网络测量方法

区域选择必须使用代表性网络样本，不在公开文档记录维护者位置、私有主机地址或具体运营商
测量明细。至少测量 TCP 连接、TLS 完成、首字节和持续 SSE，并分别覆盖用户到 API、API 到
New API 两段链路。原始样本保存在私有运维记录中。

### 3.2 建议

当前代表性样本显示，新加坡暂不推荐，连接时间和持续流稳定性落后于美西候选。

现有 New API 位于德国后，最终选择需要看完整链路，而不是只看用户到 Rakazo 的一段：

```text
用户 -> Rakazo API -> New API -> 模型供应商 -> New API -> Rakazo API -> 用户
```

两个候选：

| 候选 | 用户到 Rakazo           | Rakazo 到 New API                | 结论                                 |
| ---- | ----------------------- | -------------------------------- | ------------------------------------ |
| SFO3 | 当前用户侧最快          | 跨大西洋，约多一次长距离网络跳转 | 用户入口最优，但完整流式链路未必最优 |
| FRA1 | 比 SFO3 慢约 100–200 ms | 与 New API 都在德国，距离最短    | 可能减少流式响应中的二次跨境         |

首轮生产开始前，必须用真实模型流分别测试 SFO3 和 FRA1，比较：

- 登录和普通 API 的 P50/P95。
- 从发送消息到收到第一个 token 的时间。
- 连续 token 的间隔和 SSE 中断率。
- 20–60 秒长回答的完成时间和丢包。
- 高峰与晚间的稳定性。

在这些测试完成前，不把 SFO3 写成最终区域。初步排序为 **FRA1/SFO3 二选一，SGP1 暂不推荐**。
如果真实模型流差异很小，优先 FRA1，因为它减少 Rakazo 与 New API 之间的一次跨洲往返。

正式购买生产资源前再做一轮 3–5 天、多时段验证：

- 中国大陆样本至少覆盖电信、联通、移动三条线路。
- 每个 DigitalOcean 候选区域测试 ICMP、TCP/TLS、HTTP 首字节和持续 SSE。
- 同时测试用户到 `api` 以及服务器到模型供应商的连接。
- 样本优先来自真实潜在用户，而不是只测维护者当前网络。

如果多用户结果表明 SGP1 更适合大多数中国大陆用户，再重新评估 SGP1。首发不要同时做双区域
主写，因为用户数据库和 New API 状态没有现成的多区域复制设计。

## 4. 生产拓扑

```text
                         Cloudflare
       DNS / TLS / WAF / Rate Limit / Access / R2
                            |
          +-----------------+---------------------+
          |                 |                     |
 api.example.com   dl.example.com      www.example.com
          |                 |               privacy / terms / support
          v                 v
 DigitalOcean FRA1/SFO3 Cloudflare R2
 +------------------+         |
 | Caddy            |         +-- Mac DMG / ZIP
 | Rakazo API       |         +-- latest-mac.yml
 | Rakazo Worker    |         +-- extension ZIP
 | Admin SPA        |         +-- encrypted backups
 +--------+---------+
          | private network
 +--------v---------+
 | Managed Postgres |
 +------------------+

 +--------------------------+
 | Existing New API service |
 | Operator-managed, in DE  |
 +--------------------------+
          ^
          | HTTPS from Rakazo API only
          +-- Rakazo API
```

首发资源建议：

| 资源               | 规格               | 说明                                                    |
| ------------------ | ------------------ | ------------------------------------------------------- |
| Rakazo Droplet     | `s-4vcpu-8gb-amd`  | API、Worker、Caddy 和同机 PostgreSQL；当前约 56 美元/月 |
| Managed PostgreSQL | 按控制面规模选择   | Rakazo 账号、组织、映射和审计数据                       |
| Block Storage      | 50 GB 起           | `/data`、备份暂存和服务器端文件                         |
| Staging            | 独立小规格 Droplet | 使用独立数据库或同集群独立 database                     |
| R2                 | 按量               | 客户端安装包、更新、扩展和加密备份                      |

Droplet 价格来自 2026-10-21 的 DigitalOcean 区域报价；数据库、带宽和存储以创建页面为准。
New API 已存在，其服务器和数据库费用不计入本方案新增成本。当前 Rakazo Droplet 为约
56 美元/月，外加备份和带宽，不含模型调用费用、Apple 年费和商店费用。

## 5. 域名和路由

| 域名                    | 用途                                           | 首发状态 |
| ----------------------- | ---------------------------------------------- | -------- |
| `api.example.com`       | API、登录、模型网关、Client Manifest、`/admin` | 使用     |
| `dl.example.com`        | Mac 安装包、更新元数据、扩展包                 | 使用     |
| `www.example.com`       | 官网、下载、Privacy、Terms、Support            | 使用     |
| `example.com`           | 301 到 `www`                                   | 使用     |
| 运营方现有 New API 域名 | 仅服务器端接入，不写入客户端                   | 已存在   |
| `admin.example.com`     | 独立 Admin SPA                                 | 后续     |
| `status.example.com`    | 状态页                                         | 后续     |

### 5.1 为什么首发不拆 Admin 域名

当前 Admin 的 Vite base 是 `/admin/`，SPA 发起的登录和管理请求也是同 origin 路径。
直接增加 `admin.example.com` 会同时影响：

- Better Auth 的 cookie domain 和 trusted origins。
- CORS。
- 管理写请求的 origin 校验。
- 反向代理的 Host 头。
- Cloudflare Access 的 cookie 和登录跳转。

首发使用 `api.example.com/admin`。以后要拆独立域名时，应作为一项有测试覆盖的安全改动，
而不是只增加 DNS 记录。

### 5.2 Cloudflare 路由

- `api`、`www` 和自定义下载域名启用代理。
- TLS 使用 Full (strict)。
- `/api/*`、`/v1/*` 和 `/admin/*` 禁止缓存。
- `/v1/model/openai/*` 必须验证 SSE 流式转发，不允许边缘或 Caddy 缓冲完整响应。
- API-only 入口由 [Caddyfile.api.prod](../infra/compose/Caddyfile.api.prod) 提供，
  `/v1/*` 使用立即 flush，非 API/Admin 路径返回 404。
- `/admin*` 和 `/v1/admin/*` 使用 Cloudflare Access，只允许所有者或指定平台管理员。
- Origin 防火墙只接受 Cloudflare 地址，避免攻击者绕过 WAF 直连。
- 登录、注册和模型接口分别设置限流。

## 6. 四个组件的上线流程

### 6.1 服务器 API

1. 新建独立 DigitalOcean 项目、VPC、Droplet、Managed PostgreSQL 和 Volume。
2. 先创建 owner 和平台管理员，再开放服务。
3. 运行 `infra/compose/harden-host.sh`，启用 key-only SSH、UFW、fail2ban、AppArmor 和
   自动安全更新。
4. 生产配置至少设置：
   - `NODE_ENV=production`
   - `BETTER_AUTH_URL=https://api.example.com`
   - `WEB_ORIGIN=https://api.example.com`
   - `API_URL=https://api.example.com`
   - `RAKAZO_HOST=api.example.com`
   - `SIGNUPS_ENABLED=true`
   - `SIGNUP_ALLOWLIST=<首发白名单>`
   - `SANDBOX_PROVIDER=none`
   - `PRIVACY_POLICY_URL=https://www.example.com/privacy/`
5. 配置 SMTP、`EMAIL_FROM`、SPF、DKIM 和 DMARC。
6. 用服务器端环境变量配置现有 New API，并配置 Ed25519 Client Manifest 签名。
7. 部署后用真实 Desktop Session 完成登录、模型流和 Manifest 拉取。

Server 不启动 Docker sandbox、E2B、桌面截图或 Agent 执行。V1 的 Agent、文件和浏览器工具
都留在客户端。

### 6.2 Admin

- 首发地址为 `https://api.example.com/admin`。
- Cloudflare Access 负责额外身份门禁；Admin 自身登录继续保留。
- 管理员必须使用独立账号，并开启账号供应商支持的 MFA。
- 每次 manifest 发布记录版本、hash、签名和审计事件。
- Admin 页面不提供员工对话正文、shell 输出或浏览器内容。
- 发布操作必须在 staging 先验证 manifest 可在客户端同步和回退。

### 6.3 New API 和模型网关

New API 已由运营方单独部署，本方案不要求把它迁移到 `example.com`。Rakazo 只通过服务器
端配置读取 `NEW_API_BASE_URL`、管理员 token 和管理员 user id。

1. 提交并测试本地 New API fork 中的管理员建 token 接口，使源码与已部署版本一致。
2. 在 Rakazo 生产 `.env` 中配置现有 New API，不把地址或 token 下发客户端。
3. 从 Rakazo Droplet 验证到 New API 的 TLS、DNS、出口稳定性、超时和 SSE。
4. 验证首次请求懒创建用户和 token、并发请求只创建一次、额度错误映射和客户端断开取消。
5. 保留 New API 自身已有的高可用、数据库、Redis、备份和管理入口方案。
6. 确认 `DEBUG` 关闭，完整 New API key 不得进入 Rakazo 或 New API 日志。
7. 确认 Rakazo 所在区域到 New API 的真实模型流优于其他候选区域。

协议见 [MODEL_GATEWAY.md](./MODEL_GATEWAY.md)。

### 6.4 Mac 桌面端

首发采用 Developer ID 直接分发，不使用 Mac App Store。

构建要求：

- Apple Developer Program。
- Developer ID Application 证书和密码。
- App Store Connect API key、Key ID、Issuer ID。
- `com.ericbot.desktop` 永久稳定。
- DMG 和自动更新 ZIP。
- universal 包同时覆盖 Intel 和 Apple Silicon。

GitHub Environment secrets 使用：

- `DESKTOP_MAC_CSC_LINK`
- `DESKTOP_MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_P8`

首发前必须修改：

- 发布矩阵只生成 Mac，Windows/Linux 延后。
- Release 标题从 Rakazo 改为 ericBot。
- 替换临时图标和上游品牌资源。
- 官网下载链接指向正式安装包。
- 在干净 Intel 和 Apple Silicon Mac 上各做一次安装与升级测试。

Mac 安装包不能在后台静默安装浏览器扩展。首次启动应允许用户继续使用本地工具，并在需要
浏览器能力时引导安装扩展。

### 6.5 浏览器扩展

建议顺序：

1. Chrome Web Store Trusted Testers。
2. 与 Desktop beta 做真实配对、网页观察、点击、输入和撤销测试。
3. Chrome 公开发布。
4. Edge Add-ons 发布。

发布材料必须包含：

- 单一用途说明。
- `tabs`、`scripting`、`storage`、`alarms` 和全站点权限的逐项解释。
- 隐私政策、支持 URL、截图和测试步骤。
- 不读取或导出 Cookie、不执行远程代码、不收集页面正文用于广告的明确说明。
- 固定正式扩展 ID。
- 生产包排除 sourcemap。
- 桌面和扩展之间的协议版本握手。

CI 新增 `extension-vX.Y.Z` 标签：

- 校验 manifest version。
- 执行 check、unit test 和真实 Chromium E2E。
- 生成 ZIP 和 SHA256。
- 上传 draft release。
- 经人工确认后提交 Chrome/Edge 商店。

## 7. 持续集成与持续部署

| 触发                   | 动作                                                                                      | 生产                   |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------- |
| Pull Request           | lint、typecheck、unit、Postgres integration、Web/Desktop E2E、Extension E2E、镜像构建验证 | 否                     |
| 合并 `main`            | 发布 server `edge` 镜像、部署 Staging、构建 extension snapshot                            | 否                     |
| `vX.Y.Z`               | 发布稳定 server image 和 Mac artifact、生成 SBOM/attestation                              | 人工审批               |
| `extension-vX.Y.Z`     | 构建扩展 ZIP 并提交商店                                                                   | 人工审批               |
| New API 变更           | 由运营方现有发布流程独立管理                                                              | 不在 Rakazo 发布链路内 |
| Admin manifest publish | 版本、hash、签名和审计写入                                                                | 业务即时生效           |

### 7.1 服务端部署

1. 从干净 `main` 构建镜像。
2. 发布 `sha-<commit>`，再生成稳定 semver tag。
3. Staging 自动部署该 digest 并运行 smoke。
4. Production 使用 GitHub protected environment 人工批准。
5. 备份数据库并记录当前 image digest。
6. 在 pre-deploy job 中只执行一次 Prisma migration。
7. 使用 expand/contract migration，禁止同一版本先删旧字段。
8. 拉取固定 digest，重启 API 和 Worker。
9. 验证 `/health`、登录、Manifest、模型流和 New API。
10. 失败时恢复 previous digest；数据库按前向修复或恢复已验证备份。

不要把 `latest` 或移动中的 `edge` 作为 Production 部署目标。现有 updater sidecar 可以保留
作为运维工具，但首发 CI 不应让服务器在每次 `main` push 时自行更新。

### 7.2 桌面端发布

1. 更新 desktop version 和 CHANGELOG。
2. 合并到 `main`。
3. 创建与之匹配的 stable tag。
4. CI 构建、签名、公证、staple 和验证。
5. 先以内测安装包验证升级。
6. 发布 stable artifact。

当前 electron-updater 只支持稳定 channel，没有 Staged Rollout。首发要依靠内部 beta 和严格
验证降低风险；需要灰度时再增加独立 beta feed。

### 7.3 更新分发

推荐最终结构：

```text
dl.example.com/desktop/stable/latest-mac.yml
dl.example.com/desktop/stable/ericBot-<version>-universal.dmg
dl.example.com/desktop/stable/ericBot-<version>-universal-mac.zip
dl.example.com/desktop/stable/SHA256SUMS
```

要求：

- 版本文件不可覆盖。
- `latest-mac.yml` 由 CI 原子切换。
- ZIP 和 DMG 必须带有效 Developer ID 签名。
- R2 写权限只给发布流水线。
- 保留所有旧安装包用于回滚和审计。
- 客户端验证更新失败时继续使用当前版本。

如果首轮仍使用 GitHub Releases，应明确这是临时方案；中国大陆长期使用 GitHub 更新会增加
失败风险。

## 8. 更新与回滚

### 8.1 服务器

- 固定 image digest。
- 保留上一版镜像。
- migration 前备份并记录恢复点。
- 不自动回滚数据库 schema。
- 使用向后兼容迁移让旧 API 能在新 schema 上运行。

### 8.2 Electron

- 后台下载，不阻塞当前 Agent run。
- 退出时安装。
- 不支持降级。
- 严重问题时发布更高 patch 恢复旧行为。
- 不把 runtime 热更新描述成已实现；当前只有签名 Client Manifest 热更新。

### 8.3 浏览器扩展

- 商店自动更新受 Chrome/Edge 控制。
- Desktop 保持对最近几个 extension 版本的兼容。
- 协议不兼容时显示明确升级提示，而不是静默失败。
- 保留每个提交商店的 ZIP 和 release notes。

## 9. 安全、备份和监控

### 9.1 Secrets

- `BETTER_AUTH_SECRET`、`ENCRYPTION_KEY`、`SCREEN_PROXY_SECRET`、
  `CLIENT_MANIFEST_PRIVATE_KEY` 和 New API admin token 必须是独立值。
- 服务器 `.env` 权限为 `0600`，不进入 Git、镜像或日志。
- Mac 签名文件和商店 API token 只存在 GitHub protected environment。
- 客户端只包含公开 server URL 和 Client Manifest 公钥。
- 不把管理员 token、数据库密码、模型供应商 key 或 New API 用户 key 打进客户端。

### 9.2 备份

- Managed PostgreSQL 自动备份。
- 每日逻辑备份。
- 确认 New API Postgres 和 Redis 已有每日备份及恢复演练；其备份属于运营方现有服务责任。
- 本地验证后加密上传 R2。
- 保留 7 日、4 周、3 月。
- 每月在空环境做一次恢复演练。
- 目标 RPO 15 分钟、RTO 2 小时。

### 9.3 监控

最低指标：

- API 5xx、P95 延迟和 SSE 中断率。
- 登录失败、注册失败和 Rate Limit。
- 模型 402/429/502、首 token 延迟和渠道健康。
- Worker 队列积压和 job 失败。
- Postgres 连接数、慢查询、存储和备份年龄。
- New API 余额、渠道、用量和成本。
- Desktop 崩溃率、启动失败和更新失败。
- Extension 配对、重连、页面观察和动作失败。

不采集 prompt、模型回复、shell 输出、页面正文、Cookie 或完整凭据。诊断信息必须脱敏并经
用户确认后才上传。

## 10. 上线顺序和验收

### 阶段 0：代码可发布

- 提交当前功能分支。
- 通过 lint、typecheck、unit、integration 和 E2E。
- 提交 New API token 接口，使本地源码与已部署版本一致。
- 替换上游品牌和法律链接。
- 补齐 Rakazo 部署和扩展发布 workflow。

### 阶段 1：Staging

- 部署 Cloudflare、DigitalOcean 和托管数据库。
- 完成真实登录、模型网关、Manifest、Admin 和备份恢复。
- 对中国大陆多运营商线路做 3–5 天区域验证。

### 阶段 2：客户端内测

- Mac signed beta。
- Chrome Trusted Testers。
- 从旧版本升级到新版本。
- 完整验证本地工具、浏览器工具、停止、崩溃恢复和撤销权限。

### 阶段 3：小范围公开

- 10–20 个真实用户。
- 白名单注册。
- 每日检查错误率、模型成本、更新成功率和用户反馈。

### 阶段 4：公开发布

- 开放有限注册。
- 发布官网下载页。
- 发布 Chrome 扩展。
- 开启稳定更新节奏。

上线验收必须全部满足：

- 干净 Mac 可安装、启动、登录和完成模型流。
- 新账号只映射到一个 New API 用户和 token。
- New API 完整 key、session token 和数据库密码不出现在日志。
- shell 和写文件仍要求审批。
- 浏览器扩展需配对，Stop 后关闭 Agent Window 并清理会话。
- Admin 在不经过 Cloudflare Access 和平台登录时不可写。
- Client Manifest 签名失败时客户端拒绝应用并保留旧版本。
- Server migration 失败时旧服务仍可启动并已保留备份。
- 备份能从空环境恢复。
- Desktop 自动更新失败不会破坏当前安装。

## 11. 首发阻塞项

以下事项未完成前不应公开生产服务：

1. 当前工作区尚未形成干净、可复现的 release commit。
2. New API 虽已部署，但本地 fork 的管理员建 token 接口仍未提交；需要先让源码与生产一致。
3. 独立 Admin 域名尚未支持；首发必须使用同 origin `/admin`。
4. Desktop release 仍构建 Linux，且 release 标题和部分品牌仍是 Rakazo。
5. Browser Extension 没有正式发布 workflow、商店材料、固定 ID 和隐私说明。
6. Server Production 仍缺少 Staging、固定 digest、备份前置和人工审批链路。
7. 区域尚未完成多运营商、多时段验证。
8. 尚未完成一次从空环境恢复和一次真实版本升级。

## 12. 当前结论

当前私有测量显示，SGP1 暂不推荐。SFO3 的用户侧入口通常更快，但若现有 New API 位于欧洲，
Rakazo 放在 SFO3 会增加一次跨洲传输；FRA1 可能缩短完整流式链路。公开文档不记录原始
线路数据和私有主机位置。

产品所有者已选择先部署 SFO3。当前环境仍要在真实登录、真实模型流和 20–60 秒长回答测试后
才能决定是否长期保留，FRA1 继续作为对照候选。

无论最终选择哪个区域，首发都保持单区域、单主库和明确备份恢复点，不在没有数据复制方案的
情况下同时建设双活。

## 13. 当前 SFO3 预发布部署

截至 2026-10-21，存在一个受 Cloudflare Access 保护的单机预发布环境。健康检查、鉴权和
管理员入口已做只读验证；真实域名、区域、机器规格、资源名称、备份时间和网络测量只保存在
私有运维记录中。

当前未完成：

- New API 地址已确认可用，但 Rakazo 生产环境还没有完成管理员 token 和 admin user id
  配置，因此模型网关尚未验收。
- 尚未完成正式 owner 登录和注册白名单验收。
- 只做了本机备份，尚未配置 R2 异地备份。
- 当前预发布镜像不能视为可追溯的正式 release；正式版本必须从带 tag 的干净提交构建。
- Mac 客户端尚未绑定该服务器和 Client Manifest 公钥。

### 打包测试客户端

未签名的内部测试包可以使用：

```sh
RAKAZO_BUILD_SERVER_URL=https://api.example.com \
RAKAZO_BUILD_CLIENT_MANIFEST_PUBLIC_KEY="<服务器上的 SPKI 公钥>" \
pnpm --filter @rakazo/desktop pack:mac:preview
```

该命令只生成用于本机 QA 的 `.app`，不能代替签名、公证和正式 DMG。Finder
启动的安装包没有开发 shell 的运行时环境，因此服务器地址和 manifest 公钥必须在构建时写入。

同事测试前还需要：

- Apple Developer `Developer ID Application` 证书。
- App Store Connect API key、Key ID 和 Issuer ID。
- 稳定版本号和 CHANGELOG。
- 在 Apple Silicon 与 Intel 至少各一台干净 Mac 上安装、登录、升级和卸载测试。
- 通过密码管理器分发测试账号，不把账号密码写进安装包、README 或聊天记录。
