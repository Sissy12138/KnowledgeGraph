import type { EChartsOption } from 'echarts'
import { getAppTheme, type AppTheme, type AppThemeId } from '../../styles/app-theme'
import type {
  GraphDataset,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphPaperSummary,
  GraphSelection,
} from './graph.types'

export type GraphPaperSort = 'journalImpactFactor' | 'year'
export const GRAPH_SERIES_ID = 'knowledge-graph'

export type GraphPresentation = {
  selected: GraphSelection
  selectedPaperIds: string[]
  highlightedNodeIds: Set<string>
  isSearchActive: boolean
  contextConceptId: string | null
  contextMethodId: string | null
  contextAuthorId: string | null
  showRelatedAuthors: boolean
  showRelatedConcepts: boolean
  showRelatedMethods: boolean
  themeId: AppThemeId
  fontScalePercent: number
}

const NODE_TYPE_LABELS = {
  paper: '论文',
  author: '作者',
  concept: '概念',
  method: '方法',
  finding: '发现',
} as const

const NODE_TYPE_ORDER: GraphNodeType[] = ['paper', 'author', 'concept', 'method', 'finding']

/** 在当前图谱的节点标签和描述中进行不区分大小写的搜索。 */
export function findMatchingNodes(dataset: GraphDataset, query: string): GraphNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return dataset.nodes

  return dataset.nodes.filter((node) =>
    `${node.label} ${node.englishLabel ?? ''} ${node.description ?? ''}`.toLocaleLowerCase().includes(normalized),
  )
}

/** 按期刊影响因子或发表年份降序排列论文，缺失主排序值始终置后。 */
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

function getNodeSize(
  node: GraphNode,
  dataset: GraphDataset,
  presentation: GraphPresentation,
): number {
  if (dataset.view === 'author' && node.nodeType === 'author') {
    if (node.authorTier === 'core') {
      return Math.min(34 + 6 * Math.sqrt(new Set(node.sourcePaperIds).size), 54)
    }
    if (node.authorTier === 'bridge') return 27
    if (node.authorTier === 'context') return 21
    const totals = dataset.nodes
      .filter((candidate) => candidate.nodeType === 'author')
      .map((candidate) => Math.max(candidate.metrics.totalImpactFactor ?? 0, 0))
    const minimum = Math.min(...totals)
    const maximum = Math.max(...totals)
    if (maximum === minimum) return 20

    const impactFactor = Math.max(node.metrics.totalImpactFactor ?? 0, 0)
    const normalized = (
      Math.sqrt(impactFactor) - Math.sqrt(minimum)
    ) / (Math.sqrt(maximum) - Math.sqrt(minimum))
    return 20 + normalized * 40
  }

  if (
    (dataset.view === 'author' || dataset.view === 'method')
    && (node.nodeType === 'concept' || node.nodeType === 'method')
    && (presentation.contextAuthorId || presentation.contextMethodId)
  ) {
    const contextId = dataset.view === 'author'
      ? presentation.contextAuthorId
      : presentation.contextMethodId
    const sharedPaperIds = new Set(
      dataset.contextOverlay.edges
        .filter((edge) =>
          edge.sourceId === contextId
          && edge.targetId === node.id
          && (
            edge.relationType === 'authorConcept'
            || edge.relationType === 'authorMethod'
            || edge.relationType === 'methodConcept'
          ))
        .flatMap((edge) => edge.sourcePaperIds),
    )
    return Math.min(22 + 8 * Math.sqrt(sharedPaperIds.size), 48)
  }

  if (dataset.view === 'concept' && node.nodeType === 'concept') {
    return Math.min(28 + 8 * Math.sqrt(new Set(node.sourcePaperIds).size), 60)
  }

  if (dataset.view === 'paper' && node.nodeType === 'paper') {
    const impactFactor = Math.max(dataset.papers[node.id]?.journal?.impactFactor ?? 0, 0)
    return Math.min(28 + 6 * Math.sqrt(impactFactor), 60)
  }

  const metric = node.metrics.paperCount ?? node.metrics.connectionCount ?? 0
  return Math.min(Math.max(28 + metric * 4, 28), 60)
}

