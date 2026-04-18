# Interactive Terminal Panel Design

Date: 2026-04-18
Status: Draft for review
Scope: `apps/electron`, `packages/ui`, Electron preload/main terminal runtime

## 1. Goal

为 `craft-agents-oss` 的 Electron 客户端增加类似 VS Code / paseo 的内嵌交互终端面板，并按完整能力设计与实施，而不是只做工具输出预览。

目标能力：

- 真正的 PTY 终端，不是静态输出卡片
- 底部主终端区 + 右侧详情面板的混合式布局
- 多 tab
- split pane
- 当前 workspace / cwd 启动
- 终端输入、输出、resize、退出态
- 终端会话布局持久化
- 应用重启后的终端恢复
- 与现有 chat / task / permission / output 体系做桥接，但不把终端塞进旧输出组件里

非目标：

- 第一阶段不做 web viewer / headless server 共享终端
- 不把现有 `TerminalOutput` 改造成交互终端
- 不把旧 background shell 语义原样复用成 PTY 内核

## 2. User Experience

主布局采用混合式：

- 底部 `TerminalDock` 作为真实终端主工作区
- 右侧 `TerminalInspector` 显示当前终端会话详情与操作

默认交互：

- `Cmd/Ctrl + J` 展开/收起终端面板
- tab bar 支持新建、关闭、排序、切换
- 当前 tab 支持 split，第一版只允许二分，不开放无限嵌套
- 点击 pane 即激活对应终端
- 终端关闭、退出、恢复失败都在右侧详情面板有明确状态，不把错误埋进滚动输出里

## 3. Current Constraints

当前仓库已有终端相关能力，但不足以承载交互终端：

- `apps/cli/src/index.ts` 提供 CLI 客户端
- `packages/ui/src/components/terminal/TerminalOutput.tsx` 只负责命令与输出展示
- `packages/server-core/src/sessions/SessionManager.ts` 只维护 background shell / output / kill 语义

因此新终端必须是独立体系：

- 独立的 PTY 生命周期
- 独立的 renderer 状态
- 独立的 IPC 契约
- 与 chat/task 做桥接，而不是反向嵌套进旧消息视图

## 4. Recommended Architecture

推荐方案：分层终端内核型。

### 4.1 Renderer View Layer

新增 UI 组件：

- `TerminalDock`
- `TerminalTabBar`
- `TerminalSplitView`
- `TerminalPane`
- `TerminalInspector`
- `TerminalEmptyState`
- `TerminalRestoreErrorState`

职责：

- 渲染 `xterm`
- 响应用户键盘、焦点、tab、split、resize 操作
- 显示终端状态与详情
- 不直接管理进程

### 4.2 Renderer State Layer

新增独立 terminal state store，不混入现有 chat state。

职责：

- tab / split / active pane / dock visibility / inspector visibility
- session 到 pane 的映射
- 恢复中的 UI 状态
- 未读输出提示
- 最近激活顺序

设计原则：

- pane 是视图结构
- session 是 PTY 进程实体
- 二者必须解耦

### 4.3 Electron Main Terminal Runtime

新增 `TerminalManager`，作为唯一 PTY owner。

职责：

- 创建 / 关闭 / kill `node-pty`
- 输入与 resize 分发
- 标题、cwd、exit、状态变更事件上报
- 终端布局快照与恢复
- scrollback 缓冲与摘要

终端 runtime 只存在于 Electron main，不进入 renderer。

### 4.4 Preload / IPC Layer

通过 typed preload API 暴露终端能力，屏蔽底层 PTY 实现。

请求接口：

- `createTerminal`
- `writeTerminal`
- `resizeTerminal`
- `splitTerminal`
- `closeTerminal`
- `killTerminal`
- `renameTerminal`
- `listTerminals`
- `restoreTerminals`
- `clearTerminalScrollback`

事件接口：

- `terminal:data`
- `terminal:exit`
- `terminal:title`
- `terminal:cwdChanged`
- `terminal:stateChanged`
- `terminal:bell`

## 5. Data Model

### 5.1 TerminalSession

表示一个真实 PTY 会话。

建议字段：

- `id`
- `workspaceId`
- `cwd`
- `shell`
- `title`
- `status`
- `cols`
- `rows`
- `pid`
- `createdAt`
- `lastActiveAt`
- `restored`
- `exitCode`
- `exitSignal`
- `lastOutputSummary`

`status` 枚举：

- `starting`
- `running`
- `exited`
- `killed`
- `failed`
- `restoring`

### 5.2 TerminalPane

表示一个 UI pane。

建议字段：

- `id`
- `sessionId`
- `tabId`
- `splitParentId`
- `direction`
- `size`

### 5.3 TerminalTab

表示一个 tab 容器。

建议字段：

- `id`
- `title`
- `rootPaneId`
- `activeSessionId`
- `createdAt`

### 5.4 TerminalSnapshot

表示可恢复状态。

建议字段：

