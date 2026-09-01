# 研知图 v05 数据契约迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将论文、审核建议、知识图谱和分析任务的数据边界迁移到 v05，同时保留现有 Mock 界面、交互和离线 HTML 预览。

**Architecture:** 新增集中式 v05 DTO 与 API 错误边界；每个功能通过适配器把后端 DTO 转换为现有页面 ViewModel。Mock 与正式 API 共用 DTO，图谱展示关系仅在前端适配层派生，不污染正式 GraphResponse。

**Tech Stack:** React 19、TypeScript 6、Vite 8、Vitest 4、Testing Library、ECharts 6、Oxlint。

**Spec:** `docs/superpowers/specs/20260831_yanzhitu_v05_contract_migration_design_v01.md`

## Global Constraints

- 所有新建、修改和删除只发生在 `D:\Codex\20260831_yanzhitu_frontend_backend_handoff_v01`。
- `docs/backend/20260831_yanzhitu_ca_contract_v05.md` 是唯一有效的后端契约入口；v03/v04 仅为历史资料。
- 不实现后端、内部 API、鉴权或真实 JIF/JCR 获取。
- Mock 与正式 API 使用相同 v05 DTO；页面不得直接消费 DTO。
- 所有 ID 均为不可空字符串；单值缺失为 `null`，集合缺失为 `[]`。
- `PageResult<T>` 不含 `totalPages`，仅在页面 ViewModel 中通过 `Math.ceil(total / pageSize)` 派生。
- 所有新功能和缺陷修复严格执行 RED–GREEN；每个任务独立提交并通过双阶段复查。
- 不修改现有 ARIA 语义；新增错误或加载状态必须保持键盘和读屏可用。

---

### Task 1: 集中式 v05 DTO、API 错误与数据模式

**Files:**
- Create: `src/contracts/v05.types.ts`
- Create: `src/contracts/api-client.ts`
- Create: `src/contracts/api-client.test.ts`
- Create: `src/contracts/data-mode.ts`
- Create: `src/contracts/data-mode.test.ts`

**Interfaces:**
- Produces: `PageResult<T>`、`ApiErrorDetail`、`ApiErrorResponse`、Paper/Author/Journal/Suggestion/Graph/Analysis DTO。
- Produces: `ApiClientError`、`requestJson<T>(input, init?, fetcher?)`。
- Produces: `DataMode = 'mock' | 'api'`、`getDataMode()`。

- [ ] **Step 1: 写失败测试，锁定分页、数据模式和完整错误字段**

```ts
it('preserves the complete v05 error payload', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { code: 'INVALID_REQUEST', message: 'bad page', retryable: false, details: { page: 0 }, requestId: 'req-1' },
  }), { status: 400, headers: { 'content-type': 'application/json' } }))
  await expect(requestJson('/api/v1/papers', undefined, fetcher)).rejects.toMatchObject({
    status: 400, code: 'INVALID_REQUEST', retryable: false, requestId: 'req-1', details: { page: 0 },
  })
})

it('defaults to mock mode and accepts VITE_DATA_MODE=api', () => {
  expect(resolveDataMode(undefined)).toBe('mock')
  expect(resolveDataMode('api')).toBe('api')
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/contracts/api-client.test.ts src/contracts/data-mode.test.ts`

Expected: FAIL，因为模块和导出尚不存在。

- [ ] **Step 3: 实现最小 DTO 与错误边界**

```ts
export type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number }
export type ApiErrorDetail = { code: string; message: string; retryable: boolean; details: Record<string, unknown> | null; requestId: string }

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly detail: ApiErrorDetail,
  ) { super(detail.message); this.name = 'ApiClientError' }
  get code() { return this.detail.code }
  get retryable() { return this.detail.retryable }
  get details() { return this.detail.details }
  get requestId() { return this.detail.requestId }
}

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(input, init)
  const body = await response.json()
  if (!response.ok) throw new ApiClientError(response.status, (body as ApiErrorResponse).error)
  return body as T
}
```

在 `v05.types.ts` 逐字定义契约中的公开 DTO 与枚举，包括 `PaperAuthor.authorId/displayName/rawName/authorOrder`、`JournalInfo.metrics`、`Suggestion.operation/evidenceIds/proposedChange/executionResult`、`GraphMeta/GraphResponse` 和 `AnalysisJob.error: ApiErrorDetail | null`。

- [ ] **Step 4: 运行定向测试和类型构建并确认 GREEN**

