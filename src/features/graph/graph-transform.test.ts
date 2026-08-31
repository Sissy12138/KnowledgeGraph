import { describe, expect, it } from 'vitest'
import { authorGraphMock, conceptGraphMock, methodGraphMock, paperGraphMock } from './graph.mock'
import {
  buildGraphOption,
  findMatchingNodes,
  sortGraphPapers,
  type GraphPresentation,
  type GraphPaperSort,
} from './graph-transform'
import type { GraphPaperSummary } from './graph.types'

type GraphSeries = {
  type: string
  layout: string
  roam: boolean
  draggable: boolean
  data: Array<{
    id: string
    category: string
    symbolSize: number
    itemStyle: { color: string; opacity: number; borderColor?: string; borderWidth?: number }
    label: {
      show: boolean
      formatter: string
      color: string
      fontFamily: string
      fontSize: number
      width?: number
      overflow?: string
    }
  }>
  links: Array<{
    id: string
    source: string
    target: string
    lineStyle: { color: string; width: number; type?: string; opacity: number }
    symbol: [string, string]
  }>
  categories: Array<{ name: string; itemStyle: { color: string } }>
}

function presentation(overrides: Partial<GraphPresentation> = {}): GraphPresentation {
  return {
    selected: null,
    selectedPaperIds: [],
    highlightedNodeIds: new Set(),
    isSearchActive: false,
    contextConceptId: null,
    contextAuthorId: null,
    showRelatedAuthors: false,
    showRelatedConcepts: false,
    showRelatedMethods: false,
    themeId: 'softResearch',
    fontScalePercent: 100,
    ...overrides,
  }
}

function getGraphSeries(option: ReturnType<typeof buildGraphOption>): GraphSeries {
  const series = option.series
  if (!Array.isArray(series)) throw new Error('Expected graph series array')
  return series[0] as unknown as GraphSeries
}

function getLink(links: GraphSeries['links'], id: string): GraphSeries['links'][number] {
  const link = links.find((candidate) => candidate.id === id)
  if (!link) throw new Error(`Missing link: ${id}`)
  return link
}

const papers: GraphPaperSummary[] = [
  {
    id: 'paper-low-jif',
    title: 'Low JIF',
    authorNames: [],
    year: 2022,
    journal: { name: 'Journal A', impactFactor: 2.4, impactFactorYear: 2024, jcrQuartile: 'Q3' },
  },
  {
    id: 'paper-no-jif',
    title: 'No JIF',
    authorNames: [],
    year: 2025,
    journal: null,
  },
  {
    id: 'paper-high-jif',
    title: 'High JIF',
    authorNames: [],
    year: 2024,
    journal: { name: 'Journal B', impactFactor: 18.6, impactFactorYear: 2024, jcrQuartile: 'Q1' },
  },
]

