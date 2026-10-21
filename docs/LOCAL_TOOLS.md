# 本地 Agent 工具

> 状态：当前本地客户端注册 76 个工具名；与上游 `builtinAgentTools` 同名 64 个。
> 核实日期：2026-10-21。
>
> 对比基线：当前代码基于 `upstream/main@92214866`。2026-10-21 fetch 到的
> `upstream/main@7e9365db` 中 `builtinAgentTools` 仍是 71 个名字，但 executor 有
> 498 行变化；工具名对齐不代表行为对齐，移植必须逐项读 diff 和测试。

## 1. 存在形式

本地工具是随客户端发布的 TypeScript 定义和执行函数，不是数据库插件，也不是服务器下发代码：

```ts
{
  definition: { name, description, inputSchema, readOnly?, requiresApproval? },
  execute(request) { ... }
}
```

`LocalToolRegistry` 在内存中注册工具。每次 run 前，最终工具列表按以下交集计算：

1. 当前客户端构建注册的工具。
2. 当前环境能力，例如浏览器扩展、媒体供应商和桌面动作。
3. Bot 的 `disabledBuiltinTools`。
4. 企业 Client Manifest 的 `featurePolicy.disabledTools`。
5. 上下文限制，例如群聊不提供私有 Memory、Routine 和 Fleet。

企业策略通过 `LocalToolPolicyProvider` 合并到 Bot 策略。Manifest 中的禁用项现在会真正影响模型收到的工具 Schema。

## 2. 当前工具清单

### 本地与桌面（7）

- `shell`
- `list_files`
- `read_file`
- `write_file`
- `attach_file`
- `open_path`
- `launch_app`

`open_path` 和 `launch_app` 每次执行需要用户批准。`open_path` 的文件目标限制在本地 workspace；URL 只接受 HTTP(S)。

### 网页与媒体（5）

- `web_search`
- `web_fetch`
- `render_plot`
- `generate_image`：仅在配置媒体供应商时出现
- `generate_video`：仅在配置视频媒体供应商时出现

`generate_video` 使用本地 `media_jobs` 表保存提交状态。首次调用返回本地 job id；后续只允许用 `jobId` 轮询，不自动重复提交付费任务。

### 凭证安全 API（4）

- `request_secret`
- `list_secrets`
- `secret_request`
- `forget_secret`

凭证按账号和 Bot 隔离。当前支持：

- Bearer token。
- 自定义认证 header。
- Basic auth。

凭证值保存在 Electron `safeStorage` 加密的账号级 vault 文件中；模型和 IPC 响应只看到名称、origin 和认证类型。`secret_request` 只允许请求保存的精确 HTTPS origin，拒绝重定向，并在响应中脱敏原值及常见编码形式。

网站登录通过 `browser_act fill_secret` 在保存的精确 origin 上填入，值不进入模型上下文。Shell command variable 会注入已批准的 `shell` 和 `skill_run` 子进程环境，并在输出中脱敏。

### 交互与 Bot 协作（6）

- `ask_user`
- `message_user`
- `request_takeover`
- `run_subagent`
- `message_bot`
- `handoff_to_bot`

`ask_user` 显示本地选项弹窗并等待用户选择。`message_user` 写入当前聊天的可见进度消息，不替代最终回复。`handoff_to_bot` 只在群聊出现。

### 本地电脑（2）

- `computer_observe`
- `computer_act`

使用本地桌面截屏和系统输入控制；屏幕、辅助功能权限由操作系统管理。`computer_observe` 返回截图给模型，`computer_act` 支持指针、键盘、滚动、等待和应用聚焦，单批最多 24 个动作。

### MCP（1）

- `add_mcp_server`

支持 `streamable_http`、`sse` 和本地 `stdio` MCP server。连接成功后，服务端发现的工具以
`mcp__<server>__<tool>` 暴露给下一轮 Agent；写入类 MCP 工具逐次审批。

### Fleet（10）

- `list_fleet`
- `spawn_bot`
- `create_group`
- `update_group`
- `update_bot`
- `organize_bot`
- `archive_bot`
- `set_child_instructions`
- `set_child_bot_model`
- `create_child_routine`

全部仅在 Bot 开启 Fleet management 时出现，写入逐次审批。
归档 Bot 会停用它的 routines、从活动列表隐藏，并保留聊天、Memory 和文件；客户端提供恢复和永久删除入口。

### Bot 指令（1）

- `propose_instructions_update`

替换当前 Bot 指令前必须经过用户审批，并写入本地指令版本历史。

### Skills（5）

- `skill_read`
- `skill_create`
- `skill_update`
- `skill_delete`
- `skill_run`

`skill_run` 是本地新增工具，上游没有同名能力。

### Knowledge（2）

- `knowledge_search`
- `knowledge_read`

### Memory（5）

- `remember`
- `save_shared_memory`
- `save_memory`
- `recall_memory`
- `forget_memory`

Memory 工具不在群聊暴露。`forget_memory` 经过本地审批。

### Routines（3）

- `schedule_create`
- `schedule_list`
- `schedule_cancel`

Routine 工具不在群聊暴露。

### 历史（2）

- `search_history`
- `read_history`

只搜索当前 Bot 或群聊线程，最多读取最近 1,000 条消息。

### Scratchpad、任务目录和 Ticket（11）

- `task_catalog`
- `scratchpad_list`
- `scratchpad_add`
- `scratchpad_update`
- `scratchpad_complete`
- `scratchpad_remove`
- `board_tickets`
- `ticket_get`
- `ticket_create`
- `ticket_update`
- `ticket_comment`

Scratchpad 和 Ticket 保存在本地 SQLite；`task_catalog` 汇总当前 Bot 的 scratchpad、routines、
Skills 和模型当前可见工具。Scratchpad/Ticket 的写入逐次经过本地审批。

### 浏览器（12）

- `browser_list_tabs`
- `browser_open`
- `browser_observe`
- `browser_navigate`
- `browser_click`
- `browser_type`
- `browser_scroll`
- `browser_borrow_tab`
- `browser_return_tab`
- `browser_close`
- `browser_snapshot`
- `browser_act`

只有浏览器扩展宿主可用时注册。`browser_snapshot` 与本地 `browser_observe` 共用观察能力；
`browser_act` 支持 click、fill、type 和 origin-bound `fill_secret`，同时保留 10 个更细粒度的浏览器工具。

## 3. 与上游的剩余差异

按 2026-10-21 的 `builtinAgentTools` 对比：

- 上游 71 个。
- 本地 76 个。
- 同名 64 个。
- 本地新增 12 个。
- 上游有、本地没有 7 个。

剩余 7 个都属于明确排除或不适用的产品边界：

- `call_user`、`end_call`：产品方明确不需要。
- `cloud_agent_*`：依赖上游远程 Agent 服务，不属于单设备本地 V1。
- `create_space`：上游 Space 是服务器侧多租户数据边界；本地 V1 明确是单设备单空间，因此不迁移。

### 已知适配边界

- 浏览器 `upload` 动作仍依赖后续扩展协议支持；其他 `browser_act` 动作已迁移。
- MCP 当前支持静态 headers/token、环境变量和 stdio；OAuth 授权卡仍需后续接入。
- 凭证的 `connectionId` connector 授权流仍属于服务器 connector 能力；本地 API 凭证、网站登录和 command variable 已迁移。
