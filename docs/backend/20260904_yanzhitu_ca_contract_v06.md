# 研知图 A–B–C 统一数据与 API 契约 v0.3（v06 最终版）

日期：2026-09-04  
状态：最终开发基线，替代 v05  
适用范围：A 后端、B 分析模块、C 前端

## 1. 文档效力与系统边界

本文件是 v0.3 唯一有效契约。v01、v02、v03、v04、v05、20项问答、8月30日增补请求、Feedback、blockers、多候选对齐文件和文献导入流程仅保留为决策来源；发生冲突时以本文件为准。

正式数据流固定为：

```text
C 调用 A 的公开 API
A 读取文献、管理任务和正式数据
A 调用 B 分析论文
B 将结构化分析结果提交给 A
A 校验、生成稳定 ID、持久化并生成审核建议
C 从 A 获取解析结果、建议和正式图谱
```

- A 负责 Zotero 接入、数据库、稳定 ID、任务、审核和正式 Graph。
- B 负责 PDF 解析、内容提取、候选匹配、关系分析、Evidence 原文和 confidence。
- C 负责页面、交互和图谱展示，不直接调用 B，也不直接运行 Python 文件。
- `/api/v1/internal/*` 是 A–B 内部接口，C 不调用。
- v0.3 是本地单用户版本，只监听本机地址，不包含登录和权限系统。

## 2. 通用约定

### 2.1 路径与命名

- 公开 API 和内部 API 的基础路径均为 `/api/v1`。
- 请求体、响应体和查询参数统一使用 `camelCase`。
- A 内部可以使用 `snake_case`，但必须在 API 边界转换。

### 2.2 ID、时间和缺失值

- 所有对外 ID 均为长期稳定的 `string`。
- C 不根据 ID 的格式、长度或前缀推断类型。
- 时间使用 ISO 8601 UTC，例如 `2026-08-31T10:30:00Z`。
- 单值缺失返回 `null`，集合缺失返回 `[]`，不得使用含义不明的占位字符串。

### 2.3 分页

```ts
type PageResult<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
}
```

- `page` 从 `1` 开始。
- `pageSize` 默认 `20`，允许范围 `1–100`。
- v0.3 不返回 `totalPages`；C 可用 `Math.ceil(total / pageSize)` 计算。
- 参数越界或格式错误返回 `400 INVALID_REQUEST`。

### 2.4 评分字段

评分字段类型均为 `number | null`，非空时范围为 `[0, 1]`，只用于排序和人工审核提示，不是客观正确概率。

- `extractionConfidence` 表示 B 对“原文是否提取出有效概念或方法”的把握。
- `recommendationScore` 表示某个 Existing 或 New 候选作为当前 Suggestion 审核结果的推荐强度。同一 Suggestion 内两类候选可以比较。
- Finding、关系候选和 GraphEdge 继续使用 `confidence` 表示各自类型内的分析把握。
- `extractionConfidence`、`recommendationScore` 和其他 `confidence` 含义不同，C 必须使用不同文案展示；不同 Suggestion 或不同对象类型的分数不得直接比较。
- C 可以把非空分数显示为百分比，但必须标注为“提取置信度”或“推荐分数”，不得称为客观正确率。

### 2.5 错误响应

```ts
type ApiErrorDetail = {
  code: string
  message: string
  retryable: boolean
  details: Record<string, unknown> | null
  requestId: string
}

type ApiErrorResponse = {
  error: ApiErrorDetail
}
```

## 3. 状态

```ts
type PaperStatus =
  | 'unprocessed'
  | 'queued'
  | 'processing'
  | 'pendingReview'
  | 'completed'
  | 'failed'

type AnalysisJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

type AnalysisStage =
  | 'queued'
  | 'preparing'
  | 'parsing'
  | 'analyzing'
  | 'storing'
  | 'completed'
  | 'failed'
  | 'cancelled'

type SuggestionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded'
```

- 同一论文同时只能有一个 `queued` 或 `processing` 任务。
- `completed`、`failed`、`cancelled` 是任务终止状态。
- `PaperStatus` 不包含 `cancelled`；任务取消后恢复任务创建前的论文状态。
- 每条建议只能从 `pending` 变为 `accepted`、`rejected` 或 `superseded` 一次；三者均为终止状态。

## 4. 作者身份

### 4.1 类型

```ts
type AuthorIdentityStatus =
  | 'resolved'
  | 'provisional'
  | 'merged'

type AuthorAffiliation = {
  rawText: string
  displayName: string | null
  rorId: string | null
}

type AuthorExternalIds = {
  orcid: string | null
  orcidSource: 'orcidOAuth' | 'crossref' | 'zotero' | 'pdf' | 'manual' | null
  orcidAuthenticated: boolean
}

type AuthorSummary = {
  id: string
  displayName: string
  nameVariants: string[]
  externalIds: AuthorExternalIds
  affiliations: AuthorAffiliation[]
  identityStatus: AuthorIdentityStatus
  mergedIntoAuthorId: string | null
}

type AuthorDetail = AuthorSummary & {
  paperCount: number
  createdAt: string
  updatedAt: string
}

type PaperAuthor = {
  authorId: string
  displayName: string
  rawName: string
  authorOrder: number
}
```

`PaperSummary` 和 `PaperDetail` 均使用 `authors: PaperAuthor[]`。
`authorOrder` 从 `1` 开始，并保持论文署名顺序。

### 4.2 身份责任与规则

- 内部稳定 `authorId` 由 A 创建和维护，ORCID 不直接作为数据库主键。
- 只有通过 ORCID OAuth 取得的 iD 才能设置 `orcidAuthenticated: true`；从 DOI、Crossref、Zotero 或 PDF 获得的 ORCID 必须保留来源且不得标记为已认证。
- A 优先使用 Zotero、DOI、Crossref 等结构化来源；缺失时才采用 B 从 PDF 提取的线索。
- B 可以提交姓名、ORCID、单位等线索，但不能生成最终 `authorId`。
- 姓名、拼音、单位或姓名哈希不能单独作为作者主键。
- 已确认相同 ORCID或人工映射时可以关联已有作者。
- 无 ORCID且证据不足时创建新的 `provisional` 作者，禁止仅按姓名自动合并。
- 作者改名、单位变化或后续补充 ORCID时，原 `authorId` 不变。
- 作者合并采用别名映射：保留旧 ID 到主 ID 的映射；Paper 和 Graph 只返回主 ID。访问旧 ID 时返回 `308 Permanent Redirect`，`Location` 指向主作者接口。

以下 ID 必须完全一致：

