# 本地 Routines

> 状态：个人终端版本已实现。核实日期：2026-10-21。

## 1. 范围

Routine 是一个绑定 bot 的定时任务。定义、调度和执行都发生在当前本地账号中：

- 定义和下一次运行时间保存在 SQLite。
- ericBot 在线时由客户端 scheduler 执行。
- 执行使用本地 Agent loop、Memory、工具和浏览器扩展。
- 对话和详细运行记录不上传服务器。

V1 本地版本每条 routine 只有一个 schedule，支持：

- 标准五段 cron。
- agent 使用的 `every` + `minutes/hours/days`。
- 一次性 `runAt`、`delayMinutes` 或 `delaySeconds`。
- 时区保存和按 cron 时区计算。

不支持 watch trigger、webhook、GitHub、Slack/Teams 等消息平台触发。服务器定义和分发 routines
仍是后续控制面工作。

## 2. Agent 工具

直聊中提供：

- `schedule_create`：创建 reminder 或 recurring job。
- `schedule_list`：列出当前 bot 的 routines。
- `schedule_cancel`：按 routine id 或精确名称取消。

群聊不暴露 routine 工具，避免群成员替其他 bot 创建私有定时任务。

## 3. 调度策略

客户端 scheduler 每 30 秒检查一次：

1. 查询到期且启用的 routines。
2. 为 `(routine, scheduledFor)` 写入唯一 run claim；重复 tick 不会重复执行。
3. 在 bot 的本地线程中运行 routine prompt。
4. 写入 routine run 状态、关联普通 run id 和错误。
5. 计算下一次未来运行时间。

客户端离线时不会运行。下次启动后，已经错过超过一分钟的任务只补跑一次，然后从当前时间计算
下一次运行；不会按错过的次数连续补跑。

一次性 routine 触发后自动变为 inactive。手动 `Run now` 不消耗正常 schedule，也不改变下一次
运行时间。

如果应用在一次 routine run 中途退出，下次启动会把遗留的 `running` 记录标记为失败，避免永久
显示运行中。

## 4. UI

选择 bot 后，标题栏的 Routines 按钮提供：

- routine 列表和 Active/Paused 状态。
- 名称、prompt、每天/工作日/每周/一次性/custom cron。
- 启用、保存、删除。
- 立即运行。
- 最近 10 次运行的状态、触发原因、时间和错误。

## 5. 数据和隐私

- `routines` 保存名称、prompt、cron、时区、启用状态和下次运行时间。
- `routine_runs` 保存 claim、普通 run id、触发方式、状态和错误。
- 运行产生的消息仍在本地 bot thread。
- 详细 prompt、回复和工具记录不上传。
- 模型网关仍能看到 routine 执行时发送的 prompt。

## 6. 后续

- 服务器保存组织 routine 定义并下发签名配置。
- 客户端上报不含正文的 run 元数据。
- Managed routine 在 UI 中显示只读来源。
- 多 schedule、watch、webhook 和国内消息平台触发按产品需要单独加入。