Run: `npm test -- src/contracts/api-client.test.ts src/contracts/data-mode.test.ts`

Run: `npm run build`

Expected: 全部 PASS；TypeScript 不允许 `PageResult` 携带传输字段 `totalPages`。

- [ ] **Step 5: 提交**

```powershell
git add src/contracts
git commit -m "feat: add v05 contract boundary"
```

### Task 2: Paper、Author、Journal 适配和 v05 Mock

**Files:**
- Create: `src/features/papers/paper.adapter.ts`
- Create: `src/features/papers/paper.adapter.test.ts`
- Modify: `src/features/papers/paper.types.ts`
- Modify: `src/features/papers/paper.mock.ts`
- Modify: `src/features/papers/paper-detail.mock.ts`
- Modify: `src/features/papers/paper.service.ts`
- Modify: `src/features/papers/paper.service.test.ts`
- Modify: `src/features/papers/PaperListPage.tsx`
- Modify: `src/features/papers/PaperListPage.test.tsx`
- Modify: `src/features/papers/PaperDetailPage.tsx`
- Modify: `src/features/papers/PaperDetailPage.test.tsx`

**Interfaces:**
- Consumes: `PaperSummaryDto`、`PaperDetailDto`、`PageResult<T>`、`getDataMode()`、`requestJson<T>()`。
- Produces: `toPaperSummaryView(dto, metricSource)`、`toPaperDetailView(dto, metricSource)`、`toPaperPageView(dto, metricSource)`。
- Produces: `PaperMetricSource = 'mock' | 'unavailable'`，页面用它决定是否显示“JIF/JCR 演示数据”。

- [ ] **Step 1: 写失败测试，锁定作者顺序、Journal 嵌套和派生页数**

```ts
it('maps v05 authors, journal and derives totalPages', () => {
  const page = toPaperPageView({ items: [paperSummaryDto], page: 2, pageSize: 2, total: 5 }, 'mock')
  expect(page.totalPages).toBe(3)
  expect(page.items[0].authors.map((author) => author.id)).toEqual(['author-a', 'author-b'])
  expect(page.items[0].authors.map((author) => author.name)).toEqual(['A', 'B'])
  expect(page.items[0].journal?.impactFactor).toBe(4.2)
  expect(page.items[0].metricSource).toBe('mock')
})

it('does not expose unavailable metrics in api mode', () => {
  expect(toPaperSummaryView({ ...paperSummaryDto, journal: { name: 'J', issn: null, metrics: null } }, 'unavailable').journal?.impactFactor).toBeNull()
})

it('preserves ORCID provenance without treating imported ids as authenticated', () => {
  const author = toAuthorDetailView(authorDetailDto({
    externalIds: { orcid: '0000-0001', orcidSource: 'crossref', orcidAuthenticated: false },
  }))
  expect(author.orcid).toEqual({ value: '0000-0001', source: 'crossref', authenticated: false })
})
```

- [ ] **Step 2: 运行 Paper 定向测试并确认 RED**

Run: `npm test -- src/features/papers/paper.adapter.test.ts src/features/papers/paper.service.test.ts`

Expected: FAIL，因为 v05 fixture 和适配器尚不存在。

- [ ] **Step 3: 实现适配器、双模式服务和 v05 Mock**

```ts
export function toPaperPageView(dto: PageResult<PaperSummaryDto>, metricSource: PaperMetricSource): PaperPage {
  return {
    items: dto.items.map((item) => toPaperSummaryView(item, metricSource)),
    page: dto.page,
    pageSize: dto.pageSize,
    total: dto.total,
    totalPages: dto.pageSize > 0 ? Math.ceil(dto.total / dto.pageSize) : 0,
  }
}

export async function getPapers(scenario: PaperListScenario = 'success'): Promise<PaperPage> {
  const dto = getDataMode() === 'api'
    ? await requestJson<PageResult<PaperSummaryDto>>('/api/v1/papers?page=1&pageSize=20&sortBy=year&sortOrder=desc')
    : getPaperPageMock(scenario)
  return toPaperPageView(structuredClone(dto), getDataMode() === 'mock' ? 'mock' : 'unavailable')
}
```

Paper 页面继续消费 ViewModel；作者链接和排序基于稳定 `authorId/authorOrder`。作者详情同时展示 ORCID 来源和 OAuth 认证状态，非 `orcidOAuth` 来源不得显示为已认证。只在 Mock 指标存在时显示“JIF/JCR 演示数据”，正式 `metrics:null` 不显示 JIF/JCR 或 JIF 排序入口。

