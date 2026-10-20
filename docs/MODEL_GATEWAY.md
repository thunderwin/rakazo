# Model Gateway Protocol

> 状态：V1 协议草案。客户端和最小 OpenRouter 服务器网关已实现；额度/计费尚未接入。

## 1. 目的

本地 Agent runtime 不持有模型供应商的长期密钥。它通过运营方服务器上的模型
网关调用模型，服务器负责：

- 用户/设备鉴权
- 额度扣减和限流
- 选择模型供应商和具体模型
- 把流式结果转发给客户端
- 记录用量元数据

模型网关会看到 prompt 和模型返回内容。服务器不得把对话正文作为业务数据持久化。

## 2. Endpoint

```http
POST /v1/model/chat
Authorization: Bearer <device-token>
Content-Type: application/json
Accept: text/event-stream
```

客户端可以通过 `HttpModelGateway` 的 `path` 选项覆盖路径。

## 3. Request

```json
{
  "protocolVersion": 1,
  "botId": "bot-id",
  "instructions": "You are a careful researcher.",
  "model": {
    "provider": "openrouter",
    "id": "model-id"
  },
  "thinkingLevel": "medium",
  "messages": [
    { "role": "user", "content": "Find the source." }
  ]
}
```

字段：

- `protocolVersion`：当前固定为 `1`。
- `botId`：本地 bot id，用于审计和服务端策略，不是服务端业务主键。
- `instructions`：bot 的 instructions。
- `model`：可选；不传时由服务端按用户套餐选择。
- `thinkingLevel`：可选。
- `messages`：`system` / `user` / `assistant` 消息，按时间顺序。

## 4. Response

成功响应是 `text/event-stream`：

```text
event: text
data: {"text":"Hello "}

event: text
data: {"text":"world"}

event: done
data: {}
```

错误可以在流内返回：

```text
event: error
data: {"message":"insufficient credits"}
```

客户端行为：

- `text`：追加到当前回复。
- `done`：结束当前 stream。
- `error`：抛错；已经收到的文本不会自动写入 assistant 消息。
- 连接中断：不要自动重放已经收到文本的请求，除非服务器支持幂等 request id。

## 5. Status codes

| 状态 | 含义 |
|---|---|
| 200 | 开始 SSE |
| 400 | 请求格式错误 |
| 401 | 设备 token 无效或过期 |
| 402 | 额度不足 |
| 403 | 账号/设备被禁用 |
| 429 | 频率限制 |
| 5xx | 网关或供应商故障 |

客户端应把 401 视为需要刷新 token，402/403 作为用户可见错误，429 显示重试时间。

## 6. 客户端实现

`packages/local-runtime/src/http-model-gateway.ts` 已实现：

- Bearer token
- SSE 解析
- 跨 chunk 的事件拼接
- 错误事件
- 非 2xx 错误
- AbortSignal

`LocalRuntime` 会把本地历史、bot instructions、模型选择和 thinking level 传入网关。

## 7. 服务器实现要求

当前实现：

- `apps/api/src/model-gateway.ts`
- `POST /v1/model/chat`
- Better Auth session token（支持 `Authorization: Bearer`）
- 仅支持 OpenRouter 的部署模型
- 代理 OpenRouter SSE，并转换成客户端事件

配置：

```bash
MODEL_GATEWAY_ENABLED=true
PI_DEFAULT_PROVIDER=openrouter
PI_DEFAULT_MODEL=openai/gpt-6-luna
OPENROUTER_API_KEY=...
```

注意：当前版本**还没有接入额度扣减和账单**。在完成配额、用量记录和风控前，不要把它作为公开付费能力启用。

- 每个请求校验设备 token 和用户额度。
- 不信任客户端传来的 `botId` 做授权。
- 供应商 key 只在服务器密钥库。
- 记录用量、状态码、延迟和错误码；默认不记录 prompt/回复正文。
- 支持流式转发和客户端断开取消上游请求。
- 对共享 token、异常频率和并发做限流。
- 返回稳定的错误码/消息，不泄露供应商内部细节。

## 8. 测试

`packages/local-runtime/src/http-model-gateway.test.ts` 使用本地 HTTP server 覆盖：

- 正常文本流
- SSE 跨 chunk
- 网关错误帧
- 非 2xx 响应
- Bearer token 和请求体

服务器侧测试在 `apps/api/src/model-gateway.test.ts`，覆盖 OpenRouter SSE、鉴权后的
处理器输入、禁用状态、限流和非 2xx。后续接入额度系统时必须增加扣费/并发测试。
