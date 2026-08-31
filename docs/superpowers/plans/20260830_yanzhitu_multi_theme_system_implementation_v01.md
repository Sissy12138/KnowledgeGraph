# 研知图多主题系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立三套可即时切换的全局主题、可持久化的字号比例，以及位于侧栏左下方的极简正式用户控件，并让知识图谱与全部页面同步响应。

**Architecture:** `app-theme.ts` 是颜色、字体、字号、圆角和阴影的唯一数据源，并把界面值映射成 CSS 变量。`DisplayPreferencesProvider` 管理主题 ID、字号百分比和本地存储；普通页面依赖 CSS 变量，GraphCanvas 把当前偏好传给纯函数转换层生成 ECharts 呈现配置。

**Tech Stack:** React 19、TypeScript、CSS custom properties、ECharts、Vitest、Testing Library、oxlint、Vite。

**Spec:** `docs/superpowers/specs/20260830_yanzhitu_multi_theme_system_design_v01.md`

## Global Constraints

- 默认主题必须是 `softResearch`，另提供 `coolMinimal` 与 `warmPaper`。
- 字号范围 `85–130`，预设步长 `5`，手动输入允许范围内任意整数，默认 `100`。
- 主题和字号写入 `yanzhitu.display.theme` 与 `yanzhitu.display.fontScalePercent`。
- 主题或字号变化不得重新请求图谱数据，不得清除选择、搜索、视口或上下文开关。
- 图谱节点大小不随字号比例变化；作者网络最小 `20 px` 节点仍不常驻姓名。
- 不增加系统深色模式、自定义取色器或跨设备同步。
- 当前目录不是 Git 仓库；计划中的每个任务以测试检查点代替 commit，不执行任何 Git 写操作。

---

### Task 1: 三套主题与 CSS 变量映射

**Files:**
- Create: `src/styles/app-theme.ts`
- Create: `src/styles/app-theme.test.ts`
- Modify: `src/styles/tokens.css`

**Interfaces:**
- Consumes: `GraphNodeType` from `src/features/graph/graph.types.ts`。
- Produces: `AppThemeId`、`AppTheme`、`APP_THEMES`、`DEFAULT_THEME_ID`、`getAppTheme(themeId?)`、`applyAppTheme(themeId)`、`applyFontScale(percent)`。

- [ ] **Step 1: 写主题注册表和变量映射的失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  APP_THEMES,
  DEFAULT_THEME_ID,
  applyAppTheme,
  applyFontScale,
  getAppTheme,
} from './app-theme'