```text
Paper.authors[].authorId
= AuthorSummary.id / AuthorDetail.id
= Graph author node.id
= authored edge.sourceId
= coAuthor edge.sourceId / targetId
```

### 4.3 作者接口

```http
GET /api/v1/authors/{authorId}
GET /api/v1/authors/{authorId}/papers?page=1&pageSize=20&sortBy=year&sortOrder=desc
GET /api/v1/authors/{authorId}/collaborators?page=1&pageSize=20&sortOrder=desc
```

```ts
type AuthorCollaboratorSummary = {
  author: AuthorSummary
  sharedPaperCount: number
  sharedPaperIds: string[]
}
```

`sharedPaperCount` 只表示当前研知图中的共同论文数。

## 5. Journal、JIF 和 JCR

```ts
type JournalCategoryMetric = {
  category: string
  quartile: 'Q1' | 'Q2' | 'Q3' | 'Q4'
}

type JournalMetrics = {
  impactFactor: number | null
  jcrDataYear: number | null
  categories: JournalCategoryMetric[]
  metricSource: 'JCR' | null
}

type JournalInfo = {
  name: string
  issn: string | null
  metrics: JournalMetrics | null
}
```

- Journal 只作为论文属性，不是 Graph 节点。
- 当前项目没有已确认的合法 JCR/API 授权，因此正式接口必须返回 `metrics: null`。
- 授权确认前默认按 `year` 排序，不按 JIF 排序。
- Mock 中的 JIF/JCR 必须显著标注为演示数据。
- 禁止返回 `citationCount`、`citationSource`、`citationUpdatedAt`。
- `paper → paper: cites` 关系仍然允许。

## 6. Paper 与 ResearchOverview

```ts
type PaperSource = {
  type: 'zotero' | 'academicSearch' | 'manual'
  externalId: string | null
  url: string | null
}

type ResearchOverview = {
  researchTopics: string[]
  researchQuestion: string | null
  sample: string | null
  methods: string | null
  mainResults: string | null
}

type PaperSummary = {
  id: string
  title: string
  authors: PaperAuthor[]
  year: number | null
  doi: string | null
  journal: JournalInfo | null
  status: PaperStatus
  latestJobId: string | null
  pendingSuggestionCount: number
  createdAt: string
  updatedAt: string
}

type PaperDetail = PaperSummary & {
  abstract: string | null
  source: PaperSource
  latestExtractionId: string | null
  researchOverview: ResearchOverview | null
}
```

`researchTopics` 保存反转学习、工作记忆等研究主题；`sample` 统一描述人类被试、动物物种和数量；`methods` 保存主要实验与分析方法；`mainResults` 保存主要结果。B 提取，A 校验和保存，无法可靠提取时按类型返回 `null` 或 `[]`。

```http
GET /api/v1/papers?page=1&pageSize=20&status=unprocessed&search=memory&sortBy=updatedAt&sortOrder=desc
GET /api/v1/papers/{paperId}
```

论文列表 `sortBy` 支持 `createdAt | updatedAt | year | title`，`sortOrder` 支持 `asc | desc`。

## 7. 正式 Concept/Method 查询与匹配候选

### 7.1 正式节点类型

```ts
type MethodType =
  | 'behavioralTask'
  | 'electrophysiology'
  | 'imaging'
  | 'intervention'
  | 'molecularCellular'
  | 'computationalModel'
  | 'statisticalAnalysis'
  | 'other'

type ConceptSummary = {
  id: string
  label: string
  description: string | null
  aliases: string[]
}

type MethodSummary = {
  id: string
  label: string
  methodType: MethodType
  description: string | null
  aliases: string[]
}
```

以下公开查询只返回已经审核通过的正式节点：

```http
GET /api/v1/concepts?search=reversal&page=1&pageSize=20
GET /api/v1/concepts/{conceptId}
GET /api/v1/concepts/{conceptId}/papers?page=1&pageSize=20&sortBy=year&sortOrder=desc
GET /api/v1/methods?search=fMRI&page=1&pageSize=20
GET /api/v1/methods/{methodId}
```

列表分别返回 `PageResult<ConceptSummary>` 和 `PageResult<MethodSummary>`；详情返回对应 Summary；概念论文接口返回 `PageResult<PaperSummary>`。

### 7.2 候选查询

```ts
type MatchableNodeType = 'concept' | 'method'

type NodeMatchCandidate = {
  nodeId: string
  label: string
  recommendationScore: number | null
  evidence: string[]
}

type MatchCandidateRequest = {
  nodeType: MatchableNodeType
  rawText: string
  normalizedLabel: string
  context: string | null
  limit: number
}

type MatchCandidateResponse = {
  nodeType: MatchableNodeType
  candidates: NodeMatchCandidate[]
}
```

```http
POST /api/v1/internal/node-match-candidates
```

- `limit` 默认 `5`，允许 `1–10`。
- A 负责从当前正式 Graph 查询节点并返回候选；A 可以内部调用 B 的语义匹配能力，但候选中的 `nodeId` 必须由 A 验证存在。
- 该内部接口只查询已有正式节点；New 候选由 B 在分析结果中另行提出。
- 候选只用于排序和人工判断，不直接触发合并或写入正式 Graph。
- B 把 Existing 候选与自己提出的 New 候选放入同一审核组时，必须把分数校准为同一 `recommendationScore` 语义后再提交；A 只校验范围、排序和引用，不把不同来源的原始分数直接拼接。
- 名称相似、定义、研究语境及上位/下位关系必须综合考虑；v0.3 不设置固定自动匹配阈值。

## 8. MatchStatus、Extraction 与 Evidence

### 8.1 最终匹配类型

```ts
type MatchStatus =
  | 'matched'
  | 'uncertain'
  | 'new'
```

- `matched`：仅表示该 Extraction 已经通过审核；matched ID 数组必须包含 `1–3` 个不重复的正式节点 ID。
- `uncertain`：尚未审核，matched ID 数组必须为 `[]`，候选非空；通常表示 Existing 与 New 之间或多个候选之间需要判断。
- `new`：尚未审核，matched ID 数组必须为 `[]`，候选中必须包含一个 New 候选；表示 B 推荐创建新节点，但仍允许审核者改选 Existing 候选。
- `uncertain` 和 `new` 都生成 `resolveConceptMatch` 或 `resolveMethodMatch` Suggestion；A 不自动替审核者选择。
- B 提交时只允许 `uncertain | new`；`matched` 只能由 A 在 Suggestion 接受成功后写入。

#### 8.1.1 概念数量与审核选择

