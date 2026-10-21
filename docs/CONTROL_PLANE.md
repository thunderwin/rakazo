# 多企业控制面与管理员面板

> 状态：架构决策，尚未实现。确认日期 2026-10-21。

## 1. 核心原则

ericBot 采用 **server-managed, client-executed**：

- 服务器负责组织、员工、团队、权限、配置、内容分发、调度和审计元数据。
- 客户端负责 Agent 循环、工具调用、浏览器操作、本地文件、对话和详细日志。
- 管理员可以远程发布 bot、群、Knowledge、Skills 和 routines。
- 员工客户端后台同步已经签名的版本，不需要手工配置。
- 服务器不接管员工的浏览器登录态、本地文件或 Agent 执行。

这不是“所有功能都运行在服务器”，而是“所有可管理功能都由服务器控制”。

## 2. 多企业模型

系统从第一天就按多租户设计，即使初期只有一个企业。

```text
Platform
  └─ Organization
       ├─ Memberships (employee + role)
       ├─ Teams
       ├─ Bot templates / Groups
       ├─ Knowledge / Skills / Routines
       ├─ Assignments
       ├─ Usage and limits
       └─ Audit metadata
```

### 2.1 用户与企业关系

- 一个用户可以在多个企业中。
- 每次客户端会话必须绑定一个明确的 `organizationId`。
- 客户端打开企业空间前必须选择或接收当前企业。
- 不同企业的数据不能混在同一个本地数据库中。
- 本地数据目录至少按 `organizationId + userId` 隔离。
- 个人使用和企业使用分成不同 workspace，不共享 bot、对话和 memory。

### 2.2 租户隔离

所有控制面表必须带 `organization_id`：

- memberships
- teams
- assignments
- published packages
- package versions
- routines
- shared memory
- usage mappings
- audit events

所有服务端查询必须从已认证 session 推导 organization，不能接受客户端任意指定其他企业。

约束：

- 唯一索引使用 `(organization_id, ...)`，不能只靠全局名称或 email。
- 跨企业访问统一返回 404，避免泄露资源是否存在。
- 对象存储路径使用独立企业前缀。
- 管理员 API、审计事件和后台任务都显式携带 organization。
- 至少实现集中的 tenant guard；Postgres RLS 可作为后续增强，不能代替应用层检查。

### 2.3 角色

第一阶段只需要：

| 角色 | 范围 | 能力 |
|---|---|---|
| `platform_admin` | 整个平台 | 创建、暂停企业管理入口；不默认读取企业内容 |
| `org_owner` | 单个企业 | 管理企业管理员、策略、额度和全部配置 |
| `org_admin` | 单个企业 | 管理员工、团队、内容和分配 |
| `team_manager` | 指定团队 | 管理本团队分配和可见范围 |
| `member` | 自己 | 使用分配内容和个人本地 bot |

`platform_admin` 和 `org_admin` 必须是不同边界。平台运营人员不应因为维护服务器就默认拥有所有企业知识库正文。

### 2.4 模型额度

如果不同企业独立结算，New API 映射不能只按 Rakazo userId：

```text
(organizationId, Rakazo userId)
  -> New API user id
  -> New API token
```

网关请求必须同时校验用户 session 和当前企业 membership。企业暂停、成员被移除或授权过期后，不能继续调用该企业的额度。

## 3. 是否需要管理员面板

需要。管理员面板不是员工客户端的一部分，也不是面向普通用户的 Web 产品。

建议建立独立的管理端：

```text
https://admin.example.com
  -> 管理员认证 + MFA
  -> 企业选择
  -> 组织/员工/团队管理
  -> 内容发布和分配
  -> 使用量、设备和审计元数据
```

它应当：

- 与员工客户端使用不同的访问入口和权限策略。
- 使用服务端 session，不依赖 Electron。
- 默认开启 MFA。
- 支持管理员操作审计。
- 不展示员工对话正文，除非企业明确启用了受控诊断上传。

### 3.1 第一阶段页面

1. 企业列表和状态：平台管理员。
2. 员工、邀请和角色：企业管理员。
3. 团队及成员。
4. Bot 模板和预置群。
5. Knowledge 文档、版本和发布。
6. Skills 清单、版本和分配。
7. Routines 定义、启用状态和归属。
8. 分配矩阵：企业/团队/员工 -> 内容包。
9. 使用量和额度摘要。
10. 客户端版本、设备登录和撤销 session。
11. 运行错误、工具元数据和诊断上传请求。
12. 发布历史、回滚和功能开关。

不需要第一阶段就做复杂工作流、多人审批或可视化 bot 编排。

## 4. 服务器分发模型

不要让 bot、Knowledge、Skills 和 routines 各自实现一套同步协议。使用统一的发布包和 Client Manifest。

### 4.1 发布包

```json
{
  "id": "sales-policy",
  "organizationId": "org-example",
  "kind": "knowledge",
  "version": 7,
  "hash": "sha256:...",
  "signature": "ed25519:...",
  "downloadUrl": "https://cdn.example.com/packages/...",
  "rollbackVersion": 6
}
```

支持的 kind：

- `bot_template`
- `group_preset`
- `knowledge`
- `skill`
- `routine`
- `feature_policy`

### 4.2 客户端同步

```text
GET /v1/client/manifest
  -> 比对 organization、user、role、team 和 device 权限
  -> 返回当前可用版本
  -> 客户端下载新增或变更包
  -> 校验签名和 hash
  -> 原子写入本地缓存
  -> 下一次 Agent run 使用新版本
```

要求：

