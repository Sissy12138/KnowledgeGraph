import { graphMocks } from './graph.mock'
import { requestJson } from '../../contracts/api-client'
import { getDataMode } from '../../contracts/data-mode'
import type { GraphResponse as GraphResponseDto } from '../../contracts/v05.types'
import type { PageResult, PaperSummary } from '../../contracts/v05.types'
import type {
  AuthorNetworkMode,
  GraphDataset,
  GraphNodeDetail,
  GraphScenario,
  GraphView,
} from './graph.types'

export type GraphProjectionOptions = {
  authorMode?: AuthorNetworkMode
  expandedAuthorId?: string | null
  collectionKey?: string | null
}

/** 将全量图谱限定到一个 Zotero 文件夹，并同步裁剪论文证据和详情。 */
export function filterDatasetByCollection(
  dataset: GraphDataset,
  collectionKey: string | null | undefined,
): GraphDataset {
  if (!collectionKey) return dataset
  const allowedPaperIds = new Set(Object.values(dataset.papers)
    .filter((paper) => paper.zoteroCollections?.some((collection) => collection.key === collectionKey))
    .map((paper) => paper.id))
  const trimPaperIds = (paperIds: string[]) => paperIds.filter((paperId) => allowedPaperIds.has(paperId))
  const nodes = dataset.nodes
    .map((node) => ({ ...node, sourcePaperIds: trimPaperIds(node.sourcePaperIds) }))
    .filter((node) => node.nodeType === 'paper'
      ? allowedPaperIds.has(node.id)
      : node.sourcePaperIds.length > 0)
    .map((node) => ({
      ...node,
      metrics: { ...node.metrics, paperCount: node.sourcePaperIds.length },
    }))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = dataset.edges
    .map((edge) => ({ ...edge, sourcePaperIds: trimPaperIds(edge.sourcePaperIds) }))
    .filter((edge) => edge.sourcePaperIds.length > 0
      && nodeIds.has(edge.sourceId)
      && nodeIds.has(edge.targetId))
  const retainedEvidenceIds = new Set(edges.flatMap((edge) => edge.evidenceIds))
  const nodeDetails = Object.fromEntries(nodes.map((node) => {
    const detail = dataset.nodeDetails[node.id]
    if (!detail) return [node.id, detail]
    if (detail.nodeType === 'paper') return [node.id, detail]
    return [node.id, { ...detail, paperIds: trimPaperIds(detail.paperIds) }]
  }))

  return {
    ...dataset,
    nodes,
    edges,
    contextOverlay: { nodes: [], edges: [] },
    evidence: dataset.evidence.filter((item) =>
      allowedPaperIds.has(item.paperId) && retainedEvidenceIds.has(item.id)),
    papers: Object.fromEntries(Object.entries(dataset.papers)
      .filter(([paperId]) => allowedPaperIds.has(paperId))),
    nodeDetails,
    relatedNodeLabels: Object.fromEntries(nodes.map((node) => [node.id, node.label])),
  }
}

