import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sortGraphPapers } from './graph-transform'
import type { GraphPaperSort } from './graph-transform'
import type {
  AuthorNodeDetail,
  ConceptNodeDetail,
  GraphDataset,
  GraphNode,
  GraphNodeDetail,
  GraphPaperSummary,
  MethodNodeDetail,
  PaperNodeDetail,
} from './graph.types'

type NodeInspectorProps = {
  dataset: GraphDataset
  nodeId: string
}

const EMPTY_VALUE = '暂无数据'

/** 在图谱侧栏中展示选中节点的只读详情。 */
export function NodeInspector({ dataset, nodeId }: NodeInspectorProps) {
  const node = [...dataset.nodes, ...dataset.contextOverlay.nodes]
    .find((item) => item.id === nodeId)
  const detail = dataset.nodeDetails[nodeId]

  if (!node || !detail) return <p>{EMPTY_VALUE}</p>

  return <NodeDetailContent dataset={dataset} node={node} detail={detail} />
}

type NodeDetailContentProps = {
  dataset: GraphDataset
  node: GraphNode
  detail: GraphNodeDetail
}

/** 依据详情联合类型渲染对应节点面板，新增节点类型时会产生编译错误。 */
function NodeDetailContent({ dataset, node, detail }: NodeDetailContentProps) {
  switch (detail.nodeType) {
    case 'concept':
      return <ConceptDetail dataset={dataset} node={node} detail={detail} />
    case 'method':
      return <MethodDetail dataset={dataset} node={node} detail={detail} />
    case 'author':
      return <AuthorDetail dataset={dataset} node={node} detail={detail} />
    case 'paper':
      return <PaperDetail dataset={dataset} node={node} detail={detail} />
    default:
      return assertNever(detail)
  }
}

/** 展示概念定义、别名、相关概念和可切换排序的关联论文。 */
function ConceptDetail({ dataset, node, detail }: { dataset: GraphDataset; node: GraphNode; detail: ConceptNodeDetail }) {
  const [sortBy, setSortBy] = useState<GraphPaperSort>('journalImpactFactor')
  const papers = sortGraphPapers(getPapers(dataset, detail.paperIds), sortBy)

  return (
    <section aria-label="概念详情">
      <h2 tabIndex={-1}>{displayValue(node.label)}</h2>
      <DetailField label="定义" value={node.description} />
      <DetailField label="别名" value={detail.aliases.join('、')} />
      <EntityList dataset={dataset} label="上位概念" ids={detail.broaderConceptIds} />
      <EntityList dataset={dataset} label="下位概念" ids={detail.narrowerConceptIds} />
      <EntityList dataset={dataset} label="相关概念" ids={detail.relatedConceptIds} />
      <label>
        关联论文排序
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as GraphPaperSort)}>
          <option value="journalImpactFactor">按 JIF</option>
          <option value="year">按年份</option>
        </select>
      </label>
      <PaperLinks papers={papers} />
    </section>
  )
}

/** 展示方法类型、节点描述及引用该方法的论文。 */
function MethodDetail({ dataset, node, detail }: { dataset: GraphDataset; node: GraphNode; detail: MethodNodeDetail }) {
  return (
    <section aria-label="方法详情">
      <h2 tabIndex={-1}>{displayValue(node.label)}</h2>
      <DetailField label="方法类型" value={detail.methodType} />
      <DetailField label="描述" value={node.description} />
      <h3>使用论文</h3>
      <PaperLinks papers={getPapers(dataset, detail.paperIds)} />
    </section>
  )
}

/** 展示作者身份信息、发表论文和由共著边派生的合作摘要。 */
function AuthorDetail({ dataset, node, detail }: { dataset: GraphDataset; node: GraphNode; detail: AuthorNodeDetail }) {
  const collaborations = dataset.edges.filter(
    (edge) => edge.relationType === 'coAuthor' && (edge.sourceId === node.id || edge.targetId === node.id),
  )

  return (
    <section aria-label="作者详情">
      <h2 tabIndex={-1}>{displayValue(node.label)}</h2>
      <DetailField label="ORCID" value={detail.orcid} />
      <DetailField label="单位" value={detail.affiliations.join('、')} />
      <h3>论文</h3>
      <PaperLinks papers={getPapers(dataset, detail.paperIds)} />
      <h3>主要合作</h3>
      {collaborations.length ? (
        <ul>
          {collaborations.map((edge) => {
            const collaboratorId = edge.sourceId === node.id ? edge.targetId : edge.sourceId
            const collaborator = dataset.nodes.find((item) => item.id === collaboratorId)
            return <li key={edge.id}>{`${displayValue(collaborator?.label)}：${edge.weight ?? EMPTY_VALUE} 篇共同论文`}</li>
          })}
        </ul>
      ) : (
        <p>{EMPTY_VALUE}</p>
      )}
    </section>
  )
}

