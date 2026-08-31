# 研知图 C–A 统一契约 v03：请 A 确认的阻塞项

日期：2026-08-30  
对接对象：A 端  
目标：一次性确认并合并作者身份、概念/方法匹配、Journal/JIF/JCR 和旧契约冲突，形成唯一有效的 C–A 契约 v03。

## 一、希望 A 本轮返回的结果

请 A 不再基于 v02 继续追加零散补丁，而是输出一份统一的 v03，并对本文每项标记：

```text
已确认 / 需要修改 / 暂不实现
```

v03 应成为 A、B、C 后续开发的唯一契约来源。已废止的字段和旧版本说明不应继续混入 v03。

## 二、P0 阻塞项：稳定 author_id 与作者身份解析

### 2.1 需要 A 确认的核心决定

请确认：

1. 研知图内部稳定 `author_id` 由 A 创建和维护。
2. A 从 DOI、Crossref、Zotero 等结构化来源获取作者信息；结构化元数据缺失时，才使用 B 从 PDF 提取的作者信息补充。
3. B 可以提取姓名、ORCID、单位等身份线索，但不负责生成最终内部 `author_id`。
4. 姓名、姓名拼音、单位或姓名哈希都不能作为作者主键。
5. 没有 ORCID 且证据不足时，宁可创建两个作者 ID，也不能仅按姓名自动合并。
6. 作者改名、单位变化或补充 ORCID 时，内部 `author_id` 保持不变。
7. 后续确认两个作者实体重复时，必须保留旧 ID 到主 ID 的合并跳转，不能直接删除旧 ID。

这里需要区分：

```text
外部身份线索：ORCID、姓名、单位、来源记录
内部稳定身份：A 分配并长期维护的 author_id
```

ORCID 是重要外部标识，但不应直接作为研知图数据库主键。直接向研究者收集 ORCID 时，应优先使用 ORCID OAuth 验证流程；从 DOI/Crossref 导入的 ORCID 应保留来源信息，不应无依据标记为已认证。

官方参考：

- ORCID authenticated iD：https://info.orcid.org/what-is-orcid/services/public-api/using-the-orcid-api-to-collect-authenticated-ids/
- Crossref contributor metadata：https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/contributors
- ROR：https://ror.org/about/

### 2.2 建议写入 v03 的数据结构

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

type PaperAuthor = {
  authorId: string
  displayName: string
  rawName: string
  authorOrder: number
}
```

`PaperSummary` 和 `PaperDetail` 均应返回：

```ts
authors: PaperAuthor[]
```

不建议只返回 `authorNames: string[]`；也不建议使用容易发生顺序错位的 `authorIds[]` 与 `authorNames[]` 平行数组。

必须满足同一性约束：

```text
Paper.authors[].authorId
  = AuthorSummary.id / AuthorDetail.id
  = Graph author node.id
  = authored edge.sourceId
  = coAuthor edge.sourceId / targetId
```

### 2.3 建议的作者解析流程

```text
获取论文结构化元数据
  ↓
保存原始姓名、ORCID、单位、作者顺序和来源
  ↓
查找已有作者实体
  ├─ 已确认的相同 ORCID 或人工映射：关联已有 author_id
  ├─ 多项证据一致但仍有不确定性：生成合并候选，等待审核
  ├─ 证据冲突：创建新的 provisional author_id
  └─ 无足够证据：创建新的 provisional author_id
