# Global Shortcuts Design

## Goal

为桌面端增加一套可配置的全局快捷键，支持以下 3 个动作：

1. 隐藏/显示窗口
2. 硬清空实时辅助状态
3. 服务端截图审题

要求：

- 使用 Electron `globalShortcut`
- 快捷键可在前端设置页中查看、修改、恢复默认
- 默认键位统一采用 `CommandOrControl + 单键`
- 触发时不依赖窗口聚焦

## Default Shortcuts

- `hideOrShowWindow`: `CommandOrControl+B`
- `hardClearSession`: `CommandOrControl+.`
- `askFromServerScreen`: `CommandOrControl+/`

## Architecture

### Main Process

`desktop/main.js` 负责：

- 定义默认快捷键配置
- 在应用启动时读取持久化配置
- 注册/注销 Electron `globalShortcut`
- 暴露 IPC：
  - `get-shortcuts`
  - `update-shortcuts`
  - `reset-shortcuts`

快捷键配置持久化到 Electron `userData` 目录中的 `shortcuts.json`。

### Renderer / Preload

`desktop/preload.js` 暴露：

- `getShortcuts()`
- `updateShortcuts(shortcuts)`
- `resetShortcuts()`

前端不直接注册快捷键，只负责配置和展示状态。

### Frontend

在设置页新增“全局快捷键”区域，支持：

- 展示当前键位
- 点击后进入录制状态
- 录制新的 `CommandOrControl + 单键`
- 显示注册结果：`registered / failed / available`
- 恢复默认快捷键

前端本地保存一份快捷键状态用于 UI 展示，但真正生效配置以主进程注册结果为准。

## Action Semantics

### Hide/Show Window

调用主进程当前 `toggleWindow()`。

### Hard Clear Session

主进程直接调用后端 `POST /api/clear`。

后端 `clear` 保证：

- 清空 pending queue
- 清空 ASR candidate group
- 清空 commit buffer
- 让所有正在生成的回答失效
- 重置 session

同时后端广播 `session_cleared` 事件，前端收到后立即执行本地 `clearSession()`，避免旧 UI 残留。

### Ask From Server Screen

主进程直接调用后端 `POST /api/ask-from-server-screen`。

该接口本身已具备高优先级语义：

- 先清空所有答题工作
- 只保留这次服务端截图编程题回答

设置页和按钮文案统一使用“服务端截图审题”，避免误导为固定左侧截图。

## Validation Rules

- 仅允许 `CommandOrControl + 单个非修饰键`
- 3 个动作的快捷键不能重复
- 注册失败时保留旧键，并在 UI 中标记失败

## Testing

需要验证：

1. 默认键位可成功注册
2. 修改后重启应用仍能恢复
3. `CommandOrControl+.` 会立即硬清空当前实时辅助
4. `CommandOrControl+/` 会直接触发服务端截图审题
5. 配置重复键位会被拒绝
6. 前端设置页能正确展示主进程返回的注册状态