/** 将全量实体投影为单一语义网络，避免不同关系图混入无关节点类型。 */
function projectDatasetForView(
  dataset: GraphDataset,
  view: GraphView,
  options: GraphProjectionOptions = {},
): GraphDataset {
  const nodeType = view === 'concept'
    ? 'concept'
    : view === 'method'
      ? 'method'
      : view === 'author'
        ? 'author'
        : 'paper'
  let nodes = dataset.nodes.filter((node) => node.nodeType === nodeType)
  let edges: GraphDataset['edges']
  if (view === 'author') {
    const authorProjection = buildAuthorNetwork(
      nodes,
      dataset.edges,
      dataset.papers,
      options.authorMode ?? 'coreBridge',
      options.expandedAuthorId ?? null,
    )
    nodes = authorProjection.nodes
    edges = authorProjection.edges
  } else {
    const nodeIds = new Set(nodes.map((node) => node.id))
    const directEdges = dataset.edges.filter((edge) =>
      nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
    )
    edges = view === 'concept'
      ? buildConceptRelations(nodes, directEdges)
      : view === 'method'
        ? buildMethodRelations(nodes, directEdges)
        : directEdges.filter((edge) => edge.relationType === 'cites')
  }
  const edgeIds = new Set(edges.flatMap((edge) => edge.evidenceIds))
  const projectedNodes = nodes.map((node) => ({
    ...node,
    metrics: {
      ...node.metrics,
      connectionCount: edges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id).length,
    },
  }))
  const contextOverlay = buildContextOverlay(
    [...dataset.nodes, ...dataset.contextOverlay.nodes],
    projectedNodes,
    view,
  )
  const detailNodes = [...projectedNodes, ...contextOverlay.nodes]

  const nodeDetails = Object.fromEntries(detailNodes.map((node) => {
    const detail = dataset.nodeDetails[node.id]
    if (view === 'paper' && detail?.nodeType === 'paper') {
      return [node.id, {
        ...detail,
        conceptIds: contextOverlay.edges
          .filter((edge) => edge.sourceId === node.id && edge.relationType === 'paperConcept')
          .map((edge) => edge.targetId),
        methodIds: contextOverlay.edges
          .filter((edge) => edge.sourceId === node.id && edge.relationType === 'paperMethod')
          .map((edge) => edge.targetId),
      }]
    }
    if (view !== 'concept' || detail?.nodeType !== 'concept') return [node.id, detail]
    const broaderConceptIds: string[] = []
    const narrowerConceptIds: string[] = []
    const relatedConceptIds: string[] = []
    const coOccurringConceptIds: string[] = []
    for (const edge of edges) {
      if (edge.sourceId !== node.id && edge.targetId !== node.id) continue
      const otherId = edge.sourceId === node.id ? edge.targetId : edge.sourceId
      if (edge.relationType === 'broaderThan') {
        if (edge.sourceId === node.id) narrowerConceptIds.push(otherId)
        else broaderConceptIds.push(otherId)
      } else if (edge.relationType === 'relatedTo') {
        relatedConceptIds.push(otherId)
      } else if (edge.relationType === 'coOccurs') {
        coOccurringConceptIds.push(otherId)
      }
    }
    return [node.id, {
      ...detail,
      broaderConceptIds: [...new Set(broaderConceptIds)],
      narrowerConceptIds: [...new Set(narrowerConceptIds)],
      relatedConceptIds: [...new Set(relatedConceptIds)],
      coOccurringConceptIds: [...new Set(coOccurringConceptIds)],
    }]
  }))

  return {
    ...dataset,
    view,
    nodes: projectedNodes,
    edges,
    contextOverlay,
    evidence: dataset.evidence.filter((item) => edgeIds.has(item.id)),
    nodeDetails,
    relatedNodeLabels: Object.fromEntries(detailNodes.map((node) => [node.id, node.label])),
  }
}

/**
 * 以去重论文外键的交集构建只读上下文叠加层。
 * 这些边只表示“共同涉及论文”，不写回正式语义图谱。
 */