- [ ] **Step 4: 运行 Paper 页面、服务和适配器测试并确认 GREEN**

Run: `npm test -- src/features/papers`

Expected: 全部 PASS；额外断言第一作者由最小 `authorOrder` 决定，而不是数组偶然顺序。

- [ ] **Step 5: 提交**

```powershell
git add src/features/papers
git commit -m "feat: migrate papers to v05 contract"
```

### Task 3: Suggestion DTO、池连接与审核请求转换

**Files:**
- Modify: `src/features/suggestions/suggestion.types.ts`
- Modify: `src/features/suggestions/suggestion.mock.ts`
- Modify: `src/features/suggestions/suggestion-resolution.ts`
- Modify: `src/features/suggestions/suggestion-resolution.test.ts`
- Modify: `src/features/suggestions/suggestion.service.ts`
- Modify: `src/features/suggestions/suggestion.service.test.ts`
- Create: `src/features/suggestions/suggestion.adapter.ts`
- Create: `src/features/suggestions/suggestion.adapter.test.ts`

**Interfaces:**
- Consumes: `SuggestionPageDto`、`ExtractionDto`、`AcceptSuggestionRequestDto`、`RejectSuggestionRequestDto`、`ApiClientError`。
- Produces: `loadLatestExtraction(paperId): Promise<ExtractionDto>`，对应 `GET /api/v1/papers/{paperId}/extractions/latest`。
- Produces: `toSuggestionPageView(dto, latestExtractionsByPaperId)`，按 `evidenceIds` 和 `paperId` 连接当前页池，并从同一 `extractionId` 的最新 Extraction 连接待审核候选。
- Produces: `getDefaultCandidateIds(suggestion)`，只返回 `defaultCandidateId` 或 `[]`。
- Produces: `buildAcceptSuggestionRequest(suggestion, selectedIds, labelOverrides, comment)`。

- [ ] **Step 1: 写失败测试，移除 70% 算法并锁定 v05 请求体**

```ts
it('uses only the backend default candidate', () => {
  expect(getDefaultCandidateIds(resolveSuggestion({ defaultCandidateId: 'candidate-low' }))).toEqual(['candidate-low'])
  expect(getDefaultCandidateIds(resolveSuggestion({ defaultCandidateId: null }))).toEqual([])
})

it('builds the v05 multi-match request without silently remapping New', () => {
  expect(buildAcceptSuggestionRequest(suggestion, ['new-1'], { 'new-1': '修订名称' }, 'ok')).toEqual({
    comment: 'ok',
    resolution: { selectedTargets: [{ candidateId: 'new-1', labelOverride: '修订名称' }] },
  })
})

it('joins page-scoped paper, evidence and current extraction candidate pools', () => {
  const page = toSuggestionPageView(suggestionPageDto, { 'paper-1': latestExtractionDto })
  expect(page.items[0].paperTitle).toBe('Paper A')
  expect(page.items[0].evidence.map((item) => item.id)).toEqual(['ev-1'])
  expect(page.items[0].candidates.map((item) => item.id)).toEqual(['candidate-1'])
  expect(page.statusCounts.superseded).toBe(1)
})

it('blocks a pending review when the latest extraction no longer matches', () => {
  const page = toSuggestionPageView(suggestionPageDto, { 'paper-1': newerExtractionDto })
  expect(page.items[0]).toMatchObject({ canReview: false, candidateState: 'staleExtraction' })
})
```

- [ ] **Step 2: 运行 Suggestion 逻辑测试并确认 RED**

Run: `npm test -- src/features/suggestions/suggestion-resolution.test.ts src/features/suggestions/suggestion.adapter.test.ts src/features/suggestions/suggestion.service.test.ts`

Expected: FAIL，旧逻辑仍按 `confidence >= 0.7` 选择并提交旧 `selections`。

- [ ] **Step 3: 实现 v05 类型、适配器和逐条审核服务**