/** 把论文节点压缩为第一作者、期刊和年份，避免标题长期占据画布。 */
function getNodeLabel(node: GraphNode, dataset: GraphDataset): string {
  if (node.nodeType !== 'paper' || (dataset.view !== 'method' && dataset.view !== 'paper')) {
    return node.label
  }

  const paper = dataset.papers[node.id]
  if (!paper) return node.label
  const firstAuthor = paper.authorNames[0] || 'Unknown author'
  const journal = paper.journal?.name || 'Preprint'
  const year = paper.year ?? 'n.d.'
  return `${firstAuthor}\n${journal} · ${year}`
}

type GraphPosition = { x: number; y: number }

/**
 * 大型全量图采用稳定的类型分区，而非让力导向算法把数百个节点压成一团。
 * 关系仍全部保留；分区只负责给初始浏览提供可读的空间秩序。
 */
function getDenseGraphPositions(nodes: GraphNode[]): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>()
  const centers: Record<GraphNodeType, GraphPosition> = {
    concept: { x: -360, y: -220 },
    method: { x: 360, y: -220 },
    author: { x: -360, y: 220 },
    paper: { x: 360, y: 220 },
    finding: { x: 0, y: 0 },
  }

  for (const nodeType of NODE_TYPE_ORDER) {
    const group = nodes.filter((node) => node.nodeType === nodeType)
    const columns = Math.max(1, Math.ceil(Math.sqrt(group.length * 1.35)))
    const spacing = group.length > 90 ? 30 : 38
    const center = centers[nodeType]
    group.forEach((node, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      positions.set(node.id, {
        x: center.x + (column - (columns - 1) / 2) * spacing,
        y: center.y + (row - (Math.ceil(group.length / columns) - 1) / 2) * spacing,
      })
    })
  }

  return positions
}

function escapeTooltipText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 为论文节点生成紧凑、可换行且不执行数据中 HTML 的悬浮信息卡。 */
function formatGraphTooltip(
  dataset: GraphDataset,
  params: { dataType?: string; data?: unknown; name?: string },
): string {
  const data = typeof params.data === 'object' && params.data !== null
    ? params.data as { id?: unknown }
    : null
  const nodeId = typeof data?.id === 'string' ? data.id : null
  const paper = nodeId ? dataset.papers[nodeId] : null
  if (params.dataType !== 'node' || !paper) {
    return `<div class="graph-paper-tooltip graph-paper-tooltip--compact">${
      escapeTooltipText(params.name ?? '')
    }</div>`
  }

  return [
    '<div class="graph-paper-tooltip">',
    '<div class="graph-paper-tooltip__section">',
    '<span class="graph-paper-tooltip__label">PAPER</span>',
    `<strong class="graph-paper-tooltip__title">${escapeTooltipText(paper.title)}</strong>`,
    '</div>',
    '<dl class="graph-paper-tooltip__metadata">',
    '<dt>AUTHORS</dt>',
    `<dd>${escapeTooltipText(paper.authorNames.join(', ') || 'Unknown')}</dd>`,
    '<dt>JOURNAL</dt>',
    `<dd>${escapeTooltipText(paper.journal?.name || 'Preprint')}</dd>`,
    '<dt>YEAR</dt>',
    `<dd>${paper.year ?? 'n.d.'}</dd>`,
    '</dl>',
    '</div>',
  ].join('')
}

