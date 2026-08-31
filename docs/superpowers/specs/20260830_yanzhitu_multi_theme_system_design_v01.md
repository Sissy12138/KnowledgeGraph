# 研知图多主题系统设计 v01

## 1. 目标

为整个前端界面和知识图谱建立统一、可切换、可测试的开发期主题系统。开发者只需修改一个默认主题标识，即可切换整套界面与图谱视觉；新增主题不需要修改组件或页面 CSS。

本期内置三套主题，并在左侧导航栏底部提供正式用户显示设置控件：

- `softResearch`：明亮、柔和的科研配色，作为默认主题。
- `coolMinimal`：偏冷的蓝灰极简配色。
- `warmPaper`：偏暖的纸张与米色配色。

## 2. 设计原则

1. **单一数据源**：界面颜色、语义状态色、图谱颜色、字体、字号、圆角和阴影均来自同一个 TypeScript 主题对象。
2. **语义优先**：页面使用 `primary`、`surface`、`danger` 等语义变量，不直接依赖具体色号。
3. **图例一致**：图谱节点与对应图例始终读取同一个节点样式配置。
4. **可访问性**：浅色节点统一使用深色文字；成功、警告、错误继续保留绿、黄、红语义。
5. **正式用户功能**：主题与字号选择立即生效并保存在浏览器中，不依赖重新加载页面。

## 3. 架构

### 3.1 主题配置

新增 `src/styles/app-theme.ts`，导出：

```ts
export type AppThemeId = 'softResearch' | 'coolMinimal' | 'warmPaper'

export const APP_THEMES: Record<AppThemeId, AppTheme>
export const DEFAULT_THEME_ID: AppThemeId = 'softResearch'
export function applyAppTheme(themeId: AppThemeId): void
export function getAppTheme(themeId?: AppThemeId): AppTheme
```

`AppTheme` 分为四个区域：

```ts
type AppTheme = {
  interface: InterfaceTheme
  semantic: SemanticTheme
  graph: GraphTheme
  shape: ShapeTheme
}
```

- `interface`：页面背景、三级表面、主色及其浅色状态、文字、次级文字、边框、侧栏、反白文字及焦点色。
- `semantic`：成功、警告、错误、信息的前景色、背景色和边框色。
- `graph`：五类节点样式、节点选择边框、连线颜色及图谱文字设置。
- `shape`：卡片圆角、控件圆角和卡片阴影。

模块内部保存 `activeThemeId`。`applyAppTheme(themeId)` 同时更新活动主题和 CSS 变量；`getAppTheme()` 在未传参数时返回当前活动主题，传入参数时返回指定预设。这样图谱与页面始终读取同一主题。

### 3.2 CSS 变量映射

`applyAppTheme()` 将主题中与页面有关的字段写入 `document.documentElement.style`：

- `--color-primary`
- `--color-primary-deep`
- `--color-primary-soft`
- `--color-primary-border`
- `--color-background`
- `--color-surface`
- `--color-surface-subtle`
- `--color-surface-muted`
- `--color-sidebar`
- `--color-sidebar-text`
- `--color-sidebar-muted`
- `--color-text`
- `--color-text-soft`
- `--color-muted`
- `--color-border`
- `--color-focus`
- `--color-on-primary`
- `--color-success-*`
- `--color-warning-*`
- `--color-danger-*`
- `--color-info-*`
- `--font-interface`
- `--font-size-base`
- `--font-size-root`
- `--radius-card`
- `--radius-control`
- `--shadow-card`

`main.tsx` 在 React 挂载前调用 `readStoredDisplayPreferences()`，再应用已保存的主题和字号；没有有效偏好时使用 `softResearch` 与 `100%`。初始化结果作为 Provider 的初始值，避免首次绘制后再次切换造成闪烁。

`tokens.css` 保留同值回退变量，确保测试环境、无 JavaScript 首屏或主题初始化异常时仍有稳定样式。

### 3.3 显示偏好状态

新增 `DisplayPreferencesProvider` 和 `useDisplayPreferences()`，暴露：

```ts
type DisplayPreferences = {
  themeId: AppThemeId
  fontScalePercent: number
  setThemeId: (themeId: AppThemeId) => void
  setFontScalePercent: (percent: number) => void
  resetDisplayPreferences: () => void
}

type StoredDisplayPreferences = Pick<DisplayPreferences, 'themeId' | 'fontScalePercent'>

function readStoredDisplayPreferences(): StoredDisplayPreferences
```

Provider 在首次初始化时读取以下本地键：

- `yanzhitu.display.theme`
- `yanzhitu.display.fontScalePercent`

主题值必须属于 `AppThemeId`；字号必须是 `85–130` 之间的整数。缺失、越界或格式错误时分别回退到 `softResearch` 和 `100`。更新偏好时同步写入本地存储；存储读写失败不得阻断页面渲染。

Provider 根据比例计算实际根字号并写入 `--font-size-root`，例如 `100% → 16px`、`110% → 17.6px`。根元素使用 `font-size: var(--font-size-root)`，界面中以 `rem` 表达的文字随之缩放。图谱节点文字显式使用 `基础字号 × fontScalePercent / 100`，节点圆形尺寸不随字号变化。

