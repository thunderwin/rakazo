# 浏览器扩展桥接

> 状态：本地实现已通过确定性单元测试和临时 Chrome Profile 端到端测试。
> 核实日期：2026-10-20。

## 1. 目标

ericBot 的浏览器能力运行在用户电脑上，并通过用户现有 Chrome Profile 工作：

- 不复制 Cookie 或浏览器数据库。
- 不从服务端发起浏览器操作。
- 默认在独立、可见的 Agent Window 中打开页面。
- 需要操作已有标签页时，显式借用，并在任务结束或停止时归还。
- 页面内容始终是不可信数据。

这样，Agent 可以使用用户已经登录的网站，同时服务端和 New API 仍然只负责账号与模型网关。

## 2. 架构

```text
Pi local Agent loop
  -> @rakazo/local-runtime browser tools
  -> Electron DesktopBrowserBridge
  -> ws://127.0.0.1:<random port>/browser-bridge
  -> ericBot Browser Bridge（Chrome/Edge MV3）
  -> chrome.tabs + chrome.scripting
  -> 用户当前 Chrome Profile
```

`DesktopBrowserBridge` 只绑定 loopback，不接受公网连接。扩展通过一次性六位配对码换取本地长期
令牌；应用只在用户点击“Connect Chrome”后开放配对窗口。

## 3. 工具

| 工具 | 行为 | 审批 |
|---|---|---|
| `browser_list_tabs` | 列出普通窗口中的 HTTP(S) 标签页，不读取正文 | 否 |
| `browser_open` | 在 Agent Window 打开新页面 | 每个 run 首次浏览器写入时审批 |
| `browser_observe` | 返回页面文本、交互元素和短期 `eN` 引用 | 否 |
| `browser_navigate` | 导航当前 Agent 标签页 | 每个 run 首次浏览器写入时审批 |
| `browser_click` | 点击最近一次观察返回的引用 | 每个 run 首次浏览器写入时审批 |
| `browser_type` | 向输入框或可编辑区域输入文本 | 每个 run 首次浏览器写入时审批 |
| `browser_scroll` | 按页面或元素滚动 | 每个 run 首次浏览器写入时审批 |
| `browser_borrow_tab` | 把用户已有标签页移入 Agent Window | 每次单独审批 |
| `browser_return_tab` | 归还借用的标签页 | 否 |
| `browser_close` | 结束本次浏览器会话并关闭 Agent Window | 否 |

`browser_observe` 给元素写入带当前 observation id 的临时属性。引用不是长期选择器；页面导航、
重新观察或点击导致 DOM 变化后，模型必须重新观察。

## 4. 生命周期

- 每个本地 Agent run 使用 run id 作为浏览器 session id。
- run 正常完成时，桌面组合根自动关闭该 session，归还借用标签页。
- Stop 或切换账号时先取消 run，再关闭浏览器 session。
- 关闭 Agent Window 会结束该 session。
- 页面打开或任务结束时，普通用户标签页不会被自动关闭。

## 5. 权限和数据边界

扩展当前申请：

- `tabs`
- `scripting`
- `storage`
- `alarms`
- `http://*/*` 和 `https://*/*`

声明站点权限是为了在用户指定页面执行观察与操作。扩展不会：

- 读取或导出 Cookie。
- 读取 Chrome 密码库。
- 后台遍历用户所有页面。
- 把浏览器令牌发送给 ericBot 服务端。
- 通过远程 CDP 暴露调试端口。

模型网关仍会看到模型请求中的页面文本。页面正文、表单字段名称和操作结果属于可能被发送给模型的
数据；产品隐私说明必须明确这一点。

## 6. 当前限制

- 只支持 Chrome 和 Edge 的 Chromium MV3 扩展。
- 页面观察与操作目前针对顶层 frame；复杂 iframe、Canvas 和专用下载流程尚未支持。
- 点击和输入使用 DOM 事件，不使用 `chrome.debugger`，因此页面能够识别部分自动化输入。
- 没有任意 JavaScript `evaluate` 工具。
- 没有文件上传、下载、视频录制或网站调试功能。
- 未实现多浏览器实例选择；同一时间使用最新连接的扩展。
- 扩展尚未发布到 Chrome Web Store 或 Edge Add-ons。

这些限制不影响“在用户已有 Profile 的登录态下完成普通网页任务”的最小闭环。

## 7. 开发和测试

```bash
pnpm --filter @rakazo/browser-extension build
pnpm --filter @rakazo/browser-extension check
pnpm --filter @rakazo/browser-extension test
pnpm --filter @rakazo/browser-extension test:e2e
pnpm --filter @rakazo/desktop check
pnpm --filter @rakazo/desktop test
```

端到端测试使用 Chrome for Testing、临时 Profile、本地 HTTP 页面和本地假登录 Cookie，验证：

- 扩展配对和 WebSocket 重连握手。
- 同一 Profile 的登录状态复用。
- 观察、文本输入和点击。
- 列出、借用、归还用户已有标签页。
- session 关闭后 Agent Window 被清理。

测试不访问真实网站，不读取用户当前 Chrome Profile，也不依赖真实模型。

## 8. 发布要求

消费级安装仍需要用户从 Chrome Web Store 或 Edge Add-ons 添加扩展。桌面安装器不能静默安装
Chrome 扩展。发布前还需要：

- 准备正式扩展权限说明和隐私政策。
- 在商店审核中解释站点权限与页面自动化的用途。
- 固定正式扩展 ID，并保留开发扩展的配对方式。
- 确认企业浏览器策略不会阻止扩展。
