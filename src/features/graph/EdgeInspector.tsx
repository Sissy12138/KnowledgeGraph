import { Link } from 'react-router-dom'
import type { GraphDataset, GraphPaperSummary } from './graph.types'

type EdgeInspectorProps = {
  dataset: GraphDataset
  edgeId: string
}

const EMPTY_VALUE = '暂无数据'

/** 在图谱侧栏中展示选中关系的来源、证据和关联论文。 */
export function EdgeInspector({ dataset, edgeId }: EdgeInspectorProps) {
  const edge = [...dataset.edges, ...dataset.contextOverlay.edges]
    .find((item) => item.id === edgeId)
  if (!edge) return <p>{EMPTY_VALUE}</p>

  const allNodes = [...dataset.nodes, ...dataset.contextOverlay.nodes]
  const source = allNodes.find((node) => node.id === edge.sourceId)
  const target = allNodes.find((node) => node.id === edge.targetId)
  const papers = getPapers(dataset, edge.sourcePaperIds)

  return (
    <section aria-label="关系详情">
      <h2 tabIndex={-1}>{displayValue(edge.label)}</h2>
      <p><strong>源节点：</strong>{displayValue(source?.label)}</p>
      <p><strong>目标节点：</strong>{displayValue(target?.label)}</p>
      <p><strong>方向：</strong>{edge.directed ? '有向' : '无向'}</p>
      {edge.relationType === 'coAuthor' ? (
        <>
          <p>{`共同论文：${edge.weight ?? EMPTY_VALUE} 篇`}</p>
          <PaperLinks papers={papers} />
        </>
      ) : (
        <>
          <h3>来源论文</h3>
          <PaperLinks papers={papers} />
          <h3>原文证据</h3>
          <EvidenceList dataset={dataset} evidenceIds={edge.evidenceIds} />
        </>
      )}
    </section>
  )
}

/** 解析关系所引用的论文，不将不完整数据暴露到 UI。 */
function getPapers(dataset: GraphDataset, paperIds: string[]): GraphPaperSummary[] {
  return paperIds.flatMap((paperId) => {
    const paper = dataset.papers[paperId]
    return paper ? [paper] : []
  })
}

function PaperLinks({ papers }: { papers: GraphPaperSummary[] }) {
  if (!papers.length) return <p>{EMPTY_VALUE}</p>

  return (
    <ul>
      {papers.map((paper) => (
        <li key={paper.id}>
          <Link to={`/papers/${paper.id}`}>{displayValue(paper.title)}</Link>
        </li>
      ))}
    </ul>
  )
}

/** 列出边引用的原文片段，缺失或断开的引用使用统一证据回退。 */
function EvidenceList({ dataset, evidenceIds }: { dataset: GraphDataset; evidenceIds: string[] }) {
  const evidence = evidenceIds.flatMap((id) => {
    const item = dataset.evidence.find((candidate) => candidate.id === id)
    return item ? [item] : []
  })

  if (!evidence.length) return <p>暂无原文证据</p>

  return (
    <ul>
      {evidence.map((item) => <li key={item.id}>{displayEvidence(item.text)}</li>)}
    </ul>
  )
}

/** 将普通字段缺失值统一为“暂无数据”。 */
function displayValue(value: string | null | undefined): string {
  return value?.trim() || EMPTY_VALUE
}

/** 将空白原文片段统一为证据专用回退。 */
function displayEvidence(value: string | null | undefined): string {
  return value?.trim() || '暂无原文证据'
}
