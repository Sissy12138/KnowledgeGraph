# 研知图 v05 数据契约迁移设计 v01

日期：2026-08-31

状态：待用户确认

适用仓库：`D:\Codex\20260831_yanzhitu_frontend_backend_handoff_v01`

契约基线：`20260831_yanzhitu_ca_contract_v05.md`

## 1. 目标

把当前前端的数据边界迁移到 A–B–C 统一数据与 API 契约 v0.3（v05），同时保持现有文献、建议审核和四类知识图谱页面的交互效果，以及可双击打开的 Mock HTML 预览。

迁移完成后：

- A 返回的 v05 JSON 不直接进入 React 组件，而是先经过契约 DTO 校验和特性适配。
- Mock 与正式 API 使用相同的 v05 DTO，避免“Mock 能运行、联调即失效”。
- 页面专用字段和派生关系保留在 ViewModel，不要求 A 修改正式 Graph 类型。
- v05 成为仓库唯一开发基线，旧 v03/v04 文档只标记为历史来源。

## 2. 范围与非目标

### 2.1 本次范围

- Paper、Author、Journal 与分页 DTO。
- AnalysisJob 和通用错误响应。
- Suggestion、候选、多选审核、Evidence 池、论文池和状态计数。
- GraphResponse 到现有 GraphDataset 的适配。
- JIF/JCR 未授权时的排序、节点大小和界面提示。
- v05 契约 Mock、契约测试、后端交付文档和离线 HTML。

### 2.2 非目标

- 不实现 A 后端、B 分析模块或 `/api/v1/internal/*`。
- 不新增登录、权限或多人协作系统。
- 不获取、推断或伪造真实 JIF/JCR 数据。
- 不重新讨论 `authorId`；稳定作者 ID 已由 v05 最终裁决。
- 不要求 A 返回 `conceptAuthor`、`authorMethod`、`paperConcept` 等前端展示关系。
- 不在本次改造中增加 v05 之外的批量审核 API。

## 3. 总体架构

采用“契约 DTO → 特性适配器 → 页面 ViewModel”三层结构：

```text
A API 或 v05 Mock
        │
        ▼
v05 Contract DTO
        │  校验字段、错误、分页和可空值
        ▼
Feature Adapter / Service
        │  加入页面需要的派生字段、池连接和缓存
        ▼
现有 React 页面与图谱 ViewModel
```

不让 React 页面直接依赖后端 DTO，原因是 Graph 页面需要 `contextOverlay`、详情缓存和展示指标，而这些不是正式 Graph 的一部分。反过来，UI 派生字段也不得写入或伪装成 A 的正式响应。

## 4. 契约 DTO 与错误边界

新建集中式 v05 类型模块，完整定义 C 会使用的公开 DTO：

- `PageResult<T>` 不包含 `totalPages`；页面需要时使用 `Math.ceil(total / pageSize)`。
- 所有对外 ID 为不可空 `string`。
- 单值缺失为 `null`，集合缺失为 `[]`。
- `ApiErrorDetail` 保留 `code/message/retryable/details/requestId`。
- HTTP 客户端把非 2xx 响应转换为包含状态码和完整 `ApiErrorDetail` 的前端错误对象。

Mock 服务也必须返回同一 DTO，不维护一套平行的旧字段名称。

## 5. Paper、Author 与 Journal

### 5.1 作者

Paper 列表和详情统一消费：

```ts
type PaperAuthor = {
  authorId: string
  displayName: string
  rawName: string
  authorOrder: number
}
```

页面显示 `displayName`，排序和第一作者引用使用 `authorOrder`，链接使用 `authorId`。作者详情通过 `AuthorSummary/AuthorDetail` 单独加载；ORCID 必须同时展示来源和是否 OAuth 认证，不能只展示裸 ORCID 并暗示已验证。

### 5.2 Journal

Paper DTO 使用 v05 的 `JournalInfo.metrics` 嵌套结构。正式 API 中 `metrics=null` 时，页面不显示 JIF/JCR，也不保留不可用的排序入口。

Mock 可以包含演示 JIF/JCR，但必须满足：

- 页面显著显示“JIF/JCR 演示数据”。
- ViewModel 标记数据来源为 `mock`，该标记不是后端 DTO 字段。
- 不把演示 ORCID 标记为 OAuth 已认证。

## 6. Suggestion 审核迁移

Suggestion 页面改为完全依照 v05：

- 字段使用 `operation`，不再使用 `action`。
- Concept/Method 使用 `resolveConceptMatch/resolveMethodMatch`。
- 候选使用 `nodeId/label/recommendationScore`。
- Evidence 通过 `evidenceIds` 与当前页 `evidence` 池连接。
- 论文标题通过当前页 `papers` 池连接。
- 标签计数直接使用 `statusCounts`，不再为计数加载全部建议。
- 类型支持 `superseded`，但第一版仍只显示 pending、accepted、rejected 三个页签。

### 6.1 默认候选

前端只使用 `proposedChange.defaultCandidateId`：

- 非空时只预选该候选。
- 为 `null` 时不预选，批量采纳跳过并提示人工选择。
- 删除前端 70% 阈值及基于 `recommendationScore` 的第二套默认算法。
- 候选分数显示为“推荐分数”，`null` 显示“未提供”，不得称为正确率或普通置信度。

### 6.2 接受与拒绝

resolve 接受请求固定转换为：

```ts
{
  comment: string | null
  resolution: {
    selectedTargets: Array<{
      candidateId: string
      labelOverride: string | null
    }>
  }
}
```

非 resolve 操作必须提交 `resolution:null`。拒绝请求使用 `{reason:string|null}`，界面不强制填写拒绝原因，但保留最大 1000 字提示和前端校验。