```text
Paper 1 ── 0..n ExtractedConcept
ExtractedConcept 1 ── 0..3 Concept（审核前为 0，接受后为 1..3）
Evidence 1 ── 0..n ExtractedConcept

Paper 1 ── 0..n ExtractedMethod
ExtractedMethod 1 ── 0..3 Method（审核前为 0，接受后为 1..3）
```

- 一篇论文可以提取并最终关联多个不同的 Concept；同一个 Concept 也可以关联多篇论文，因此 Paper 与 Concept 整体是多对多关系。
- Concept 是标准化的语义节点，不等同于原始关键词。`rawText` 保存原文词语，近义词或不同写法可以归一到同一个 Concept。
- 同一句 Evidence 可以支持多个 `ExtractedConcept`；C 也允许把同一原文识别结果作为一个审核组，在单条 resolve Suggestion 中选择 `1–3` 个正式 Concept 或 Method。
- 一个审核组内的候选不是互斥项。审核者可以同时选择 Existing 和 New，但候选 ID 不得重复，且最多选择一个 New 候选。
- 同一证据需要创建两个不同的新节点时，B 必须拆成两条可共享 Evidence 的 Extraction/Suggestion；不能在一条 Suggestion 中放入两个 New 候选。
- B 对明显无关的概念仍应拆成不同的 Extraction；单条多选用于同一证据片段中紧密相关、需要共同归类的 `1–3` 个目标，不应用于把整篇论文的所有关键词塞进一条建议。
- 前端既可以在论文层面选择多条 Suggestion，也可以在单条 resolve Suggestion 内选择多个候选。
- v0.3 的 Suggestion 仍逐条审核。前端批量选择时，应分别调用每条 Suggestion 的 accept 或 reject 接口；一条成功不代表其他条目成功。

### 8.2 Evidence

```ts
type Evidence = {
  id: string
  paperId: string
  section: string | null
  text: string
}
```

- B 提交 Evidence 的局部 `clientRef`、章节和原文。
- A 在保存 Extraction 的事务内生成最终 `Evidence.id`、建立引用并持久化。
- 同一提交中相同 `clientRef` 只能映射到一个 Evidence ID，多条提取结果可以共享它。
- 同一分析任务幂等重试必须返回原 Evidence ID；新的分析任务生成新的 Evidence ID。
- Evidence 一旦保存，在该 Extraction 生命周期内保持稳定；建议被拒绝也不删除 Evidence。
- v0.3 不返回 PDF 物理页、段落 ID 或字符范围。

### 8.3 保存后的 Extraction

```ts
type ResolutionCandidate = {
  id: string
  kind: 'existing' | 'new'
  nodeId: string | null
  label: string
  recommendationScore: number | null
}

type ExtractedConcept = {
  id: string
  paperId: string
  rawText: string
  normalizedLabel: string
  matchStatus: MatchStatus
  matchedConceptIds: string[]
  candidates: ResolutionCandidate[]
  extractionConfidence: number | null
  evidenceIds: string[]
}

type ExtractedMethod = {
  id: string
  paperId: string
  rawText: string
  normalizedLabel: string
  methodType: MethodType
  description: string | null
  matchStatus: MatchStatus
  matchedMethodIds: string[]
  candidates: ResolutionCandidate[]
  extractionConfidence: number | null
  evidenceIds: string[]
}

type ExtractedFinding = {
  id: string
  paperId: string
  statement: string
  confidence: number | null
  evidenceIds: string[]
}

type Extraction = {
  id: string
  paperId: string
  analysisJobId: string
  isLatest: boolean
  researchOverview: ResearchOverview
  concepts: ExtractedConcept[]
  methods: ExtractedMethod[]
  findings: ExtractedFinding[]
  evidence: Evidence[]
  createdAt: string
}
```

`ResolutionCandidate` 约束：

- `kind='existing'` 时 `nodeId` 必须是 A 已验证存在的正式节点 ID；`kind='new'` 时 `nodeId` 必须为 `null`。
- 同一 Extraction 内 `id` 唯一并在 Suggestion 生命周期内稳定；ID 由 A 持久化时生成。
- 每个 Extraction 最多包含一个 New 候选。
- 候选按 `recommendationScore` 降序返回，`null` 排在最后；分数并列时保持 A 的稳定顺序。
- Existing 与 New 候选使用相同的推荐分数语义，但分数不构成自动采纳阈值。

`FindingType` 已删除。Finding 只保存陈述、Evidence 和 confidence；研究主题写入 `researchTopics`。

```http
GET /api/v1/papers/{paperId}/extractions/latest
```

没有解析结果时返回 `404 EXTRACTION_NOT_FOUND`。

## 9. AnalysisJob 与 B → A 提交

### 9.1 AnalysisJob

```ts
type AnalysisJob = {
  id: string
  paperId: string
  status: AnalysisJobStatus
  progress: number
  stage: AnalysisStage
  error: ApiErrorDetail | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}
```

- `progress` 是 `0–100` 整数，`queued=0`，成功完成为 `100`。
- A 与 B 在任务开始时建立固定子任务和权重，只有子任务完成后才更新进度。
- 进度不得倒退，不得按阶段硬填百分比或用定时器制造假进度。
- 失败或取消保留最后一次进度。

```http
POST /api/v1/papers/{paperId}/analysis-jobs
GET /api/v1/analysis-jobs/{jobId}
POST /api/v1/analysis-jobs/{jobId}/cancel
```

- 创建成功返回 `201` 和完整 `AnalysisJob`。
- 已有活动任务返回 `409 ACTIVE_JOB_EXISTS`。
- 取消成功返回 `200` 和完整 `AnalysisJob`；重复取消已取消任务仍返回 `200`。
- 取消 `completed` 或 `failed` 任务返回 `409 JOB_NOT_CANCELLABLE`。
- 取消后 A 必须拒绝该任务迟到的 B 结果。

### 9.2 B 提交结构

B 不生成 A 的最终业务 ID，只在单次提交内使用 `clientRef`：