- `dockVisible`
- `dockHeight`
- `tabs`
- `panes`
- `activeTabId`
- `sessionLaunchConfigs`
- `inspectorVisible`
- `selectedInspectorSessionId`

## 6. Persistence And Restore

### 6.1 What Persists

持久化：

- dock 布局
- tab / pane 结构
- 每个 session 的启动参数（`cwd`、shell、title）
- 活跃 tab / pane
- 最近输出摘要

### 6.2 What Does Not Persist

不把完整 scrollback 直接塞进主配置存储。

原因：

- 体积不可控
- 配置污染严重
- 读取开销过大

scrollback 单独放本地缓存文件，由 `TerminalManager` 管理。

### 6.3 Restore Semantics

应用重启后恢复“终端定义”，不承诺恢复原 PTY 进程本体。

恢复流程：

1. 读取 `TerminalSnapshot`
2. 还原 tab / pane 布局
3. 重新按原 `cwd/shell/title` 拉起 session
4. 标记为 `restored`
5. 若恢复失败，pane 保留，但展示错误态和一键重启

理由：

- 保持完整体验
- 避免把“跨应用重启保活真实 PTY”作为第一阶段硬约束
- 降低平台差异与崩溃恢复复杂度

## 7. Integration With Existing Systems

### 7.1 Chat

终端是 chat workspace 的共享工作台，不属于某条消息卡片。

集成点：

- 在聊天页中显示 `TerminalDock`
- 支持从 chat 上下文以当前 workspace cwd 新建终端

### 7.2 Task / Background Shell

旧 task/background shell 不直接变成新 PTY 内核。

只提供桥接动作：

- `Open Output in Terminal`
- `Rerun in Terminal`

### 7.3 Permission Request

permission request 现有流程保留。

扩展策略：

- 长驻或交互型 bash 批准后，可允许在 terminal 中继续承接
- 但 permission state 不嵌进 terminal state store

### 7.4 Existing Terminal Output Preview

`packages/ui/src/components/terminal/TerminalOutput.tsx` 继续作为工具输出预览组件保留。

不做：

- 不嵌入 `xterm`
- 不接收用户输入
- 不承载 PTY 生命周期

## 8. UI Details

### 8.1 Bottom Dock

- 可收起/展开
- 可拖拽高度
- 支持 keyboard focus
- 有 tab bar、split controls、new terminal action

### 8.2 Terminal Inspector

显示：

- cwd
- shell
- pid
- status
- 启动时间
- 最近活跃时间
- cols / rows
- last output summary
- exit code / signal

操作：

- restart
- clear scrollback
- copy cwd
- reveal in file manager
- kill session

### 8.3 Split Scope

第一阶段 split 只支持二分：

- horizontal
- vertical

不支持无限递归 split tree，避免状态模型过早膨胀。

## 9. Error Handling

必须显式建模以下错误：

- PTY create failure
- shell path invalid
- cwd missing / permission denied
- resize failure
- restore failure
- session already closed
- IPC event out of order

策略：

- 错误进入 `TerminalSession.status`
- inspector 显示结构化错误
- 用户可重试 / 重启 / 清理
- 不允许 silently fail

## 10. Testing Strategy

按 TDD 分 4 层：

### 10.1 Main Runtime Tests

覆盖：

- `TerminalManager` create
- write / resize
- close / kill
- state transitions
- restore logic

### 10.2 IPC Contract Tests

覆盖：

- preload API 与 main handlers 对齐
- invalid sessionId
- duplicate close
- restore failure

### 10.3 Renderer State Tests

覆盖：

- tab/split/layout state
- active pane switching
- dock / inspector visibility
- restore UI state

### 10.4 Integration Tests

使用真实 PTY 验证：

- 输入回显
- resize 生效
- exit 事件更新 UI
- restore 后可重新拉起 session

## 11. Implementation Sequence

1. 补主进程 `TerminalManager` 失败测试
2. 接入 `node-pty`
3. 建 typed IPC / preload contract
4. 建 renderer terminal store
5. 落 `TerminalDock` / `TerminalInspector` / `TerminalPane`
6. 接入 `xterm` 与 addons
7. 接入恢复、摘要、错误态
8. 接 chat/task/permission 桥接
9. 跑类型检查、定向测试、手动验证

## 12. Open Questions Resolved

- 功能范围：按完整能力推进
- 主布局：混合式 `C`
- 架构：分层终端内核型
- 恢复语义：恢复终端定义，不强保活旧 PTY 进程

## 13. Acceptance Criteria

以下都成立才算完成：

- Electron 内可打开底部终端 dock
- 可创建多个终端 tab
- 单个 tab 可 split 为两个 pane
- 用户输入可实时回显
- resize 会同步到底层 PTY
- session 退出后 UI 状态正确更新
- 重启 app 后可恢复布局并重新拉起终端
- 右侧 inspector 可显示会话详情与错误态
- 现有 `TerminalOutput` 仍保持工具输出预览职责，不被交互终端污染
