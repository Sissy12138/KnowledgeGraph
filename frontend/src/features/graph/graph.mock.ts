import type {
  Evidence,
  GraphDataset,
  GraphEdge,
  GraphNode,
  GraphPaperSummary,
  GraphView,
} from './graph.types'

// JIF 为界面开发 Mock，不代表 A 已确认数据。
// ORCID 为界面开发 Mock，不代表 A 已确认数据。
const sharedPapers: Record<string, GraphPaperSummary> = {
  'paper-001': {
    id: 'paper-001',
    title: '反转学习中的认知灵活性与前额叶活动',
    authorNames: ['李明', '王芳'],
    year: 2025,
    journal: { name: 'Nature Neuroscience', impactFactor: 25.0, impactFactorYear: 2024, jcrQuartile: 'Q1' },
  },
  'paper-002': {
    id: 'paper-002',
    title: '价值更新中的网络动力学',
    authorNames: ['李明', '王芳', '陈伟'],
    year: 2024,
    journal: { name: 'Neuron', impactFactor: 16.2, impactFactorYear: 2024, jcrQuartile: 'Q1' },
  },
  'paper-003': {
    id: 'paper-003',
    title: '适应性决策的脑电标记',
    authorNames: ['陈伟', '赵静'],
    year: 2023,
    journal: { name: 'Cerebral Cortex', impactFactor: 4.2, impactFactorYear: 2024, jcrQuartile: 'Q2' },
  },
  'paper-004': {
    id: 'paper-004',
    title: '人类层级强化学习',
    authorNames: ['周宁', '孙悦'],
    year: 2022,
    journal: { name: 'PLOS Computational Biology', impactFactor: 4.3, impactFactorYear: 2024, jcrQuartile: 'Q1' },
  },
  'paper-005': {
    id: 'paper-005',
    title: '可重复的任务切换数据集',
    authorNames: ['吴兰'],
    year: 2021,
    journal: null,
  },
}

const conceptEvidence: Evidence[] = [
  { id: 'evidence-reversal', paperId: 'paper-001', section: 'Results', text: 'Reversal trials increased adaptive control signals.' },
  { id: 'evidence-model', paperId: 'paper-004', section: 'Results', text: 'Hierarchical learning linked decisions to reinforcement-learning structure.' },
]

const methodEvidence: Evidence[] = [
  { id: 'evidence-method', paperId: 'paper-002', section: 'Methods', text: 'A reinforcement-learning model estimated trial-wise values.' },
]

const paperEvidence: Evidence[] = [
  { id: 'evidence-citation-001-002', paperId: 'paper-001', section: null, text: 'The reversal-learning study builds on the value-updating framework.' },
  { id: 'evidence-citation-002-003', paperId: 'paper-002', section: null, text: 'The network analysis cites earlier EEG markers of adaptive decisions.' },
]

const sharedNodeLabels: Record<string, string> = {
  'concept-learning': '学习',
  'concept-reversal-learning': '反转学习',
  'concept-cognitive-control': '认知控制',
  'concept-value-updating': '价值更新',
  'concept-decision-making': '决策',
  'concept-reinforcement-learning': '强化学习',
  'method-rl-model': '强化学习建模',
  'method-fmri': '功能磁共振',
  'method-eeg': '脑电图',
  'method-network-analysis': '网络分析',
}

const conceptNodes: GraphNode[] = [
  { id: 'concept-learning', nodeType: 'concept', label: '学习', description: '通过经验改变行为或表征的过程。', sourcePaperIds: ['paper-001', 'paper-004'], metrics: { paperCount: 4, connectionCount: 3 } },
  { id: 'concept-reversal-learning', nodeType: 'concept', label: '反转学习', description: '在奖惩规则改变后更新行为策略的能力。', sourcePaperIds: ['paper-001', 'paper-002'], metrics: { paperCount: 2, connectionCount: 3 } },
  { id: 'concept-cognitive-control', nodeType: 'concept', label: '认知控制', description: '根据目标调节信息加工与行为的能力。', sourcePaperIds: ['paper-001'], metrics: { paperCount: 2, connectionCount: 2 } },
  { id: 'concept-value-updating', nodeType: 'concept', label: '价值更新', description: '根据反馈修正预期价值的过程。', sourcePaperIds: ['paper-002'], metrics: { paperCount: 2, connectionCount: 2 } },
  { id: 'concept-decision-making', nodeType: 'concept', label: '决策', description: '在多个行动方案间作出选择的过程。', sourcePaperIds: ['paper-003', 'paper-005'], metrics: { paperCount: 3, connectionCount: 2 } },
  { id: 'concept-reinforcement-learning', nodeType: 'concept', label: '强化学习', description: '利用奖惩信号优化行为策略的计算框架。', sourcePaperIds: ['paper-004'], metrics: { paperCount: 2, connectionCount: 2 } },
]