describe('app theme', () => {
  it('提供三个完整主题并默认使用柔和科研', () => {
    expect(Object.keys(APP_THEMES)).toEqual(['softResearch', 'coolMinimal', 'warmPaper'])
    expect(DEFAULT_THEME_ID).toBe('softResearch')
    for (const theme of Object.values(APP_THEMES)) {
      expect(Object.keys(theme.graph.nodes)).toEqual(['paper', 'author', 'concept', 'method', 'finding'])
      expect(theme.semantic.danger).toEqual(expect.objectContaining({
        foreground: expect.stringMatching(/^#/),
        background: expect.stringMatching(/^#/),
        border: expect.stringMatching(/^#/),
      }))
    }
  })

  it('把主题和字号映射到根元素变量并更新活动主题', () => {
    applyAppTheme('warmPaper')
    applyFontScale(117)
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')
    expect(document.documentElement.style.getPropertyValue('--graph-node-concept')).toBe('#C6DDD3')
    expect(document.documentElement.style.getPropertyValue('--font-size-root')).toBe('18.72px')
    expect(getAppTheme()).toBe(APP_THEMES.warmPaper)
  })
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npx.cmd vitest run src/styles/app-theme.test.ts`

Expected: FAIL，提示无法解析 `./app-theme`。

- [ ] **Step 3: 实现类型、三套完整主题和显式变量映射**

```ts
export type AppThemeId = 'softResearch' | 'coolMinimal' | 'warmPaper'
export type NodeVisualStyle = {
  background: string
  text: string
  fontFamily: string
  fontSize: number
}
export type AppTheme = {
  interface: {
    primary: string; primaryDeep: string; primarySoft: string; primaryBorder: string
    background: string; surface: string; surfaceSubtle: string; surfaceMuted: string
    sidebar: string; sidebarText: string; sidebarMuted: string
    text: string; textSoft: string; muted: string; border: string
    focus: string; onPrimary: string; fontFamily: string; baseFontSize: number
  }
  semantic: Record<'success' | 'warning' | 'danger' | 'info', {
    foreground: string; background: string; border: string
  }>
  graph: {
    nodes: Record<GraphNodeType, NodeVisualStyle>
    edge: string; selectedBorder: string
  }
  shape: { cardRadius: string; controlRadius: string; cardShadow: string }
}

const FONT = 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif'
const SEMANTIC = {
  success: { foreground: '#166534', background: '#F0FDF4', border: '#BBF7D0' },
  warning: { foreground: '#92400E', background: '#FFFBEB', border: '#FDE68A' },
  danger: { foreground: '#991B1B', background: '#FEF2F2', border: '#FECACA' },
  info: { foreground: '#1E40AF', background: '#EFF6FF', border: '#BFDBFE' },
}
const node = (background: string, text = '#111827'): NodeVisualStyle => ({
  background, text, fontFamily: FONT, fontSize: 12,
})
const makeTheme = (
  interfaceTheme: AppTheme['interface'],
  nodeColors: Record<GraphNodeType, string>,
  nodeText: string,
  edge: string,
  shadow: string,
): AppTheme => ({
  interface: interfaceTheme,
  semantic: SEMANTIC,
  graph: {
    nodes: {
      paper: node(nodeColors.paper, nodeText), author: node(nodeColors.author, nodeText),
      concept: node(nodeColors.concept, nodeText), method: node(nodeColors.method, nodeText),
      finding: node(nodeColors.finding, nodeText),
    },
    edge,
    selectedBorder: interfaceTheme.onPrimary,
  },
  shape: { cardRadius: '12px', controlRadius: '8px', cardShadow: shadow },
})

export const DEFAULT_THEME_ID: AppThemeId = 'softResearch'
export const APP_THEMES = {
  softResearch: makeTheme(
    { primary: '#5B68D6', primaryDeep: '#4855B8', primarySoft: '#EEF0FF', primaryBorder: '#C7CDF8', background: '#F6F8FC', surface: '#FFFFFF', surfaceSubtle: '#F8FAFC', surfaceMuted: '#F1F4F9', sidebar: '#252A3D', sidebarText: '#CBD2E3', sidebarMuted: '#929AB2', text: '#172033', textSoft: '#475467', muted: '#667085', border: '#E3E8F2', focus: '#818CF8', onPrimary: '#FFFFFF', fontFamily: FONT, baseFontSize: 16 },
    { paper: '#BDD7FF', author: '#DCCBFF', concept: '#AEEBE7', method: '#FFE0A8', finding: '#C5E8C9' },
    '#111827', '#94A3B8', '0 18px 48px rgba(23, 32, 51, 0.10)',
  ),
  coolMinimal: makeTheme(
    { primary: '#5277A8', primaryDeep: '#3F5F87', primarySoft: '#EAF1F8', primaryBorder: '#C4D5E6', background: '#F4F7FA', surface: '#FBFDFF', surfaceSubtle: '#F7FAFC', surfaceMuted: '#EDF2F6', sidebar: '#24313F', sidebarText: '#CCD8E5', sidebarMuted: '#8EA0B2', text: '#172133', textSoft: '#405066', muted: '#66768A', border: '#DCE4EC', focus: '#6F91BA', onPrimary: '#FFFFFF', fontFamily: FONT, baseFontSize: 16 },
    { paper: '#C6DCF2', author: '#D8D2EC', concept: '#BFE3E0', method: '#E8D8B8', finding: '#CFE2D1' },
    '#111827', '#91A2B3', '0 18px 48px rgba(23, 33, 51, 0.09)',
  ),
  warmPaper: makeTheme(
    { primary: '#8C5B43', primaryDeep: '#724733', primarySoft: '#F4EAE3', primaryBorder: '#DDBFAC', background: '#F7F3EA', surface: '#FFFCF6', surfaceSubtle: '#FAF7F1', surfaceMuted: '#F0E9DE', sidebar: '#332F2A', sidebarText: '#DED5C9', sidebarMuted: '#A79D90', text: '#2B2925', textSoft: '#5F584F', muted: '#746E64', border: '#E7DED0', focus: '#B98262', onPrimary: '#FFFFFF', fontFamily: FONT, baseFontSize: 16 },
    { paper: '#C9D9E8', author: '#DCCFE2', concept: '#C6DDD3', method: '#F1D5A5', finding: '#D1DFC3' },
    '#171512', '#A59C90', '0 18px 48px rgba(43, 41, 37, 0.10)',
  ),
} satisfies Record<AppThemeId, AppTheme>

let activeThemeId: AppThemeId = DEFAULT_THEME_ID
export function getAppTheme(themeId: AppThemeId = activeThemeId) { return APP_THEMES[themeId] }
export function applyAppTheme(themeId: AppThemeId) {
  activeThemeId = themeId
  const theme = APP_THEMES[themeId]
  const values: Record<string, string> = {
    '--color-primary': theme.interface.primary,
    '--color-primary-deep': theme.interface.primaryDeep,
    '--color-primary-soft': theme.interface.primarySoft,
    '--color-primary-border': theme.interface.primaryBorder,
    '--color-background': theme.interface.background,
    '--color-surface': theme.interface.surface,
    '--color-surface-subtle': theme.interface.surfaceSubtle,
    '--color-surface-muted': theme.interface.surfaceMuted,
    '--color-sidebar': theme.interface.sidebar,
    '--color-sidebar-text': theme.interface.sidebarText,
    '--color-sidebar-muted': theme.interface.sidebarMuted,
    '--color-text': theme.interface.text,
    '--color-text-soft': theme.interface.textSoft,
    '--color-muted': theme.interface.muted,
    '--color-border': theme.interface.border,
    '--color-focus': theme.interface.focus,
    '--color-on-primary': theme.interface.onPrimary,
    '--font-interface': theme.interface.fontFamily,
    '--font-size-base': `${theme.interface.baseFontSize}px`,
    '--radius-card': theme.shape.cardRadius,
    '--radius-control': theme.shape.controlRadius,
    '--shadow-card': theme.shape.cardShadow,
    '--graph-node-paper': theme.graph.nodes.paper.background,
    '--graph-node-author': theme.graph.nodes.author.background,
    '--graph-node-concept': theme.graph.nodes.concept.background,
    '--graph-node-method': theme.graph.nodes.method.background,
    '--graph-node-finding': theme.graph.nodes.finding.background,
  }
  for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value)
  for (const status of ['success', 'warning', 'danger', 'info'] as const) {
    document.documentElement.style.setProperty(`--color-${status}-foreground`, theme.semantic[status].foreground)
    document.documentElement.style.setProperty(`--color-${status}-background`, theme.semantic[status].background)
    document.documentElement.style.setProperty(`--color-${status}-border`, theme.semantic[status].border)
  }
}
export function applyFontScale(percent: number) {
  const baseFontSize = getAppTheme().interface.baseFontSize
  document.documentElement.style.setProperty('--font-size-root', `${baseFontSize * percent / 100}px`)
}
```

同时在 `tokens.css` 为 spec 中列出的所有 CSS 变量提供 `softResearch` 回退值。

- [ ] **Step 4: 运行主题测试并确认通过**

Run: `npx.cmd vitest run src/styles/app-theme.test.ts`

Expected: PASS。

---

### Task 2: 显示偏好状态、持久化与启动初始化

**Files:**
- Create: `src/styles/display-preferences.tsx`
- Create: `src/styles/display-preferences.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Task 1 的 `AppThemeId`、`DEFAULT_THEME_ID`、`applyAppTheme`、`applyFontScale`。
- Produces: `StoredDisplayPreferences`、`readStoredDisplayPreferences(storage?)`、`DisplayPreferencesProvider`、`useDisplayPreferences()`。

- [ ] **Step 1: 写恢复、更新、异常回退和重置的失败测试**

```tsx
function Probe() {
  const value = useDisplayPreferences()
  return <>
    <output aria-label="主题">{value.themeId}</output>
    <output aria-label="字号">{value.fontScalePercent}</output>
    <button onClick={() => value.setThemeId('warmPaper')}>换主题</button>
    <button onClick={() => value.setFontScalePercent(117)}>换字号</button>
    <button onClick={value.resetDisplayPreferences}>重置</button>
  </>
}

it('恢复有效偏好并持久化更新与重置', async () => {
  const user = userEvent.setup()
  localStorage.setItem('yanzhitu.display.theme', 'coolMinimal')
  localStorage.setItem('yanzhitu.display.fontScalePercent', '105')
  render(<DisplayPreferencesProvider><Probe /></DisplayPreferencesProvider>)
  expect(screen.getByLabelText('主题')).toHaveTextContent('coolMinimal')
  expect(screen.getByLabelText('字号')).toHaveTextContent('105')
  await user.click(screen.getByRole('button', { name: '换主题' }))
  expect(localStorage.getItem('yanzhitu.display.theme')).toBe('warmPaper')
  await user.click(screen.getByRole('button', { name: '重置' }))
  expect(screen.getByLabelText('主题')).toHaveTextContent('softResearch')
  expect(screen.getByLabelText('字号')).toHaveTextContent('100')
})

it('无效或不可访问的存储回退到默认值', () => {
  const broken = { getItem: () => { throw new Error('blocked') } }
  expect(readStoredDisplayPreferences(broken)).toEqual({ themeId: 'softResearch', fontScalePercent: 100 })
})
```

- [ ] **Step 2: 运行测试并确认因 Provider 不存在而失败**

Run: `npx.cmd vitest run src/styles/display-preferences.test.tsx`

Expected: FAIL，无法解析模块。

- [ ] **Step 3: 实现边界校验、同步应用和容错持久化**

```tsx
export const DISPLAY_PREFERENCE_KEYS = {
  theme: 'yanzhitu.display.theme',
  fontScale: 'yanzhitu.display.fontScalePercent',
} as const

export function readStoredDisplayPreferences(storage: Pick<Storage, 'getItem'> = localStorage) {
  try {
    const theme = storage.getItem(DISPLAY_PREFERENCE_KEYS.theme)
    const fontScale = Number(storage.getItem(DISPLAY_PREFERENCE_KEYS.fontScale))
    return {
      themeId: isAppThemeId(theme) ? theme : DEFAULT_THEME_ID,
      fontScalePercent: Number.isInteger(fontScale) && fontScale >= 85 && fontScale <= 130 ? fontScale : 100,
    }
  } catch {
    return { themeId: DEFAULT_THEME_ID, fontScalePercent: 100 }
  }
}
```

Provider 的两个 setter 必须先更新状态和 CSS，再在 `try/catch` 中写 storage；`resetDisplayPreferences()` 调用两个默认 setter。`useDisplayPreferences()` 在 Provider 外抛出可读错误。

- [ ] **Step 4: 在 React 挂载前初始化主题和字号**

```tsx
const initialPreferences = readStoredDisplayPreferences()
applyAppTheme(initialPreferences.themeId)
applyFontScale(initialPreferences.fontScalePercent)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DisplayPreferencesProvider initialPreferences={initialPreferences}>
      <BrowserRouter><App /></BrowserRouter>
    </DisplayPreferencesProvider>
  </StrictMode>,
)
```

- [ ] **Step 5: 运行偏好测试和 App 测试**

Run: `npx.cmd vitest run src/styles/display-preferences.test.tsx src/App.test.tsx`

Expected: PASS。

---

### Task 3: 极简主题、字号组合框和重置控件

**Files:**
- Create: `src/components/DisplaySettings.tsx`
- Create: `src/components/DisplaySettings.test.tsx`
- Modify: `src/components/AppSidebar.tsx`
- Modify: `src/components/AppShell.test.tsx`
- Modify: `src/styles/layout.css`

**Interfaces:**
- Consumes: Task 2 的 `useDisplayPreferences()`。
- Produces: `<DisplaySettings />`，含“界面主题”选择框、“显示字号”组合框和“恢复默认显示设置”按钮。

- [ ] **Step 1: 写正式用户交互的失败测试**

```tsx
function renderSettings() {
  return render(
    <DisplayPreferencesProvider initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}>
      <DisplaySettings />
    </DisplayPreferencesProvider>,
  )
}

it('切换主题、选择字号并重置', async () => {
  const user = userEvent.setup()
  renderSettings()
  await user.selectOptions(screen.getByRole('combobox', { name: '界面主题' }), 'warmPaper')
  await user.click(screen.getByRole('combobox', { name: '显示字号' }))
  await user.click(screen.getByRole('option', { name: '115%' }))
  expect(screen.getByRole('combobox', { name: '显示字号' })).toHaveTextContent('115%')
  await user.click(screen.getByRole('button', { name: '恢复默认显示设置' }))
  expect(screen.getByRole('combobox', { name: '界面主题' })).toHaveValue('softResearch')
  expect(screen.getByRole('combobox', { name: '显示字号' })).toHaveTextContent('100%')
})

it('双击或 F2 进入手动输入并校验范围', async () => {
  const user = userEvent.setup()
  renderSettings()
  const combo = screen.getByRole('combobox', { name: '显示字号' })
  await user.dblClick(combo)
  const input = screen.getByRole('spinbutton', { name: '显示字号百分比' })
  await user.clear(input); await user.type(input, '117{Enter}')
  expect(screen.getByRole('combobox', { name: '显示字号' })).toHaveTextContent('117%')
  screen.getByRole('combobox', { name: '显示字号' }).focus()
  await user.keyboard('{F2}')
  await user.clear(screen.getByRole('spinbutton')); await user.type(screen.getByRole('spinbutton'), '140{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('请输入 85–130 之间的整数')
})
```

- [ ] **Step 2: 运行测试并确认控件不存在**

Run: `npx.cmd vitest run src/components/DisplaySettings.test.tsx`

Expected: FAIL，无法解析 `DisplaySettings`。

- [ ] **Step 3: 实现组合框状态机和键盘行为**

组件状态仅包含 `isOpen`、`isEditing`、`draftValue`、`activeOptionIndex`、`validationError`。预设值固定为：

```ts
const FONT_SCALE_OPTIONS = [85, 90, 95, 100, 105, 110, 115, 120, 125, 130]
```

单击常态按钮切换 listbox；双击或 F2 进入 `<input type="number" min={85} max={130}>`；Enter/blur 提交有效整数，Escape 取消；ArrowUp/ArrowDown/Home/End 移动活动 option，Enter 选择，Escape 关闭。所有状态结果通过 Provider setter 产生，不维护第二份已应用值。

- [ ] **Step 4: 放到侧栏底部并实现极简响应式样式**

```tsx
<nav className="app-sidebar" aria-label="主导航">
  <div className="app-sidebar__navigation">
    <p className="app-sidebar__label">工作区</p>
    {navigationItems.map((item) => item.to
      ? <NavLink className={({ isActive }) => `app-sidebar__item${isActive ? ' app-sidebar__item--active' : ''}`} to={item.to} key={item.label}>{item.label}</NavLink>
      : <button className="app-sidebar__item" type="button" key={item.label}>{item.label}</button>)}
  </div>
  <DisplaySettings />
</nav>
```

```css
.display-settings { margin-top: auto; display: grid; grid-template-columns: minmax(0, 1fr) 74px 32px; gap: 6px; }
.display-settings select,
.display-settings__font-trigger,
.display-settings__reset { min-height: 32px; color: var(--color-sidebar-text); background: color-mix(in srgb, var(--color-sidebar) 82%, var(--color-surface)); border: 1px solid color-mix(in srgb, var(--color-sidebar-text) 25%, transparent); border-radius: var(--radius-control); }
@media (max-width: 760px) { .display-settings { margin: 0 0 0 auto; min-width: 250px; } }
```

- [ ] **Step 5: 运行控件和外壳测试**

Run: `npx.cmd vitest run src/components/DisplaySettings.test.tsx src/components/AppShell.test.tsx`

Expected: PASS，外壳测试能找到三个控件且原导航仍正确。

---

### Task 4: 图谱主题和字号联动

**Files:**
- Modify: `src/features/graph/graph-transform.ts`
- Modify: `src/features/graph/graph-transform.test.ts`
- Modify: `src/features/graph/GraphCanvas.tsx`
- Modify: `src/features/graph/GraphCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `AppThemeId`/`getAppTheme()` 和 Task 2 的 `useDisplayPreferences()`。
- Produces: `GraphPresentation.themeId: AppThemeId`、`GraphPresentation.fontScalePercent: number`；图谱选项使用对应主题。

- [ ] **Step 1: 写浅色节点、字体缩放和主题切换失败测试**

```ts
it('从主题读取节点与图例颜色并按比例缩放文字', () => {
  const option = buildGraphOption(conceptGraphMock, presentation({
    themeId: 'softResearch', fontScalePercent: 125,
  }))
  const graph = getGraphSeries(option)
  const concept = graph.data.find((node) => node.id === 'concept-learning')
  expect(concept?.itemStyle.color).toBe('#AEEBE7')
  expect(concept?.label.color).toBe('#111827')
  expect(concept?.label.fontSize).toBe(15)
  expect(graph.categories.find((item) => item.name === '概念')?.itemStyle.color).toBe('#AEEBE7')
})

it('不同主题改变视觉但不改变图谱数据 IDs', () => {
  const soft = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({ themeId: 'softResearch' })))
  const warm = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({ themeId: 'warmPaper' })))
  expect(warm.data.map((node) => node.id)).toEqual(soft.data.map((node) => node.id))
  expect(warm.data[0].itemStyle.color).not.toBe(soft.data[0].itemStyle.color)
})
```

- [ ] **Step 2: 运行转换测试并确认仍返回旧深色/固定字号**

Run: `npx.cmd vitest run src/features/graph/graph-transform.test.ts`

Expected: FAIL，概念色仍为 `#0891b2` 或 `fontSize` 缺失。

