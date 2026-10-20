# Prompt for the New API Agent

Use this prompt with an agent that has access to the New API fork. It is not
runtime code and must not be copied into client configuration.

```text
你在 /Users/bin/Documents/middleman/new-api-pool 这个 New API fork 上工作。
请先阅读仓库的 AGENTS.md、CLAUDE.md、相关路由、鉴权、Token model 和测试约定。

任务：
新增一个最小的管理员接口，让管理员可以替指定用户创建 New API API token。
原版 /api/token/ 只使用 c.GetInt("id")，只能给调用者自己建 token，不能指定目标用户。
Rakazo 需要这个能力来做用户映射，但 Rakazo 不直接接触 New API 用户令牌。

必须实现的接口契约：

POST /api/user/:id/token

鉴权：
- 使用现有 middleware.AdminAuth()
- Authorization 使用管理员 access token（现有 ValidateAccessToken 接受可选 Bearer 前缀）
- New-Api-User 必须等于管理员自己的用户 id

请求体字段：
{
  "name": "rakazo-<stable-user-key>",
  "unlimited_quota": true,
  "remain_quota": 0,
  "expired_time": -1,
  "model_limits_enabled": false,
  "model_limits": "",
  "allow_ips": "",
  "group": "",
  "cross_group_retry": false
}

成功响应：
{
  "success": true,
  "message": "",
  "data": {
    "id": 123,
    "key": "sk-..."
  }
}

data.key 必须是完整 key，只在创建/幂等读取响应中返回一次。不要写入日志。

实现要求：
1. 目标用户必须存在；目标用户必须启用（status == common.UserStatusEnabled）。
2. 调用者角色必须高于目标用户；root 也不能替另一个 root 创建 token。
3. 复用现有 AddToken 的输入校验、令牌数量上限、额度上限和 model/group/IP 规则，
   不要复制一套逐渐漂移的规则。必要时把共享逻辑提取成 service/helper。
4. 新 token 默认是 unlimited_quota=true，remain_quota=0；用户额度由 New API 用户余额控制。
5. 幂等：同一目标用户的同一个 name 重复请求不能无限创建重复 token。
   如果已有同名未删除 token，返回它的完整 key，不创建第二个。
   并发请求也必须安全。可以用唯一的 idempotency 字段/迁移，或事务安全的
   lookup-or-create；不要把“并发下可能多建几个”当成可接受结果。
6. 保留现有 Token model 的 UserId、Key、Status、Name、ExpiredTime、Group 等语义。
   不要复用用户的 access_token 字段，也不要把 API token 写进 access_token。
7. 失败遵循 New API 现有管理 API 风格，返回稳定的 success:false/message；
   不要泄露 access token、完整 API key、数据库错误或内部路径。
8. 不要在日志、测试输出、错误消息或文档中打印完整 key。
9. 添加 Go 单元/集成测试，覆盖：
   - 管理员替普通用户创建 token
   - 非管理员调用被拒绝
   - 目标用户不存在/被禁用被拒绝
   - 普通管理员不能操作同级/更高角色
   - 重复调用幂等
   - 并发第一次调用只创建一个 token
   - 完整 key 不出现在错误/日志
10. 更新 New API 自己的路由文档或 AGENTS 相关说明（如果仓库要求）。

约束：
- 不要修改 Rakazo 仓库。
- 不要提交真实域名、密钥、生产 token 或 .env。
- 不要自行改变已经确认的接口路径和成功响应字段。
- 不要实现 Rakazo 的扣费逻辑；额度、充值、渠道和结算仍由 New API 负责。

完成后汇报：
- 新增/修改的文件
- 路由和请求/响应契约
- 幂等/并发实现方式
- 运行了哪些离线测试
- 是否需要迁移、部署或重启服务
```
