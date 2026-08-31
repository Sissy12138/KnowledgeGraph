# 研知图知识图谱展示页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 React 应用中实现 `/graph` 知识图谱页面，以 Mock 数据展示概念、方法、作者合作和文献关系四类网络，并支持搜索、缩放、选择及详情查看。

**Architecture:** 图谱功能封装在 `src/features/graph` 中，页面组件通过 `graph.service` 获取统一的 `GraphDataset`，再由纯函数 `graph-transform` 转换为 ECharts 配置。`GraphCanvas` 只管理 ECharts 生命周期和画布事件，页面状态、搜索、选中对象及详情展示由 React 组件管理。

**Tech Stack:** React 19、TypeScript 6、React Router 7、ECharts、Vitest、Testing Library、CSS。

**Spec:** `docs/superpowers/specs/20260830_yanzhitu_knowledge_graph_page_design_v01.md`

## Global Constraints

- 所有修改只能发生在 `D:\Claude\KG\yzt-frontend-mockup\20260823_yanzhitu_frontend_foundation_v01` 内。
- 使用 Windows PowerShell；为避开 PowerShell 脚本执行策略，Node 命令统一写作 `npm.cmd` 和 `npx.cmd`。
- 首版只使用 Mock，不调用真实后端。
- 只展示已经审核通过的正式图谱，不显示待审核建议。
- 期刊只作为论文属性，不作为节点；作者作为节点。
- `coAuthor` 为共同论文派生边，`weight` 等于共同论文数。
- 组件不得直接导入具体 Mock，统一通过 `graph.service` 获取数据。
- 采用测试先行：每个行为先写失败测试，再写最小实现。
- 当前目录不是 Git 仓库，因此本计划不执行 `git commit`；每个任务以相关测试通过作为可审阅检查点。

---

## File Structure

新增：

- `src/features/graph/graph.types.ts`：图谱视图、节点、边、论文摘要和详情联合类型。
- `src/features/graph/graph.mock.ts`：四类网络及其节点详情 Mock。
- `src/features/graph/graph.service.ts`：Mock 数据访问和错误/空态场景。
- `src/features/graph/graph.service.test.ts`：数据服务测试。
- `src/features/graph/graph-transform.ts`：搜索、论文排序和 ECharts 配置转换纯函数。
- `src/features/graph/graph-transform.test.ts`：转换逻辑测试。
- `src/features/graph/GraphToolbar.tsx`：网络标签、搜索结果、画布操作按钮。
- `src/features/graph/GraphToolbar.test.tsx`：工具栏交互测试。
- `src/features/graph/NodeInspector.tsx`：概念、方法、作者、论文节点详情。
- `src/features/graph/EdgeInspector.tsx`：普通关系和作者合作边详情。
- `src/features/graph/GraphInspector.test.tsx`：两类详情面板测试。
- `src/features/graph/GraphCanvas.tsx`：ECharts 初始化、更新、事件和销毁。
- `src/features/graph/GraphCanvas.test.tsx`：ECharts 生命周期和点击回调测试。
- `src/features/graph/GraphPage.tsx`：请求状态、标签、搜索、选择和详情编排。
- `src/features/graph/GraphPage.css`：图谱页桌面和小屏幕布局。
- `src/features/graph/GraphPage.test.tsx`：页面集成状态测试。

修改：

- `package.json`、`package-lock.json`：增加 ECharts。
- `src/App.tsx`：注册 `/graph` 路由。
- `src/App.test.tsx`：验证图谱地址。
- `src/components/AppSidebar.tsx`：知识图谱按钮改为导航链接。
- `src/components/AppShell.test.tsx`：更新主导航断言。

---

### Task 1: 建立图谱领域类型、Mock 和数据服务

**Files:**

- Create: `src/features/graph/graph.types.ts`
- Create: `src/features/graph/graph.mock.ts`
- Create: `src/features/graph/graph.service.ts`
- Test: `src/features/graph/graph.service.test.ts`

**Interfaces:**

- Produces: `GraphView`、`GraphScenario`、`GraphNode`、`GraphEdge`、`GraphNodeDetail`、`GraphDataset`。
- Produces: `getGraphDataset(view: GraphView, scenario?: GraphScenario): Promise<GraphDataset>`。
- Consumes: 无。

- [ ] **Step 1: 写数据服务失败测试**

