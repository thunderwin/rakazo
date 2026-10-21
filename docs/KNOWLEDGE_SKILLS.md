# 本地 Knowledge 和 Skills

> 状态：客户端执行、本地缓存、签名 Manifest 分发和受控 Skill 脚本已实现。核实日期：2026-10-21。

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

一个 Skill 还可以携带最多 20 个脚本文件。脚本保存在本地 `agent_skills.scripts`
JSON 中，每个文件记录相对路径、正文、运行时、超时、联网声明和 SHA-256：

```json
{
  "path": "scripts/main.js",
  "content": "const fs = require('node:fs'); ...",
  "runtime": "node",
  "timeoutSeconds": 60,
  "network": false,
  "sha256": "..."
}
```

支持的入口运行时是 `node`、`python3` 和 `sh`。扩展名与运行时不符时拒绝保存；
辅助文件可以设置 `runtime: null`，只会随入口一起复制，不能单独执行。

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
- `skill_run`：运行该 skill 声明的脚本入口。
- `skill_create`：创建 user skill。
- `skill_update` / `skill_delete`：只允许修改 user skill。
- builtin 和 managed skill 永远不能从客户端覆盖或删除。

`skill_run` 的安全边界：

- 只能运行已声明、扩展名匹配且 SHA-256 未变化的入口，不接受模型传入任意命令。
- 每次执行都进入桌面审批；加载 Skill 不会自动执行代码。
- 所有 Skill 文件复制到一个新的 `workspace/skill-runs/<skill>-<time>-<id>` 目录，
  脚本位于只读的 `skill/` 子目录，当前目录是每次运行独立的 run 目录。
- 模型参数写成 `input.json`，路径作为 `process.argv[2]` 传给入口；脚本输出写到
  run 目录。可以直接调用 `attach_file` 把生成文件附到聊天。
- 环境变量默认只提供 PATH、HOME、TMPDIR 和 LANG，不继承 provider key、session
  token 或其他宿主环境变量。
- 单次超时 1–120 秒，stdout/stderr 各最多 512 KiB；支持 Stop 取消。
- macOS 上 `network: false` 通过 `sandbox-exec` 拒绝网络访问。其他平台当前只有
  显式审批和联网声明，尚无同等系统级网络隔离；这是已知限制。
- 当前只复制 Skill 脚本，不包含通用 references/assets 包；企业 Knowledge 附件和
  Skill 资产对象存储仍未实现。

## 3. UI

“应用设置 → 账户资源 → Knowledge and skills”提供：

- Knowledge document 列表、新建、编辑、删除。
- Managed document 只读查看。
- Skill 列表与来源标识。
- User skill 新建、编辑、删除。
- User skill 可以新增、删除和编辑脚本，并设置入口运行时、超时和联网声明。
- Built-in 和 managed skill 只读查看。

## 4. 数据边界

- 文档和 skill 正文保存在当前账号的本地 SQLite。
- 模型请求会看到实际搜索到的 Knowledge 和加载/展开的 Skill 正文。
- 服务器默认不保存用户的本地 Knowledge 或 user skill。
- 管理端通过签名 Client Manifest 发布托管内容；客户端通过 `source`、`packageId`、
  `version` 区分托管内容。

## 5. 尚未实现

- 服务器 Knowledge 索引、检索 API 和企业分配。
- embedding/向量检索。
- PDF/Office 正文抽取。
- 企业知识附件对象存储。
- Skill 的 references/assets 上传、版本对比和签名包独立回滚 UI。
- Linux/Windows 上脚本的强制文件系统与网络沙箱。

这些能力接入时复用当前工具协议和本地缓存，不改变 Agent 的调用方式。

当前已实现的最小分发链路是企业管理员通过 `/admin` 编辑版本化 Client Manifest，
包括 Skill 脚本；客户端校验 Ed25519 签名和 hash 后把 managed Knowledge/Skills
写入本地只读缓存。脚本本身不因同步而执行，员工仍需在 `skill_run` 时逐次批准。
服务器端大规模检索索引和预置附件仍未实现。
