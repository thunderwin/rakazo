# 本地 Knowledge 和 Skills

> 状态：客户端执行与本地缓存已实现。核实日期：2026-10-21。

## 1. Knowledge

Knowledge 是账号级参考文档库：

- `local`：用户自己维护。
- `managed`：为企业分发预留，客户端只读。
- 每条文档包含 title、content、source、package id 和 version。

当前检索是确定性的本地关键词搜索，不依赖 embedding、向量库或第三方服务：

- `knowledge_search` 返回匹配文档的 id、title、snippet 和 score。
- `knowledge_read` 读取完整文档。
- 标题命中权重大于正文，最多返回 10 条。

Agent 根据任务需要主动搜索。Knowledge 不会每轮全量注入模型，避免本地库变大后拖垮上下文。

## 2. Skills

Skills 复用 Claude Agent Skills 的 `SKILL.md` 格式：

```text
---
name: Release review
description: Review a release before it ships.
---

Steps and guidance.
```

来源：

- `builtin`：随客户端发布，只读。
- `user`：用户或 Agent 创建，可编辑。
- `managed`：为企业分发预留，只读。

当前内建 skill：`Interrogate`，用于只读、对抗式审查 diff/PR/plan。

### Agent 行为和工具

- 每轮注入最多 50 个 skill 的名称和 description。
- `/Name` 强制加载一个 skill 的完整正文。
- routine prompt 中的 `@Name` 同样在运行时展开。
- `skill_read`：按名称读取完整 skill。
- `skill_create`：创建 user skill。
- `skill_update` / `skill_delete`：只允许修改 user skill。
- builtin 和 managed skill 永远不能从客户端覆盖或删除。

## 3. UI

bot 标题栏的 Knowledge and skills 按钮提供：

- Knowledge document 列表、新建、编辑、删除。
- Managed document 只读查看。
- Skill 列表与来源标识。
- User skill 新建、编辑、删除。
- Built-in 和 managed skill 只读查看。

## 4. 数据边界

- 文档和 skill 正文保存在当前账号的本地 SQLite。
- 模型请求会看到实际搜索到的 Knowledge 和加载/展开的 Skill 正文。
- 服务器默认不保存用户的本地 Knowledge 或 user skill。
- 管理端以后可以发布签名包；客户端通过 `source`、`packageId`、`version` 区分托管内容。

## 5. 尚未实现

- 服务器 Knowledge 索引、检索 API 和企业分配。
- Client Manifest、签名包校验、版本回滚和后台同步。
- embedding/向量检索。
- PDF/Office 正文抽取。
- 企业知识附件对象存储。

这些能力接入时复用当前工具协议和本地缓存，不改变 Agent 的调用方式。
