# 本地 Memory

> 状态：个人版已实现。核实日期：2026-10-21。

## 1. 范围

V1 Memory 完全保存在当前账号的本地 SQLite，不上传服务器。它包含两个作用域：

| Scope  | 读取范围           | 写入方式                              |
| ------ | ------------------ | ------------------------------------- |
| `bot`  | 当前 bot           | `remember` 追加到 bot 文档            |
| `user` | 当前账号的所有 bot | `save_shared_memory` 整份替换共享文档 |

这不是企业共享 Memory。服务器维护、版本化并向组织成员分发 Memory 仍是后续工作。

## 2. Agent 工具

直聊时向 Agent 暴露：

- `remember`：向 bot 的 `MEMORY.md` 或其他指定文档追加一条事实；重复内容不会再次写入。
- `save_shared_memory`：替换账号级共享文档；单份内容上限 4,000 字符。

两个工具都不需要逐次人工审批，因为它们只写当前账号的本地数据库，不访问电脑或外部
服务。群聊不暴露这两个工具，也不会注入 bot 私有 Memory，避免成员之间意外串用私有上下文。

## 3. 上下文注入

每次直聊 run 开始前，runtime 读取该 bot 的文档和账号共享文档，按更新时间排序并注入本轮
instructions：

- 总预算 32 KiB。
- bot 文档超出预算时保留末尾，优先保留最近追加的事实。
- 共享文档超出预算时保留开头。
- 内容明确标记为可能过期的背景数据，不是高优先级指令。
- 路径和正文中的 HTML 字符会转义，避免伪造上下文边界。

Memory 不会进入群聊上下文、服务器请求日志或控制面数据库。模型网关仍会看到最终拼入请求的
Memory 内容。

## 4. 持久化和修订

SQLite migration 5 新增：

- `memory_documents`：scope、bot id、path、正文、当前 revision、时间。
- `memory_revisions`：每次写入的完整内容和来源 run/thread。

写入使用 expected revision：

- 新文档的期望 revision 为 0。
- 读到 revision 1 后写入成功，新 revision 为 2。
- 如果另一个写入先完成，旧写入会收到冲突并重新读取；`remember` 最多重试三次。
- UI 同样提交打开文档时看到的 revision，避免静默覆盖更新。

`MEMORY.md` 是索引文档，可以编辑但不能删除；其他文档可以删除。

## 5. UI

选择 Bot 后，标题栏的 Memory 按钮只打开当前 Bot 私有文档。账号共享文档从
“应用设置 → 账户资源 → Shared memory”打开：

- `This bot`：当前 Bot 文档。
- `Shared`：当前账号中所有 Bot 共用的文档。
- 查看、编辑、带冲突保护的保存。
- 删除非 `MEMORY.md` 文档。
- 下载当前页签的 Markdown。

## 6. 不包含

- Supermemory、Honcho、Serenity 等语义 Memory 供应商。
- embedding、向量索引或第三方召回服务。
- 服务器端私有 Memory 存储或跨设备同步。
- 企业共享 Memory 的 `memory_search` 和晋升流程。
- 从空状态手工新建文档；文档由 Agent 工具或已经存在的文档编辑产生。