New 候选改名只生成 `labelOverride`，不得因为名称与 Existing 相同而在前端静默改选。遇到 `409 RESOLUTION_CANDIDATE_STALE` 时，保留用户选择并提示刷新候选。

### 6.3 批量审核

继续使用逐条 accept/reject 请求和 `Promise.allSettled`，允许部分成功。批量采纳的每条 resolve Suggestion 只提交自己的 `defaultCandidateId`；无默认项的条目跳过并计入提示。

## 7. Graph 适配

后端 DTO 严格保留 v05 的 `GraphNode/GraphEdge/GraphMeta/GraphResponse`。现有 `GraphDataset` 改名或明确标记为页面 ViewModel，并由适配器生成。

### 7.1 正式关系与展示关系

适配器只把 v05 关系当作正式事实：

- `authored`
- `coAuthor`
- `studies`
- `uses`
- `reports`
- `supports`
- `contradicts`
- `relatedTo`
- `broaderThan`
- `cites`

`conceptAuthor`、`conceptMethod`、`authorConcept`、`authorMethod`、`paperConcept` 继续作为前端展示层派生边，放入 `contextOverlay`，不得出现在 API DTO 或回传 A。

### 7.2 四类视图

每个页面视图都基于一个稳定中心节点调用：

```text
GET /api/v1/graph?focusNodeId=...&depth=2&maxNodes=30
```

Mock 为 concept、method、author、paper 各提供确定的初始中心节点。正式 API 模式按以下顺序取得初始中心：

- concept：概念列表第一页的首项。
- method：方法列表第一页的首项。
- paper：论文列表按 year desc 的首项。
- author：论文列表首篇中 `authorOrder=1` 的作者。

如果对应列表为空，页面显示现有空态，不猜测 ID。

### 7.3 相关节点开关

- Concept 焦点：根据 `studies` 找 Paper，再根据 `authored/uses` 派生相关 Author/Method。
- Author 焦点：根据 `authored` 找 Paper，再根据 `studies/uses` 派生相关 Concept/Method。
- Paper 多选：对新增选中的 Paper 按 ID 加载 GraphResponse，缓存后合并 Concept 与展示边；再次点击只移除当前选择，不清空其他选择。
- Method 视图保持现有展示，不增加新的相关节点开关。

### 7.4 详情与论文信息

GraphResponse 不携带完整 Paper/Author/Concept/Method 详情。适配器采用按需加载和 ID 缓存：

- Paper 悬停或检查器需要完整信息时调用 `/papers/{paperId}`。
- Author、Concept、Method 检查器调用各自详情接口。
- 同一 ID 在一次页面会话中只请求一次。
- Finding 在 v05 没有独立详情接口，只展示 GraphNode 描述、边和 Evidence。

Mock 模式使用等价的本地详情池，不改变离线体验。

## 8. JIF/JCR 降级与节点大小

正式 API 未授权状态固定执行：

- Paper 默认按 `year` 排序。
- Paper 节点无 JIF 时使用最小尺寸或引用连接数的平方根缩放。
- Author 节点无总 JIF 时使用去重 `sourcePaperIds.length` 的平方根缩放。
- Concept 主节点继续按去重关联论文数缩放。
- Method 视图和各类不要求调整的附加节点保持既有规则。

Mock 模式可以继续演示 JIF 缩放，但必须显示“演示数据”标识。任何缺失、负值或非有限数都按 0 处理，禁止生成 `NaN` 节点尺寸。

## 9. AnalysisJob

保留现有状态和进度组件，补齐服务边界：

- 创建任务：`POST /papers/{paperId}/analysis-jobs`。
- 查询任务：`GET /analysis-jobs/{jobId}`。
- 取消任务：`POST /analysis-jobs/{jobId}/cancel`。
- 错误显示使用 `retryable` 决定是否提供重试提示，并显示或记录 `requestId` 以便排查。

Mock 时间线继续用于离线预览，但每个快照必须符合 v05 `AnalysisJob`。

## 10. 文档与数据基线

- 把 v05 原文复制到仓库 `docs/backend/`，文件名保持不变。
- `BACKEND_HANDOFF.md` 首先指向 v05，并明确旧 blockers 仅为历史资料。
- README 说明 Mock 和 API 两种数据模式，以及 JIF/JCR 演示标识。
- 不提交 `.env`、凭据、真实 PDF、真实个人身份信息或未授权计量数据。

## 11. 测试策略

每个迁移任务遵循 RED–GREEN：

1. 契约类型与固定 v05 fixture 的编译/结构测试。
2. Paper 作者、Journal 和分页映射测试。
3. SuggestionPage 池连接、默认候选、请求体和 409 错误测试。
4. GraphResponse 正式边到四类 ViewModel/overlay 的映射测试。
5. 无 JIF、Mock JIF、负值和缺失值的节点大小测试。
6. AnalysisJob 创建、查询、取消和错误转换测试。
7. 保留现有组件行为测试，确保页面设计没有回退。
8. 全量 `npm test`、`npm run lint`、`npm run build`、`npm run test:preview`。
9. 重新生成离线 HTML，检查不存在外部 CSS、JavaScript 或 assets 依赖。

## 12. 验收标准

- v05 是仓库唯一有效契约入口。
- 所有公开 API DTO 与 v05 字段、枚举、可空性和分页一致。
- 现有 Mock 页面和离线 HTML 保持可用。
- Suggestion 支持 1–3 个目标、New 名称修订、superseded 和部分成功批量审核。
- 正式 API 模式不显示或依赖真实 JIF/JCR。
- 前端展示关系不污染正式 Graph DTO。
- `authorId` 在 Paper、Author 和 Graph 中保持同一稳定字符串。
- 所有新增契约测试及原有测试通过，lint 和生产构建通过。
