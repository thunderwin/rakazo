# Model Gateway: OpenAI-Compatible New API Passthrough

> 状态：V1 目标协议。客户端和服务端类型/代理已切换；运营方的 New API 部署已于
> 2026-10-21 由产品所有者确认可用。本文不记录生产 URL 或凭据。本地 New API fork 的管理员
> 建令牌接口仍需提交，确保源码与已部署版本一致。

## 1. 目标链路

```text
本地 Pi / 本地 Agent runtime
  -> Rakazo API: /v1/model/openai/*
  -> Better Auth session 鉴权
  -> Rakazo 查 Rakazo userId 对应的 New API 用户和令牌
  -> New API: /v1/chat/completions 或 /v1/models
  -> New API 渠道 / 模型供应商
```

额度、倍率、渠道、充值和结算全部由 New API 负责。Rakazo 不保存模型供应商密钥，也不自己
实现余额。

## 2. Rakazo 端点

客户端把 `baseUrl` 设为：

```text
{serverUrl}/v1/model/openai
```

因此 Pi OpenAI-compatible provider 会请求：

```http
POST /v1/model/openai/chat/completions
GET  /v1/model/openai/models
```

鉴权：

```http
Authorization: Bearer <Better Auth session token>
```

客户端永远不接触 New API 地址、管理员 access token 或用户 New API token。

## 3. Rakazo 到 New API 的映射

控制面表 `new_api_identities`：

- `userId`：Rakazo 用户 id，唯一主键
- `newApiUserId`：New API 用户 id
- `tokenCiphertext`：该用户的 New API API token 的加密密文
- `createdAt` / `updatedAt`

首次调用时懒创建：

1. 用 `userId` 唯一约束抢占一行 `pending` 记录。
2. 生成稳定用户名和随机密码，调用管理员创建用户接口。
3. 通过管理员令牌接口为该用户创建 API token。
4. 用仓库已有的 `SecretStore` 加密 token，写入映射行。
5. 并发调用只有一个创建者；其他请求轮询映射行，冲突后重新读取。
6. 创建失败释放 claim，下一次调用可重试。

用户名格式为 `rakazo_<hash>`，密码只用于创建用户，不写入 Rakazo 数据库。

### New API 管理员建令牌接口

原版 New API 的 `/api/token/` 只能给调用者自己创建令牌，不能指定目标用户。Rakazo
需要 New API fork 新增一个管理员接口：

```http
POST /api/user/:id/token
Authorization: Bearer <admin access token>
New-Api-User: <admin user id>
Content-Type: application/json
```

请求：

```json
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
```

响应：

```json
{
  "success": true,
  "message": "",
  "data": { "id": 123, "key": "sk-..." }
}
```

要求：

- `AdminAuth`，并校验 `New-Api-User`。
- 目标用户存在且启用。
- 调用者角色高于目标用户。
- 同名创建应幂等，只返回一次完整 key。
- 完整 key 不写日志。
- token 使用无限 token 额度，用户额度由 New API 用户钱包控制。

## 4. 请求和流式透传

Rakazo 只做必要处理：

- 读取 JSON object，限制请求体大小。
- `stream === true` 时强制：

```json
{
  "stream_options": { "include_usage": true }
}
```

- 其他字段（`tools`、`tool_choice`、推理字段、多模态字段等）原样保留。
- 把 `Authorization` 换成该用户的 New API token。
- 流式响应直接转发，不在 Rakazo 重组 SSE。
- 客户端断开时透传 `request.signal`，取消上游请求。

### 客户端解析

桌面客户端的 Pi OpenAI-compatible provider 识别：

- `choices[].delta.content`：文本
- `choices[].delta.tool_calls`：工具调用，按 index 拼接 arguments
- `usage`：用量
- `[DONE]`
- 错误帧或非 2xx

Pi 在客户端完成工具循环。当前已接入 `shell`：模型发起调用后，本地 runtime 执行
已获批准的工具，把结果作为 tool message 继续交给同一轮 Pi 循环。文件、应用、浏览器、
Memory、Routines、MCP 和 Skills 工具也由本地 runtime 执行；服务端只透传 OpenAI 协议，
不执行任何工具。