### 3.4 图谱样式消费

`graph-transform.ts` 不再维护 `NODE_COLORS` 或固定字体值，而是从 `getAppTheme()` 读取：

```ts
graph.nodes[nodeType] = {
  background,
  text,
  fontFamily,
  fontSize,
}
```

节点和图例分类使用相同的 `background`。节点文字使用各类型配置的 `text`、`fontFamily` 和缩放后 `fontSize`。GraphCanvas 订阅显示偏好；主题或字号改变时只更新 ECharts 呈现配置，不重新请求图谱数据，不清除选择、搜索、视口或上下文开关。作者网络中最小的 `20 px` 节点仍不常驻显示姓名，悬停提示行为不变。

### 3.5 左侧栏显示设置控件

新增极简控件，位于现有左侧导航栏最底部，通过 `margin-top: auto` 保持左下对齐。控件无卡片标题，三项水平排列：

1. **主题框**：原生选择框，显示“柔和科研”“冷色极简”“暖色纸张”。可访问名称为“界面主题”。
2. **字号框**：自定义组合框，常态显示当前百分比。单击打开 `85%–130%`、步长 `5%` 的预设列表；双击切换为数字输入；键盘 `F2` 同样进入输入模式。手动值允许 `85–130` 的任意整数。
3. **重置按钮**：仅显示回转箭头图标，视觉保持极简；可访问名称为“恢复默认显示设置”。重置后主题为 `softResearch`，字号为 `100%`。

字号输入规则：

- `Enter` 或失去焦点应用有效值。
- `Escape` 取消编辑并恢复进入编辑前的值。
- 小于 `85` 或大于 `130` 的值不应用，保留编辑状态并显示简短校验提示“请输入 85–130 之间的整数”。
- 预设列表支持上下方向键、Home、End、Enter 和 Escape。

桌面端三项并排。`760 px` 以下侧栏改为横向导航时，显示设置仍作为一个不可拆分的紧凑组跟随导航项，不遮挡或挤压主内容。

### 3.6 页面样式迁移

以下样式中的业务色号迁移到主题变量：

- `src/index.css`
- `src/styles/tokens.css`
- `src/styles/layout.css`
- `src/features/graph/GraphPage.css`
- `src/features/papers/PaperListPage.css`
- `src/features/papers/PaperDetailPage.css`
- `src/features/suggestions/SuggestionReviewPage.css`
- `src/features/analysis/AnalysisProgressPanel.css`

布局尺寸、间距、响应式断点和交互行为不在本次修改范围。仅将具有主题含义的固定色值、字体和通用圆角替换为语义变量；界面文字字号统一使用 `rem`，确保比例完整覆盖；图表数据颜色以外的纯透明值可保留。

## 4. 默认配色

### 4.1 `softResearch`

界面：

| 语义 | 色值 |
|---|---|
| 页面背景 | `#F6F8FC` |
| 卡片/画布 | `#FFFFFF` |
| 主文字 | `#172033` |
| 次级文字 | `#667085` |
| 边框 | `#E3E8F2` |
| 主色 | `#5B68D6` |
| 主色深色 | `#4855B8` |
| 主色浅底 | `#EEF0FF` |
| 主色浅边框 | `#C7CDF8` |
| 次浅表面 | `#F8FAFC` |
| 加深表面 | `#F1F4F9` |
| 柔和文字 | `#475467` |
| 侧栏 | `#252A3D` |
| 侧栏文字 | `#CBD2E3` |
| 侧栏弱文字 | `#929AB2` |
| 焦点色 | `#818CF8` |
| 反白文字 | `#FFFFFF` |

图谱：

| 节点类型 | 背景色 | 文字色 |
|---|---|---|
| 论文 | `#BDD7FF` | `#111827` |
| 作者 | `#DCCBFF` | `#111827` |
| 概念 | `#AEEBE7` | `#111827` |
| 方法 | `#FFE0A8` | `#111827` |
| 发现 | `#C5E8C9` | `#111827` |

图谱连线使用 `#94A3B8`。默认图谱字体为 `Inter, "Segoe UI", "Microsoft YaHei", sans-serif`，五类节点默认字号均为 `12 px`，各节点类型允许单独覆盖。界面基础字号为 `16 px`，卡片圆角为 `12 px`，控件圆角为 `8 px`，卡片阴影为 `0 18px 48px rgba(23, 32, 51, 0.10)`。

### 4.2 `coolMinimal`

界面：

| 语义 | 色值 |
|---|---|
| 页面背景 | `#F4F7FA` |
| 卡片/画布 | `#FBFDFF` |
| 主文字 | `#172133` |
| 次级文字 | `#66768A` |
| 边框 | `#DCE4EC` |
| 主色 | `#5277A8` |
| 主色深色 | `#3F5F87` |
| 主色浅底 | `#EAF1F8` |
| 主色浅边框 | `#C4D5E6` |
| 次浅表面 | `#F7FAFC` |
| 加深表面 | `#EDF2F6` |
| 柔和文字 | `#405066` |
| 侧栏 | `#24313F` |
| 侧栏文字 | `#CCD8E5` |
| 侧栏弱文字 | `#8EA0B2` |
| 焦点色 | `#6F91BA` |
| 反白文字 | `#FFFFFF` |