function buildContextOverlay(
  allNodes: GraphDataset['nodes'],
  primaryNodes: GraphDataset['nodes'],
  view: GraphView,
): GraphDataset['contextOverlay'] {
  const targets = view === 'concept'
    ? allNodes.filter((node) => node.nodeType === 'author' || node.nodeType === 'method')
    : view === 'author'
      ? allNodes.filter((node) => node.nodeType === 'concept' || node.nodeType === 'method')
      : view === 'method'
        ? allNodes.filter((node) => node.nodeType === 'concept')
      : view === 'paper'
        ? allNodes.filter((node) => node.nodeType === 'concept' || node.nodeType === 'method')
        : []
  if (!targets.length) return { nodes: [], edges: [] }

  const edges: GraphDataset['edges'] = []
  const includedTargetIds = new Set<string>()
  for (const source of primaryNodes) {
    const sourcePaperIds = new Set(source.sourcePaperIds)
    for (const target of targets) {
      const sharedPaperIds = target.sourcePaperIds.filter((paperId) => sourcePaperIds.has(paperId))
      if (!sharedPaperIds.length) continue
      const relationType = contextRelationType(view, target.nodeType)
      if (!relationType) continue
      includedTargetIds.add(target.id)
      edges.push({
        id: `context:${relationType}:${source.id}:${target.id}`,
        sourceId: source.id,
        targetId: target.id,
        relationType,
        label: contextRelationLabel(relationType),
        directed: false,
        weight: sharedPaperIds.length,
        evidenceIds: [],
        sourcePaperIds: sharedPaperIds,
      })
    }
  }
  return {
    nodes: targets.filter((node) => includedTargetIds.has(node.id)),
    edges,
  }
}

function contextRelationType(
  view: GraphView,
  targetType: GraphDataset['nodes'][number]['nodeType'],
): GraphDataset['edges'][number]['relationType'] | null {
  if (view === 'concept' && targetType === 'author') return 'conceptAuthor'
  if (view === 'concept' && targetType === 'method') return 'conceptMethod'
  if (view === 'author' && targetType === 'concept') return 'authorConcept'
  if (view === 'author' && targetType === 'method') return 'authorMethod'
  if (view === 'method' && targetType === 'concept') return 'methodConcept'
  if (view === 'paper' && targetType === 'concept') return 'paperConcept'
  if (view === 'paper' && targetType === 'method') return 'paperMethod'
  return null
}

function contextRelationLabel(relationType: GraphDataset['edges'][number]['relationType']): string {
  if (relationType === 'conceptAuthor') return '相关作者'
  if (
    relationType === 'conceptMethod'
    || relationType === 'authorMethod'
    || relationType === 'paperMethod'
  ) return '相关方法'
  return '相关概念'
}

/**
 * 同篇出现只作为关系召回信号，以虚线显示；已审核的语义关系优先并覆盖同一节点对。
 */
function buildConceptRelations(
  nodes: GraphDataset['nodes'],
  directEdges: GraphDataset['edges'],
): GraphDataset['edges'] {
  const reviewedEdges = directEdges.filter((edge) =>
    edge.relationType === 'broaderThan' || edge.relationType === 'relatedTo',
  )
  const relationByPair = new Map(reviewedEdges.map((edge) => [
    [edge.sourceId, edge.targetId].sort().join('|'), edge,
  ]))

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex]
      const right = nodes[rightIndex]
      const sharedPaperIds = left.sourcePaperIds.filter((paperId) => right.sourcePaperIds.includes(paperId))
      if (sharedPaperIds.length === 0) continue
      const key = [left.id, right.id].sort().join('|')
      if (relationByPair.has(key)) continue
      relationByPair.set(key, {
        id: `conceptCoOccurs:${key}`,
        sourceId: left.id,
        targetId: right.id,
        relationType: 'coOccurs',
        label: '同篇共现（待语义判断）',
        directed: false,
        weight: sharedPaperIds.length,
        evidenceIds: [],
        sourcePaperIds: sharedPaperIds,
      })
    }
  }
  return [...relationByPair.values()]
}

const MAX_DEFAULT_AUTHOR_NODES = 40
const MAX_CONTEXT_AUTHORS_PER_CORE = 3

function normalizedAuthorName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * 从全量共著图中保留核心作者，再补入少量结构性桥接作者。
 * 展开某作者时额外加入其所有一跳合作者，但不伪造间接合作边。
 */