/** 展示论文的书目信息、期刊影响因子以及图谱提取结果。 */
function PaperDetail({ dataset, node, detail }: { dataset: GraphDataset; node: GraphNode; detail: PaperNodeDetail }) {
  const paper = dataset.papers[detail.paperId]
  const journal = paper?.journal
  const citedPaperIds = dataset.edges
    .filter((edge) => edge.relationType === 'cites' && edge.sourceId === node.id)
    .map((edge) => edge.targetId)
  const citingPaperIds = dataset.edges
    .filter((edge) => edge.relationType === 'cites' && edge.targetId === node.id)
    .map((edge) => edge.sourceId)
  const jif = journal?.impactFactor == null
    ? EMPTY_VALUE
    : `JIF ${journal.impactFactor}（${journal.impactFactorYear ?? EMPTY_VALUE}）`

  return (
    <section aria-label="论文详情">
      <h2 tabIndex={-1}>{displayValue(node.label)}</h2>
      <DetailField label="作者" value={paper?.authorNames.join('、')} />
      <DetailField label="年份" value={paper?.year == null ? null : String(paper.year)} />
      <DetailField label="期刊" value={journal?.name} />
      <DetailField label="期刊影响因子" value={jif} />
      <EntityList dataset={dataset} label="概念" ids={detail.conceptIds} />
      <EntityList dataset={dataset} label="方法" ids={detail.methodIds} />
      <EntityList dataset={dataset} label="引用论文" ids={citedPaperIds} />
      <EntityList dataset={dataset} label="被引用论文" ids={citingPaperIds} />
      <DetailField label="发现摘要" value={detail.findingSummaries.join('、')} />
    </section>
  )
}

/** 将论文 ID 转为存在的论文摘要，忽略损坏的外键。 */
function getPapers(dataset: GraphDataset, paperIds: string[]): GraphPaperSummary[] {
  return paperIds.flatMap((paperId) => {
    const paper = dataset.papers[paperId]
    return paper ? [paper] : []
  })
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return <p><strong>{label}：</strong>{displayValue(value)}</p>
}

/** 将节点 ID 解析成当前数据集中的标签，并对缺失关联使用统一回退。 */
function EntityList({ dataset, label, ids }: { dataset: GraphDataset; label: string; ids: string[] }) {
  const labels = ids.map((id) => {
    const canvasLabel = dataset.nodes.find((node) => node.id === id)?.label
    return displayValue(canvasLabel || dataset.relatedNodeLabels[id])
  })
  return <DetailField label={label} value={labels.join('、')} />
}

/** 渲染统一格式的论文详情链接和年份元数据。 */
function PaperLinks({ papers }: { papers: GraphPaperSummary[] }) {
  if (!papers.length) return <p>{EMPTY_VALUE}</p>

  return (
    <ul>
      {papers.map((paper) => (
        <li key={paper.id} data-testid="related-paper">
          <Link to={`/papers/${paper.id}`}>{`查看论文：${displayValue(paper.title)}`}</Link>
          <span>
            {` · 作者：${displayValue(paper.authorNames.join('、'))}`}
            {` · 期刊：${displayValue(paper.journal?.name)}`}
            {` · 年份：${paper.year ?? EMPTY_VALUE}`}
            {` · ${formatJif(paper)}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 格式化论文的期刊影响因子及对应年度。 */
function formatJif(paper: GraphPaperSummary): string {
  const impactFactor = paper.journal?.impactFactor
  if (impactFactor == null) return `JIF ${EMPTY_VALUE}`
  return `JIF ${impactFactor}（${paper.journal?.impactFactorYear ?? EMPTY_VALUE}）`
}

/** 让新增但未渲染的详情联合类型在编译期暴露。 */
function assertNever(value: never): never {
  throw new Error(`不支持的节点详情类型：${JSON.stringify(value)}`)
}

/** 将空字符串、缺失值归一为详情面板的统一占位文本。 */
function displayValue(value: string | null | undefined): string {
  return value?.trim() || EMPTY_VALUE
}