- [ ] **Step 3: 用主题替换图谱固定色与字体**

删除 `NODE_COLORS`，在 `buildPresentationNodes`、`buildCategories` 和 `buildPresentationLinks` 中使用：

```ts
const theme = getAppTheme(presentation.themeId)
const nodeStyle = theme.graph.nodes[node.nodeType]
label: {
  show: shouldShowLabel,
  formatter: node.label,
  color: nodeStyle.text,
  fontFamily: nodeStyle.fontFamily,
  fontSize: nodeStyle.fontSize * presentation.fontScalePercent / 100,
}
```

选中边框使用 `theme.graph.selectedBorder`，连线使用 `theme.graph.edge`。图例 category 和节点读取同一个 `nodeStyle.background`。

- [ ] **Step 4: GraphCanvas 订阅偏好且只更新 presentation**

```tsx
const { themeId, fontScalePercent } = useDisplayPreferences()
const presentation = {
  selected, highlightedNodeIds, isSearchActive,
  contextConceptId, contextAuthorId,
  showRelatedAuthors, showRelatedConcepts, showRelatedMethods,
  themeId, fontScalePercent,
}
```

把两个值加入呈现 effect 依赖；dataset identity 不变时继续调用 `buildGraphPresentationOption`，不得触发 ECharts 重新初始化。