```typescript
import { describe, expect, it } from 'vitest'
import { getGraphDataset } from './graph.service'

describe('getGraphDataset', () => {
  it('返回具有稳定节点和关系的概念网络', async () => {
    const result = await getGraphDataset('concept')

    expect(result.view).toBe('concept')
    expect(result.nodes.some((node) => node.id === 'concept-reversal-learning')).toBe(true)
    expect(result.edges.some((edge) => edge.relationType === 'broaderThan')).toBe(true)
    expect(result.nodeDetails['concept-reversal-learning'].nodeType).toBe('concept')
  })

  it('作者合作边权重等于共同论文数量', async () => {
    const result = await getGraphDataset('author')
    const collaboration = result.edges.find((edge) => edge.relationType === 'coAuthor')

    expect(collaboration).toBeDefined()
    expect(collaboration?.weight).toBe(collaboration?.sourcePaperIds.length)
  })

  it('空态返回有效空集合', async () => {
    await expect(getGraphDataset('paper', 'empty')).resolves.toMatchObject({
      view: 'paper',
      nodes: [],
      edges: [],
    })
  })

  it('失败场景抛出可直接展示的信息', async () => {
    await expect(getGraphDataset('method', 'error')).rejects.toThrow(
      '知识图谱加载失败，请稍后重试。',
    )
  })
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```powershell
npx.cmd vitest run src/features/graph/graph.service.test.ts
```

Expected: FAIL，提示无法找到 `graph.service` 或 `graph.types`。

- [ ] **Step 3: 定义领域类型**

在 `graph.types.ts` 定义：

```typescript
export type GraphView = 'concept' | 'method' | 'author' | 'paper'
export type GraphScenario = 'success' | 'empty' | 'error'
export type GraphNodeType = 'paper' | 'author' | 'concept' | 'method' | 'finding'

export type Evidence = {
  id: string
  paperId: string
  section: string | null
  text: string
}

export type JournalInfo = {
  name: string
  impactFactor: number | null
  impactFactorYear: number | null
  jcrQuartile: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
}

export type GraphPaperSummary = {
  id: string
  title: string
  authorNames: string[]
  year: number | null
  journal: JournalInfo | null
}

export type GraphNode = {
  id: string
  nodeType: GraphNodeType
  label: string
  description: string | null
  sourcePaperIds: string[]
  metrics: {
    paperCount?: number
    connectionCount?: number
  }
}

export type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  relationType: 'broaderThan' | 'relatedTo' | 'uses' | 'coAuthor' | 'cites'
  label: string
  directed: boolean
  weight: number | null
  evidenceIds: string[]
  sourcePaperIds: string[]
}

type BaseNodeDetail = {
  nodeId: string
  nodeType: GraphNodeType
}

export type ConceptNodeDetail = BaseNodeDetail & {
  nodeType: 'concept'
  aliases: string[]
  broaderConceptIds: string[]
  narrowerConceptIds: string[]
  relatedConceptIds: string[]
  paperIds: string[]
}

export type MethodNodeDetail = BaseNodeDetail & {
  nodeType: 'method'
  methodType: string
  paperIds: string[]
}

export type AuthorNodeDetail = BaseNodeDetail & {
  nodeType: 'author'
  orcid: string | null
  affiliations: string[]
  paperIds: string[]
}

export type PaperNodeDetail = BaseNodeDetail & {
  nodeType: 'paper'
  paperId: string
  conceptIds: string[]
  methodIds: string[]
  findingSummaries: string[]
}

export type GraphNodeDetail =
  | ConceptNodeDetail
  | MethodNodeDetail
  | AuthorNodeDetail
  | PaperNodeDetail

export type GraphDataset = {
  view: GraphView
  nodes: GraphNode[]
  edges: GraphEdge[]
  evidence: Evidence[]
  papers: Record<string, GraphPaperSummary>
  nodeDetails: Record<string, GraphNodeDetail>
}