function getVisibleGraph(dataset: GraphDataset, presentation: GraphPresentation) {
  const contextNodeId = dataset.view === 'concept'
    ? presentation.contextConceptId
    : dataset.view === 'author'
      ? presentation.contextAuthorId
      : dataset.view === 'method'
        ? presentation.contextMethodId
        : null
  const contextEdges = dataset.view === 'paper'
    ? presentation.showRelatedConcepts || presentation.showRelatedMethods
      ? dataset.contextOverlay.edges.filter((edge) =>
        (
          (edge.relationType === 'paperConcept' && presentation.showRelatedConcepts)
          || (edge.relationType === 'paperMethod' && presentation.showRelatedMethods)
        )
        && presentation.selectedPaperIds.includes(edge.sourceId))
      : []
    : contextNodeId
      ? dataset.contextOverlay.edges.filter((edge) =>
      edge.sourceId === contextNodeId
      && (
        (edge.relationType === 'conceptAuthor' && presentation.showRelatedAuthors)
        || (edge.relationType === 'conceptMethod' && presentation.showRelatedMethods)
        || (edge.relationType === 'authorConcept' && presentation.showRelatedConcepts)
        || (edge.relationType === 'authorMethod' && presentation.showRelatedMethods)
        || (edge.relationType === 'methodConcept' && presentation.showRelatedConcepts)
      ),
      )
      : []
  const contextNodeIds = new Set(contextEdges.map((edge) => edge.targetId))
  const contextNodes = dataset.contextOverlay.nodes.filter((node) => contextNodeIds.has(node.id))

  return {
    nodes: [...dataset.nodes, ...contextNodes],
    edges: [...dataset.edges, ...contextEdges],
  }
}

/** 返回当前开关和概念锚点下实际显示的节点、边数量。 */
export function getVisibleGraphCounts(
  dataset: GraphDataset,
  presentation: GraphPresentation,
): { nodeCount: number; edgeCount: number } {
  const visible = getVisibleGraph(dataset, presentation)
  return { nodeCount: visible.nodes.length, edgeCount: visible.edges.length }
}

function getFocusedNodeIds(dataset: GraphDataset, presentation: GraphPresentation): Set<string> | null {
  if (dataset.view === 'paper') {
    if (
      (!presentation.showRelatedConcepts && !presentation.showRelatedMethods)
      || presentation.selectedPaperIds.length === 0
    ) return null
    const focused = new Set(presentation.selectedPaperIds)
    for (const edge of dataset.contextOverlay.edges) {
      if (
        (
          (edge.relationType === 'paperConcept' && presentation.showRelatedConcepts)
          || (edge.relationType === 'paperMethod' && presentation.showRelatedMethods)
        )
        && focused.has(edge.sourceId)
      ) {
        focused.add(edge.targetId)
      }
    }
    return focused
  }

  const anchorId = dataset.view === 'concept'
    ? presentation.contextConceptId
    : dataset.view === 'author'
      ? presentation.contextAuthorId
      : dataset.view === 'method'
        ? presentation.contextMethodId
        : null
  if (!anchorId) return null

  const hasVisibleContext = dataset.view === 'concept'
    ? presentation.showRelatedAuthors || presentation.showRelatedMethods
    : dataset.view === 'method'
      ? presentation.showRelatedConcepts
      : presentation.showRelatedConcepts || presentation.showRelatedMethods
  if (dataset.view === 'author' && !hasVisibleContext) return null

  const focused = new Set([anchorId])
  if (dataset.view === 'concept' && !hasVisibleContext) {
    for (const edge of dataset.edges) {
      if (edge.sourceId === anchorId) focused.add(edge.targetId)
      if (edge.targetId === anchorId) focused.add(edge.sourceId)
    }
  }
  for (const edge of dataset.contextOverlay.edges) {
    if (edge.sourceId !== anchorId) continue
    if (edge.relationType === 'conceptAuthor' && presentation.showRelatedAuthors) {
      focused.add(edge.targetId)
    }
    if (edge.relationType === 'conceptMethod' && presentation.showRelatedMethods) {
      focused.add(edge.targetId)
    }
    if (edge.relationType === 'authorConcept' && presentation.showRelatedConcepts) {
      focused.add(edge.targetId)
    }
    if (edge.relationType === 'authorMethod' && presentation.showRelatedMethods) {
      focused.add(edge.targetId)
    }
    if (edge.relationType === 'methodConcept' && presentation.showRelatedConcepts) {
      focused.add(edge.targetId)
    }
  }
  return focused
}