客户端请求仍只带 Better Auth session token。公开服务器地址由编译后的组合根提供，
不是 bot 或模型返回的任意 URL。组合根把该地址标记为“精确 API 前缀”，避免 Pi/OpenAI
SDK 再补一层 `/v1` 后请求成 `/v1/model/openai/v1/chat/completions`。

## 5. 错误映射

New API 调研结果：

| New API 情况                     | 上游 HTTP | Rakazo HTTP |
| -------------------------------- | --------: | ----------: |
| session/New API token 无效或过期 |       401 |         401 |
| 用户/分组无权限、封禁            |       403 |         403 |
| `insufficient_user_quota`        |       403 |     **402** |
| `pre_consume_token_quota_failed` |       403 |     **402** |
| 限流                             |       429 |         429 |
| 渠道/供应商 5xx                  |       5xx |         502 |
| 非法请求                         |       4xx |         400 |

New API 的错误体通常是：

```json
{
  "error": {
    "message": "...",
    "type": "new_api_error",
    "code": "insufficient_user_quota"
  }
}
```

Rakazo 对外只返回稳定通用消息，不把上游渠道名、供应商错误或 New API 的原始 message
透传给客户端。

New API 自己的流内错误没有统一 SSE envelope；Rakazo 对非 2xx 做状态映射，对已经开始的流
保持原始数据转发，客户端按 OpenAI chunk/error 处理。

本地中文界面会进一步把状态映射为可操作提示：

- 缺少 `NEW_API_*` 服务端配置：显示“模型网关尚未配置，请联系管理员连接模型服务。”
- `400/404`：显示所选模型不可用或无效。
- `401`：提示重新登录；`402`：提示额度不足；`429`：提示模型服务繁忙。
- `413`：提示移除附件或缩短消息。

排查本地 API 时，先确认 `.env` 同时包含 `NEW_API_BASE_URL`、`NEW_API_ADMIN_TOKEN` 和
`NEW_API_ADMIN_USER_ID`，然后重启 API。只配置其中一个不会启动有效模型网关。

## 6. 用量和结算

New API 支持 `stream_options.include_usage`，并且 `FORCE_STREAM_OPTION` 默认为 true。
流式响应末尾会有 usage chunk，随后是 `[DONE]`。

New API 在请求前预扣，流结束后用真实 usage 结算；如果渠道没有返回 usage，会尝试用响应
文本估算。Rakazo 不重复扣费，只透传。

## 7. 服务端配置

```bash
NEW_API_BASE_URL=https://newapi.example.com
NEW_API_ADMIN_TOKEN=replace-with-admin-access-token
NEW_API_ADMIN_USER_ID=1
NEW_API_DEFAULT_MODEL=
```

`NEW_API_DEFAULT_MODEL` 只在客户端没有模型 id 时使用；它不是客户端配置，也不会下发给
客户端。

`NEW_API_ADMIN_TOKEN`、`NEW_API_ADMIN_USER_ID` 和 `NEW_API_BASE_URL` 必须同时配置。

## 8. 隐私

Rakazo 网关和 New API 都能看到 prompt 和模型返回内容。生产部署要求：

- New API `DEBUG` 不设置或设为 `false`。
- 不使用会记录正文的额外网关/代理日志。
- New API 只保留用量、状态、延迟和错误元数据。
- Rakazo 不把对话正文写入业务数据库。

New API 的 `DEBUG=true` 会启用请求/响应正文调试输出；`LOG_DIR` 只控制日志文件位置，
不是正文开关。支付 webhook 另有自己的请求体日志，和模型 relay 路径无关。

## 9. 测试边界

离线测试必须覆盖：

- New API 用户/令牌懒创建，重复调用不重复创建
- 并发首次调用只创建一个
- New API token 替换客户端 session
- `include_usage` 强制注入
- tool_calls 字段完整保留
- New API 错误到 Rakazo 状态码的映射
- 客户端断开取消上游
- 未登录返回 401
- 本地 Pi 请求映射、tool call 执行、工具审批和禁用工具过滤