- [ ] **Step 5: 运行图谱转换与画布测试**

Run: `npx.cmd vitest run src/features/graph/graph-transform.test.ts src/features/graph/GraphCanvas.test.tsx`

Expected: PASS；主题 rerender 后 `echarts.init` 次数不增加，`setOption` 收到新颜色/字号。

---

### Task 5: 应用外壳、图谱与论文页面的语义变量迁移

**Files:**
- Modify: `src/index.css`
- Modify: `src/styles/layout.css`
- Modify: `src/features/graph/GraphPage.css`
- Modify: `src/features/papers/PaperListPage.css`
- Modify: `src/features/papers/PaperDetailPage.css`
- Test: `src/App.test.tsx`
- Test: `src/features/papers/PaperListPage.test.tsx`
- Test: `src/features/papers/PaperDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 注入的 CSS 变量。
- Produces: 外壳、图谱容器和论文页面完全由语义变量着色，文字字号使用 `rem`。

- [ ] **Step 1: 运行现有页面测试，建立 CSS 迁移前的行为基线**

Run: `npx.cmd vitest run src/App.test.tsx src/features/papers/PaperListPage.test.tsx src/features/papers/PaperDetailPage.test.tsx src/features/graph/GraphPage.test.tsx`

Expected: PASS，记录迁移前的测试数量；CSS 重构过程中不得减少或跳过这些测试。

- [ ] **Step 2: 在 App 集成测试中锁定正式主题控件到根变量的连接**

```tsx
it('切换主题后应用外壳使用新的根变量', async () => {
  const user = userEvent.setup()
  render(
    <DisplayPreferencesProvider initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}>
      <MemoryRouter initialEntries={['/papers']}><App /></MemoryRouter>
    </DisplayPreferencesProvider>,
  )
  await user.selectOptions(screen.getByRole('combobox', { name: '界面主题' }), 'warmPaper')
  expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#F7F3EA')
  expect(document.documentElement.style.getPropertyValue('--color-sidebar')).toBe('#332F2A')
})
```

- [ ] **Step 3: 运行集成测试并确认控件与主题系统连接正常**

Run: `npx.cmd vitest run src/App.test.tsx`

Expected: PASS；Tasks 1–3 已建立主题行为，本测试作为 CSS 重构的集成保护，不制造伪失败。

- [ ] **Step 4: 按固定映射迁移 CSS**

迁移规则：

| 旧用途 | 新变量 |
|---|---|
| `#4f46e5`、主要紫色操作 | `var(--color-primary)` |
| `#4338ca`、深主色文字 | `var(--color-primary-deep)` |
| `#eef0fe`、`#eef2ff`、主色浅底 | `var(--color-primary-soft)` |
| `#a5b4fc`、`#c7d2fe`、主色浅边 | `var(--color-primary-border)` |
| `#fff`、`#ffffff` 卡片 | `var(--color-surface)` |
| `#f8fafc`、`#f8f8fc` | `var(--color-surface-subtle)` |
| `#f1f5f9`、`#f4f4fb` | `var(--color-surface-muted)` |
| 中性正文灰 | `var(--color-text-soft)` 或 `var(--color-muted)` |
| 白色按钮文字/焦点反白 | `var(--color-on-primary)` |
| 错误浅底/边框/文字 | `var(--color-danger-background/border/foreground)` |
| 成功浅底/边框/文字 | `var(--color-success-background/border/foreground)` |
| 警告浅底/边框/文字 | `var(--color-warning-background/border/foreground)` |
| 信息浅底/边框/文字 | `var(--color-info-background/border/foreground)` |

