# 本地运行与工具活动记录

> 状态：本地实现已完成。核实日期：2026-10-21。

## 1. 目标

ericBot 在本地记录每次 Agent run 和工具调用，用于：

- UI 活动历史。
- 工具失败排查。
- 用户查看 Agent 实际执行过什么。
- 后续诊断包和服务器元数据上报。

详细参数、结果和错误只保存在当前账号的本地 SQLite。

## 2. 数据

`runs`：

- run id。
- kind：`direct` / `group`。
- bot id。
- 可选 group id。
- thread id。
- status：`running` / `completed` / `failed` / `stopped`。
- error、开始和结束时间。

`tool_runs`：

- run id、execution id、bot id。
- tool name。
- 参数和结果 JSON。
- status：`running` / `completed` / `failed`。
- error、开始和结束时间。

单个参数或结果 JSON 最多保存 32,000 字符；超出时保存截断预览。

## 3. 写入路径

- 每个 Agent run 开始时写 `runs`。
- run 结束、失败或 Stop 时更新状态。
- `RecordingToolProvider` 在工具执行前后写入 `tool_runs`。
- 群聊 `handoff_to_bot` 也记录为工具活动。
- 数据库写入失败不会改变工具执行结果，但当前实现会让工具调用失败以便暴露本地存储问题。

## 4. UI

主窗口的 Activity 按钮打开最近 50 次 run：

- bot 或 group 名称。
- run 状态和持续时间。
- 工具数量。
- 工具名称、状态、耗时。
- 可展开查看参数、结果和错误。

当前没有服务器 Activity 上传。

## 5. 隐私边界

- run/tool 正文默认不上传服务器。
- 模型网关仍会看到 prompt/response。
- 后续服务器只接收 run/tool 元数据或用户明确上传的脱敏诊断包。
- shell 和文件工具的本地参数可能包含敏感信息，因此 UI 和导出必须保持本地。
