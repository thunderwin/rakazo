# Desktop computer use 设计

> 状态：设计草案，尚未实现。核实日期：2026-10-20。

## 1. 定位

Computer use 是浏览器扩展之外的桌面兜底能力，不应替代浏览器工具。网页任务优先使用 Chrome
扩展，因为 DOM 观察、元素引用和站点登录态更稳定；只有本地应用、系统对话框、Canvas 或跨应用
流程才进入 desktop tools。

所有电脑操作都在用户设备上执行：

```text
Pi local Agent loop
  -> DesktopComputerHost
  -> platform adapter
       macOS: Accessibility + ScreenCaptureKit + CGEvent
       Windows: UI Automation + Windows Graphics Capture + SendInput
```

服务端只返回模型工具调用，不执行桌面操作，也不接收持续屏幕流。

## 2. 工具边界

第一阶段计划提供：

- `desktop_list_windows`：列出可操作应用窗口。
- `desktop_observe`：返回当前窗口的可访问性元素、视口截图和短期 `dN` 引用。
- `desktop_click`：点击可访问性元素或最新截图坐标。
- `desktop_type`：向当前焦点输入文本。
- `desktop_press_key`：发送有限组合键。
- `desktop_scroll`：在目标窗口滚动。
- `desktop_wait`：等待应用或窗口状态变化。

不接受任意 shell 命令代替桌面工具，也不提供隐藏进程注入、读取密码字段或全局键盘记录。

## 3. macOS 方案

优先实现 macOS：

- Accessibility API：读取窗口、控件层级、角色、名称和值，执行 `AXPress` 等语义动作。
- ScreenCaptureKit：只在需要视觉理解或遇到无辅助功能元素的窗口时截图。
- CGEvent：当语义动作不可用时发送点击、键盘和滚动事件。
- AppKit：定位应用、窗口和前台状态。

权限：

- Accessibility：读取控件和执行输入。
- Screen Recording：截图。
- Automation/Apple Events：仅针对明确支持且单独启用的应用，不作为基础依赖。

用户必须在系统设置中显式授权；应用应显示当前权限状态，并提供撤销入口。

## 4. 安全模型

- 每次 run 首次调用桌面写入工具时请求审批。
- 审批界面显示目标应用和窗口，而不是只显示工具名。
- 截图和屏幕录制必须有可见状态指示。
- 输入密码、支付确认、删除、权限变更和系统安全设置需要单独确认。
- 密码输入框、系统安全提示和权限授权窗口默认禁止自动填写或点击。
- 页面和应用内容都是不可信数据，不能改变用户授权。
- Stop 必须立即取消等待，并阻止后续工具调用。

## 5. 观察格式

`desktop_observe` 返回有界数据：

```json
{
  "window_id": "window-1",
  "app": "Example App",
  "title": "Project",
  "elements": [
    { "ref": "d1", "role": "button", "name": "Save" },
    { "ref": "d2", "role": "textbox", "name": "Search" }
  ],
  "screenshot": "optional local artifact reference",
  "truncated": false
}
```

引用来自最近一次观察。窗口、应用或明显布局变化后必须重新观察。坐标只作为语义元素不可用时的
后备方案。

## 6. 实现顺序

1. 抽象 `DesktopComputerHost`，先接一个确定性的 fake adapter。
2. 实现 macOS 窗口枚举和 Accessibility 观察。
3. 加入语义点击、输入和按键。
4. 加入 ScreenCaptureKit 截图，并把截图保存为本地 run artifact，而不是长期存储在服务器。
5. 完成权限页、目标窗口审批和 Stop。
6. 用专用测试应用验证中英文输入、窗口切换、权限拒绝和超时。
7. Windows 通过同一接口实现 UI Automation 和 SendInput。

`computer use` 不应与浏览器扩展共用同一权限：浏览器页面授权和桌面全屏控制是两个独立边界。