export type GraphSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null
```

- [ ] **Step 4: 创建四类 Mock 数据**

在 `graph.mock.ts` 导出：

```typescript
export const graphMocks: Record<GraphView, GraphDataset> = {
  concept: conceptGraphMock,
  method: methodGraphMock,
  author: authorGraphMock,
  paper: paperGraphMock,
}
```

具体数量和覆盖：

- `conceptGraphMock`：至少 6 个概念，包含 `broaderThan`、`relatedTo` 和 `concept-reversal-learning`。
- `methodGraphMock`：至少 4 个方法、4 篇论文和 `uses`。
- `authorGraphMock`：至少 6 位作者；至少一条 `weight: 2` 且含两个 `sourcePaperIds` 的 `coAuthor` 边；至少一位无 ORCID 作者。
- `paperGraphMock`：至少 5 篇论文和 `cites`；至少一篇 `journal: null`。
- 所有视图共用相同论文 ID、标题、作者、年份和期刊示例。

JIF 与 ORCID 在注释中明确写为界面开发 Mock，不代表 A 已确认数据。

- [ ] **Step 5: 实现 Mock 数据服务**

```typescript
import { graphMocks } from './graph.mock'
import type { GraphDataset, GraphScenario, GraphView } from './graph.types'

export async function getGraphDataset(
  view: GraphView,
  scenario: GraphScenario = 'success',
): Promise<GraphDataset> {
  if (scenario === 'error') {
    throw new Error('知识图谱加载失败，请稍后重试。')
  }

  if (scenario === 'empty') {
    return {
      view,
      nodes: [],
      edges: [],
      evidence: [],
      papers: {},
      nodeDetails: {},
    }
  }

  return structuredClone(graphMocks[view])
}
```

- [ ] **Step 6: 运行数据服务测试**

Run:

```powershell
npx.cmd vitest run src/features/graph/graph.service.test.ts
```

Expected: 4 tests PASS。

---

### Task 2: 实现搜索、论文排序和 ECharts 数据转换

**Files:**

- Create: `src/features/graph/graph-transform.ts`
- Test: `src/features/graph/graph-transform.test.ts`

**Interfaces:**

- Consumes: `GraphDataset`、`GraphNode`、`GraphPaperSummary`。
- Produces: `findMatchingNodes(dataset, query): GraphNode[]`。
- Produces: `sortGraphPapers(papers, sortBy): GraphPaperSummary[]`。
- Produces: `buildGraphOption(dataset, presentation): EChartsOption`。

- [ ] **Step 1: 写纯函数失败测试**

测试必须覆盖：

```typescript
it('搜索大小写不敏感且不修改数据集', () => {
  const matches = findMatchingNodes(conceptGraphMock, '反转')
  expect(matches.map((node) => node.id)).toContain('concept-reversal-learning')
  expect(conceptGraphMock.nodes).toHaveLength(originalCount)
})

it('JIF 降序并把缺失值放在末尾', () => {
  const result = sortGraphPapers(papers, 'journalImpactFactor')
  expect(result.map((paper) => paper.id)).toEqual(['paper-high-jif', 'paper-low-jif', 'paper-no-jif'])
})

it('作者合作边宽随 weight 增加', () => {
  const option = buildGraphOption(authorGraphMock, {
    selected: null,
    highlightedNodeIds: new Set(),
  })
  const links = getGraphSeries(option).links
  expect(getLink(links, 'edge-author-1').lineStyle.width).toBeGreaterThan(
    getLink(links, 'edge-author-2').lineStyle.width,
  )
})
```

测试文件内定义小型 `papers` fixture 和只用于断言的 `getGraphSeries`、`getLink` 辅助函数，不能依赖实现文件的内部变量。

- [ ] **Step 2: 安装 ECharts 类型与运行时代码**

Run:

```powershell
npm.cmd install echarts
```

Expected: `package.json` 增加 `echarts`，`package-lock.json` 更新，命令退出码为 0。

- [ ] **Step 3: 运行测试并确认函数不存在**

Run:

```powershell
npx.cmd vitest run src/features/graph/graph-transform.test.ts
```

Expected: FAIL，提示无法导入 `findMatchingNodes`、`sortGraphPapers` 或 `buildGraphOption`。

- [ ] **Step 4: 实现搜索和排序**

```typescript
export type GraphPaperSort = 'journalImpactFactor' | 'year'

export function findMatchingNodes(dataset: GraphDataset, query: string): GraphNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return dataset.nodes

  return dataset.nodes.filter((node) =>
    `${node.label} ${node.description ?? ''}`.toLocaleLowerCase().includes(normalized),
  )
}