function buildAuthorNetwork(
  authors: GraphDataset['nodes'],
  allEdges: GraphDataset['edges'],
  papers: GraphDataset['papers'],
  mode: AuthorNetworkMode,
  expandedAuthorId: string | null,
): { nodes: GraphDataset['nodes']; edges: GraphDataset['edges'] } {
  const explicitlyIncludedAuthorIds = new Set<string>()
  const explicitlyIncludedAuthorNames = new Set<string>()
  const authorById = new Map(authors.map((author) => [author.id, author]))
  const authorsByName = new Map<string, string[]>()
  for (const author of authors) {
    const key = normalizedAuthorName(author.label)
    authorsByName.set(key, [...(authorsByName.get(key) ?? []), author.id])
  }
  for (const paper of Object.values(papers)) {
    if (paper.authors?.length) {
      for (const author of paper.authors) {
        const roles = new Set(author.contributionRoles)
        if (
          author.order === 1
          || roles.has('firstAuthor')
          || roles.has('coFirstAuthor')
          || roles.has('correspondingAuthor')
        ) {
          explicitlyIncludedAuthorIds.add(author.id)
          explicitlyIncludedAuthorNames.add(normalizedAuthorName(author.name))
        }
      }
    } else if (paper.authorNames[0]) {
      // 兼容没有贡献角色字段的历史数据。
      explicitlyIncludedAuthorNames.add(normalizedAuthorName(paper.authorNames[0]))
    }
  }
  const coreIds = new Set(authors.filter((author) =>
    explicitlyIncludedAuthorIds.has(author.id)
    || explicitlyIncludedAuthorNames.has(normalizedAuthorName(author.label)),
  ).map((author) => author.id))
  // 后端可能已把同名作者合并到一个规范 ID；通过名称补齐论文 API 里的旧 ID。
  for (const name of explicitlyIncludedAuthorNames) {
    for (const id of authorsByName.get(name) ?? []) coreIds.add(id)
  }

  const coauthorEdges = allEdges.filter((edge) => edge.relationType === 'coAuthor')
  const adjacency = new Map<string, Array<{ authorId: string; weight: number }>>()
  for (const edge of coauthorEdges) {
    const weight = edge.weight ?? edge.sourcePaperIds.length
    adjacency.set(edge.sourceId, [
      ...(adjacency.get(edge.sourceId) ?? []),
      { authorId: edge.targetId, weight },
    ])
    adjacency.set(edge.targetId, [
      ...(adjacency.get(edge.targetId) ?? []),
      { authorId: edge.sourceId, weight },
    ])
  }

  const includedIds = new Set(mode === 'all' ? authors.map((author) => author.id) : coreIds)
  const bridgeIds = new Set<string>()
  if (mode === 'coreBridge') {
    const candidates = authors
      .filter((author) => !coreIds.has(author.id))
      .map((author) => {
        const coreLinks = (adjacency.get(author.id) ?? []).filter((link) => coreIds.has(link.authorId))
        return {
          author,
          coreLinks,
          repeatedPaperCount: new Set(author.sourcePaperIds).size,
          strongestCoreWeight: Math.max(0, ...coreLinks.map((link) => link.weight)),
        }
      })
    const structural = candidates
      .filter((item) => item.coreLinks.length >= 2 || item.strongestCoreWeight >= 2)
      .sort((left, right) =>
        right.coreLinks.length - left.coreLinks.length
        || right.strongestCoreWeight - left.strongestCoreWeight
        || right.repeatedPaperCount - left.repeatedPaperCount
        || left.author.label.localeCompare(right.author.label),
      )
    for (const item of structural) {
      if (includedIds.size >= MAX_DEFAULT_AUTHOR_NODES) break
      includedIds.add(item.author.id)
      bridgeIds.add(item.author.id)
    }

    const orderedCoreIds = [...coreIds].sort((left, right) =>
      (authorById.get(left)?.label ?? left).localeCompare(authorById.get(right)?.label ?? right),
    )
    const neighboursByCore = new Map(orderedCoreIds.map((coreId) => [
      coreId,
      (adjacency.get(coreId) ?? [])
        .filter((link) => !coreIds.has(link.authorId) && authorById.has(link.authorId))
        .sort((left, right) =>
          right.weight - left.weight
          || new Set(authorById.get(right.authorId)?.sourcePaperIds ?? []).size
            - new Set(authorById.get(left.authorId)?.sourcePaperIds ?? []).size
          || (authorById.get(left.authorId)?.label ?? left.authorId)
            .localeCompare(authorById.get(right.authorId)?.label ?? right.authorId),
        ),
    ]))
    // 轮转补入，避免前几位核心作者占满全局节点上限。
    for (let rank = 0; rank < MAX_CONTEXT_AUTHORS_PER_CORE; rank += 1) {
      for (const coreId of orderedCoreIds) {
        if (includedIds.size >= MAX_DEFAULT_AUTHOR_NODES) break
        const neighbour = neighboursByCore.get(coreId)?.[rank]
        if (!neighbour) continue
        includedIds.add(neighbour.authorId)
      }
    }
  }

  if (expandedAuthorId && authorById.has(expandedAuthorId)) {
    includedIds.add(expandedAuthorId)
    for (const neighbour of adjacency.get(expandedAuthorId) ?? []) {
      includedIds.add(neighbour.authorId)
    }
  }

  const nodes = authors
    .filter((author) => includedIds.has(author.id))
    .map((author) => ({
      ...author,
      authorTier: coreIds.has(author.id)
        ? 'core' as const
        : bridgeIds.has(author.id)
          ? 'bridge' as const
          : 'context' as const,
    }))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = coauthorEdges.filter((edge) =>
    nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
  )
  return { nodes, edges }
}

