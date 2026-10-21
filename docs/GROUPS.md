# 本地群聊与 Bot Handoff

> 状态：本地实现已完成。核实日期：2026-10-21。

## 1. 数据模型

群聊全部保存在当前账号的本地 SQLite：

- `chat_groups`
- `group_members`
- `group_threads`
- `group_messages`

每个群有：

- 2–10 个 bot 成员。
- 一个共享 group thread。
- 每条 bot 消息记录发送者 `bot_id`。

群的私有消息不会上传服务器。服务器后续只可能分发 `group_preset`，不会保存群消息。

## 2. 唤醒规则

用户发送消息时：

1. 文本中 `@BotName` 唤醒对应群成员。
2. `@everyone` 唤醒全部成员。
3. 没有任何 mention 时，只唤醒群内第一个 bot。
4. 非群成员的 bot 不会因为文本出现同名 mention 而被唤醒。

## 3. Handoff

群成员可以使用 `handoff_to_bot`：

```json
{
  "bot_id": "target-bot-id",
  "message": "下一步需要完成的工作"
}
```

规则：

- 只能交给当前群成员。
- 不能交给自己。
- 不能立即交回给上一个 bot。
- 同一 handoff 链不能重复经过已经出现的 bot。
- 最多 6 跳。
- handoff 消息持久化到 group thread。
- 接收 bot 在当前 bot 完成本轮后自动运行。
- 接收 bot 使用同一个 group thread 历史。

## 4. 执行

- 每个被唤醒的群成员都有独立 run id。
- 同群同时只允许一个群操作；成员依次执行，避免消息顺序竞争。
- 每个成员使用自己的 instructions、model 和工具配置。
- group context 会告诉成员群名、成员和 `handoff_to_bot` 规则。
- run、tool、错误和 usage 事件继续沿用本地 Agent 事件流。
- Stop 会中止当前群操作及后续 handoff 队列。

## 5. UI

- 侧栏 Groups 区显示群和成员数。
- 群使用共享的 GroupAvatar。
- 群聊中显示每个 bot 的真实名称、头像和身份色。
- handoff 显示为独立事件卡片，包含发送者、接收者、任务和 hop。
- 群设置支持重命名、修改成员和删除。
- `@` picker 在群聊中只显示当前群成员。

## 6. 当前限制

- 当前不支持人类员工共享群频道；群消息仍在单个员工设备上。
- 群成员顺序固定为创建/保存时顺序，暂不做拖拽排序。
- 群成员执行是顺序的，不是并行 fan-out。
- 服务器下发 group preset 尚未实现。