```ts
export function getDefaultCandidateIds(suggestion: Suggestion): string[] {
  const id = suggestion.proposedChange.type === 'resolveConceptMatch' || suggestion.proposedChange.type === 'resolveMethodMatch'
    ? suggestion.proposedChange.defaultCandidateId
    : null
  return id ? [id] : []
}

export function buildAcceptSuggestionRequest(
  suggestion: Suggestion,
  selectedIds: string[],
  labelOverrides: Record<string, string>,
  comment: string | null,
): AcceptSuggestionRequestDto {
  const resolve = suggestion.operation === 'resolveConceptMatch' || suggestion.operation === 'resolveMethodMatch'
  return {
    comment: comment?.trim() || null,
    resolution: resolve ? { selectedTargets: selectedIds.map((candidateId) => ({
      candidateId,
      labelOverride: suggestion.candidates.find((item) => item.id === candidateId)?.kind === 'new'
        ? labelOverrides[candidateId]?.trim() || null
        : null,
    })) } : null,
  }
}
```

Mock service 返回完整 `SuggestionPageDto`，包括 `evidence/papers/statusCounts`；对当前页涉及的论文按 ID 去重后加载最新 Extraction。待审核 resolve 建议仅在 `suggestion.extractionId === extraction.id` 时连接候选，否则标记 `staleExtraction`、禁用 accept 并提示刷新。accepted/rejected 历史项使用 `executionResult` 展示最终目标，不伪造 v05 未公开的旧候选。批量操作继续 `Promise.allSettled`，每条 resolve 仅用自己的 `defaultCandidateId`，没有默认项则跳过。

- [ ] **Step 4: 运行逻辑和服务测试并确认 GREEN**

Run: `npm test -- src/features/suggestions/suggestion-resolution.test.ts src/features/suggestions/suggestion.adapter.test.ts src/features/suggestions/suggestion.service.test.ts`

Expected: 全部 PASS；覆盖 1–3 个目标、最多一个 New、Existing 的 `labelOverride:null`、非 resolve 的 `resolution:null` 和拒绝 `{reason:null}`。

- [ ] **Step 5: 提交**

```powershell
git add src/features/suggestions
git commit -m "feat: migrate suggestion review contract"
```

### Task 4: Suggestion 页面状态、409 冲突和批量部分成功

**Files:**
- Modify: `src/features/suggestions/SuggestionReviewPage.tsx`
- Modify: `src/features/suggestions/SuggestionReviewPage.test.tsx`
- Modify: `src/features/suggestions/SuggestionReviewCard.tsx`
- Modify: `src/features/suggestions/PaperReviewGroup.tsx`
- Modify: `src/features/suggestions/BatchReviewDialog.tsx`
- Modify: `src/features/suggestions/RejectSuggestionDialog.tsx`
- Modify: `src/features/suggestions/ReviewStatusTabs.tsx`

**Interfaces:**
- Consumes: Task 3 的 `SuggestionPage` ViewModel、`statusCounts`、请求构造函数和 `ApiClientError`。
- Produces: pending/accepted/rejected 三页签；`superseded` 只参与计数和不可审核状态。

- [ ] **Step 1: 写失败的页面行为测试**

```tsx
it('shows backend counts and skips batch accept items without defaults', async () => {
  renderPage({ service: serviceWithOneDefaultAndOneManualItem })
  expect(screen.getByRole('tab', { name: /待审核.*2/ })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '批量采纳' }))
  expect(service.acceptSuggestion).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toHaveTextContent('1 条需要人工选择')
})

it('preserves the New selection after a stale candidate conflict', async () => {
  service.acceptSuggestion.mockRejectedValue(new ApiClientError(409, staleDetail))
  renderPage({ service })
  await chooseNewAndAccept('修订名称')
  expect(screen.getByRole('alert')).toHaveTextContent('候选已变化')
  expect(screen.getByDisplayValue('修订名称')).toBeVisible()
})
```

- [ ] **Step 2: 运行页面测试并确认 RED**

Run: `npm test -- src/features/suggestions/SuggestionReviewPage.test.tsx`

Expected: FAIL，旧页面使用本地全量计数、强制拒绝原因或在重名时静默换候选。

- [ ] **Step 3: 实现页面迁移**

```ts
const counts = page.statusCounts
const result = await service.reviewSuggestions({ ids: selectedIds, status: 'accepted' })
setNotice(`${result.updated.length} 条成功，${result.skipped.length} 条需要人工选择，${result.failures.length} 条失败`)

if (error instanceof ApiClientError && error.status === 409 && error.code === 'RESOLUTION_CANDIDATE_STALE') {
  setConflict({ suggestionId, message: error.message, replacementNodeId: typeof error.details?.nodeId === 'string' ? error.details.nodeId : null })
  return
}
```