```ts
type BEvidenceInput = {
  clientRef: string
  section: string | null
  text: string
}

type PendingMatchStatus = 'uncertain' | 'new'

type BResolutionCandidateInput = {
  clientRef: string
  kind: 'existing' | 'new'
  nodeId: string | null
  label: string
  recommendationScore: number | null
}

type BExtractedConceptInput = {
  clientRef: string
  rawText: string
  normalizedLabel: string
  matchStatus: PendingMatchStatus
  candidates: BResolutionCandidateInput[]
  extractionConfidence: number | null
  evidenceRefs: string[]
}

type BExtractedMethodInput = {
  clientRef: string
  rawText: string
  normalizedLabel: string
  methodType: MethodType
  description: string | null
  matchStatus: PendingMatchStatus
  candidates: BResolutionCandidateInput[]
  extractionConfidence: number | null
  evidenceRefs: string[]
}

type BExtractedFindingInput = {
  clientRef: string
  statement: string
  confidence: number | null
  evidenceRefs: string[]
}

type BNodeReference =
  | { type: 'formalNodeId'; value: string }
  | { type: 'resolutionCandidateRef'; value: string }
  | { type: 'findingRef'; value: string }

type AnalyzedRelationType =
  | 'supports'
  | 'contradicts'
  | 'relatedTo'
  | 'broaderThan'
  | 'cites'

type BRelationCandidateInput = {
  source: BNodeReference
  target: BNodeReference
  relationType: AnalyzedRelationType
  confidence: number | null
  evidenceRefs: string[]
}

type BAnalysisResultSubmission = {
  submissionId: string
  paperId: string
  researchOverview: ResearchOverview
  evidence: BEvidenceInput[]
  concepts: BExtractedConceptInput[]
  methods: BExtractedMethodInput[]
  findings: BExtractedFindingInput[]
  relationCandidates: BRelationCandidateInput[]
}

type BAnalysisResultAccepted = {
  extractionId: string
  evidenceIds: string[]
  suggestionIds: string[]
  analysisJob: AnalysisJob
}
```

```http
POST /api/v1/internal/analysis-jobs/{jobId}/result
Content-Type: application/json
```

- A 校验路径中的 `jobId`、请求中的 `paperId` 和任务所属论文一致。
- A 校验 Extraction、Evidence 和 Finding 的 `clientRef` 在各自集合内唯一；所有 Concept/Method 候选的 `clientRef` 在两类候选合并范围内唯一；所有引用有效。Existing 候选的 `nodeId` 必须指向类型一致的正式节点。
- New 候选的 `nodeId` 必须为 `null`，每个 Extraction 最多一个 New 候选。A 为保存后的候选生成最终稳定 `ResolutionCandidate.id`。
- A 在一个事务中创建 Extraction、Evidence 和 Suggestion，再更新任务与论文状态。
- 新 Extraction 成为 latest 时，A 在同一事务中把该论文旧 Extraction 的全部 `pending` Suggestion 改为 `superseded`；已接受或已拒绝的历史建议不变。
- 有待审核建议时 Paper 变为 `pendingReview`；没有待审核建议时 Paper 变为 `completed`；AnalysisJob 成功时变为 `completed`、`stage='completed'`、`progress=100`。
- 首次成功返回 `201 Created`。
- 相同 `jobId + submissionId` 重试返回原结果和 `200 OK`，不得重复创建。
- 同一任务用不同 `submissionId` 重复提交返回 `409 JOB_RESULT_ALREADY_SUBMITTED`。
- 任务已取消或已终止且不再接收结果时返回 `409 JOB_NOT_ACCEPTING_RESULTS`。
- schema 或引用错误返回 `422 INVALID_ANALYSIS_RESULT`，不得部分写入。

### 9.3 关系候选的延迟解析

- `resolutionCandidateRef` 必须指向本次提交中某个 Concept 或 Method 候选的 `clientRef`；`findingRef` 必须指向本次提交中的 Finding `clientRef`。
- A 先保存关系候选。只有两个端点都已经解析成正式节点后，才生成 `addRelation` Suggestion。
- `resolutionCandidateRef` 只在该具体候选被选中时解析，禁止把一个多选 Extraction 展开为所有候选的笛卡尔积。
- 某个必要候选未被选中、对应 Suggestion 被拒绝或被 supersede 时，依赖它的关系候选不进入审核队列。
- 生成前若相同方向、端点和关系类型的正式关系或 pending Suggestion 已存在，A 不得重复生成；`relatedTo` 的两个端点按稳定 ID 规范化后再去重。
- `Paper → Concept/Method/Finding` 的 `studies / uses / reports` 基础关系在对应节点建议接受时自动创建，不额外生成 `addRelation` Suggestion。
- `authored` 来自论文作者数据，`coAuthor` 查询时派生；二者不由 B 通过 `relationCandidates` 提交。

## 10. Suggestion 提交与审核

### 10.1 操作类型

```ts
type SuggestionOperation =
  | 'resolveConceptMatch'
  | 'resolveMethodMatch'
  | 'addFinding'
  | 'addRelation'
```

Concept 和 Method 的 Existing/New 选择统一使用 resolve 操作，不再保留并行的 `addConcept`、`addMethod` 审核结构。v0.3 不包含 `updateNode`、`deleteNode`、`deleteRelation` 或批量修改。

```ts
type ResolveConceptMatchChange = {
  type: 'resolveConceptMatch'
  extractedConceptId: string
  candidateIds: string[]
  defaultCandidateId: string | null
  maxSelections: 3
}

type ResolveMethodMatchChange = {
  type: 'resolveMethodMatch'
  extractedMethodId: string
  candidateIds: string[]
  defaultCandidateId: string | null
  maxSelections: 3
}

type AddFindingChange = {
  type: 'addFinding'
  extractedFindingId: string
  statement: string
}

type AddRelationChange = {
  type: 'addRelation'
  sourceId: string
  sourceType: GraphNodeType
  targetId: string
  targetType: GraphNodeType
  relationType: RelationType
}

type ProposedChange =
  | ResolveConceptMatchChange
  | ResolveMethodMatchChange
  | AddFindingChange
  | AddRelationChange
```

- `candidateIds` 必须与对应 Extraction 的 `candidates[].id` 完全一致，不得引用候选之外的 ID。
- `defaultCandidateId` 由 A 明确返回：存在非空推荐分数时取最高分候选；并列时取候选稳定顺序中的第一个；全部为 `null` 时返回 `null`。
- 默认项只用于 C 的批量采纳和界面预选，不代表自动审核，也不改变 `maxSelections: 3`。
- 批量采纳只提交一个 `defaultCandidateId`，不会自动选择前三名；无默认项的 Suggestion 必须跳过并提示人工选择。

### 10.2 uncertain、new 与多候选

- `uncertain` 和 `new` 都必须创建一条 `resolveConceptMatch` 或 `resolveMethodMatch` 的 `pending` Suggestion。
- 审核者从该 Suggestion 的 Existing/New 候选中选择 `1–3` 个；最多选择一个 New 候选。
- 选择 Existing 后复用其正式节点；选择 New 后创建新正式节点。两类候选可以在同一次接受操作中组合。
- 接受后 A 把 Extraction 更新为 `matched`，将所有最终正式节点 ID 写入 `matchedConceptIds` 或 `matchedMethodIds`，并为每个节点创建或复用一条 Paper 基础关系。
- New Concept 使用候选最终名称，`description=null`，原文 `rawText` 与名称不同时作为 alias；New Method 还使用对应 `ExtractedMethod.methodType` 和 `description`。alias 去空白、去重后保存。
- 所有选中目标可以引用同一组 `evidenceIds`。
- 拒绝 `uncertain` 或 `new` 后不创建节点或关系，Extraction 和 Evidence 保留。
- 审核前，候选和 Extraction 均不得作为正式 Graph 节点或边返回。