/** 同篇使用只作为弱共现信号；combinedWith 仅保留有二次判断/审核的正式边。 */
function buildMethodRelations(
  nodes: GraphDataset['nodes'],
  directEdges: GraphDataset['edges'],
): GraphDataset['edges'] {
  const directMethodEdges = directEdges.filter((edge) =>
    edge.relationType === 'combinedWith'
    || edge.relationType === 'variantOf'
    || edge.relationType === 'alternativeTo',
  )
  const relationByPair = new Map(directMethodEdges.map((edge) => [
    [edge.sourceId, edge.targetId].sort().join('|'), edge,
  ]))

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex]
      const right = nodes[rightIndex]
      const sharedPaperIds = left.sourcePaperIds.filter((paperId) => right.sourcePaperIds.includes(paperId))
      if (sharedPaperIds.length === 0) continue
      const key = [left.id, right.id].sort().join('|')
      if (relationByPair.has(key)) continue
      relationByPair.set(key, {
        id: `methodCooccurs:${key}`,
        sourceId: left.id,
        targetId: right.id,
        relationType: 'coOccurs',
        label: '同篇使用（待关系判断）',
        directed: false,
        weight: sharedPaperIds.length,
        evidenceIds: [],
        sourcePaperIds: sharedPaperIds,
      })
    }
  }

  return [...relationByPair.values()]
}

/** 获取指定图谱视图的开发期数据集，并支持空态和失败态演示。 */
export async function getGraphDataset(
  view: GraphView,
  scenario: GraphScenario = 'success',
  options: GraphProjectionOptions = {},
): Promise<GraphDataset> {
  if (scenario === 'error') {
    throw new Error('知识图谱加载失败，请稍后重试。')
  }

  if (scenario === 'empty') {
    return {
      view,
      nodes: [],
      edges: [],
      contextOverlay: { nodes: [], edges: [] },
      evidence: [],
      papers: {},
      relatedNodeLabels: {},
      nodeDetails: {},
    }
  }

  if (getDataMode() === 'api') {
    const papers = await requestJson<PageResult<PaperSummary>>('/api/v1/papers?page=1&pageSize=100&sortBy=updatedAt&sortOrder=desc')
    const response = await requestJson<GraphResponseDto>('/api/v1/graph')
    const dataset = filterDatasetByCollection(
      toGraphDataset(response, view, papers),
      options.collectionKey,
    )
    return projectDatasetForView(dataset, view, options)
  }

  return projectDatasetForView(
    filterDatasetByCollection(structuredClone(graphMocks[view]), options.collectionKey),
    view,
    options,
  )
}