export function sortGraphPapers(
  papers: GraphPaperSummary[],
  sortBy: GraphPaperSort,
): GraphPaperSummary[] {
  return [...papers].sort((left, right) => {
    const leftPrimary = sortBy === 'year' ? left.year : left.journal?.impactFactor
    const rightPrimary = sortBy === 'year' ? right.year : right.journal?.impactFactor
    if (leftPrimary == null && rightPrimary != null) return 1
    if (leftPrimary != null && rightPrimary == null) return -1
    if (leftPrimary != null && rightPrimary != null && leftPrimary !== rightPrimary) {
      return rightPrimary - leftPrimary
    }

    const leftSecondary = sortBy === 'year' ? left.journal?.impactFactor : left.year
    const rightSecondary = sortBy === 'year' ? right.journal?.impactFactor : right.year
    if (leftSecondary == null && rightSecondary != null) return 1
    if (leftSecondary != null && rightSecondary == null) return -1
    if (leftSecondary != null && rightSecondary != null && leftSecondary !== rightSecondary) {
      return rightSecondary - leftSecondary
    }
    return left.id.localeCompare(right.id)
  })
}
```

- [ ] **Step 5: 实现 ECharts 配置转换**

`buildGraphOption` 必须：

- 使用 `series.type = 'graph'`、`layout = 'force'`、`roam = true`、`draggable = true`。
- 依据节点类型设置颜色。
- 依据 `paperCount` 或 `connectionCount` 计算有上下限的节点大小。
- `directed: true` 时显示箭头。
- `coAuthor` 的线宽使用 `Math.min(2 + weight, 8)`。
- 选中节点增加白色间隔和类型色外圈。
- 搜索非空时，未命中节点透明度降低到 `0.22`，不删除节点。
- 使用 SVG 友好的普通颜色值，不依赖 Canvas 渐变。

```typescript
export type GraphPresentation = {
  selected: GraphSelection
  highlightedNodeIds: Set<string>
}

export function buildGraphOption(
  dataset: GraphDataset,
  presentation: GraphPresentation,
): EChartsOption {
  // 返回 tooltip、legend 和单个 graph series。
}
```

- [ ] **Step 6: 运行转换测试**

Run:

```powershell
npx.cmd vitest run src/features/graph/graph-transform.test.ts
```

Expected: 全部 PASS。

---

### Task 3: 实现网络标签和搜索工具栏

**Files:**

- Create: `src/features/graph/GraphToolbar.tsx`
- Test: `src/features/graph/GraphToolbar.test.tsx`

**Interfaces:**

- Consumes: `GraphView`、`GraphNode[]`。
- Produces: `onViewChange`、`onQueryChange`、`onResultSelect`、`onFit`、`onReset` 事件。

- [ ] **Step 1: 写工具栏失败测试**

```typescript
it('显示四个网络标签并报告标签切换', async () => {
  const onViewChange = vi.fn()
  render(<GraphToolbar {...baseProps} onViewChange={onViewChange} />)
  await userEvent.click(screen.getByRole('tab', { name: '作者合作' }))
  expect(onViewChange).toHaveBeenCalledWith('author')
})

it('输入搜索词并选择匹配节点', async () => {
  const onQueryChange = vi.fn()
  const onResultSelect = vi.fn()
  render(
    <GraphToolbar
      {...baseProps}
      query=""
      searchResults={[conceptNode]}
      onQueryChange={onQueryChange}
      onResultSelect={onResultSelect}
    />,
  )
  await userEvent.type(screen.getByRole('searchbox', { name: '搜索当前网络中的节点' }), '反转')
  expect(onQueryChange).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('option', { name: '反转学习' }))
  expect(onResultSelect).toHaveBeenCalledWith('concept-reversal-learning')
})
```

- [ ] **Step 2: 运行测试并确认组件不存在**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphToolbar.test.tsx
```

Expected: FAIL，无法找到 `GraphToolbar`。

- [ ] **Step 3: 实现可访问工具栏**

组件 props：

```typescript
type GraphToolbarProps = {
  view: GraphView
  query: string
  searchResults: GraphNode[]
  onViewChange: (view: GraphView) => void
  onQueryChange: (query: string) => void
  onResultSelect: (nodeId: string) => void
  onFit: () => void
  onReset: () => void
}
```

实现要求：

- 四个按钮使用 `role="tab"`，当前项设置 `aria-selected="true"`。
- 搜索框使用 `type="search"` 和明确 `aria-label`。
- 有查询词时显示 `role="listbox"`；结果项使用 `role="option"`。
- 查询词非空且结果为空时显示“没有匹配节点”。
- “适应画布”和“重置”使用文字按钮。