### 10.3 Suggestion 与审核响应

```ts
type SelectedResolutionTarget = {
  candidateId: string
  labelOverride: string | null
}

type MultiMatchResolution = {
  selectedTargets: SelectedResolutionTarget[]
}

type ResolvedTarget = {
  candidateId: string
  nodeId: string
  label: string
  created: boolean
  relationId: string
}

type SuggestionExecutionResult =
  | {
      type: 'resolveMatch'
      resolvedTargets: ResolvedTarget[]
    }
  | {
      type: 'addFinding'
      nodeId: string
      relationId: string
    }
  | {
      type: 'addRelation'
      relationId: string
    }

type Suggestion = {
  id: string
  paperId: string
  extractionId: string
  operation: SuggestionOperation
  status: SuggestionStatus
  title: string
  reason: string
  confidence: number | null
  evidenceIds: string[]
  proposedChange: ProposedChange
  executionResult: SuggestionExecutionResult | null
  reviewedAt: string | null
  supersededAt: string | null
  reviewComment: string | null
  createdAt: string
  updatedAt: string
}

type SuggestionPage = PageResult<Suggestion> & {
  evidence: Evidence[]
  papers: SuggestionPaperSummary[]
  statusCounts: SuggestionStatusCounts
}

type AcceptSuggestionRequest = {
  comment: string | null
  resolution: MultiMatchResolution | null
}

type RejectSuggestionRequest = {
  reason: string | null
}

type SuggestionPaperSummary = {
  id: string
  title: string
}

type SuggestionStatusCounts = {
  pending: number
  accepted: number
  rejected: number
  superseded: number
}

type SuggestionDetailResponse = {
  suggestion: Suggestion
  evidence: Evidence[]
  paper: SuggestionPaperSummary
}

type SuggestionAlreadyReviewedDetails = {
  suggestionId: string
  currentStatus: 'accepted' | 'rejected'
  reviewedAt: string
}

type SuggestionSupersededDetails = {
  suggestionId: string
  currentStatus: 'superseded'
  supersededAt: string
}
```

```http
GET /api/v1/suggestions?page=1&pageSize=20&paperId={paperId}&status=pending&operation=resolveConceptMatch
GET /api/v1/suggestions/{suggestionId}
POST /api/v1/suggestions/{suggestionId}/accept
POST /api/v1/suggestions/{suggestionId}/reject
```

- 两个审核接口成功均返回 `200 OK` 和更新后的完整 `Suggestion`。
- 单条详情接口返回 `SuggestionDetailResponse`，其 Evidence 必须覆盖该建议的全部 `evidenceIds`。
- resolve 操作接受时 `resolution` 必填，`selectedTargets` 长度必须为 `1–3`；其他操作的 `resolution` 必须为 `null`。
- `candidateId` 不得重复且必须属于当前 Suggestion；最多选择一个 New 候选。
- Existing 候选的 `labelOverride` 必须为 `null`。New 候选可为 `null`；非空时去除首尾空格后长度为 `1–200`，最终创建名称使用修订值，否则使用候选原始 `label`。
- 接受 New 候选前，A 必须再次检查当前正式节点是否已出现同名或明确别名匹配；若候选已过期，不得静默创建重复节点或替用户改选，返回 `409 RESOLUTION_CANDIDATE_STALE` 并在 `error.details` 提供可重新选择的正式 `nodeId`。
- 建议原始 `proposedChange` 不可编辑，A 必须长期保存。
- 同一 resolve Suggestion 选中的全部目标必须在一个事务内完成候选校验、新节点创建、基础关系创建或复用、Extraction 更新、Suggestion 更新和 `executionResult` 保存；全部成功或全部失败。
- `ResolvedTarget.created` 表示节点是否由本次审核新建；`relationId` 返回该目标对应的 `studies` 或 `uses` 基础关系 ID。
- 接受 `addFinding` 时，Finding 与 `Paper → Finding: reports` 基础关系必须在同一事务创建；接受 `addRelation` 时只创建或复用该正式关系。
- `addRelation` 只能引用已存在的正式节点，禁止引用其他待审核建议将来创建的节点。
- 拒绝原因可不填；非空时去除首尾空格后最大长度为 `1000`，保存到 `reviewComment`。
- 重复审核已接受或已拒绝的建议返回 `409 SUGGESTION_ALREADY_REVIEWED`，`error.details` 至少包含 `suggestionId`、`currentStatus` 和 `reviewedAt`。
- 审核 `superseded` 建议返回 `409 SUGGESTION_SUPERSEDED`；`superseded` 不能 accept 或 reject。
- accepted/rejected 使用 `reviewedAt`；superseded 使用 `supersededAt` 且 `reviewedAt=null`。
- v0.3 不使用 `expectedVersion`，不要求 `reviewedBy`，不提供通用编辑 API。

### 10.4 列表、计数与旧建议失效

- `status` 和 `operation` 查询参数第一版都只接受单值；不传时不按该字段筛选。
- 列表固定按 `createdAt desc` 排序，同一时间使用稳定 `id` 作为次级排序键。
- `papers` 至少覆盖当前页 `items` 中出现的全部 `paperId`；`evidence` 至少覆盖当前页 `items.evidenceIds`，二者不覆盖尚未加载的页面。
- `statusCounts` 应用 `paperId`、`operation` 和其他业务过滤条件，但忽略当前 `status` 条件。C 第一版显示 pending、accepted、rejected 三个页签；superseded 计数用于历史状态，不要求单独页签。
- page/pageSize 越界仍返回通用 `400 INVALID_REQUEST`。
- 新 Extraction 成功保存时，旧 Extraction 的 pending Suggestion 改为 `superseded`；`pendingSuggestionCount` 不统计 superseded。
- 与旧 Extraction 绑定且尚未生成 Suggestion 的延迟关系候选同时失效。
- 旧 Extraction 已 accepted 或 rejected 的历史建议保持原状态；重新分析不自动撤销已经进入正式 Graph 的知识。
- 每次审核后 A 重新计算 `pendingSuggestionCount`；最新 Extraction 已无 pending Suggestion 时，Paper 变为 `completed`，否则保持 `pendingReview`。
- 论文级或类别级批量审核仍由 C 分别调用单条接口，允许不同 Suggestion 部分成功；不新增批量审核 API。