/** 生成只依赖搜索、选择和上下文开关状态的节点呈现数据。 */
function buildPresentationNodes(
  dataset: GraphDataset,
  presentation: GraphPresentation,
  theme: AppTheme,
) {
  const visible = getVisibleGraph(dataset, presentation)
  const focusedNodeIds = getFocusedNodeIds(dataset, presentation)
  // 全量网络中同时绘制数百条文字标签会遮住节点与关系；保留完整节点，
  // 仅在选中、搜索命中或悬停时展示名称。
  const isDenseGraph = dataset.view === 'author'
    ? visible.nodes.length > 24
    : visible.nodes.length > 36
  const densePositions = isDenseGraph ? getDenseGraphPositions(visible.nodes) : null

  return visible.nodes.map((node) => {
    const nodeStyle = theme.graph.nodes[node.nodeType]
    const isSelected = (presentation.selected?.kind === 'node'
      && presentation.selected.id === node.id)
      || (dataset.view === 'paper' && presentation.selectedPaperIds.includes(node.id))
    const isHighlighted = presentation.highlightedNodeIds.has(node.id)
    const tierOpacity = dataset.view === 'author' && node.authorTier === 'bridge'
      ? 0.78
      : dataset.view === 'author' && node.authorTier === 'context'
        ? 0.62
        : 1
    const opacity = presentation.isSearchActive
      ? (isHighlighted ? 1 : 0.22)
      : (focusedNodeIds && !focusedNodeIds.has(node.id) ? 0.18 : tierOpacity)

    const label = getNodeLabel(node, dataset)
    const nodeSize = getNodeSize(node, dataset, presentation)
    return {
      id: node.id,
      name: label,
      value: node.label,
      category: NODE_TYPE_LABELS[node.nodeType],
      symbol: 'circle',
      symbolSize: nodeSize,
      ...(densePositions ? densePositions.get(node.id) : {}),
      itemStyle: {
        color: nodeStyle.background,
        opacity,
        borderColor: isSelected ? theme.graph.selectedBorder : nodeStyle.background,
        borderWidth: isSelected ? 5 : 1,
        shadowColor: isSelected ? nodeStyle.background : undefined,
        shadowBlur: isSelected ? 4 : 0,
      },
      label: {
        show: (node.authorTier === 'core')
          || (!isDenseGraph && !(dataset.view === 'author' && node.nodeType === 'author' && nodeSize <= 21))
          || isSelected
          || isHighlighted,
        formatter: label,
        ...(node.nodeType === 'paper' && (dataset.view === 'method' || dataset.view === 'paper')
          ? { width: 144, overflow: 'break' as const, lineHeight: 17, align: 'center' as const }
          : {}),
        color: nodeStyle.text,
        fontFamily: nodeStyle.fontFamily,
        fontSize: nodeStyle.fontSize * presentation.fontScalePercent / 100,
      },
    }
  })
}

function buildCategories(nodes: GraphNode[], theme: AppTheme) {
  const visibleTypes = new Set(nodes.map((node) => node.nodeType))
  return NODE_TYPE_ORDER
    .filter((nodeType) => visibleTypes.has(nodeType))
    .map((nodeType) => ({
      name: NODE_TYPE_LABELS[nodeType],
      itemStyle: { color: theme.graph.nodes[nodeType].background },
    }))
}

function buildPresentationLinks(
  dataset: GraphDataset,
  presentation: GraphPresentation,
  edges: GraphEdge[],
  theme: AppTheme,
) {
  const focusedNodeIds = getFocusedNodeIds(dataset, presentation)
  const isDenseGraph = dataset.view === 'author'
    ? dataset.nodes.length > 24
    : dataset.nodes.length > 36
  const methodPairCounts = new Map<string, number>()
  for (const edge of edges) {
    if (!['combinedWith', 'variantOf', 'alternativeTo'].includes(edge.relationType)) continue
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    methodPairCounts.set(key, (methodPairCounts.get(key) ?? 0) + 1)
  }
  return edges.map((edge) => {
    const isContextEdge = edge.relationType === 'conceptAuthor'
      || edge.relationType === 'conceptMethod'
      || edge.relationType === 'authorConcept'
      || edge.relationType === 'authorMethod'
      || edge.relationType === 'methodConcept'
      || edge.relationType === 'paperConcept'
      || edge.relationType === 'paperMethod'
    const isFocused = !focusedNodeIds
      || (focusedNodeIds.has(edge.sourceId) && focusedNodeIds.has(edge.targetId))
    const lineType: 'dashed' | 'solid' = isContextEdge || edge.relationType === 'coOccurs'
      ? 'dashed'
      : 'solid'
    const methodRelationStyle = methodEdgeStyle(edge.relationType, theme)
    const pairKey = [edge.sourceId, edge.targetId].sort().join('|')
    const samePairCount = methodPairCounts.get(pairKey) ?? 0
    const curveness = samePairCount > 1 ? methodEdgeCurveness(edge.relationType) : 0
    return {
      id: edge.id,
      name: edge.label,
      source: edge.sourceId,
      target: edge.targetId,
      lineStyle: {
        color: methodRelationStyle.color,
        opacity: isFocused ? (isDenseGraph ? 0.28 : 0.72) : 0.12,
        width: edge.relationType === 'coAuthor'
          ? Math.min(2 + (edge.weight ?? 0), 8)
          : edge.relationType === 'coOccurs'
            ? Math.min(1 + (edge.weight ?? 1) * 0.4, 2.6)
            : methodRelationStyle.width,
        type: methodRelationStyle.type ?? lineType,
        curveness,
      },
      symbol: edge.directed ? ['none', 'arrow'] : ['none', 'none'],
      symbolSize: edge.directed ? [0, 8] : [0, 0],
    }
  })
}