```

可用于候选排序的辅助证据包括：

- 规范化姓名及姓名变体；
- 单位原文和 ROR ID；
- 共同作者集合；
- 既有论文、主题和方法的连续性；
- 元数据来源和人工确认记录。

这些证据只能支持候选排序。除已确认的强标识外，本阶段不制定固定自动合并阈值。

### 2.4 authored 与 coAuthor 规则

- `author → paper: authored` 是正式保存的关系。
- `author ↔ author: coAuthor` 是查询时根据已审核论文临时派生的无向边，不单独保存。
- 一篇论文的 `authors[].authorId` 先去重，再两两组成无序作者对。
- 边端点必须按稳定作者 ID 的确定性顺序排列，避免返回两条反向重复边。
- `sourcePaperIds` 是当前研知图数据库中两位作者的共同论文 ID 集合。
- `weight = 去重后的 sourcePaperIds.length`。
- `sharedPaperCount` 不能解释为两位作者现实中的全部合作论文数量。

对于一篇包含 `n` 位不同作者的论文，派生作者对数量为：

```text
n(n - 1) / 2
```

### 2.5 作者相关接口

请将此前反馈中的接口合并进 v03：

```http
GET /api/v1/authors/{authorId}
GET /api/v1/authors/{authorId}/papers
GET /api/v1/authors/{authorId}/collaborators
```

Graph 查询必须支持以 Author 为中心；`GraphNodeType` 增加 `author`，`RelationType` 增加 `authored` 和 `coAuthor`。`GraphEdge` 应支持 `weight` 与 `sourcePaperIds`。

### 2.6 作者身份验收场景

v03 对应实现至少覆盖：

1. 两位同名、单位不同作者得到不同 `author_id`。
2. 两位同名、单位相同但 ORCID 不同作者得到不同 `author_id`。
3. 同一作者使用中英文姓名且身份已确认时，共用同一 `author_id`。
4. 缺失 ORCID且证据不足时创建新的 provisional ID，不自动并入同名作者。
5. 作者更换单位后 `author_id` 不变。
6. 作者实体合并后，旧 ID 可解析到主 ID。
7. 共著边的每篇 `sourcePaperId` 必须同时包含边两端的作者 ID。
8. `weight` 等于去重后的共同论文数。
9. 独立作者允许没有 `coAuthor` 边。
10. 姓名修改不得改变论文—作者关系的身份端点。

## 三、P0 阻塞项：概念和方法匹配状态

### 3.1 已确认方向

Concept 和 Method 保持两种不同节点：

```text
paper | author | concept | method | finding
```

新提取内容必须优先匹配已有节点；只有确认无法匹配时，才建议新增节点。不能只根据名称相似度自动合并，还要考虑定义、研究语境及上位/下位关系。

### 3.2 建议写入 v03 的状态

```ts
type MatchStatus =
  | 'matched'
  | 'uncertain'
  | 'new'
```

概念和方法提取结果均应包含：

```ts
type NodeMatchCandidate = {
  nodeId: string
  label: string
  confidence: number | null
  evidence: string[]
}

type ExtractedConcept = {
  rawText: string
  normalizedLabel: string
  matchStatus: MatchStatus
  matchedConceptId: string | null
  candidates: NodeMatchCandidate[]
}