## 11. 正式 Graph

```ts
type GraphNodeType =
  | 'paper'
  | 'author'
  | 'concept'
  | 'method'
  | 'finding'

type RelationType =
  | 'authored'
  | 'coAuthor'
  | 'studies'
  | 'uses'
  | 'reports'
  | 'supports'
  | 'contradicts'
  | 'relatedTo'
  | 'broaderThan'
  | 'cites'

type GraphNode = {
  id: string
  nodeType: GraphNodeType
  label: string
  description: string | null
  sourcePaperIds: string[]
  createdAt: string
  updatedAt: string
}

type GraphEdge = {
  id: string
  sourceId: string
  targetId: string
  relationType: RelationType
  label: string
  confidence: number | null
  evidenceIds: string[]
  weight: number | null
  sourcePaperIds: string[]
  createdAt: string
  updatedAt: string
}

type GraphMeta = {
  focusNodeId: string
  depth: number
  nodeCount: number
  edgeCount: number
  totalMatched: number
  truncated: boolean
}

type GraphResponse = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  evidence: Evidence[]
  meta: GraphMeta
}
```

正式关系约束：

| 关系 | 起点 | 终点 | 说明 |
|---|---|---|---|
| `authored` | Author | Paper | 正式保存 |
| `coAuthor` | Author | Author | 查询时派生，不保存 |
| `studies` | Paper | Concept | 正式保存 |
| `uses` | Paper | Method | 正式保存 |
| `reports` | Paper | Finding | 正式保存 |
| `supports` | Finding | Finding | 正式保存 |
| `contradicts` | Finding | Finding | 正式保存 |
| `relatedTo` | Concept | Concept | 对称语义 |
| `broaderThan` | Concept | Concept | 起点更宽泛 |
| `cites` | Paper | Paper | 起点引用终点 |

`coAuthor` 规则：只根据正式 `authored` 关系计算；论文作者 ID 去重后两两组合；端点按稳定 ID 排序；`sourcePaperIds` 去重；`weight = sourcePaperIds.length`。一篇含 `n` 位不同作者的论文生成 `n(n-1)/2` 个作者对。

```http
GET /api/v1/graph?focusNodeId={nodeId}&depth=2&maxNodes=30
```

- `depth` 默认 `2`，允许 `1–5`。
- `maxNodes` 默认 `30`，允许 `10–50`，硬上限 `50`。
- 参数越界返回 `400 INVALID_GRAPH_QUERY`，不静默修改参数。
- 匹配节点超过 `maxNodes` 时优先保留中心节点、距离近、证据多或相关性高的节点，并返回 `truncated: true`。
- Paper、Author、Concept、Method 和 Finding 中心节点使用同一组参数规则。
- Graph 只包含审核通过的正式知识；pending、rejected 或 superseded Suggestion 均不得混入。

## 12. 关键对齐项最终裁决

1. 既有 Concept/Method 使用第7.1节公开查询；B 的匹配候选使用 `POST /api/v1/internal/node-match-candidates`，A 对正式节点 ID 负责。
2. 最终匹配类型固定为 `matched | uncertain | new`，字段约束见第8.1节。
3. `uncertain` 与 `new` 均产生 resolve Suggestion；单条建议可选择 `1–3` 个 Existing/New 候选，规则见第8节和第10节。
4. B 通过 `POST /api/v1/internal/analysis-jobs/{jobId}/result` 向 A 提交，使用 `submissionId` 保证幂等，见第9.2节。
5. Evidence 最终 ID 由 A 在持久化事务中生成并维护；B 只提交 `clientRef`，C 不生成 ID。
6. `ResearchOverview` 最终定义为 `researchTopics / researchQuestion / sample / methods / mainResults`，见第6节。

## 13. A-01～A-15 最终答复

| 编号 | 最终答复 | 契约位置 |
|---|---|---|
| A-01 | 已确认，内部 `authorId` 由 A 创建和维护 | 4.2 |
| A-02 | 已确认，Paper 返回 `authors: PaperAuthor[]` | 4.1、6 |
| A-03 | 已确认，证据不足时创建 provisional ID，不按姓名自动合并 | 4.2 |
| A-04 | 采用别名映射并保留旧 ID；旧 ID 请求返回308到主 ID | 4.2 |
| A-05 | 已确认，authored 保存，coAuthor 查询时派生 | 4.3、11 |
| A-06 | 已确认，使用 `matched / uncertain / new` | 8.1 |
| A-07 | uncertain 与 new 统一使用 resolve Suggestion | 10.2 |
| A-08 | 当前无已确认的合法 JCR/API 授权，按未授权处理 | 5 |
| A-09 | 已确认，`metrics: null`，默认按 year | 5 |
| A-10 | 已确认 cancelled、单任务取消及终止规则 | 3、9.1 |
| A-11 | 使用最新五字段 ResearchOverview | 6 |
| A-12 | 删除 FindingType，不设置替代枚举 | 8.3 |
| A-13 | 四种 SuggestionOperation；不含独立 addConcept/addMethod 及 update/delete | 10.1 |
| A-14 | depth默认2、范围1–5；maxNodes默认30、范围10–50 | 11 |
| A-15 | 20项裁决全部落位，见第14节 | 14 |

## 14. 原20项裁决落位清单

| 原编号 | 裁决 | v06位置 |
|---|---|---|
| 1 | camelCase | 2.1 |
| 2 | `/api/v1` | 2.1 |
| 3 | 分页从1开始，默认20，最大100 | 2.3 |
| 4 | 对外稳定字符串 ID | 2.2 |
| 5 | latestJobId、pendingSuggestionCount | 6 |
| 6 | 最新 ResearchOverview | 6 |
| 7 | 单论文单活动任务、cancelled和取消接口 | 3、9.1 |
| 8 | stage和真实0–100 progress | 9.1 |
| 9 | v0.3 Evidence 基础字段 | 8.2 |
| 10 | 暂不返回字符范围 | 8.2 |
| 11 | extractionConfidence、recommendationScore和其他confidence语义 | 2.4 |
| 12 | MethodType保留、FindingType删除 | 7.1、8.3 |
| 13 | matched ID 改为数组；审核前为空，接受后为1–3个 | 7.2、8.1、8.3 |
| 14 | 固定四种 SuggestionOperation；Concept/Method统一使用resolve | 10.1 |
| 15 | 单条建议内新节点、全部基础关系及状态更新事务原子性 | 10.3 |
| 16 | 保存原始建议、状态、reviewedAt和comment；不编辑 | 10.3 |
| 17 | 删除expectedVersion；重复审核409 | 10.3 |
| 18 | Graph节点、关系和方向 | 11 |
| 19 | depth/maxNodes规则 | 11 |
| 20 | 本地单用户，不要求reviewedBy | 1、10.3 |