拒绝原因改为可空，非空时在前端校验去空白后不超过 1000 字；superseded 卡片不可 accept/reject；推荐分数 `null` 显示“未提供”。

- [ ] **Step 4: 运行全部 Suggestion 测试并确认 GREEN**

Run: `npm test -- src/features/suggestions`

Expected: 全部 PASS；批量部分成功不会回滚已成功条目，409 不清除用户输入。

- [ ] **Step 5: 提交**

```powershell
git add src/features/suggestions
git commit -m "feat: align suggestion review UI with v05"
```

### Task 5: GraphResponse 适配器、正式边与详情缓存

**Files:**
- Modify: `src/features/graph/graph.types.ts`
- Modify: `src/features/graph/graph.mock.ts`
- Modify: `src/features/graph/graph.service.ts`
- Modify: `src/features/graph/graph.service.test.ts`
- Create: `src/features/graph/graph.adapter.ts`
- Create: `src/features/graph/graph.adapter.test.ts`
- Create: `src/features/graph/graph-detail-cache.ts`
- Create: `src/features/graph/graph-detail-cache.test.ts`

**Interfaces:**
- Consumes: `GraphResponseDto` 及 Paper/Author/Concept/Method 详情加载器。
- Produces: `GraphDatasetView`（现 `GraphDataset` 的明确 ViewModel 名称），其中 `formalEdges` 保存适配所需的全部 v05 关系，`nodes/edges` 只保存当前基础视图实际展示的节点和边，`contextOverlay` 保存派生展示关系。
- Produces: `toGraphDatasetView(view, responses, detailPools)`。
- Produces: `createGraphDetailCache(loaders)`，同一类型/ID 会话内只加载一次。
- Produces: `GraphFocusDependencies = { listConcepts(): Promise<PageResult<ConceptSummaryDto>>; listMethods(): Promise<PageResult<MethodSummaryDto>>; listPapers(input: { sortBy: 'year'; sortOrder: 'desc' }): Promise<PageResult<PaperSummaryDto>> }`。
- Produces: `getInitialGraphFocus(view, dependencies)`，concept/method/paper 取对应列表首项；author 取论文首项中最小 `authorOrder` 的 `authorId`；空列表返回 `null`。

- [ ] **Step 1: 写失败测试，锁定正式边、派生 overlay、合并和缓存**

```ts
it('keeps only v05 relations as formal edges and derives author overlays', () => {
  const dataset = toGraphDatasetView('concept', [conceptGraphResponse], pools)
  expect(dataset.formalEdges.map((edge) => edge.relationType)).toEqual(expect.arrayContaining(['studies', 'authored']))
  expect(dataset.edges.every((edge) => edge.relationType === 'relatedTo' || edge.relationType === 'broaderThan')).toBe(true)
  expect(dataset.contextOverlay.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ relationType: 'conceptAuthor', sourceId: 'concept-1', targetId: 'author-1' }),
  ]))
})

it('merges selected paper responses without duplicating nodes or evidence', () => {
  const dataset = toGraphDatasetView('paper', [paperOneResponse, paperTwoResponse], pools)
  expect(new Set(dataset.nodes.map((node) => node.id)).size).toBe(dataset.nodes.length)
})

it('loads each detail only once per session', async () => {
  const cache = createGraphDetailCache(loaders)
  await Promise.all([cache.paper('paper-1'), cache.paper('paper-1')])
  expect(loaders.paper).toHaveBeenCalledTimes(1)
})

it('selects deterministic initial focuses and never guesses an empty id', async () => {
  await expect(getInitialGraphFocus('concept', dependencies)).resolves.toBe('concept-1')
  await expect(getInitialGraphFocus('method', dependencies)).resolves.toBe('method-1')
  await expect(getInitialGraphFocus('paper', dependencies)).resolves.toBe('paper-newest')
  await expect(getInitialGraphFocus('author', dependencies)).resolves.toBe('first-author-id')
  await expect(getInitialGraphFocus('concept', emptyDependencies)).resolves.toBeNull()
})
```

- [ ] **Step 2: 运行 Graph 适配器测试并确认 RED**

Run: `npm test -- src/features/graph/graph.adapter.test.ts src/features/graph/graph-detail-cache.test.ts src/features/graph/graph.service.test.ts`

Expected: FAIL，因为旧 Mock 直接返回带自定义边的 `GraphDataset`。

- [ ] **Step 3: 实现 v05 Graph Mock、适配和服务**