const methodNodes: GraphNode[] = [
  { id: 'method-rl-model', nodeType: 'method', label: '强化学习建模', description: '拟合试次级价值与学习率。', sourcePaperIds: ['paper-002', 'paper-004'], metrics: { paperCount: 2, connectionCount: 2 } },
  { id: 'method-fmri', nodeType: 'method', label: '功能磁共振', description: '测量血氧水平依赖信号。', sourcePaperIds: ['paper-001'], metrics: { paperCount: 1, connectionCount: 1 } },
  { id: 'method-eeg', nodeType: 'method', label: '脑电图', description: '记录毫秒级脑电活动。', sourcePaperIds: ['paper-003'], metrics: { paperCount: 1, connectionCount: 1 } },
  { id: 'method-network-analysis', nodeType: 'method', label: '网络分析', description: '量化脑区间的功能连接。', sourcePaperIds: ['paper-002', 'paper-005'], metrics: { paperCount: 2, connectionCount: 2 } },
]

const authorNodes: GraphNode[] = [
  { id: 'author-li-ming', nodeType: 'author', label: '李明', description: '认知神经科学研究者。', sourcePaperIds: ['paper-001', 'paper-002'], metrics: { paperCount: 2 } },
  { id: 'author-wang-fang', nodeType: 'author', label: '王芳', description: '计算精神病学研究者。', sourcePaperIds: ['paper-001', 'paper-002'], metrics: { paperCount: 2 } },
  { id: 'author-chen-wei', nodeType: 'author', label: '陈伟', description: '神经信号分析研究者。', sourcePaperIds: ['paper-002', 'paper-003'], metrics: { paperCount: 2 } },
  { id: 'author-zhao-jing', nodeType: 'author', label: '赵静', description: '认知电生理研究者。', sourcePaperIds: ['paper-003'], metrics: { paperCount: 1 } },
  { id: 'author-zhou-ning', nodeType: 'author', label: '周宁', description: '计算建模研究者。', sourcePaperIds: ['paper-004'], metrics: { paperCount: 1 } },
  { id: 'author-sun-yue', nodeType: 'author', label: '孙悦', description: '计算建模研究者。', sourcePaperIds: ['paper-004'], metrics: { paperCount: 1 } },
  { id: 'author-wu-lan', nodeType: 'author', label: '吴兰', description: '开放科学与可重复性研究者。', sourcePaperIds: ['paper-005'], metrics: { paperCount: 1 } },
]

/** 仅以稳定节点 ID 携带的论文外键求交集，生成只读上下文边。 */
function buildConceptContextEdges(
  contextNodes: GraphNode[],
  relationType: 'conceptAuthor' | 'conceptMethod',
): GraphEdge[] {
  return conceptNodes.flatMap((concept) =>
    contextNodes.flatMap((contextNode) => {
      const contextPaperIds = new Set(contextNode.sourcePaperIds)
      const sourcePaperIds = concept.sourcePaperIds.filter((paperId) => contextPaperIds.has(paperId))
      if (sourcePaperIds.length === 0) return []

      return [{
        id: `edge-context-${concept.id}-${contextNode.id}`,
        sourceId: concept.id,
        targetId: contextNode.id,
        relationType,
        label: relationType === 'conceptAuthor' ? '相关作者' : '相关方法',
        directed: false,
        weight: null,
        evidenceIds: [],
        sourcePaperIds,
      }]
    }),
  )
}