## 15. v0.3 验收要求

1. A、B、C 只依据本文件开发和生成 Mock。
2. 所有 Paper、Author、Extraction、Evidence、Suggestion 和 Graph 引用必须可解析。
3. 同名作者不得仅按姓名合并；合并后的旧作者 ID 可跳转。
4. `matched / uncertain / new` 的空值和候选约束必须在 A 保存前校验。
5. `uncertain` 和 `new` 审核前不得进入正式 Graph。
6. 取消任务的迟到结果不得写入。
7. 相同 B submission 重试不得重复创建 Extraction、Evidence 或 Suggestion。
8. JCR授权确认前正式接口始终返回 `metrics: null`。
9. Graph 参数越界返回400，结果过多时按规则截断并标记。
10. Mock 必须明确标记演示数据，不能伪装未经授权的 JIF/JCR 或未验证 ORCID。
11. 单条 resolve Suggestion 必须支持选择 `1–3` 个候选，并保证全部成功或全部失败。
12. Existing/New 候选必须具有 A 生成的稳定候选 ID；默认候选和 `null` 分数规则必须一致。
13. 新 Extraction 保存后，旧 pending Suggestion 必须变为 superseded，且不能继续审核。
14. 多目标 Extraction 的关系候选只能解析明确选中的候选，不得自动生成笛卡尔积关系。
15. Suggestion 列表的论文标题池、Evidence 池和状态计数必须满足第10.4节覆盖规则。

## 16. CA-01～CA-15 最终答复

| 编号 | 最终答复 | 契约位置 |
|---|---|---|
| CA-01 | 同意；Concept 和 Method 的单条 resolve Suggestion 均可选1–3个候选 | 8.1.1、10.2 |
| CA-02 | 同意；Existing/New 统一使用 `recommendationScore`，只在同一 Suggestion 内比较 | 2.4、8.3 |
| CA-03 | 同意；保存后的候选使用 A 生成的稳定 `ResolutionCandidate.id` | 8.3、9.2 |
| CA-04 | 同意推荐方案；A 返回 `defaultCandidateId`，全部无分数时为 `null` | 10.1 |
| CA-05 | 同意；接受请求使用 `selectedTargets[]`，长度1–3 | 10.3 |
| CA-06 | 同意；仅 New 候选允许通过 `labelOverride` 修订名称，不改原始 proposedChange | 10.3 |
| CA-07 | 同意；单条 Suggestion 内多目标全部成功或全部失败 | 10.3 |
| CA-08 | 同意；resolve 的执行结果返回逐目标 `resolvedTargets[]` | 10.3 |
| CA-09 | 同意；SuggestionPage 增加 `papers` 和 `statusCounts` | 10.3、10.4 |
| CA-10 | 同意；单条详情返回 Suggestion、Evidence 和论文摘要 | 10.3 |
| CA-11 | 同意；增加 `superseded`，旧 pending 建议随新 Extraction 失效 | 3、9.2、10.4 |
| CA-12 | 同意 C 建议；拒绝原因可空，非空最长1000字符 | 10.3 |
| CA-13 | 同意；重复审核409返回当前状态与时间 | 10.3 |
| CA-14 | 采用方案A；端点解析后再生成关系建议，并使用候选级引用避免端点含糊 | 9.3 |
| CA-15 | 同意；筛选、排序、计数及当前页池范围按第10.4节固定 | 10.4 |

## 17. Zotero Collection 导入与同步

### 17.1 范围与责任

- Zotero 是原始文献库；A 通过 Pyzotero 访问本机 Zotero API，C 不直接访问 Zotero。
- C 只负责展示连接状态、文件夹树、导入预览和导入结果，并向 A 提交用户选择。
- A 负责读取 Collection、过滤文献、定位 PDF、去重、写入 SQLite 和保存同步范围。
- B 不参与 Zotero 导入；Paper 成功写入 A 后，才进入第9节的分析任务流程。
- 本版本支持选择整个文库或一个至多个 Collection；不支持逐篇选择、自动删除、后台定时同步或云端 Zotero API。

正式导入数据流固定为：

```text
用户启动 Zotero
C 查询 A 的 Zotero 连接状态和 Collection 列表
用户选择整个文库或一个至多个 Collection
C 请求 A 生成导入预览
用户确认后 C 请求 A 执行导入
A 通过 Pyzotero 读取文献并写入 SQLite
C 重新请求 GET /api/v1/papers 展示结果
```

### 17.2 类型

```ts
type ZoteroStatusResponse = {
  connected: boolean
}

type ZoteroCollectionSummary = {
  key: string
  name: string
  parentCollectionKey: string | null
  directItemCount: number
  childCollectionCount: number
}

type ZoteroImportMode = 'library' | 'collections'

type ZoteroSelection = {
  mode: ZoteroImportMode
  collectionKeys: string[]
  includeSubcollections: boolean
}

type ZoteroCollectionListResponse = {
  items: ZoteroCollectionSummary[]
  syncSelection: ZoteroSelection | null
}

type ZoteroImportPreview = {
  selection: ZoteroSelection
  foundCount: number
  importableCount: number
  createdCount: number
  updatedCount: number
  unchangedCount: number
  withPdfCount: number
  missingPdfCount: number
  skippedCount: number
}

type ZoteroImportRequest = ZoteroSelection & {
  saveAsSyncScope: boolean
}

type ZoteroImportResult = ZoteroImportPreview & {
  paperIds: string[]
  syncScopeSaved: boolean
}
```

字段含义：

- `directItemCount` 是该 Collection 直接包含的条目数量，不递归统计子 Collection。
- `childCollectionCount` 是直接子 Collection 数量。
- `foundCount` 是展开选择范围后，按 `sourceLibraryId + sourceItemKey` 去重的顶层条目总数。
- `importableCount` 是符合支持类型、具有 Zotero Item Key 且题名非空的文献数。
- `createdCount` 是数据库中尚不存在、本次将新增或已经新增的文献数。
- `updatedCount` 是数据库中已存在但 Zotero `dateModified` 已变化、本次将更新或已经更新的文献数。
- `unchangedCount` 是数据库中已存在且 Zotero `dateModified` 未变化的文献数。
- `withPdfCount` 和 `missingPdfCount` 只在 `importableCount` 内统计。
- `skippedCount = foundCount - importableCount`。
- `paperIds` 按本次实际导入文献返回 A 的稳定 Paper ID；同一文献只出现一次。