```ts
export async function getGraphResponse(focusNodeId: string): Promise<GraphResponseDto> {
  if (getDataMode() === 'api') {
    return requestJson(`/api/v1/graph?focusNodeId=${encodeURIComponent(focusNodeId)}&depth=2&maxNodes=30`)
  }
  return structuredClone(graphResponseMocks[focusNodeId] ?? emptyGraphResponse(focusNodeId))
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}
```

`RelationTypeDto` 只能包含 `authored/coAuthor/studies/uses/reports/supports/contradicts/relatedTo/broaderThan/cites`。`conceptAuthor/conceptMethod/authorConcept/authorMethod/paperConcept` 仅由适配器写入 `contextOverlay`。

- [ ] **Step 4: 运行 Graph 服务与适配器测试并确认 GREEN**

Run: `npm test -- src/features/graph/graph.adapter.test.ts src/features/graph/graph-detail-cache.test.ts src/features/graph/graph.service.test.ts`

Expected: 全部 PASS；覆盖空列表不猜 ID、四种初始 focus、`meta.truncated` 保留和多 Paper 增量合并。

- [ ] **Step 5: 提交**

```powershell
git add src/features/graph
git commit -m "feat: adapt v05 graph responses"
```

### Task 6: Graph 页面接线、按需详情和无 JIF 降级

**Files:**
- Modify: `src/features/graph/GraphPage.tsx`
- Modify: `src/features/graph/GraphPage.test.tsx`
- Modify: `src/features/graph/NodeInspector.tsx`
- Modify: `src/features/graph/GraphInspector.test.tsx`
- Modify: `src/features/graph/graph-transform.ts`
- Modify: `src/features/graph/graph-transform.test.ts`
- Modify: `src/features/graph/GraphPage.css`

**Interfaces:**
- Consumes: Task 5 的 focus 选择、Graph service、适配器和详情缓存。
- Produces: 保持现有四图交互；Paper 多选按需加载、缓存和合并 GraphResponse。
- Produces: `getGraphNodeSize(node, dataset, metricAvailability)` 的安全缩放。

- [ ] **Step 1: 写失败测试，锁定加载流程和指标降级**

```ts
it('loads and retains multiple selected paper graph responses', async () => {
  renderPage({ view: 'paper', service })
  await clickNode('paper-1')
  await clickNode('paper-2')
  expect(service.getGraphResponse).toHaveBeenCalledWith('paper-1')
  expect(service.getGraphResponse).toHaveBeenCalledWith('paper-2')
  expect(selectedPaperIds()).toEqual(['paper-1', 'paper-2'])
  await clickNode('paper-1')
  expect(selectedPaperIds()).toEqual(['paper-2'])
})

it.each([undefined, Number.NaN, -3])('uses a finite minimum paper size for unavailable JIF %s', (impactFactor) => {
  expect(getPaperNodeSize(impactFactor, 4)).toBeGreaterThanOrEqual(28)
  expect(Number.isFinite(getPaperNodeSize(impactFactor, 4))).toBe(true)
})

it('falls back to unique paper count for author size', () => {
  expect(getAuthorNodeSize({ totalImpactFactor: undefined, sourcePaperIds: ['p1', 'p1', 'p2'] }, 'unavailable')).toBeGreaterThan(20)
})
```

- [ ] **Step 2: 运行 Graph 页面和变换测试并确认 RED**

Run: `npm test -- src/features/graph/GraphPage.test.tsx src/features/graph/GraphInspector.test.tsx src/features/graph/graph-transform.test.ts`

Expected: FAIL，旧页面一次加载完整 ViewModel，且默认 JIF 排序/尺寸没有正式模式降级。

- [ ] **Step 3: 实现按需接线和安全尺寸函数**

```ts
function safeMetric(value: number | null | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0
}

export function getPaperNodeSize(impactFactor: number | null | undefined, connectionCount: number): number {
  const metric = safeMetric(impactFactor)
  return metric > 0 ? Math.min(28 + 6 * Math.sqrt(metric), 60) : Math.min(28 + 5 * Math.sqrt(Math.max(connectionCount, 0)), 60)
}

export function getAuthorNodeSize(node: GraphNodeView, availability: MetricAvailability): number {
  const impact = availability === 'mock' ? safeMetric(node.metrics.totalImpactFactor) : 0
  const paperCount = new Set(node.sourcePaperIds).size
  return impact > 0 ? scaleMockImpact(impact) : Math.min(20 + 8 * Math.sqrt(paperCount), 60)
}
```