function methodEdgeStyle(
  relationType: GraphEdge['relationType'],
  theme: AppTheme,
): { color: string; width: number; type?: 'dashed' | 'solid' } {
  // 方法网络的线只表达“存在已审核关系”；具体类型交由悬浮/详情文字呈现，避免颜色语义过载。
  if (relationType === 'combinedWith' || relationType === 'variantOf' || relationType === 'alternativeTo') {
    return { color: theme.graph.edge, width: 2 }
  }
  return { color: theme.graph.edge, width: 2 }
}

function methodEdgeCurveness(relationType: GraphEdge['relationType']) {
  if (relationType === 'combinedWith') return -0.18
  if (relationType === 'variantOf') return 0
  if (relationType === 'alternativeTo') return 0.18
  return 0
}

/** 只合并节点呈现，不替换力导向数据模型和已产生的视口状态。 */
export function buildGraphPresentationOption(
  dataset: GraphDataset,
  presentation: GraphPresentation,
): EChartsOption {
  const visible = getVisibleGraph(dataset, presentation)
  const theme = getAppTheme(presentation.themeId)
  const categories = buildCategories(visible.nodes, theme)
  return {
    legend: { data: categories.map((category) => category.name) },
    series: [
      {
        id: GRAPH_SERIES_ID,
        type: 'graph',
        data: buildPresentationNodes(dataset, presentation, theme),
        links: buildPresentationLinks(dataset, presentation, visible.edges, theme),
        categories,
      },
    ],
  }
}

/** 将领域图谱数据转换为可交互的 ECharts 力导向图配置。 */
export function buildGraphOption(
  dataset: GraphDataset,
  presentation: GraphPresentation,
): EChartsOption {
  const visible = getVisibleGraph(dataset, presentation)
  const theme = getAppTheme(presentation.themeId)
  const categories = buildCategories(visible.nodes, theme)
  const isDenseGraph = visible.nodes.length > 36
  return {
    tooltip: {
      trigger: 'item',
      className: 'graph-tooltip',
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      formatter: (params) => Array.isArray(params)
        ? params.map((item) => formatGraphTooltip(dataset, item)).join('<br/>')
        : formatGraphTooltip(dataset, params),
    },
    legend: {
      data: categories.map((category) => category.name),
    },
    series: [
      {
        id: GRAPH_SERIES_ID,
        type: 'graph',
        layout: isDenseGraph ? 'none' : 'force',
        roam: true,
        draggable: true,
        categories,
        data: buildPresentationNodes(dataset, presentation, theme),
        links: buildPresentationLinks(dataset, presentation, visible.edges, theme),
        ...(isDenseGraph ? {} : {
          force: {
            initLayout: 'circular',
            repulsion: 380,
            edgeLength: [100, 180],
            gravity: 0.08,
          },
        }),
        lineStyle: { color: theme.graph.edge },
        emphasis: {
          focus: 'adjacency',
          label: { show: true },
        },
      },
    ],
  }
}