### 17.3 选择规则

- `mode='library'` 表示整个本地 Zotero 文库；此时必须使用 `collectionKeys=[]` 和 `includeSubcollections=false`。
- `mode='collections'` 表示按 Collection 导入；`collectionKeys` 必须包含 `1` 个以上不重复的有效 Collection Key。
- `includeSubcollections=true` 时，A 递归包含所有后代 Collection；为 `false` 时只读取直接选中的 Collection。
- 同一文献可能属于多个选中 Collection，A 必须按 `sourceLibraryId + sourceItemKey` 去重。
- v0.3 支持 `journalArticle | preprint | conferencePaper | book | bookSection`。
- PDF、笔记、批注等子条目不作为 Paper；PDF 作为 Paper 附件读取。
- 没有 PDF 的受支持文献仍导入元数据并计入 `missingPdfCount`，不得将其计入 `skippedCount`。

### 17.4 连接状态

```http
GET /api/v1/zotero/status
```

- 成功返回 `200 OK` 和 `ZoteroStatusResponse`。
- `connected=true` 表示 A 当前可以访问本机 Zotero API。
- `connected=false` 表示 Zotero 未启动、本地通信未开启或当前不可达。
- 该接口不写数据库。

### 17.5 Collection 列表

```http
GET /api/v1/zotero/collections
```

- 成功返回 `200 OK` 和 `ZoteroCollectionListResponse`。
- A 返回所有层级的 Collection；C 根据 `parentCollectionKey` 构建文件夹树。
- `syncSelection` 返回当前保存的同步范围；尚未保存时为 `null`。
- Zotero 不可达时返回 `503 ZOTERO_UNAVAILABLE`。

响应示例：

```json
{
  "items": [
    {
      "key": "ABC123",
      "name": "神经振荡",
      "parentCollectionKey": null,
      "directItemCount": 8,
      "childCollectionCount": 1
    },
    {
      "key": "DEF456",
      "name": "Gamma振荡",
      "parentCollectionKey": "ABC123",
      "directItemCount": 12,
      "childCollectionCount": 0
    }
  ],
  "syncSelection": null
}
```

### 17.6 导入预览

```http
POST /api/v1/zotero/import-preview
Content-Type: application/json
```

请求体使用 `ZoteroSelection`：

```json
{
  "mode": "collections",
  "collectionKeys": ["ABC123", "DEF456"],
  "includeSubcollections": true
}
```

- 成功返回 `200 OK` 和 `ZoteroImportPreview`。
- 预览读取 Zotero 并与 SQLite 比较，但不写入 Paper，也不保存同步范围。
- C 必须在用户确认前展示新增、更新、未变化、缺少 PDF 和跳过数量。
- 选择结构不合法时返回 `400 INVALID_ZOTERO_SELECTION`。
- Collection Key 不存在时返回 `404 ZOTERO_COLLECTION_NOT_FOUND`，`details.collectionKeys` 返回无效 Key。
- Zotero 不可达时返回 `503 ZOTERO_UNAVAILABLE`。

### 17.7 确认导入

```http
POST /api/v1/zotero/import
Content-Type: application/json
```

请求体使用 `ZoteroImportRequest`：

```json
{
  "mode": "collections",
  "collectionKeys": ["ABC123", "DEF456"],
  "includeSubcollections": true,
  "saveAsSyncScope": true
}
```

- 成功返回 `200 OK` 和 `ZoteroImportResult`。
- A 必须在一次数据库事务中新增或更新全部 Paper、Author、Tag 和 PDF 附件。
- 去重键固定为 `sourceType='zotero' + sourceLibraryId + sourceItemKey`；题名和 DOI 不是 Zotero 导入主键。
- 已存在文献沿用原 Paper ID；重新导入不得创建第二条 Paper。
- `saveAsSyncScope=true` 时，本次选择完整替换此前保存的同步范围；为 `false` 时不修改同步范围。
- 导入成功后 C 使用 `GET /api/v1/papers` 重新加载文献列表，不直接修改本地 Mock 数据。
- 错误码与第17.6节一致；任何读取或写库失败不得返回伪成功结果。

### 17.8 后续同步

```http
POST /api/v1/zotero/sync
```

- 请求体为空。
- A 使用最近一次成功保存的 `syncSelection` 重新读取 Zotero。
- 成功返回 `200 OK` 和 `ZoteroImportResult`；`syncScopeSaved=false`，原同步范围保持不变。
- 尚未保存同步范围时返回 `409 ZOTERO_SYNC_SCOPE_NOT_SET`。
- v0.3 只新增或更新当前范围内的文献，不自动删除数据库中的 Paper。
- 文献从 Zotero 或同步范围移出时，v0.3 保留数据库记录、Extraction、Suggestion 和正式 Graph，不自动撤销知识。
- v0.3 不提供后台定时同步；同步只由 C 的用户操作触发。

### 17.9 错误码

| HTTP | code | 含义 | retryable |
|---|---|---|---|
| 400 | `INVALID_ZOTERO_SELECTION` | mode、Collection Key 数组或子文件夹参数不合法 | false |
| 404 | `ZOTERO_COLLECTION_NOT_FOUND` | 请求的 Collection Key 当前不存在 | false |
| 409 | `ZOTERO_SYNC_SCOPE_NOT_SET` | 尚未保存可用于同步的选择范围 | false |
| 503 | `ZOTERO_UNAVAILABLE` | 本机 Zotero 未启动或本地接口不可达 | true |

错误响应统一使用第2.5节 `ApiErrorResponse`。

## 18. v06 新增验收要求

1. `GET /api/v1/zotero/status` 在 Zotero 可达和不可达时都返回可解释的连接状态。
2. Collection 列表保留父子关系，C 可以仅依靠 `parentCollectionKey` 构建文件夹树。
3. 选择父 Collection 且包含子 Collection 时，后代 Collection 必须全部进入读取范围。
4. 同一文献位于多个选中 Collection 时，预览、导入结果和数据库都只能计数一次。
5. 预览不得写入 Paper 或修改同步范围。
6. 无 PDF 文献保留元数据并计入 `missingPdfCount`。
7. 重复导入必须沿用原 Paper ID；Zotero 去重必须同时使用 Library ID 和 Item Key。
8. 保存新同步范围时必须完整替换旧范围；普通同步不得修改范围。
9. 同步不得自动删除 Paper、分析结果、审核历史或正式 Graph。
10. 导入完成后 C 必须重新调用 Paper API，不得继续展示过期 Mock 数据。