type ExtractedMethod = {
  rawText: string
  normalizedLabel: string
  matchStatus: MatchStatus
  matchedMethodId: string | null
  candidates: NodeMatchCandidate[]
}
```

状态约束：

- `matched`：对应的 matched ID 必填；只生成论文与已有节点的关系建议。
- `uncertain`：matched ID 为空；候选交给人工判断，不自动新增。
- `new`：matched ID 为空；确认没有适合旧节点后，才生成 `addConcept` 或 `addMethod`。
- 本阶段不制定固定相似度阈值；`confidence` 只用于候选排序，不直接触发自动合并。

### 3.3 需要 A 确认

1. 匹配已有节点的执行方和数据来源。
2. `candidates` 是否由 A 查询现有图谱后返回。
3. 人工确认后，最终 matched ID 如何写回分析结果和审核响应。
4. `uncertain` 是否始终进入建议审核队列。
5. `new` 在审核前是否只保存为建议，不进入正式图谱。

## 四、P0 决策项：Journal、JIF 与 JCR 授权

### 4.1 已确认方向

- Journal 暂不作为图谱节点，只作为论文属性。
- JIF/JCR 只有在 A 拥有合法、稳定的数据来源和授权时才启用。
- 没有授权时必须返回 `null`，不能从不明网站抓取后声称数据来自 JCR。
- 数据来源未确认时，前端默认按 `year` 排序，而不是按 JIF。
- 界面只能称“按期刊影响因子排序”，不能解释为论文质量排序。

### 4.2 建议写入 v03 的结构

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

JCR 学科可能不止一个，不应只保留一个“主要类别”。

### 4.3 请 A 明确答复

1. 当前是否拥有合法的 JCR/API 授权与 API Key。
2. 若有授权：数据来源、更新周期、缓存方式和许可允许的展示范围。
3. 若没有授权：确认正式接口统一返回 `metrics: null`。
4. 比赛和开发 Mock 是否明确标记为演示数据。
5. A 是否同意数据源未确认期间默认排序为 `year`。

已经废止的引用量请求不得重新加入：

```text
citationCount
citationSource
citationUpdatedAt
```

论文之间的 `paper → paper: cites` 图谱关系可以保留。

## 五、必须合并进统一 v03 的旧契约冲突

以下项目来自此前反馈，不能继续保留 v02 的旧定义：

### 5.1 AnalysisJobStatus 和取消接口

- `AnalysisJobStatus` 必须加入 `cancelled`。
- 必须合并已确认的单任务取消接口。
- 已取消任务的最终响应、错误字段和可否重试需要在 v03 中明确定义。

具体取消接口路径若已在此前 20 项裁决中确认，应原样合并；当前项目资料中没有其最终路径，不应重新猜测。

### 5.2 ResearchOverview

v02 仍使用旧五字段，必须替换为此前已经确认的最新结构。

当前项目资料没有保存最新 `ResearchOverview` 的精确定义，请 A 从已确认的 20 项裁决中原样合并，不能继续沿用旧五字段，也不应由 C 重新猜测字段。

### 5.3 FindingType

v02 中仍存在已经决定移除或替换的 `FindingType`。请 A 按此前确认裁决更新 v03，并明确迁移后的字段或结构。

当前资料缺少替代结构的权威定义，请以已确认的 20 项裁决为准。

### 5.4 SuggestionOperation

第一版不实现：

```text
updateNode
deleteRelation
```

请从 v03 的第一版 `SuggestionOperation` 中删除，并合并完整的 Suggestion 审核响应结构。

### 5.5 Graph 查询参数

v02 仍写着 Graph 查询不支持：

```text
depth
maxNodes
```

请按此前确认决定修正 v03，明确：

- 是否支持；
- 默认值；
- 上限；
- 超出上限时的响应；
- 不同中心节点类型是否采用相同规则。

### 5.6 已确认的 20 项裁决

统一 v03 必须以此前已经确认的 20 项裁决为基础，并合并本文件新增确认项。

当前 C 项目目录没有这 20 项裁决的完整原文，因此本文不重复推断。请 A 在返回 v03 时附一份对应清单，注明每项裁决落在 v03 的章节或类型位置，避免遗漏。

## 六、v03 的一致性约束

### 6.1 正式图谱范围

- 只返回已经审核通过的正式节点和关系。
- 待审核建议不得混入正式 Graph 查询。
- Author 是正式节点。
- Journal 仅是论文属性。
- `coAuthor` 是派生关系，不单独保存。

### 6.2 ID 一致性

- Paper、Author、Concept、Method 和 Finding 均使用各自稳定 ID。
- 同一实体在列表、详情、Graph 节点、Graph 边和审核响应中必须使用相同 ID。
- 任何关系端点和外键都必须能解析到有效实体。
- 合并后的旧实体 ID 必须有明确的解析或跳转策略。

### 6.3 Mock 与正式数据

- Mock 数据必须明确标注为演示数据。
- JIF、JCR、ORCID 等未经确认的数据不能伪装成正式数据。
- 正式接口缺失字段统一返回契约定义的 `null` 或空集合，不返回含义不明的占位字符串。

## 七、请 A 按此表回复

| 编号 | 需要 A 确认 | 建议答复格式 |
|---|---|---|
| A-01 | 内部 `author_id` 是否由 A 创建和维护 | 已确认 / 修改说明 |
| A-02 | Paper 是否返回包含稳定 ID 的 `authors: PaperAuthor[]` | 已确认 / 修改后的结构 |
| A-03 | 无 ORCID、同名作者和证据不足时的处理 | 已确认 / 规则修改 |
| A-04 | 作者合并后的旧 ID 兼容方式 | 跳转 / 别名 / 其他 |
| A-05 | authored 保存、coAuthor 查询时派生 | 已确认 / 修改说明 |
| A-06 | 概念/方法 `matched / uncertain / new` | 已确认 / 修改后的状态 |
| A-07 | uncertain 和 new 的审核流 | 接口与状态说明 |
| A-08 | 当前是否具有合法 JCR/API 授权 | 有 / 无 / 待确认 |
| A-09 | 无授权时 `metrics: null`、默认按 year | 已确认 / 修改说明 |
| A-10 | cancelled、取消接口和最终状态 | v03 章节或接口位置 |
| A-11 | 最新 ResearchOverview | 完整类型定义 |
| A-12 | FindingType 的最终处理 | 删除 / 替代结构 |
| A-13 | SuggestionOperation 第一版范围 | 完整联合类型 |
| A-14 | Graph depth/maxNodes | 默认值、上限、错误规则 |
| A-15 | 已确认 20 项裁决是否全部进入 v03 | 对应清单 |

## 八、A 返回 v03 后的完成标准

本轮对接完成需同时满足：

1. A 返回一份统一 v03，而不是新的增补文档。
2. 本文 A-01～A-15 均有明确答复。
3. v03 中不再出现已废止字段和 v02 旧冲突。
4. Paper、Author 和 Graph 使用同一套稳定作者 ID。
5. 概念/方法匹配状态、人工审核和新增节点条件可由类型约束验证。
6. JIF/JCR 授权状态及无授权时的返回规则明确。
7. 已确认的 20 项裁决有逐项落位清单。
8. A、B、C 共同确认以该 v03 作为唯一开发基线。