- [ ] **Step 4: 运行工具栏测试**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphToolbar.test.tsx
```

Expected: 全部 PASS。

---

### Task 4: 实现节点和关系详情面板

**Files:**

- Create: `src/features/graph/NodeInspector.tsx`
- Create: `src/features/graph/EdgeInspector.tsx`
- Test: `src/features/graph/GraphInspector.test.tsx`

**Interfaces:**

- Consumes: `GraphDataset`、`GraphNode`、`GraphNodeDetail`、`GraphEdge`。
- Produces: 只读详情 UI；论文链接统一指向 `/papers/{paperId}`。

- [ ] **Step 1: 写详情面板失败测试**

覆盖以下行为：

```typescript
it('概念详情显示定义并允许切换论文排序', async () => {
  render(<NodeInspector dataset={conceptGraphMock} nodeId="concept-reversal-learning" />)
  expect(screen.getByRole('heading', { name: '反转学习' })).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('关联论文排序'), 'year')
  expect(screen.getAllByTestId('related-paper')[0]).toHaveTextContent('2025')
})

it('作者详情显示 ORCID、单位和全部论文', () => {
  render(<NodeInspector dataset={authorGraphMock} nodeId="author-li-ming" />)
  expect(screen.getByText(/ORCID/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /查看论文/ })).toHaveAttribute('href', expect.stringMatching(/^\/papers\//))
})

it('合作边显示权重和共同论文', () => {
  render(<EdgeInspector dataset={authorGraphMock} edgeId="edge-author-li-wang" />)
  expect(screen.getByText('共同论文：2 篇')).toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(2)
})
```

- [ ] **Step 2: 运行测试并确认组件不存在**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphInspector.test.tsx
```

Expected: FAIL，无法找到两个 Inspector 组件。

- [ ] **Step 3: 实现 NodeInspector**

```typescript
type NodeInspectorProps = {
  dataset: GraphDataset
  nodeId: string
}
```

实现规则：

- 根据 `detail.nodeType` 使用穷尽 `switch` 渲染。
- 概念显示别名、相关概念和可排序论文。
- 方法显示方法类型、描述和使用论文。
- 作者显示 ORCID、单位、论文及主要合作边摘要。
- 论文显示作者、年份、期刊、`JIF {value}（{year}）`，以及概念、方法、发现摘要。
- 缺失值统一显示“暂无数据”，不显示 `null` 或空字符串。
- 相关论文使用 `Link`，并保留 `data-testid="related-paper"` 供排序测试使用。

- [ ] **Step 4: 实现 EdgeInspector**

```typescript
type EdgeInspectorProps = {
  dataset: GraphDataset
  edgeId: string
}
```

实现规则：

- 显示源节点、目标节点、关系标签和方向。
- `coAuthor` 显示 `共同论文：{weight} 篇`，并列出 `sourcePaperIds` 对应论文链接。
- 普通关系显示来源论文和 `evidenceIds` 对应证据文本。
- 缺失 Evidence 时显示“暂无原文证据”。

- [ ] **Step 5: 运行详情面板测试**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphInspector.test.tsx
```

Expected: 全部 PASS。

---

### Task 5: 实现 ECharts 图谱画布

**Files:**

- Create: `src/features/graph/GraphCanvas.tsx`
- Test: `src/features/graph/GraphCanvas.test.tsx`

**Interfaces:**

- Consumes: `GraphDataset`、`GraphSelection`、高亮 ID 集合。
- Produces: `GraphCanvasHandle.fitToView()` 和 `onSelectionChange(selection)`。

- [ ] **Step 1: 写 ECharts 生命周期失败测试**

在测试顶部模拟 ECharts：

```typescript
const setOption = vi.fn()
const resize = vi.fn()
const dispose = vi.fn()
const on = vi.fn()
const off = vi.fn()
const zrOn = vi.fn()
const zrOff = vi.fn()

vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption,
    resize,
    dispose,
    on,
    off,
    getZr: () => ({ on: zrOn, off: zrOff }),
    dispatchAction: vi.fn(),
  })),
}))
```

测试必须验证：

- 首次渲染调用 `init(element, undefined, { renderer: 'svg' })`。
- 数据变化调用 `setOption`。
- 模拟节点点击后回调 `{ kind: 'node', id }`。
- 模拟边点击后回调 `{ kind: 'edge', id }`。
- 模拟空白点击后回调 `null`。
- 卸载时解绑事件并调用 `dispose()`。

- [ ] **Step 2: 运行测试并确认组件不存在**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphCanvas.test.tsx
```