/** 从作者论文外键与概念/方法论文外键的交集生成只读上下文边。 */
function buildAuthorContextEdges(
  contextNodes: GraphNode[],
  relationType: 'authorConcept' | 'authorMethod',
): GraphEdge[] {
  return authorNodes.flatMap((author) =>
    contextNodes.flatMap((contextNode) => {
      const contextPaperIds = new Set(contextNode.sourcePaperIds)
      const sourcePaperIds = author.sourcePaperIds.filter((paperId) => contextPaperIds.has(paperId))
      if (sourcePaperIds.length === 0) return []

      return [{
        id: `edge-context-${author.id}-${contextNode.id}`,
        sourceId: author.id,
        targetId: contextNode.id,
        relationType,
        label: relationType === 'authorConcept' ? '相关概念' : '相关方法',
        directed: false,
        weight: null,
        evidenceIds: [],
        sourcePaperIds,
      }]
    }),
  )
}

/** 从论文 ID 与概念的论文外键生成文献—概念上下文边。 */
function buildPaperContextEdges(papers: Record<string, GraphPaperSummary>): GraphEdge[] {
  return Object.values(papers).flatMap((paper) =>
    conceptNodes
      .filter((concept) => concept.sourcePaperIds.includes(paper.id))
      .map((concept) => ({
        id: `edge-context-${paper.id}-${concept.id}`,
        sourceId: paper.id,
        targetId: concept.id,
        relationType: 'paperConcept' as const,
        label: '相关概念',
        directed: false,
        weight: null,
        evidenceIds: [],
        sourcePaperIds: [paper.id],
      })),
  )
}

/** 由节点论文外键和边端点统一推导计数，避免 Mock 手填值随关系变更漂移。 */
function withDerivedMetrics(dataset: GraphDataset): GraphDataset {
  return {
    ...dataset,
    nodes: dataset.nodes.map((node) => ({
      ...node,
      metrics: {
        ...node.metrics,
        ...(node.metrics.paperCount === undefined
          ? {}
          : { paperCount: new Set(node.sourcePaperIds).size }),
        ...(node.nodeType === 'author'
          ? {
              totalImpactFactor: [...new Set(node.sourcePaperIds)].reduce(
                (total, paperId) => total + (dataset.papers[paperId]?.journal?.impactFactor ?? 0),
                0,
              ),
            }
          : {}),
        connectionCount: dataset.edges.filter(
          (edge) => edge.sourceId === node.id || edge.targetId === node.id,
        ).length,
      },
    })),
  }
}

/** 从每篇论文的作者组合生成完整的无向合作边。 */
function buildCoauthorEdges(
  authorNodes: GraphNode[],
  papers: Record<string, GraphPaperSummary>,
): GraphEdge[] {
  const authorIdByName = new Map(authorNodes.map((node) => [node.label, node.id]))
  const paperIdsByPair = new Map<string, string[]>()

  for (const paper of Object.values(papers)) {
    const authorIds = paper.authorNames.flatMap((name) => {
      const authorId = authorIdByName.get(name)
      return authorId ? [authorId] : []
    })
    for (let leftIndex = 0; leftIndex < authorIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < authorIds.length; rightIndex += 1) {
        const pair = [authorIds[leftIndex], authorIds[rightIndex]].sort()
        const key = pair.join('|')
        paperIdsByPair.set(key, [...(paperIdsByPair.get(key) ?? []), paper.id])
      }
    }
  }

  return [...paperIdsByPair.entries()].sort().map(([key, sourcePaperIds]) => {
    const [sourceId, targetId] = key.split('|')
    return {
      id: `edge-${sourceId}-${targetId}`,
      sourceId,
      targetId,
      relationType: 'coAuthor',
      label: '共同作者',
      directed: false,
      weight: sourcePaperIds.length,
      evidenceIds: [],
      sourcePaperIds,
    }
  })
}