function toGraphDataset(response: GraphResponseDto, view: GraphView, paperPage?: PageResult<PaperSummary>): GraphDataset {
  const paperById = new Map((paperPage?.items ?? []).map((paper) => [paper.id, paper]))
  const collectionCounts = new Map<string, { key: string; name: string; paperCount: number }>()
  for (const paper of paperPage?.items ?? []) {
    for (const collection of paper.zoteroCollections ?? []) {
      const current = collectionCounts.get(collection.key)
      collectionCounts.set(collection.key, {
        ...collection,
        paperCount: (current?.paperCount ?? 0) + 1,
      })
    }
  }
  const papers = Object.fromEntries(response.nodes.filter((node) => node.nodeType === 'paper').map((node) => {
    const paper = paperById.get(node.id)
    return [node.id, {
      id: node.id,
      title: paper?.title ?? node.label,
      authorNames: paper?.authors.map((author) => author.displayName) ?? [],
      authors: paper?.authors.map((author) => ({
        id: author.authorId,
        name: author.displayName,
        order: author.authorOrder,
        contributionRoles: author.contributionRoles
          ?? (author.authorOrder === 1 ? ['firstAuthor'] : []),
      })) ?? [],
      year: paper?.year ?? null,
      journal: paper?.journal ? {
        name: paper.journal.name,
        impactFactor: paper.journal.metrics?.impactFactor ?? null,
        impactFactorYear: paper.journal.metrics?.jcrDataYear ?? null,
        jcrQuartile: paper.journal.metrics?.categories[0]?.quartile ?? null,
      } : null,
      zoteroCollections: paper?.zoteroCollections?.map((collection) => ({ ...collection })) ?? [],
    }]
  }))

  return {
    view,
    nodes: response.nodes.map((node) => ({
      id: node.id,
      nodeType: node.nodeType,
      label: node.label,
      englishLabel: node.englishLabel ?? null,
      description: node.description,
      sourcePaperIds: node.sourcePaperIds,
      metrics: { paperCount: node.sourcePaperIds.length },
    })),
    edges: response.edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relationType: edge.relationType as GraphDataset['edges'][number]['relationType'],
      label: edge.label,
      directed: edge.relationType !== 'coAuthor',
      weight: edge.weight,
      evidenceIds: edge.evidenceIds,
      sourcePaperIds: edge.sourcePaperIds,
    })),
    contextOverlay: { nodes: [], edges: [] },
    evidence: response.evidence,
    papers,
    relatedNodeLabels: Object.fromEntries(response.nodes.map((node) => [node.id, node.label])),
    nodeDetails: Object.fromEntries(response.nodes.map((node) => [node.id, toNodeDetail(node)])),
    collections: [...collectionCounts.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN') || left.key.localeCompare(right.key)),
  }
}

function toNodeDetail(node: GraphResponseDto['nodes'][number]): GraphNodeDetail {
  if (node.nodeType === 'paper') {
    return { nodeId: node.id, nodeType: 'paper', paperId: node.id, conceptIds: [], methodIds: [], findingSummaries: [] }
  }
  if (node.nodeType === 'author') {
    return { nodeId: node.id, nodeType: 'author', orcid: null, affiliations: [], paperIds: node.sourcePaperIds }
  }
  if (node.nodeType === 'method') {
    return { nodeId: node.id, nodeType: 'method', methodType: 'other', paperIds: node.sourcePaperIds }
  }
  return {
    nodeId: node.id,
    nodeType: 'concept',
    aliases: [],
    broaderConceptIds: [],
    narrowerConceptIds: [],
    relatedConceptIds: [],
    coOccurringConceptIds: [],
    paperIds: node.sourcePaperIds,
  }
}