页面切换视图时先同步进入 loading，使用 cleanup/请求序号阻止旧响应提交；Paper 多选缓存 GraphResponse。检查器按需调用详情缓存；Finding 仅展示节点描述、边和 Evidence。

- [ ] **Step 4: 运行全部 Graph 测试并确认 GREEN**

Run: `npm test -- src/features/graph`

Expected: 全部 PASS；现有主题、字体、相关节点开关、多选、悬浮卡和无障碍行为不回退。

- [ ] **Step 5: 提交**

```powershell
git add src/features/graph
git commit -m "feat: connect graph UI to v05 adapter"
```

### Task 7: AnalysisJob 创建、查询、取消和错误呈现

**Files:**
- Modify: `src/features/analysis/analysis-job.types.ts`
- Modify: `src/features/analysis/analysis-job.mock.ts`
- Modify: `src/features/analysis/analysis-job.service.ts`
- Modify: `src/features/analysis/analysis-job.service.test.ts`
- Modify: `src/features/analysis/AnalysisProgressPanel.tsx`
- Modify: `src/features/analysis/AnalysisProgressPanel.test.tsx`

**Interfaces:**
- Consumes: `AnalysisJobDto`、`ApiClientError`、`getDataMode()`。
- Produces: `createAnalysisJob(paperId)`、`getAnalysisJob(jobId)`、`cancelAnalysisJob(jobId)`。

- [ ] **Step 1: 写失败测试，覆盖三个 endpoint 和错误元数据**

```ts
it('uses the three v05 analysis job endpoints', async () => {
  await service.createAnalysisJob('paper-1')
  await service.getAnalysisJob('job-1')
  await service.cancelAnalysisJob('job-1')
  expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
    ['/api/v1/papers/paper-1/analysis-jobs', 'POST'],
    ['/api/v1/analysis-jobs/job-1', 'GET'],
    ['/api/v1/analysis-jobs/job-1/cancel', 'POST'],
  ])
})

it('renders retryability and request id from a failed job', () => {
  render(<AnalysisProgressPanel job={failedJob({ retryable: true, requestId: 'req-job-1' })} />)
  expect(screen.getByRole('alert')).toHaveTextContent('可以重试')
  expect(screen.getByText(/req-job-1/)).toBeVisible()
})
```

- [ ] **Step 2: 运行 Analysis 测试并确认 RED**

Run: `npm test -- src/features/analysis`

Expected: FAIL，旧 service 只有轮询 loader，错误缺少 `retryable/requestId`。

- [ ] **Step 3: 实现三接口服务和 v05 Mock 时间线**