describe('graph transforms', () => {
  it.each([
    ['方法网络', methodGraphMock],
    ['文献引用网络', paperGraphMock],
  ])('%s中的论文节点显示第一作者、期刊和年份的换行短引用', (_, dataset) => {
    const graph = getGraphSeries(buildGraphOption(dataset, presentation()))
    const paper = graph.data.find((node) => node.id === 'paper-001')

    expect(paper?.label.formatter).toBe('李明\nNature Neuroscience · 2025')
    expect(paper?.label.width).toBe(144)
    expect(paper?.label.overflow).toBe('break')
  })

  it('论文节点悬停卡使用英文分栏展示完整标题、作者、期刊和年份', () => {
    const option = buildGraphOption(paperGraphMock, presentation())
    const tooltip = option.tooltip as {
      className: string
      formatter: (params: { dataType: string; data: { id: string }; name: string }) => string
    }
    const card = tooltip.formatter({
      dataType: 'node',
      data: { id: 'paper-001' },
      name: '不应使用短标签代替完整信息',
    })

    expect(tooltip.className).toBe('graph-tooltip')
    expect(card).toContain('PAPER')
    expect(card).toContain('反转学习中的认知灵活性与前额叶活动')
    expect(card).toContain('AUTHORS')
    expect(card).toContain('李明, 王芳')
    expect(card).toContain('JOURNAL')
    expect(card).toContain('Nature Neuroscience')
    expect(card).toContain('YEAR')
    expect(card).toContain('2025')
  })

  it('非论文节点仍使用带高对比背景的紧凑悬浮提示', () => {
    const option = buildGraphOption(methodGraphMock, presentation())
    const tooltip = option.tooltip as {
      formatter: (params: { dataType: string; data: { id: string }; name: string }) => string
    }

    expect(tooltip.formatter({
      dataType: 'node',
      data: { id: 'method-fmri' },
      name: '功能磁共振',
    })).toBe(
      '<div class="graph-paper-tooltip graph-paper-tooltip--compact">功能磁共振</div>',
    )
  })

  it('搜索大小写不敏感且不修改数据集', () => {
    const dataset = {
      ...conceptGraphMock,
      nodes: [
        ...conceptGraphMock.nodes,
        { ...conceptGraphMock.nodes[0], id: 'concept-english', label: 'Reversal Learning' },
      ],
    }
    const originalNodeIds = dataset.nodes.map((node) => node.id)

    const matches = findMatchingNodes(dataset, 'learning')

    expect(matches.map((node) => node.id)).toContain('concept-english')
    expect(dataset.nodes.map((node) => node.id)).toEqual(originalNodeIds)
  })

  it('JIF 降序并把缺失值放在末尾', () => {
    const result = sortGraphPapers(papers, 'journalImpactFactor')

    expect(result.map((paper) => paper.id)).toEqual([
      'paper-high-jif',
      'paper-low-jif',
      'paper-no-jif',
    ])
    expect(papers.map((paper) => paper.id)).toEqual([
      'paper-low-jif',
      'paper-no-jif',
      'paper-high-jif',
    ])
  })

  it('年份排序以 JIF 和论文 ID 作为稳定的次级排序', () => {
    const result = sortGraphPapers(
      [
        ...papers,
        {
          id: 'paper-same-year-low-jif',
          title: 'Same year low JIF',
          authorNames: [],
          year: 2024,
          journal: { name: 'Journal C', impactFactor: 4.3, impactFactorYear: 2024, jcrQuartile: 'Q2' },
        },
      ],
      'year' satisfies GraphPaperSort,
    )

    expect(result.map((paper) => paper.id)).toEqual([
      'paper-no-jif',
      'paper-high-jif',
      'paper-same-year-low-jif',
      'paper-low-jif',
    ])
  })

  it('作者合作边宽随 weight 增加且有上限', () => {
    const option = buildGraphOption(authorGraphMock, presentation())
    const links = getGraphSeries(option).links

    expect(
      getLink(links, 'edge-author-li-ming-author-wang-fang').lineStyle.width,
    ).toBe(4)
    expect(
      getLink(links, 'edge-author-chen-wei-author-wang-fang').lineStyle.width,
    ).toBe(3)
  })

  it('保留所有节点，并降低未命中节点的透明度', () => {
    const option = buildGraphOption(conceptGraphMock, presentation({
      highlightedNodeIds: new Set(['concept-reversal-learning']),
      isSearchActive: true,
    }))
    const nodes = getGraphSeries(option).data

    expect(nodes).toHaveLength(conceptGraphMock.nodes.length)
    expect(nodes.find((node) => node.id === 'concept-reversal-learning')?.itemStyle.opacity).toBe(1)
    expect(nodes.find((node) => node.id === 'concept-learning')?.itemStyle.opacity).toBe(0.22)
  })

  it('搜索无匹配时降低全部节点的透明度', () => {
    const option = buildGraphOption(conceptGraphMock, presentation({ isSearchActive: true }))

    expect(getGraphSeries(option).data.every((node) => node.itemStyle.opacity === 0.22)).toBe(true)
  })

  it('生成可缩放、可拖动的力导向图，并给有向边设置箭头', () => {
    const option = buildGraphOption(conceptGraphMock, presentation({
      selected: { kind: 'node', id: 'concept-reversal-learning' },
      contextConceptId: 'concept-reversal-learning',
    }))
    const graph = getGraphSeries(option)
    const selected = graph.data.find((node) => node.id === 'concept-reversal-learning')
    const directed = getLink(graph.links, 'edge-concept-learning-reversal')

    expect(graph.type).toBe('graph')
    expect(graph.layout).toBe('force')
    expect(graph.roam).toBe(true)
    expect(graph.draggable).toBe(true)
    expect(directed.symbol).toEqual(['none', 'arrow'])
    expect(selected?.symbolSize).toBeGreaterThanOrEqual(28)
    expect(selected?.symbolSize).toBeLessThanOrEqual(60)
    expect(selected?.itemStyle.borderColor).toBe('#FFFFFF')
    expect(selected?.itemStyle.borderWidth).toBe(5)
  })

  it('图例只包含可见节点类型，且图例和概念节点使用同一颜色', () => {
    const option = buildGraphOption(conceptGraphMock, presentation())
    const graph = getGraphSeries(option)
    const legend = option.legend as { data: string[] }
    const conceptCategory = graph.categories.find((category) => category.name === '概念')
    const conceptNode = graph.data.find((node) => node.id === 'concept-learning')

    expect(legend.data).toEqual(['概念'])
    expect(legend.data).not.toContain('发现')
    expect(conceptCategory?.itemStyle.color).toBe(conceptNode?.itemStyle.color)
  })

  it('从主题读取节点、图例与连线样式，并按百分比缩放文字', () => {
    const graph = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      themeId: 'softResearch',
      fontScalePercent: 125,
    })))
    const concept = graph.data.find((node) => node.id === 'concept-learning')

    expect(concept?.itemStyle.color).toBe('#AEEBE7')
    expect(concept?.label.color).toBe('#111827')
    expect(concept?.label.fontFamily).toBe('Inter, "Segoe UI", "Microsoft YaHei", sans-serif')
    expect(concept?.label.fontSize).toBe(15)
    expect(graph.categories.find((item) => item.name === '概念')?.itemStyle.color).toBe('#AEEBE7')
    expect(graph.links[0].lineStyle.color).toBe('#94A3B8')
  })

  it('不同主题只改变视觉，不改变图谱数据 ID 与节点大小', () => {
    const soft = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      themeId: 'softResearch',
      fontScalePercent: 100,
    })))
    const warm = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      themeId: 'warmPaper',
      fontScalePercent: 125,
    })))

    expect(warm.data.map((node) => node.id)).toEqual(soft.data.map((node) => node.id))
    expect(warm.data[0].itemStyle.color).not.toBe(soft.data[0].itemStyle.color)
    expect(warm.data.map((node) => node.symbolSize)).toEqual(soft.data.map((node) => node.symbolSize))
  })

  it('选择概念后只保持锚点和直接相邻概念为完整不透明度', () => {
    const graph = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      selected: { kind: 'node', id: 'concept-reversal-learning' },
      contextConceptId: 'concept-reversal-learning',
    })))
    const opacityById = new Map(graph.data.map((node) => [node.id, node.itemStyle.opacity]))

    expect(opacityById.get('concept-reversal-learning')).toBe(1)
    expect(opacityById.get('concept-learning')).toBe(1)
    expect(opacityById.get('concept-cognitive-control')).toBe(1)
    expect(opacityById.get('concept-value-updating')).toBe(1)
    expect(opacityById.get('concept-decision-making')).toBe(0.18)
    expect(opacityById.get('concept-reinforcement-learning')).toBe(0.18)
  })

  it('概念上下文开关打开时直接相邻概念也变淡，只突出锚点和展开节点', () => {
    const graph = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      selected: { kind: 'node', id: 'concept-reversal-learning' },
      contextConceptId: 'concept-reversal-learning',
      showRelatedAuthors: true,
    })))
    const opacityById = new Map(graph.data.map((node) => [node.id, node.itemStyle.opacity]))

    expect(opacityById.get('concept-reversal-learning')).toBe(1)
    expect(opacityById.get('author-li-ming')).toBe(1)
    expect(opacityById.get('concept-learning')).toBe(0.18)
    expect(opacityById.get('concept-cognitive-control')).toBe(0.18)
    expect(opacityById.get('concept-value-updating')).toBe(0.18)
  })

  it.each([
    ['作者', true, false, ['author-li-ming', 'author-wang-fang', 'author-chen-wei'], 'conceptAuthor'],
    ['方法', false, true, ['method-fmri', 'method-rl-model', 'method-network-analysis'], 'conceptMethod'],
  ] as const)('只打开相关%s时显示对应节点和虚线上下文边', (_, showAuthors, showMethods, expectedIds, relationType) => {
    const option = buildGraphOption(conceptGraphMock, presentation({
      contextConceptId: 'concept-reversal-learning',
      showRelatedAuthors: showAuthors,
      showRelatedMethods: showMethods,
    }))
    const graph = getGraphSeries(option)
    const primaryIds = new Set(conceptGraphMock.nodes.map((node) => node.id))
    const contextIds = graph.data.filter((node) => !primaryIds.has(node.id)).map((node) => node.id)
    const contextLinks = graph.links.filter((link) => link.id.startsWith('edge-context-'))

    expect(contextIds.sort()).toEqual([...expectedIds].sort())
    expect(contextLinks).toHaveLength(expectedIds.length)
    expect(contextLinks.every((link) => link.source === 'concept-reversal-learning')).toBe(true)
    expect(contextLinks.every((link) => link.lineStyle.type === 'dashed')).toBe(true)
    expect(contextLinks.every((link) => link.id.includes(relationType === 'conceptAuthor' ? 'author-' : 'method-'))).toBe(true)
  })

  it('同时打开两个开关时合并作者与方法，并随概念锚点切换', () => {
    const first = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      contextConceptId: 'concept-reversal-learning',
      showRelatedAuthors: true,
      showRelatedMethods: true,
    })))
    const second = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      contextConceptId: 'concept-decision-making',
      showRelatedAuthors: true,
      showRelatedMethods: true,
    })))

    expect(first.data.some((node) => node.id === 'author-li-ming')).toBe(true)
    expect(first.data.some((node) => node.id === 'method-fmri')).toBe(true)
    expect(second.data.some((node) => node.id === 'author-zhao-jing')).toBe(true)
    expect(second.data.some((node) => node.id === 'method-eeg')).toBe(true)
    expect(second.data.some((node) => node.id === 'author-li-ming')).toBe(false)
  })

  it('作者上下文开关按选中作者的论文展开概念和方法，并让其他作者与合作边变淡', () => {
    const graph = getGraphSeries(buildGraphOption(authorGraphMock, presentation({
      selected: { kind: 'node', id: 'author-li-ming' },
      contextAuthorId: 'author-li-ming',
      showRelatedConcepts: true,
      showRelatedMethods: true,
    })))
    const opacityById = new Map(graph.data.map((node) => [node.id, node.itemStyle.opacity]))
    const contextIds = graph.data
      .filter((node) => node.category !== '作者')
      .map((node) => node.id)

    expect(contextIds.sort()).toEqual([
      'concept-cognitive-control',
      'concept-learning',
      'concept-reversal-learning',
      'concept-value-updating',
      'method-fmri',
      'method-network-analysis',
      'method-rl-model',
    ])
    expect(opacityById.get('author-li-ming')).toBe(1)
    expect(opacityById.get('concept-learning')).toBe(1)
    expect(opacityById.get('method-fmri')).toBe(1)
    expect(opacityById.get('author-wang-fang')).toBe(0.18)
    expect(graph.links.find((link) => link.id === 'edge-author-li-ming-author-wang-fang')?.lineStyle.opacity).toBe(0.12)
  })

  it('文献引用图合并多个选中论文的相关概念，并只突出选择并集中的节点与边', () => {
    const paperPresentation = {
      ...presentation({ showRelatedConcepts: true }),
      selectedPaperIds: ['paper-001', 'paper-002'],
    } as GraphPresentation
    const graph = getGraphSeries(buildGraphOption(paperGraphMock, paperPresentation))
    const opacityById = new Map(graph.data.map((node) => [node.id, node.itemStyle.opacity]))
    const conceptIds = graph.data
      .filter((node) => node.category === '概念')
      .map((node) => node.id)

    expect(conceptIds.sort()).toEqual([
      'concept-cognitive-control',
      'concept-learning',
      'concept-reversal-learning',
      'concept-value-updating',
    ])
    expect(opacityById.get('paper-001')).toBe(1)
    expect(opacityById.get('paper-002')).toBe(1)
    expect(opacityById.get('paper-003')).toBe(0.18)
    expect(opacityById.get('concept-reversal-learning')).toBe(1)
    expect(graph.links.filter((link) => link.id.startsWith('edge-context-paper-'))).toHaveLength(5)
    expect(graph.links.find((link) => link.id === 'edge-paper-network-eeg')?.lineStyle.opacity)
      .toBe(0.12)
  })

  it('作者节点按总 JIF 平方根缩放到 20–60，最小节点只在悬停时显示姓名', () => {
    const graph = getGraphSeries(buildGraphOption(authorGraphMock, presentation({
      fontScalePercent: 125,
    })))
    const byId = new Map(graph.data.map((node) => [node.id, node]))

    expect(byId.get('author-li-ming')?.symbolSize).toBe(60)
    expect(byId.get('author-wu-lan')?.symbolSize).toBe(20)
    expect(byId.get('author-wu-lan')?.label.show).toBe(false)
    expect(byId.get('author-chen-wei')?.symbolSize).toBeGreaterThan(20)
    expect(byId.get('author-chen-wei')?.symbolSize).toBeLessThan(60)
    expect(byId.get('author-chen-wei')?.label.show).toBe(true)
  })

  it('作者总 JIF 为负值时按零处理，避免生成无效节点尺寸', () => {
    const dataset = {
      ...authorGraphMock,
      nodes: authorGraphMock.nodes.map((node) => node.id === 'author-wu-lan'
        ? { ...node, metrics: { ...node.metrics, totalImpactFactor: -3 } }
        : node),
    }
    const graph = getGraphSeries(buildGraphOption(dataset, presentation()))
    const node = graph.data.find((candidate) => candidate.id === 'author-wu-lan')

    expect(node?.symbolSize).toBe(20)
    expect(Number.isFinite(node?.symbolSize)).toBe(true)
  })

  it('概念关系图按去重关联论文数使用固定平方根公式缩放主概念节点', () => {
    const graph = getGraphSeries(buildGraphOption(conceptGraphMock, presentation()))
    const byId = new Map(graph.data.map((node) => [node.id, node.symbolSize]))

    expect(byId.get('concept-cognitive-control')).toBe(36)
    expect(byId.get('concept-learning')).toBeCloseTo(39.31, 2)
  })

  it('作者图的相关概念和方法按与当前作者共同涉及的去重论文数缩放', () => {
    const graph = getGraphSeries(buildGraphOption(authorGraphMock, presentation({
      contextAuthorId: 'author-li-ming',
      showRelatedConcepts: true,
      showRelatedMethods: true,
    })))
    const byId = new Map(graph.data.map((node) => [node.id, node.symbolSize]))

    expect(byId.get('concept-reversal-learning')).toBeCloseTo(33.31, 2)
    expect(byId.get('concept-cognitive-control')).toBe(30)
    expect(byId.get('method-fmri')).toBe(30)
    expect(byId.get('method-rl-model')).toBe(30)
  })

  it('文献引用图按单篇论文 JIF 缩放，缺失 JIF 使用最小尺寸', () => {
    const graph = getGraphSeries(buildGraphOption(paperGraphMock, presentation()))
    const byId = new Map(graph.data.map((node) => [node.id, node.symbolSize]))

    expect(byId.get('paper-001')).toBe(58)
    expect(byId.get('paper-004')).toBeCloseTo(40.44, 2)
    expect(byId.get('paper-005')).toBe(28)
  })

  it('不改变概念图上下文、方法网络论文和引用图相关概念的原有尺寸', () => {
    const concept = getGraphSeries(buildGraphOption(conceptGraphMock, presentation({
      contextConceptId: 'concept-reversal-learning',
      showRelatedAuthors: true,
      showRelatedMethods: true,
    })))
    const method = getGraphSeries(buildGraphOption(methodGraphMock, presentation()))
    const paper = getGraphSeries(buildGraphOption(paperGraphMock, presentation({
      selectedPaperIds: ['paper-001'],
      showRelatedConcepts: true,
    })))

    expect(concept.data.find((node) => node.id === 'author-li-ming')?.symbolSize).toBe(36)
    expect(concept.data.find((node) => node.id === 'method-rl-model')?.symbolSize).toBe(36)
    expect(method.data.find((node) => node.id === 'paper-001')?.symbolSize).toBe(32)
    expect(paper.data.find((node) => node.id === 'concept-learning')?.symbolSize).toBe(44)
  })
})
