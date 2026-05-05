# Linear 风格状态看板任务视图设计

## 状态

已确认方向：B，状态看板 + 详情面板。

本文件是实现前规格，不包含源码实现。实现前仍需用户再次确认本 spec。

## 背景

当前应用的任务感知能力主要来自 session metadata，而不是独立 todo 数据模型：

- `sessionStatus` 是任务状态来源，状态配置在 workspace 级别维护。
- `views.json` 提供动态 session 视图，表达式基于 session metadata 计算。
- `SessionList` 已支持按日期、状态、未读分组，并复用搜索、过滤、分页、键盘导航链路。
- `AppShell` 已按当前 session filter 保存状态筛选、标签筛选和分组设置。

Linear 官方 display options 的核心是同一批 issue 可以通过 list、board、filter、group、sort 组合查看；本设计沿用这个模式，把 sessions 以任务看板呈现。

参考：<https://linear.app/docs/display-options>

## 目标

新增一个 Linear 风格状态看板视图，用于更直观地管理 sessions/tasks：

- 按 `sessionStatus` 分列展示任务。
- 在卡片上展示任务摘要、标签、更新时间和关键运行状态。
- 点击卡片只选中并展示详情，不直接打开聊天。
- 通过详情栏或卡片菜单更改状态、标签、标记、归档等现有 session 操作。
- 用 `Open chat` 明确进入会话内容面板。

## 非目标

首版不做这些能力：

- 拖拽跨列改状态。
- WIP limits。
- 批量拖动。
- 跨列复杂虚拟化。
- 新增后端任务模型或复制一份 task 存储。
- 改造 agent runtime、聊天流、release 或外部同步。

## 产品结构

### 入口

在 sessions navigator 的 toolbar 增加 display mode 切换：

- `List`
- `Board`

Board mode 对当前 session filter 生效，包括：

- All sessions
- Flagged
- Status 子视图
- Label 子视图
- Dynamic views

显示模式按现有 per-view key 持久化。用户在 `allSessions` 选 Board，不影响某个 label view 的 List/Board 偏好。

### 看板布局

Board mode 使用三段布局：

- 顶部 toolbar：标题、List/Board toggle、Filter、Sort。
- 中间 board：横向状态列，纵向滚动卡片。
- 右侧 inspector：当前选中卡片的任务详情。

状态列来自 workspace status config，按配置顺序显示。列头展示状态图标、状态名称和数量。空列保留，方便用户理解完整流程。

### 卡片内容

卡片展示：

- session title。
- labels。
- 更新时间。
- 未读、运行中、pending plan、pending prompt 等状态标记。
- 可选 token/cost 简短信息，空间不足时隐藏。

卡片操作：

- 单击：选中卡片并刷新右侧 inspector。
- 双击或 `Enter`：Open chat。
- 右键或 more menu：复用现有 session menu 能力。
- 状态变更：通过菜单或 inspector 内 status selector。

首版不支持拖拽。这样能先验证看板信息架构，不把范围扩大到拖拽排序系统。

### Inspector

右侧 inspector 固定在 board 内部，不复用全局 right sidebar。原因：当前全局 right sidebar 类型只有 `files | history | none`，把 task detail 塞进去会污染导航模型。

Inspector 展示：

- 标题。
- Status selector。
- Labels。
- Permission mode。
- Model / connection 简要信息。
- 更新时间、创建时间。
- Token/cost 使用。
- Preview text。
- `Open chat` 操作。

没有选中卡片时显示空状态，提示用户选择一张任务卡。

## 数据流

Board 不新增持久化 task 数据。它消费现有 sessions metadata：

1. `AppShell` 读取当前 workspace sessions、statuses、labels、views。
2. Board 使用与 `SessionList` 同源的 current filter、status filter、label filter、search query。
3. Board 将过滤后的 sessions 按 `sessionStatus` 分组。
4. 列内按 `lastMessageAt` 降序排序。
5. 状态变更调用现有 `onSessionStatusChange(sessionId, stateId)`。
6. `Open chat` 调用现有 route builder 进入对应 session route。

缺失或无效 `sessionStatus` 继续通过已有状态验证逻辑落到默认状态。

## 组件边界

建议新增这些 renderer 组件：

- `SessionBoard`
  - Board 容器，接收 sessions、statuses、filters、labels 和 callbacks。
- `SessionBoardColumn`
  - 渲染单个状态列。
- `SessionBoardCard`
  - 渲染单张 session task card。
- `SessionBoardInspector`
  - 渲染选中 session 的详情和操作。
- `session-board-utils.ts`
  - 纯函数：过滤结果分组、排序、默认选中、计数。

必要时从 `useSessionSearch` 或 `SessionList` 中抽出纯过滤 helper，避免复制 current filter 逻辑。

## 状态与持久化

扩展现有 per-view filter storage：

```ts
type SessionDisplayMode = 'list' | 'board'

type ViewFiltersMap = Record<string, {
  statuses: FilterEntry
  labels: FilterEntry
  groupingMode?: ChatGroupingMode
  displayMode?: SessionDisplayMode
}>
```

默认 `displayMode` 为 `list`。这是 UI 偏好默认值，不需要迁移旧数据文件。

Board 内部维护当前选中 session id。切换 filter 后：

- 如果当前选中 session 仍在过滤结果内，保持选中。
- 否则选择第一列里的第一张卡片。
- 没有卡片时清空 inspector。

## 响应式行为

宽屏：board 和 inspector 同屏。

窄屏或 compact mode：

- Board 占满 navigator/content 区。
- 点击卡片进入 inspector overlay 或下方 detail 面板。
- `Open chat` 使用现有 compact navigation 行为。

首版可以先保证桌面宽屏体验，再用简单 responsive 规则避免窄屏布局破裂。

## 视觉原则

应用界面走 Linear 风格 restraint：

- 高密度但可读。
- 低 chrome，少阴影。
- 列和卡片只保留必要边界。
- 状态颜色来自现有 status color resolver。
- 不新增装饰性渐变、营销式 hero 或卡片套卡片。

## 测试计划

实现时至少覆盖：

- 纯函数测试：sessions 按状态分组、列内排序、无效状态 fallback、空列计数。
- 组件测试：Board 渲染状态列、卡片点击更新 inspector、`Open chat` 调用 navigation callback。
- 状态变更测试：通过 inspector status selector 调用 `onSessionStatusChange`。
- 持久化测试：List/Board display mode 按 view key 独立保存。
- 手动真实流程：启动 Electron，进入 All sessions，切 Board，筛选 label/status，选卡片，看详情，改状态，Open chat。

## 分阶段实现

1. 抽出可测试的 session board 数据 helper。
2. 增加 `displayMode` 偏好和 toolbar toggle。
3. 实现 board columns/cards。
4. 实现 inspector 与状态操作。
5. 接入导航和现有 session menu。
6. 补测试并跑真实 Electron 流程。