- 后台静默同步。
- 配置包立即生效。
- 客户端保留最近一个已验证版本。
- 网络失败继续使用旧版本。
- 删除分配后停止使用，但不能删除用户自己的本地数据。

## 5. 功能位置

| 功能 | 服务器权威数据 | 客户端数据 | 执行位置 |
|---|---|---|---|
| 群预设、成员、角色 | 是 | 缓存 | 客户端 |
| 群消息和 handoff | 否 | 是 | 客户端 |
| Bot 模板、instructions | 是 | 缓存 | 客户端 |
| Knowledge 文档和索引 | 是 | 可选缓存 | 服务器检索，Agent 客户端 |
| Skills 定义和版本 | 是 | 缓存 | 客户端 |
| Routines 定义和调度 | 是 | 缓存和运行历史 | 客户端 |
| Bot/用户私有 memory | 否 | 是 | 客户端 |
| 企业/团队 shared memory | 是 | 检索结果缓存 | 服务器存储，客户端调用 |
| 工具详细日志 | 否 | 是 | 客户端 |
| Run/tool 元数据 | 是 | 可选本地副本 | 客户端上报 |
| 附件 | 视类型 | 视类型 | 客户端/对象存储 |

## 6. Memory 分层

### 企业/团队 Memory

- 服务器权威存储。
- 管理员发布，按企业、团队、角色和 bot 分配。
- Agent 通过受认证的 `memory_search` 获取相关片段。
- 普通成员不能直接写入共享 Memory。
- Agent 可以提出“晋升建议”，由管理员审核发布。

### Bot/用户私有 Memory

- 客户端 SQLite 权威存储。
- 包含个人偏好、本地上下文和 bot 自主总结。
- 默认不上传服务器。
- 用户导出或明确选择后才进入共享 Memory。

## 7. Knowledge

Knowledge 是企业资料，不等同于 Agent 自主记忆。

推荐：

- 管理端上传、编辑、审核和发布。
- 服务器保存原文、版本、ACL 和索引。
- 客户端通过 `knowledge_search` 查询。
- 小型、必须离线可用的制度卡片可下载到本地缓存。
- 大型知识库不把完整索引复制到每个客户端。

如果后续需要完全离线知识库，再增加签名 Knowledge Pack；不要在第一版同时实现两套检索路径。

## 8. Skills

Skills 是声明式能力包：

- instructions
- 可用工具白名单
- 输入输出约定
- Knowledge/Memory 引用
- 版本和签名
- 适用的企业、团队或 bot

客户端下载、校验和缓存，由本地 Agent 执行。

第一阶段禁止服务器下发任意可执行代码。以后增加脚本型 Skill 时，必须单独设计签名、权限、沙箱和审核。

## 9. Routines

服务器权威保存：

- routine 定义。
- 所属 bot 和团队。
- 触发规则和启用状态。
- 目标版本和分配范围。

客户端负责：

- 实际 Agent run。
- 本地工具和浏览器。
- run 结果和活动记录。

客户端离线时不运行本地任务。需要明确错过运行的处理策略：

- 下次上线补跑。
- 只跑最近一次。
- 跳过。
- 等待用户确认。

## 10. 工具运行记录和活动历史

### 本地详细记录

客户端 SQLite 保存：

- runId、botId/groupId、tool name。
- 审批结果、开始/结束时间、耗时。
- 参数和结果摘要。
- 错误码和错误栈。
- 关联 message。
- 可选本地 artifact 路径。

### 服务器元数据

服务器只保存：

- 企业、用户、设备、客户端版本。
- runId、tool name、status、error code、duration。
- token/usage 元数据。
- 配置版本和 routine 触发来源。

不在默认日志中上传 prompt、回复、命令输出、文件内容、页面正文或附件。

深入排查使用按需 diagnostic bundle：

- 用户主动上传。
- 或企业管理员发起请求后由客户端提示。
- 上传前显示范围并脱敏。

## 11. 团队管理的边界

本方案中的团队管理指：

- 创建企业和团队。
- 邀请员工和分配角色。
- 给团队/员工分配 bot、群、Knowledge、Skills 和 routines。
- 查看用量、版本和审计元数据。

它**不默认表示多个员工共享同一群聊和消息历史**。

如果需要人类员工共享频道，必须把群消息、附件、成员在线状态和权限改成服务器权威存储。这是独立的产品决策，不复用当前单设备 group thread。

## 12. 附件

- 私聊附件：默认保存在客户端。
- 管理端预置资料：服务器对象存储，随 Knowledge 包发布。
- 团队共享附件：只有实现服务器共享频道后才进入对象存储。
- 所有对象使用企业前缀、权限校验和生命周期策略。
- 中国部署优先使用国内 S3 兼容对象存储，不依赖海外 SaaS。

## 13. 推荐实施顺序

1. 多企业 schema、membership、RBAC 和 tenant guard。
2. 管理员认证、最小管理面板和员工邀请。
3. Client Manifest、签名包、客户端后台同步和回滚。
4. Bot 模板、群预设、Skills 和 Knowledge 分配。
5. 本地群聊和 `handoff_to_bot`。
6. Routines 服务器调度与客户端执行。
7. Memory 分层和共享 Memory 审核。
8. 工具运行记录、活动历史和诊断 bundle。
9. 附件与对象存储。
10. 团队共享频道，仅在明确需要时启动。

## 14. 当前排除项

- Computer use。
- Voice 和电话。
- 海外第三方软件集成。
- Cloud Agent。
- 没有明确需求的人类共享频道和团队电脑。