```ts
export const analysisJobService = {
  createAnalysisJob: (paperId: string) => requestJson<AnalysisJobDto>(`/api/v1/papers/${encodeURIComponent(paperId)}/analysis-jobs`, { method: 'POST' }),
  getAnalysisJob: (jobId: string) => requestJson<AnalysisJobDto>(`/api/v1/analysis-jobs/${encodeURIComponent(jobId)}`),
  cancelAnalysisJob: (jobId: string) => requestJson<AnalysisJobDto>(`/api/v1/analysis-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
}
```

Mock service 必须保持已有时间线预览，但每个快照的 `error` 使用完整 `ApiErrorDetail`；取消已取消任务幂等，取消 completed/failed 返回 `JOB_NOT_CANCELLABLE`。

- [ ] **Step 4: 运行 Analysis 测试并确认 GREEN**

Run: `npm test -- src/features/analysis`

Expected: 全部 PASS；进度保持 0–100 整数且不倒退，现有 progressbar ARIA 不变。

- [ ] **Step 5: 提交**

```powershell
git add src/features/analysis
git commit -m "feat: complete v05 analysis job boundary"
```

### Task 8: 契约基线、交付说明和离线 HTML

**Files:**
- Create: `docs/backend/20260831_yanzhitu_ca_contract_v05.md`
- Modify: `BACKEND_HANDOFF.md`
- Modify: `README.md`
- Modify: `scripts/build-preview.test.mjs`
- Regenerate: `preview/20260831_yanzhitu_frontend_mock_preview_v01.html`

**Interfaces:**
- Consumes: 已完成的 v05 Mock 应用。
- Produces: 后端唯一契约入口、Mock/API 模式说明、JIF/JCR 演示说明和无外部依赖的单 HTML。

- [ ] **Step 1: 写失败的交付基线测试**

```js
test('handoff points to v05 and preview exposes the mock metric disclaimer', async () => {
  const handoff = await readFile('BACKEND_HANDOFF.md', 'utf8')
  const html = await readFile(previewPath, 'utf8')
  assert.match(handoff, /20260831_yanzhitu_ca_contract_v05\.md/)
  assert.match(handoff, /唯一有效契约/)
  assert.match(html, /JIF\/JCR 演示数据/)
})
```

- [ ] **Step 2: 运行预览测试并确认 RED**

Run: `npm run test:preview`

Expected: FAIL，交付索引仍指向 v03，仓库尚未复制 v05。

- [ ] **Step 3: 复制只读 v05、更新文档并生成 HTML**

```powershell
Copy-Item -LiteralPath 'D:\Claude\KG\yzt-frontend-mockup\documents\0824_api_contract\20260831_yanzhitu_ca_contract_v05.md' -Destination 'D:\Codex\20260831_yanzhitu_frontend_backend_handoff_v01\docs\backend\20260831_yanzhitu_ca_contract_v05.md'
npm run build:preview
```

`BACKEND_HANDOFF.md` 首段声明 v05 是唯一有效契约；旧 blocker 文档标注为历史背景。`README.md` 解释默认 Mock、`VITE_DATA_MODE=api`、正式环境无 JIF/JCR 和离线 HTML 用途。

- [ ] **Step 4: 验证契约副本和预览**

Run: `Get-FileHash 'docs/backend/20260831_yanzhitu_ca_contract_v05.md'; Get-FileHash 'D:\Claude\KG\yzt-frontend-mockup\documents\0824_api_contract\20260831_yanzhitu_ca_contract_v05.md'`

Expected: 两个 SHA256 完全一致。

Run: `npm run test:preview`

Expected: PASS，HTML 不依赖外部 CSS、JavaScript 或构建资源。

- [ ] **Step 5: 提交**

```powershell
git add docs/backend BACKEND_HANDOFF.md README.md scripts/build-preview.test.mjs preview/20260831_yanzhitu_frontend_mock_preview_v01.html
git commit -m "docs: publish v05 backend handoff"
```

### Task 9: 全量回归、浏览器验收和发布

**Files:**
- Modify only if verification exposes a defect: files owned by the failing task.

**Interfaces:**
- Consumes: Tasks 1–8 的完整交付。
- Produces: 可复现的测试证据和推送到 `origin/main` 的迁移提交。

- [ ] **Step 1: 运行全量自动化验证**

```powershell
npm test
npm run test:preview
npm run lint
npm run build
git diff --check
```

Expected: 所有命令退出码为 0；不接受仅凭旧报告或局部测试宣称完成。

- [ ] **Step 2: 用正式用户入口执行浏览器验收**

打开 `preview/20260831_yanzhitu_frontend_mock_preview_v01.html`，逐项验证：

```text
文献：作者顺序正确，Mock 指标有“JIF/JCR 演示数据”标识。
审核：三页签计数来自 statusCounts；无默认候选时批量采纳跳过；拒绝原因可空。
概念/作者图：相关节点开关和选择透明度保持现有设计。
文献图：多选不会互相取消，再次点击只取消当前论文。
方法/文献图：节点短引用与英文悬浮信息卡正常。
主题/字号：左下角正式控件可切换且刷新后保留。
```

- [ ] **Step 3: 检查安全与交付范围**

Run: `git status --short; git diff --name-only 8221249..HEAD; rg -n "(api[_-]?key|secret|password|BEGIN .*PRIVATE KEY)" --glob '!package-lock.json' .`

Expected: 仅包含计划内文件；没有 `.env`、凭据、真实 PDF、真实个人身份信息或未授权计量数据。

- [ ] **Step 4: 由独立审查者执行规格与质量双判定**

审查者必须分别报告：

```text
Spec compliance: PASS / NEEDS FIXES
Task quality: PASS / NEEDS FIXES
Critical / Important / Minor findings with exact file and line
```

发现 Critical/Important 时回到对应任务做 RED–GREEN 修复并再次复审；两项均 PASS 才允许发布。

- [ ] **Step 5: 推送已审核提交**

```powershell
git status --short
git log --oneline 5a4bb08..HEAD
git push origin main
```

Expected: 工作树干净，远端 `main` 包含设计、计划、v05 迁移和重新生成的离线 HTML。