export const conceptGraphMock: GraphDataset = withDerivedMetrics({
  view: 'concept',
  nodes: conceptNodes,
  edges: [
    { id: 'edge-concept-learning-reversal', sourceId: 'concept-learning', targetId: 'concept-reversal-learning', relationType: 'broaderThan', label: '包含', directed: true, weight: null, evidenceIds: ['evidence-reversal'], sourcePaperIds: ['paper-001'] },
    { id: 'edge-concept-reversal-control', sourceId: 'concept-reversal-learning', targetId: 'concept-cognitive-control', relationType: 'relatedTo', label: '相关', directed: false, weight: null, evidenceIds: ['evidence-reversal'], sourcePaperIds: ['paper-001'] },
    { id: 'edge-concept-reversal-value', sourceId: 'concept-reversal-learning', targetId: 'concept-value-updating', relationType: 'relatedTo', label: '相关', directed: false, weight: null, evidenceIds: [], sourcePaperIds: ['paper-002'] },
    { id: 'edge-concept-decision-rl', sourceId: 'concept-decision-making', targetId: 'concept-reinforcement-learning', relationType: 'relatedTo', label: '相关', directed: false, weight: null, evidenceIds: ['evidence-model'], sourcePaperIds: ['paper-004'] },
  ],
  contextOverlay: {
    nodes: [...authorNodes, ...methodNodes],
    edges: [
      ...buildConceptContextEdges(authorNodes, 'conceptAuthor'),
      ...buildConceptContextEdges(methodNodes, 'conceptMethod'),
    ],
  },
  evidence: conceptEvidence,
  papers: sharedPapers,
  relatedNodeLabels: sharedNodeLabels,
  nodeDetails: {
    'concept-learning': { nodeId: 'concept-learning', nodeType: 'concept', aliases: [], broaderConceptIds: [], narrowerConceptIds: ['concept-reversal-learning'], relatedConceptIds: [], paperIds: ['paper-001', 'paper-004'] },
    'concept-reversal-learning': { nodeId: 'concept-reversal-learning', nodeType: 'concept', aliases: ['概率反转学习'], broaderConceptIds: ['concept-learning'], narrowerConceptIds: [], relatedConceptIds: ['concept-cognitive-control', 'concept-value-updating'], paperIds: ['paper-001', 'paper-002'] },
    'concept-cognitive-control': { nodeId: 'concept-cognitive-control', nodeType: 'concept', aliases: [], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-reversal-learning'], paperIds: ['paper-001'] },
    'concept-value-updating': { nodeId: 'concept-value-updating', nodeType: 'concept', aliases: [], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-reversal-learning'], paperIds: ['paper-002'] },
    'concept-decision-making': { nodeId: 'concept-decision-making', nodeType: 'concept', aliases: ['决策制定'], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-reinforcement-learning'], paperIds: ['paper-003', 'paper-005'] },
    'concept-reinforcement-learning': { nodeId: 'concept-reinforcement-learning', nodeType: 'concept', aliases: ['RL'], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-decision-making'], paperIds: ['paper-004'] },
    'method-rl-model': { nodeId: 'method-rl-model', nodeType: 'method', methodType: '计算建模', paperIds: ['paper-002', 'paper-004'] },
    'method-fmri': { nodeId: 'method-fmri', nodeType: 'method', methodType: '神经影像', paperIds: ['paper-001'] },
    'method-eeg': { nodeId: 'method-eeg', nodeType: 'method', methodType: '电生理', paperIds: ['paper-003'] },
    'method-network-analysis': { nodeId: 'method-network-analysis', nodeType: 'method', methodType: '网络科学', paperIds: ['paper-002', 'paper-005'] },
    'author-li-ming': { nodeId: 'author-li-ming', nodeType: 'author', orcid: '0000-0002-1825-0097', affiliations: ['研知大学认知科学中心'], paperIds: ['paper-001', 'paper-002'] },
    'author-wang-fang': { nodeId: 'author-wang-fang', nodeType: 'author', orcid: '0000-0003-1415-9265', affiliations: ['研知大学计算神经科学实验室'], paperIds: ['paper-001', 'paper-002'] },
    'author-chen-wei': { nodeId: 'author-chen-wei', nodeType: 'author', orcid: '0000-0001-6748-3647', affiliations: ['研知大学脑科学学院'], paperIds: ['paper-002', 'paper-003'] },
    'author-zhao-jing': { nodeId: 'author-zhao-jing', nodeType: 'author', orcid: null, affiliations: ['研知大学脑科学学院'], paperIds: ['paper-003'] },
    'author-zhou-ning': { nodeId: 'author-zhou-ning', nodeType: 'author', orcid: '0000-0002-7182-8182', affiliations: ['研知大学人工智能学院'], paperIds: ['paper-004'] },
    'author-sun-yue': { nodeId: 'author-sun-yue', nodeType: 'author', orcid: '0000-0002-4590-4498', affiliations: ['研知大学人工智能学院'], paperIds: ['paper-004'] },
    'author-wu-lan': { nodeId: 'author-wu-lan', nodeType: 'author', orcid: null, affiliations: ['开放科学研究中心'], paperIds: ['paper-005'] },
  },
})

export const methodGraphMock: GraphDataset = withDerivedMetrics({
  view: 'method',
  nodes: [
    { id: 'paper-001', nodeType: 'paper', label: sharedPapers['paper-001'].title, description: sharedPapers['paper-001'].journal?.name ?? null, sourcePaperIds: ['paper-001'], metrics: { connectionCount: 2 } },
    { id: 'paper-002', nodeType: 'paper', label: sharedPapers['paper-002'].title, description: sharedPapers['paper-002'].journal?.name ?? null, sourcePaperIds: ['paper-002'], metrics: { connectionCount: 2 } },
    { id: 'paper-003', nodeType: 'paper', label: sharedPapers['paper-003'].title, description: sharedPapers['paper-003'].journal?.name ?? null, sourcePaperIds: ['paper-003'], metrics: { connectionCount: 1 } },
    { id: 'paper-004', nodeType: 'paper', label: sharedPapers['paper-004'].title, description: sharedPapers['paper-004'].journal?.name ?? null, sourcePaperIds: ['paper-004'], metrics: { connectionCount: 1 } },
    { id: 'paper-005', nodeType: 'paper', label: sharedPapers['paper-005'].title, description: sharedPapers['paper-005'].journal?.name ?? null, sourcePaperIds: ['paper-005'], metrics: { connectionCount: 1 } },
    ...methodNodes,
  ],
  edges: [
    { id: 'edge-paper-reversal-fmri', sourceId: 'paper-001', targetId: 'method-fmri', relationType: 'uses', label: '使用', directed: true, weight: null, evidenceIds: [], sourcePaperIds: ['paper-001'] },
    { id: 'edge-paper-network-rl', sourceId: 'paper-002', targetId: 'method-rl-model', relationType: 'uses', label: '使用', directed: true, weight: null, evidenceIds: ['evidence-method'], sourcePaperIds: ['paper-002'] },
    { id: 'edge-paper-network-analysis', sourceId: 'paper-002', targetId: 'method-network-analysis', relationType: 'uses', label: '使用', directed: true, weight: null, evidenceIds: ['evidence-method'], sourcePaperIds: ['paper-002'] },
    { id: 'edge-paper-eeg-eeg', sourceId: 'paper-003', targetId: 'method-eeg', relationType: 'uses', label: '使用', directed: true, weight: null, evidenceIds: [], sourcePaperIds: ['paper-003'] },
    { id: 'edge-paper-model-rl', sourceId: 'paper-004', targetId: 'method-rl-model', relationType: 'uses', label: '使用', directed: true, weight: null, evidenceIds: [], sourcePaperIds: ['paper-004'] },
    { id: 'edge-paper-preprint-network', sourceId: 'paper-005', targetId: 'method-network-analysis', relationType: 'uses', label: '使用', directed: true, weight: null, evidenceIds: [], sourcePaperIds: ['paper-005'] },
  ],
  contextOverlay: { nodes: [], edges: [] },
  evidence: methodEvidence,
  papers: sharedPapers,
  relatedNodeLabels: sharedNodeLabels,
  nodeDetails: {
    'paper-001': { nodeId: 'paper-001', nodeType: 'paper', paperId: 'paper-001', conceptIds: ['concept-reversal-learning', 'concept-cognitive-control'], methodIds: ['method-fmri'], findingSummaries: ['反转阶段的认知控制信号增强。'] },
    'paper-002': { nodeId: 'paper-002', nodeType: 'paper', paperId: 'paper-002', conceptIds: ['concept-reversal-learning', 'concept-value-updating'], methodIds: ['method-rl-model', 'method-network-analysis'], findingSummaries: ['网络状态反映价值更新。'] },
    'paper-003': { nodeId: 'paper-003', nodeType: 'paper', paperId: 'paper-003', conceptIds: ['concept-decision-making'], methodIds: ['method-eeg'], findingSummaries: ['EEG 指标预测适应性决策。'] },
    'paper-004': { nodeId: 'paper-004', nodeType: 'paper', paperId: 'paper-004', conceptIds: ['concept-reinforcement-learning'], methodIds: ['method-rl-model'], findingSummaries: ['层级模型解释策略更新。'] },
    'paper-005': { nodeId: 'paper-005', nodeType: 'paper', paperId: 'paper-005', conceptIds: ['concept-decision-making'], methodIds: ['method-network-analysis'], findingSummaries: ['数据集支持可重复任务切换研究。'] },
    'method-rl-model': { nodeId: 'method-rl-model', nodeType: 'method', methodType: '计算建模', paperIds: ['paper-002', 'paper-004'] },
    'method-fmri': { nodeId: 'method-fmri', nodeType: 'method', methodType: '神经影像', paperIds: ['paper-001'] },
    'method-eeg': { nodeId: 'method-eeg', nodeType: 'method', methodType: '电生理', paperIds: ['paper-003'] },
    'method-network-analysis': { nodeId: 'method-network-analysis', nodeType: 'method', methodType: '网络科学', paperIds: ['paper-002', 'paper-005'] },
  },
})

export const authorGraphMock: GraphDataset = withDerivedMetrics({
  view: 'author',
  nodes: authorNodes,
  edges: buildCoauthorEdges(authorNodes, sharedPapers),
  contextOverlay: {
    nodes: [...conceptNodes, ...methodNodes],
    edges: [
      ...buildAuthorContextEdges(conceptNodes, 'authorConcept'),
      ...buildAuthorContextEdges(methodNodes, 'authorMethod'),
    ],
  },
  evidence: [],
  papers: sharedPapers,
  relatedNodeLabels: sharedNodeLabels,
  nodeDetails: {
    'author-li-ming': { nodeId: 'author-li-ming', nodeType: 'author', orcid: '0000-0002-1825-0097', affiliations: ['研知大学认知科学中心'], paperIds: ['paper-001', 'paper-002'] },
    'author-wang-fang': { nodeId: 'author-wang-fang', nodeType: 'author', orcid: '0000-0003-1415-9265', affiliations: ['研知大学计算神经科学实验室'], paperIds: ['paper-001', 'paper-002'] },
    'author-chen-wei': { nodeId: 'author-chen-wei', nodeType: 'author', orcid: '0000-0001-6748-3647', affiliations: ['研知大学脑科学学院'], paperIds: ['paper-002', 'paper-003'] },
    'author-zhao-jing': { nodeId: 'author-zhao-jing', nodeType: 'author', orcid: null, affiliations: ['研知大学脑科学学院'], paperIds: ['paper-003'] },
    'author-zhou-ning': { nodeId: 'author-zhou-ning', nodeType: 'author', orcid: '0000-0002-7182-8182', affiliations: ['研知大学人工智能学院'], paperIds: ['paper-004'] },
    'author-sun-yue': { nodeId: 'author-sun-yue', nodeType: 'author', orcid: '0000-0002-4590-4498', affiliations: ['研知大学人工智能学院'], paperIds: ['paper-004'] },
    'author-wu-lan': { nodeId: 'author-wu-lan', nodeType: 'author', orcid: null, affiliations: ['开放科学研究中心'], paperIds: ['paper-005'] },
    'concept-learning': { nodeId: 'concept-learning', nodeType: 'concept', aliases: [], broaderConceptIds: [], narrowerConceptIds: ['concept-reversal-learning'], relatedConceptIds: [], paperIds: ['paper-001', 'paper-004'] },
    'concept-reversal-learning': { nodeId: 'concept-reversal-learning', nodeType: 'concept', aliases: ['概率反转学习'], broaderConceptIds: ['concept-learning'], narrowerConceptIds: [], relatedConceptIds: ['concept-cognitive-control', 'concept-value-updating'], paperIds: ['paper-001', 'paper-002'] },
    'concept-cognitive-control': { nodeId: 'concept-cognitive-control', nodeType: 'concept', aliases: [], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-reversal-learning'], paperIds: ['paper-001'] },
    'concept-value-updating': { nodeId: 'concept-value-updating', nodeType: 'concept', aliases: [], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-reversal-learning'], paperIds: ['paper-002'] },
    'concept-decision-making': { nodeId: 'concept-decision-making', nodeType: 'concept', aliases: ['决策制定'], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-reinforcement-learning'], paperIds: ['paper-003', 'paper-005'] },
    'concept-reinforcement-learning': { nodeId: 'concept-reinforcement-learning', nodeType: 'concept', aliases: ['RL'], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: ['concept-decision-making'], paperIds: ['paper-004'] },
    'method-rl-model': { nodeId: 'method-rl-model', nodeType: 'method', methodType: '计算建模', paperIds: ['paper-002', 'paper-004'] },
    'method-fmri': { nodeId: 'method-fmri', nodeType: 'method', methodType: '神经影像', paperIds: ['paper-001'] },
    'method-eeg': { nodeId: 'method-eeg', nodeType: 'method', methodType: '电生理', paperIds: ['paper-003'] },
    'method-network-analysis': { nodeId: 'method-network-analysis', nodeType: 'method', methodType: '网络科学', paperIds: ['paper-002', 'paper-005'] },
  },
})

export const paperGraphMock: GraphDataset = withDerivedMetrics({
  view: 'paper',
  nodes: Object.values(sharedPapers).map((paper) => ({ id: paper.id, nodeType: 'paper', label: paper.title, description: paper.journal?.name ?? '预印本', sourcePaperIds: [paper.id], metrics: { connectionCount: 1 } })),
  edges: [
    { id: 'edge-paper-reversal-network', sourceId: 'paper-001', targetId: 'paper-002', relationType: 'cites', label: '引用', directed: true, weight: null, evidenceIds: ['evidence-citation-001-002'], sourcePaperIds: ['paper-001'] },
    { id: 'edge-paper-network-eeg', sourceId: 'paper-002', targetId: 'paper-003', relationType: 'cites', label: '引用', directed: true, weight: null, evidenceIds: ['evidence-citation-002-003'], sourcePaperIds: ['paper-002'] },
    { id: 'edge-paper-eeg-model', sourceId: 'paper-003', targetId: 'paper-004', relationType: 'cites', label: '引用', directed: true, weight: null, evidenceIds: [], sourcePaperIds: ['paper-003'] },
  ],
  contextOverlay: {
    nodes: conceptNodes,
    edges: buildPaperContextEdges(sharedPapers),
  },
  evidence: paperEvidence,
  papers: sharedPapers,
  relatedNodeLabels: sharedNodeLabels,
  nodeDetails: {
    ...Object.fromEntries(
      conceptNodes.map((node) => [node.id, conceptGraphMock.nodeDetails[node.id]]),
    ),
    'paper-001': { nodeId: 'paper-001', nodeType: 'paper', paperId: 'paper-001', conceptIds: ['concept-reversal-learning', 'concept-cognitive-control'], methodIds: ['method-fmri'], findingSummaries: ['反转阶段的认知控制信号增强。'] },
    'paper-002': { nodeId: 'paper-002', nodeType: 'paper', paperId: 'paper-002', conceptIds: ['concept-reversal-learning', 'concept-value-updating'], methodIds: ['method-rl-model', 'method-network-analysis'], findingSummaries: ['网络状态反映价值更新。'] },
    'paper-003': { nodeId: 'paper-003', nodeType: 'paper', paperId: 'paper-003', conceptIds: ['concept-decision-making'], methodIds: ['method-eeg'], findingSummaries: ['EEG 指标预测适应性决策。'] },
    'paper-004': { nodeId: 'paper-004', nodeType: 'paper', paperId: 'paper-004', conceptIds: ['concept-reinforcement-learning'], methodIds: ['method-rl-model'], findingSummaries: ['层级模型解释策略更新。'] },
    'paper-005': { nodeId: 'paper-005', nodeType: 'paper', paperId: 'paper-005', conceptIds: ['concept-decision-making'], methodIds: ['method-network-analysis'], findingSummaries: ['数据集支持可重复任务切换研究。'] },
  },
})

export const graphMocks: Record<GraphView, GraphDataset> = {
  concept: conceptGraphMock,
  method: methodGraphMock,
  author: authorGraphMock,
  paper: paperGraphMock,
}