Expected: FAIL，无法找到 `GraphCanvas`。

- [ ] **Step 3: 实现画布组件和命令句柄**

```typescript
export type GraphCanvasHandle = {
  fitToView: () => void
}

export type GraphCanvasProps = {
  dataset: GraphDataset
  selection: GraphSelection
  highlightedNodeIds: Set<string>
  onSelectionChange: (selection: GraphSelection) => void
}
```

实现要点：

- 容器 `role="img"`，`aria-label` 包含网络类型、节点数和关系数。
- `useEffect` 首次创建 ECharts 实例；cleanup 中解绑并销毁。
- 独立 `useEffect` 根据 dataset、selection 和 highlighted IDs 调用 `setOption(buildGraphOption(...), true)`。
- ECharts `click` 事件根据 `dataType` 和 `data.id` 回传节点或边选择。
- zrender 空白点击仅在 `event.target` 不存在时清除选择。
- `fitToView` 使用 `dispatchAction({ type: 'restore' })`，随后调用 `resize()`。
- 窗口 `resize` 时调用实例 `resize()`，cleanup 时移除监听。

- [ ] **Step 4: 运行画布测试**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphCanvas.test.tsx
```

Expected: 全部 PASS。

---

### Task 6: 编排 GraphPage、请求状态和响应式布局

**Files:**

- Create: `src/features/graph/GraphPage.tsx`
- Create: `src/features/graph/GraphPage.css`
- Test: `src/features/graph/GraphPage.test.tsx`

**Interfaces:**

- Consumes: `getGraphDataset`、`GraphToolbar`、`GraphCanvas`、两个 Inspector。
- Produces: 默认导出的 `/graph` 页面组件。

- [ ] **Step 1: 写 GraphPage 失败测试**

在页面测试中 mock `GraphCanvas` 为可点击的语义化替身，避免 jsdom 依赖 SVG 布局：

```typescript
vi.mock('./GraphCanvas', () => ({
  default: ({ dataset, onSelectionChange }: GraphCanvasProps) => (
    <div aria-label={`测试图谱 ${dataset.view}`}>
      <button onClick={() => onSelectionChange({ kind: 'node', id: dataset.nodes[0].id })}>
        选择第一个节点
      </button>
    </div>
  ),
}))
```

测试覆盖：

- 默认显示“知识图谱”标题和概念网络。
- 加载未完成显示 `role="status"` 和“正在加载知识图谱”。
- 切换到作者合作会调用 loader 的 `'author'` 参数。
- 选择节点后显示正确详情。
- 搜索并选择结果后显示对应详情。
- 空数据显示“当前网络暂无节点”。
- 加载失败显示 `role="alert"` 和“重新加载”，点击后再次调用 loader。

- [ ] **Step 2: 运行页面测试并确认组件不存在**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphPage.test.tsx
```

Expected: FAIL，无法找到 `GraphPage`。

- [ ] **Step 3: 实现 GraphPage 状态编排**

```typescript
type LoadGraph = (view: GraphView) => Promise<GraphDataset>

type GraphPageProps = {
  loadGraph?: LoadGraph
}

export default function GraphPage({ loadGraph = getGraphDataset }: GraphPageProps) {
  // view、dataset、requestState、error、query、selection 状态
}
```

行为：

- 初始 `view = 'concept'`。
- view 变化后设置 loading、调用 loader，并忽略已过期请求的结果。
- 首次成功后选择 `paperCount` 最大的概念；其他网络默认选择节点数组第一项。
- 标签切换时恢复该标签在当前页面会话中的最后选择；若不存在则使用默认项。
- 搜索使用 `findMatchingNodes`，选择结果时设置节点 selection 并清空结果列表。
- `onReset` 清除查询并恢复默认选择。
- `onFit` 调用 `GraphCanvasHandle.fitToView()`。
- dataset 为空时不渲染画布实例，显示空态。
- error 时显示错误内容和重试按钮。

- [ ] **Step 4: 编写页面 CSS**

必须实现这些类和行为：

```css
.graph-page { min-height: calc(100vh - 136px); }
.graph-page__workspace { display: grid; grid-template-columns: minmax(0, 1fr) 320px; }
.graph-page__canvas { min-height: 620px; }
.graph-page__inspector { overflow: auto; }

@media (max-width: 980px) {
  .graph-page__workspace { grid-template-columns: 1fr; }
  .graph-page__canvas { min-height: 520px; }
}
```

