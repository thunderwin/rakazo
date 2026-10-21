# Client Control Plane 和内部管理页

> 状态：最小可用控制面已实现。核实日期：2026-10-21。

## 1. 已实现

- 多组织数据模型复用 Better Auth 的 Organization/Member。
- 一个账号可以加入组织；客户端不做组织切换器。
- 平台管理员可以创建组织并指定已有账号作为 owner。
- Organization owner/admin 可以管理成员、发布 Client Manifest。
- `/admin` 直接编辑并管理企业 Knowledge 和 Skills；Bot 模板、群组、Routines 和功能策略
  仍放在高级 manifest JSON 中。
- `/admin` 默认中文，并提供同页登录表单；平台管理员和企业管理员共用界面，由服务端
  返回的组织列表和操作权限区分能力。
- `featurePolicy.disabledTools` 通过高级 Manifest JSON 编辑。客户端会实际执行该策略，
  并与每个 Bot 自己的 `disabledBuiltinTools` 合并。
- Client Manifest 版本递增，保存内容 hash、发布时间和 Ed25519 签名。
- 每次管理操作写入 `control_plane_audits`。
- 内部管理页：`/admin`。
- Admin SPA 源码位于 `apps/admin`；API 只托管 `apps/admin/dist` 并提供控制面 API。

管理页布局（核实日期：2026-10-21）：

- 平台管理员默认优先选择企业组织；Better Auth 自动生成的大量 `Personal` 工作区
  收进默认折叠的“个人工作区”分组，避免抢占主视图。
- 侧栏同时显示组织名称、slug 和成员数；新建企业使用渐进展开表单。
- 成员邀请使用可见的“邀请邮箱 / 角色”标签；窄屏下表单与资源卡片转为单列。
- 移除成员需要第二次确认，并在可访问名称中同步切换为“确认移除”。
- 企业内容统一使用“知识库 / 技能”中文名称；空状态说明下一步操作。

## 2. 角色

| 角色                 | 来源                             | 能力                          |
| -------------------- | -------------------------------- | ----------------------------- |
| `platform_admin`     | `DeploymentSettings.ownerUserId` | 创建组织；管理所有组织        |
| organization `owner` | Better Auth Member role          | 管理本组织、管理员和 manifest |
| organization `admin` | Better Auth Member role          | 管理成员、发布 manifest       |
| `member`             | Better Auth Member role          | 只读取自己组织的 manifest     |

第一版没有复杂部门树、审批流或单独的平台管理员列表。部署中的首个用户成为
`platform_admin`。

可选的服务器配置 `PLATFORM_ADMIN_EMAILS` 接受逗号分隔的邮箱列表，用于在不替换部署
owner 的情况下增加平台管理员。该配置只在服务端读取，普通客户端无法设置。本地开发测试
账号使用 `platform-admin@ericbot.test`；真实凭证只保存在 Git 忽略的
`TEST_ACCOUNTS.local.md`。

## 3. Manifest

`ClientManifestContent` 包含：

- bot templates。
- group presets。
- Knowledge documents。
- Skills。
- Routines。
- feature policy。
- minimum client version。

发布流程：

```text
管理员编辑企业 Knowledge / Skills
  （其他 preset 可选高级 JSON）
  -> schema 校验
  -> version + 1
  -> SHA-256 hash
  -> Ed25519 signature
  -> 保存 client_manifests
  -> 写入 audit
```

Knowledge 和 Skills 使用结构化卡片编辑，至少包含稳定 key、展示名称和正文；Skills 正文
必须是有效 `SKILL.md`。Skill 卡片还可以添加脚本文件，设置相对路径、Node/Python/Shell
运行时、1–120 秒超时和联网声明；辅助文件可选择“辅助文件”，不会作为入口直接执行。
服务端发布后，员工客户端通过签名 Manifest 自动同步为 `source=managed` 的只读本地缓存。
客户端的 `skill_run` 每次仍需员工本地批准，不会在同步时自动执行脚本。

工具策略通过高级 Manifest JSON 编辑：

```json
{
  "featurePolicy": {
    "disabledTools": ["shell", "computer_act"],
    "allowComputerUse": false
  }
}
```

客户端仍必须有对应的代码工具；该策略只能禁用，不能远程创建或下发原生工具实现。

客户端请求：

```text
GET /v1/client/manifest
Authorization: Bearer <Better Auth session>
```

返回 `{ manifest: ClientManifestEnvelope | null }`。

如果账号有多个已发布 manifest 但没有 active organization，接口返回 409；V1 客户端不提供
组织选择。

## 4. 客户端同步

- 登录并启动本地 runtime 后立即拉取一次。
- 之后每 5 分钟静默拉取。
- 必须验证 Ed25519 签名；缺签名、公钥不匹配或内容被篡改时拒绝应用。
- 网络或服务器失败时保留上一次已验证版本。
- 服务器明确返回 `manifest: null` 时清除当前组织的托管内容。
- 应用到本地后通知 renderer 重新加载 bot/group 列表。

托管数据：

- bot/group/routine 使用 `source=managed` 和稳定 managed key。
- Knowledge/Skills 使用 `source=managed`。
- 用户创建的 bot、群、聊天、Memory、附件、Knowledge 和 Skills 不受影响。
- Managed bot/group/routine 在客户端只读；可以查看，routine 可以手动运行。

## 5. 签名配置

服务端只保存私钥：

```bash
CLIENT_MANIFEST_PRIVATE_KEY=<base64 PKCS#8 DER Ed25519 private key>
```

客户端或打包环境需要对应公钥：

```bash
RAKAZO_CLIENT_MANIFEST_PUBLIC_KEY=<base64 SPKI DER Ed25519 public key>
```

生成样例：

```bash
openssl genpkey -algorithm ED25519 -out manifest-private.pem
openssl pkcs8 -topk8 -nocrypt -in manifest-private.pem -outform DER | base64
openssl pkey -in manifest-private.pem -pubout -outform DER | base64
```

私钥不得进入仓库、客户端、日志或浏览器。产品打包前需要把公钥安全注入桌面构建配置。

本地开发或 API 镜像需要先构建 Admin SPA：

```bash
pnpm --filter @rakazo/admin build
pnpm --filter @rakazo/api start
```

独立 Vite 开发服务使用 `pnpm --filter @rakazo/admin dev`，默认端口 `5175`，并把
`/api` 与 `/v1` 代理到 `127.0.0.1:3100`。

## 6. HTTP 接口

| Method   | Path                                                  | 用途                    |
| -------- | ----------------------------------------------------- | ----------------------- |
| GET      | `/v1/client/manifest`                                 | 客户端拉取签名 manifest |
| GET      | `/admin`                                              | 内部管理页              |
| GET      | `/v1/admin/control/me`                                | 当前管理员和可见组织    |
| POST     | `/v1/admin/control/organizations`                     | platform admin 创建组织 |
| GET/PUT  | `/v1/admin/control/organizations/:id/manifest`        | 查看/发布 manifest      |
| GET/POST | `/v1/admin/control/organizations/:id/members`         | 列出/添加成员           |
| DELETE   | `/v1/admin/control/organizations/:id/members/:userId` | 移除成员                |

管理写请求拒绝跨 origin 浏览器调用。所有响应不包含 session token、API key 或 provider
正文。

## 7. 尚未实现

- 独立 `admin.example.com` 部署和 MFA。
- 组织停用、删除、转移 owner。
- 发布审批流和双人复核。
- manifest 分页、diff 和回滚 UI。
- 企业 Knowledge 服务端检索。
- 用量/错误监控面板。