把 `index.css` 的 `color`、`background`、`font-family`、`font-size` 改为对应变量。所有界面文字字号用 `rem`；布局尺寸和边框宽度的 px 不变。

- [ ] **Step 5: 运行外壳和论文页面测试**

Run: `npx.cmd vitest run src/App.test.tsx src/features/papers/PaperListPage.test.tsx src/features/papers/PaperDetailPage.test.tsx src/features/graph/GraphPage.test.tsx`

Expected: PASS。

---

### Task 6: 建议审核与分析状态的语义变量迁移

**Files:**
- Modify: `src/features/suggestions/SuggestionReviewPage.css`
- Modify: `src/features/analysis/AnalysisProgressPanel.css`
- Test: `src/features/suggestions/SuggestionReviewPage.test.tsx`
- Test: `src/features/analysis/AnalysisProgressPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 interface/semantic CSS 变量和 Task 5 的迁移规则。
- Produces: 审核、弹窗、批处理、分析进度、失败和完成状态均随主题变化且保留状态语义。

- [ ] **Step 1: 运行现有业务测试，建立状态交互基线**

Run: `npx.cmd vitest run src/features/suggestions/SuggestionReviewPage.test.tsx src/features/analysis/AnalysisProgressPanel.test.tsx`

Expected: PASS，记录迁移前测试数量；CSS 重构不得改变审核与分析流程。

- [ ] **Step 2: 补充主题切换后的状态语义回归测试**

```tsx
it('主题切换不改变审核和分析状态的可访问语义', async () => {
  const user = userEvent.setup()
  render(
    <DisplayPreferencesProvider initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}>
      <MemoryRouter><AppShell><SuggestionReviewPage /></AppShell></MemoryRouter>
    </DisplayPreferencesProvider>,
  )
  await user.selectOptions(screen.getByRole('combobox', { name: '界面主题' }), 'coolMinimal')
  expect(await screen.findByRole('tab', { name: /待审核/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: /采纳/ })).toBeEnabled()
})
```

- [ ] **Step 3: 运行新增回归测试**

Run: `npx.cmd vitest run src/features/suggestions/SuggestionReviewPage.test.tsx src/features/analysis/AnalysisProgressPanel.test.tsx`

Expected: PASS；主题状态管理和正式控件已在前置任务完成，本测试锁定 CSS 重构不会破坏可访问语义。

- [ ] **Step 4: 按 Task 5 映射替换所有业务色号**

保留状态色相：采纳/完成使用 success，拒绝/失败使用 danger，待审核/警告使用 warning，处理中/信息使用 info；普通卡片和对话框使用 surface 系列。只保留 `rgba(..., alpha)` 的透明阴影参数及第三方资源色值。

- [ ] **Step 5: 运行建议审核与分析测试**

Run: `npx.cmd vitest run src/features/suggestions/SuggestionReviewPage.test.tsx src/features/analysis/AnalysisProgressPanel.test.tsx`

Expected: PASS。

---

### Task 7: 全量验证与三主题浏览器验收

**Files:**
- Modify only if a verification failure identifies a scoped defect.

**Interfaces:**
- Consumes: Tasks 1–6 的完整主题系统。
- Produces: 可复现的自动检查与浏览器验收记录。

- [ ] **Step 1: 运行全量自动测试**

Run: `npm.cmd test -- --run`

Expected: 所有测试文件 PASS，0 failed。

- [ ] **Step 2: 运行规范与生产构建**

Run: `npm.cmd run lint`

Expected: exit code 0，无 lint 错误。

Run: `npm.cmd run build`

Expected: TypeScript 和 Vite 构建成功；允许现有的大 chunk 提示，不允许新增编译错误。

- [ ] **Step 3: 检查目标 CSS 中剩余业务色号**

Run: `rg -n --glob '*.css' '#[0-9a-fA-F]{3,8}' src/index.css src/styles src/features/graph src/features/papers src/features/suggestions src/features/analysis`

Expected: 仅 `tokens.css` 回退值、透明阴影或明确记录的非主题资源色值；发现业务色号则按 Task 5 映射修正并重新运行相关测试。

- [ ] **Step 4: 浏览器验证显示设置和持久化**

在 `/graph`：

1. 确认左侧栏底部显示 `主题框 | 字号框 | 重置按钮`。
2. 依次选择三套主题，核对界面、节点和图例同步变化，节点文字保持深色。
3. 单击字号框选择 `115%`；双击输入 `117`；验证界面和图谱文字变大、节点圆形尺寸不变。
4. 输入 `140`，确认显示范围提示且未应用。
5. 刷新页面，确认主题与 `117%` 恢复。
6. 点击重置，确认恢复 `softResearch` 与 `100%`。
7. 在文献库、文献详情和建议审核页面核对主题与状态色。
8. 检查浏览器 error/warning 日志为空。

- [ ] **Step 5: 最终重新运行完整验证**

Run: `npm.cmd test -- --run`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

可用并行任务执行以上三条独立 PowerShell 命令。Expected: 0 test failures、0 lint errors、build exit code 0。