同时复用 `tokens.css` 的颜色、圆角和边框变量；不要修改审核页样式。

- [ ] **Step 5: 运行 GraphPage 测试**

Run:

```powershell
npx.cmd vitest run src/features/graph/GraphPage.test.tsx
```

Expected: 全部 PASS。

---

### Task 7: 接入路由和主导航

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/AppSidebar.tsx`
- Modify: `src/components/AppShell.test.tsx`

**Interfaces:**

- Consumes: 默认导出的 `GraphPage`。
- Produces: `/graph` 路由和可激活的“知识图谱”导航链接。

- [ ] **Step 1: 先更新路由和导航测试**

向 `App.test.tsx` 增加：

```typescript
it('图谱地址显示知识图谱页面', async () => {
  render(
    <MemoryRouter initialEntries={['/graph']}>
      <App />
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { name: '知识图谱' })).toBeInTheDocument()
  expect(await screen.findByText('概念网络')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '知识图谱' })).toHaveAttribute('aria-current', 'page')
})
```

将 `AppShell.test.tsx` 中知识图谱断言改成：

```typescript
expect(screen.getByRole('link', { name: '知识图谱' })).toHaveAttribute('href', '/graph')
```

- [ ] **Step 2: 运行测试并确认路由/链接尚不存在**

Run:

```powershell
npx.cmd vitest run src/App.test.tsx src/components/AppShell.test.tsx
```

Expected: FAIL，`/graph` 被重定向或知识图谱仍为 button。

- [ ] **Step 3: 注册路由**

在 `App.tsx`：

```typescript
import GraphPage from './features/graph/GraphPage'

<Route path="/graph" element={<GraphPage />} />
```

现有默认 `/ → /papers` 行为保持不变。

- [ ] **Step 4: 更新主导航**

在 `AppSidebar.tsx` 将：

```typescript
{ label: '知识图谱', to: null }
```

改为：

```typescript
{ label: '知识图谱', to: '/graph' }
```

保留“知识问答”为未实现按钮。

- [ ] **Step 5: 运行路由和导航测试**

Run:

```powershell
npx.cmd vitest run src/App.test.tsx src/components/AppShell.test.tsx
```

Expected: 全部 PASS。

---

### Task 8: 完整验证和浏览器验收

**Files:**

- Modify only if verification exposes a defect: files already listed in Tasks 1–7。

**Interfaces:**

- Consumes: 完成后的完整应用。
- Produces: 测试、检查、构建和本地浏览器验收证据。

- [ ] **Step 1: 运行所有自动测试**

Run:

```powershell
npm.cmd test
```

Expected: 所有测试文件和测试用例 PASS，0 failed。

- [ ] **Step 2: 运行代码检查**

Run:

```powershell
npm.cmd run lint
```

Expected: 退出码 0，无 lint error。

- [ ] **Step 3: 运行正式构建**

Run:

```powershell
npm.cmd run build
```

Expected: TypeScript 编译和 Vite build 均成功，退出码 0。

- [ ] **Step 4: 启动或复用开发服务器**

Run:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

Expected: Vite 输出本地地址；保持此终端运行。

- [ ] **Step 5: 在浏览器逐项验收 `/graph`**

验证：

1. 左侧知识图谱导航激活。
2. 四个标签依次切换且画布内容变化。
3. 搜索“反转学习”后可定位并打开详情。
4. 点击概念、方法、论文和作者节点分别显示正确详情。
5. 点击作者合作边显示权重和共同论文。
6. 适应画布、重置、缩放、平移和节点拖动可用。
7. 概念论文 JIF/年份排序切换可用。
8. 将窗口缩窄到 980px 以下，详情移动到画布下方。
9. 控制台没有未处理异常。

- [ ] **Step 6: 若验收发现缺陷，先补失败测试再修复**

对每个缺陷执行：

```text
写出能够复现问题的失败测试
→ 运行并确认失败原因正确
→ 做最小修复
→ 运行该测试并确认通过
→ 重新运行 npm.cmd test、npm.cmd run lint、npm.cmd run build
```

- [ ] **Step 7: 记录最终验证结果**

在任务交付回复中报告：

- 测试文件数、测试用例数和失败数；
- lint 退出结果；
- build 退出结果；
- 浏览器验收通过的交互项；
- 因等待 A 确认而仍为 Mock 的字段。