图谱节点：论文 `#C6DCF2`、作者 `#D8D2EC`、概念 `#BFE3E0`、方法 `#E8D8B8`、发现 `#CFE2D1`；文字统一为 `#111827`，连线为 `#91A2B3`。

### 4.3 `warmPaper`

界面：

| 语义 | 色值 |
|---|---|
| 页面背景 | `#F7F3EA` |
| 卡片/画布 | `#FFFCF6` |
| 主文字 | `#2B2925` |
| 次级文字 | `#746E64` |
| 边框 | `#E7DED0` |
| 主色 | `#8C5B43` |
| 主色深色 | `#724733` |
| 主色浅底 | `#F4EAE3` |
| 主色浅边框 | `#DDBFAC` |
| 次浅表面 | `#FAF7F1` |
| 加深表面 | `#F0E9DE` |
| 柔和文字 | `#5F584F` |
| 侧栏 | `#332F2A` |
| 侧栏文字 | `#DED5C9` |
| 侧栏弱文字 | `#A79D90` |
| 焦点色 | `#B98262` |
| 反白文字 | `#FFFFFF` |

图谱节点：论文 `#C9D9E8`、作者 `#DCCFE2`、概念 `#C6DDD3`、方法 `#F1D5A5`、发现 `#D1DFC3`；文字统一为 `#171512`，连线为 `#A59C90`。

三套主题必须完整提供相同字段，不允许通过运行时猜测缺失值。

`coolMinimal` 与 `warmPaper` 使用与默认主题相同的字体、基础字号和圆角；阴影颜色分别使用 `rgba(23, 33, 51, 0.09)` 与 `rgba(43, 41, 37, 0.10)`。

## 5. 状态色

每个主题都必须提供以下完整组合：

- `success.foreground/background/border`
- `warning.foreground/background/border`
- `danger.foreground/background/border`
- `info.foreground/background/border`

状态色允许在不同主题下调整明度和饱和度，但语义色相保持：成功为绿色、警告为黄色或琥珀色、错误为红色、信息为蓝色。

本期三套主题统一采用以下状态色，未来可在单个主题内覆盖：

| 状态 | 前景色 | 背景色 | 边框色 |
|---|---|---|---|
| 成功 | `#166534` | `#F0FDF4` | `#BBF7D0` |
| 警告 | `#92400E` | `#FFFBEB` | `#FDE68A` |
| 错误 | `#991B1B` | `#FEF2F2` | `#FECACA` |
| 信息 | `#1E40AF` | `#EFF6FF` | `#BFDBFE` |

## 6. 容错与边界

- `getAppTheme()` 只接受 `AppThemeId` 联合类型；开发期写错主题名必须产生 TypeScript 错误。
- 所有主题对象通过 `satisfies Record<AppThemeId, AppTheme>` 检查字段完整性。
- `applyAppTheme()` 只设置预先定义的 CSS 变量，不遍历任意对象生成未知变量。
- 主题切换不得修改图谱数据、选择状态、搜索状态或上下文开关。
- 本期不增加系统深色模式，不跨设备同步偏好，也不提供自定义取色器。

## 7. 测试与验证

### 7.1 自动测试

1. `app-theme.test.ts`：验证三套主题字段完整，默认主题为 `softResearch`，CSS 变量映射正确。
2. `DisplayPreferencesProvider.test.tsx`：验证有效偏好恢复、无效值回退、更新持久化、存储异常容错和重置。
3. `DisplaySettings.test.tsx`：验证主题选择、字号预设、双击/F2 编辑、范围校验、键盘操作和重置。
4. `graph-transform.test.ts`：验证五类节点读取主题颜色和字体，图例颜色与节点一致，主题和字号变化可生成另一套呈现样式。
5. 现有页面和图谱测试继续通过，防止主题迁移改变交互或数据行为。

### 7.2 静态检查

- TypeScript 构建通过。
- oxlint 通过。
- 目标 CSS 文件中不再保留属于主题语义的业务色号；透明、阴影内部 alpha 或第三方资源色值除外。

### 7.3 浏览器验证

分别切换三套主题并调整字号，检查：

- 应用外壳、侧栏、卡片、按钮和焦点状态。
- 文献列表、文献详情、建议审核、分析进度的成功/警告/错误状态。
- 四类知识图谱视图中的节点、图例、文字、连线和选中状态。
- 浅色节点上的黑色文字清晰可读；最小作者节点保持无常驻姓名、悬停显示姓名。
- 主题、字号和重置控件位于侧栏左下方，刷新后有效偏好得到恢复。

## 8. 后续扩展

后续可在不改变主题数据结构的前提下增加自定义主题、系统深色模式或服务端账户同步。本期的本地偏好键可作为迁移来源，但不得被当作跨设备配置接口。
