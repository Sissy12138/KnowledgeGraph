import { describe, expect, it, vi } from 'vitest'
import { getPaperDetail, getPapers } from '../papers/paper.service'
import { getGraphDataset } from './graph.service'
import type { GraphView } from './graph.types'

const graphViews: GraphView[] = ['concept', 'method', 'author', 'paper']

describe('getGraphDataset', () => {
  it('API 模式从 A 获取真实图谱响应并转换为页面数据集', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'paper-api', title: 'API 论文', authors: [], year: 2025, doi: null, journal: null, status: 'unprocessed', latestJobId: null, pendingSuggestionCount: 0, createdAt: '', updatedAt: '' }], page: 1, pageSize: 100, total: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nodes: [{ id: 'paper-api', nodeType: 'paper', label: 'API 论文', englishLabel: 'API Paper', description: null, sourcePaperIds: ['paper-api'], createdAt: '', updatedAt: '' }],
        edges: [], evidence: [], meta: { focusNodeId: 'paper-api', depth: 2, nodeCount: 1, edgeCount: 0, totalMatched: 1, truncated: false },
      }), { status: 200 })),
    )
    const result = await getGraphDataset('paper')
    expect(result.nodes[0]).toMatchObject({ id: 'paper-api', label: 'API 论文', englishLabel: 'API Paper' })
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('API 模式为概念生成基于共同论文的作者和方法叠加层', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: 'paper-api', title: 'API 论文', authors: [], year: 2025, doi: null, journal: null, status: 'completed', latestJobId: null, pendingSuggestionCount: 0, createdAt: '', updatedAt: '' }],
        page: 1, pageSize: 100, total: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nodes: [
          { id: 'paper-api', nodeType: 'paper', label: 'API 论文', description: null, sourcePaperIds: ['paper-api'], createdAt: '', updatedAt: '' },
          { id: 'concept-api', nodeType: 'concept', label: '测试概念', description: null, sourcePaperIds: ['paper-api'], createdAt: '', updatedAt: '' },
          { id: 'author-api', nodeType: 'author', label: '测试作者', description: null, sourcePaperIds: ['paper-api'], createdAt: '', updatedAt: '' },
          { id: 'method-api', nodeType: 'method', label: '测试方法', description: null, sourcePaperIds: ['paper-api'], createdAt: '', updatedAt: '' },
        ],
        edges: [], evidence: [], meta: { focusNodeId: null, depth: null, nodeCount: 4, edgeCount: 0, totalMatched: 4, truncated: false },
      }), { status: 200 })),
    )

    const result = await getGraphDataset('concept')

    expect(result.contextOverlay.nodes.map((node) => node.id).sort()).toEqual(['author-api', 'method-api'])
    expect(result.contextOverlay.edges.map((edge) => edge.relationType).sort()).toEqual(['conceptAuthor', 'conceptMethod'])
    expect(result.nodeDetails['author-api'].nodeType).toBe('author')
    expect(result.nodeDetails['method-api'].nodeType).toBe('method')
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('按 Zotero 文件夹同时过滤论文和图谱节点，并保留全部文件夹选项', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const paperBase = {
      authors: [], year: 2026, doi: null, journal: null, status: 'completed',
      latestJobId: null, pendingSuggestionCount: 0, createdAt: '', updatedAt: '',
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          { ...paperBase, id: 'paper-a', title: '论文 A', zoteroCollections: [{ key: 'folder-a', name: '文件夹 A' }] },
          { ...paperBase, id: 'paper-b', title: '论文 B', zoteroCollections: [{ key: 'folder-b', name: '文件夹 B' }] },
        ],
        page: 1, pageSize: 100, total: 2,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nodes: [
          { id: 'paper-a', nodeType: 'paper', label: '论文 A', description: null, sourcePaperIds: ['paper-a'], createdAt: '', updatedAt: '' },
          { id: 'paper-b', nodeType: 'paper', label: '论文 B', description: null, sourcePaperIds: ['paper-b'], createdAt: '', updatedAt: '' },
          { id: 'concept-a', nodeType: 'concept', label: '概念 A', description: null, sourcePaperIds: ['paper-a'], createdAt: '', updatedAt: '' },
          { id: 'concept-b', nodeType: 'concept', label: '概念 B', description: null, sourcePaperIds: ['paper-b'], createdAt: '', updatedAt: '' },
        ],
        edges: [], evidence: [], meta: { focusNodeId: null, depth: null, nodeCount: 4, edgeCount: 0, totalMatched: 4, truncated: false },
      }), { status: 200 })),
    )

    const result = await getGraphDataset('concept', 'success', { collectionKey: 'folder-a' })

    expect(result.nodes.map((node) => node.id)).toEqual(['concept-a'])
    expect(Object.keys(result.papers)).toEqual(['paper-a'])
    expect(result.collections?.map((collection) => collection.key)).toEqual(['folder-a', 'folder-b'])
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  it('返回具有稳定节点和关系的概念网络', async () => {
    const result = await getGraphDataset('concept')

    expect(result.view).toBe('concept')
    expect(result.nodes.some((node) => node.id === 'concept-reversal-learning')).toBe(true)
    expect(result.edges.some((edge) => edge.relationType === 'broaderThan')).toBe(true)
    expect(result.nodeDetails['concept-reversal-learning'].nodeType).toBe('concept')
  })

  it('概念网络只保留概念及概念之间的关系', async () => {
    const result = await getGraphDataset('concept')

    expect(result.nodes.every((node) => node.nodeType === 'concept')).toBe(true)
    expect(result.edges.every((edge) => ['broaderThan', 'relatedTo', 'coOccurs'].includes(edge.relationType))).toBe(true)
    expect(result.contextOverlay.nodes.every((node) =>
      node.nodeType === 'author' || node.nodeType === 'method',
    )).toBe(true)
    expect(result.contextOverlay.edges.every((edge) =>
      edge.relationType === 'conceptAuthor' || edge.relationType === 'conceptMethod',
    )).toBe(true)
  })

  it('概念网络用虚线候选连接同篇论文的概念', async () => {
    const result = await getGraphDataset('concept')
    const candidates = result.edges.filter((edge) => edge.relationType === 'coOccurs')

    expect(candidates.length).toBeGreaterThan(0)
    for (const edge of candidates) {
      const source = result.nodes.find((node) => node.id === edge.sourceId)
      const target = result.nodes.find((node) => node.id === edge.targetId)
      const sharedPaperIds = source?.sourcePaperIds.filter((paperId) =>
        target?.sourcePaperIds.includes(paperId),
      ) ?? []
      expect(edge.directed).toBe(false)
      expect(edge.sourcePaperIds).toEqual(sharedPaperIds)
      expect(edge.weight).toBe(sharedPaperIds.length)
    }
  })

  it('作者合作边权重等于共同论文数量', async () => {
    const result = await getGraphDataset('author')
    const collaboration = result.edges.find((edge) => edge.relationType === 'coAuthor')

    expect(collaboration).toBeDefined()
    expect(collaboration?.weight).toBe(collaboration?.sourcePaperIds.length)
  })

  it('作者网络只显示作者合作，并保留已知论文 JIF 总和', async () => {
    const result = await getGraphDataset('author')
    const authorById = new Map(result.nodes.map((node) => [node.id, node]))

    expect(authorById.get('author-li-ming')?.metrics.totalImpactFactor).toBe(41.2)
    expect(authorById.get('author-wu-lan')?.metrics.totalImpactFactor).toBe(0)
    expect(result.nodes.every((node) => node.nodeType === 'author')).toBe(true)
    expect(result.edges.every((edge) => edge.relationType === 'coAuthor')).toBe(true)
    expect(result.contextOverlay.nodes.every((node) =>
      node.nodeType === 'concept' || node.nodeType === 'method',
    )).toBe(true)
    expect(result.contextOverlay.edges.every((edge) =>
      edge.relationType === 'authorConcept' || edge.relationType === 'authorMethod',
    )).toBe(true)
  })

  it('作者网络支持核心、核心加桥接和全量三种范围', async () => {
    const core = await getGraphDataset('author', 'success', { authorMode: 'core' })
    const bridge = await getGraphDataset('author', 'success', { authorMode: 'coreBridge' })
    const all = await getGraphDataset('author', 'success', { authorMode: 'all' })

    expect(core.nodes.every((node) => node.authorTier === 'core')).toBe(true)
    expect(core.nodes.some((node) => node.id === 'author-wang-fang')).toBe(false)
    expect(bridge.nodes.find((node) => node.id === 'author-wang-fang')?.authorTier).toBe('bridge')
    expect(bridge.nodes.length).toBeGreaterThanOrEqual(core.nodes.length)
    expect(all.nodes.length).toBeGreaterThanOrEqual(bridge.nodes.length)
    expect(bridge.edges.every((edge) => edge.relationType === 'coAuthor')).toBe(true)
  })

  it('方法网络只显示方法，并区分已判定关系与同篇使用候选', async () => {
    const result = await getGraphDataset('method')
    const nodeTypeById = new Map(result.nodes.map((node) => [node.id, node.nodeType]))
    const relatedEdges = result.edges.filter((edge) =>
      ['combinedWith', 'variantOf', 'alternativeTo', 'coOccurs'].includes(edge.relationType),
    )

    expect(result.nodes.every((node) => node.nodeType === 'method')).toBe(true)
    expect(relatedEdges.length).toBeGreaterThan(0)
    expect(relatedEdges.every((edge) => nodeTypeById.get(edge.sourceId) === 'method')).toBe(true)
    expect(relatedEdges.every((edge) => nodeTypeById.get(edge.targetId) === 'method')).toBe(true)
    expect(result.contextOverlay.nodes.every((node) => node.nodeType === 'concept')).toBe(true)
    expect(result.contextOverlay.edges.every((edge) => edge.relationType === 'methodConcept')).toBe(true)
  })

  it('文献引用网络同时提供论文实际涉及的概念和方法', async () => {
    const result = await getGraphDataset('paper')

    expect(result.contextOverlay.nodes.some((node) => node.nodeType === 'concept')).toBe(true)
    expect(result.contextOverlay.nodes.some((node) => node.nodeType === 'method')).toBe(true)
    expect(result.contextOverlay.edges.some((edge) => edge.relationType === 'paperConcept')).toBe(true)
    expect(result.contextOverlay.edges.some((edge) => edge.relationType === 'paperMethod')).toBe(true)
    for (const edge of result.contextOverlay.edges) {
      expect(edge.sourcePaperIds).toContain(edge.sourceId)
    }
    expect(result.nodeDetails['paper-001']).toMatchObject({
      nodeType: 'paper',
      conceptIds: expect.arrayContaining(['concept-reversal-learning']),
      methodIds: expect.arrayContaining(['method-fmri']),
    })
  })

  it('方法关联边的来源论文是两个方法的共同论文', async () => {
    const result = await getGraphDataset('method')
    const methods = new Map(result.nodes.map((node) => [node.id, node]))

    for (const edge of result.edges) {
      const source = methods.get(edge.sourceId)
      const target = methods.get(edge.targetId)
      const sharedPaperIds = source?.sourcePaperIds.filter((paperId) =>
        target?.sourcePaperIds.includes(paperId),
      ).sort()
      expect(edge.sourcePaperIds).toEqual(sharedPaperIds)
    }
  })

  it('空态返回有效空集合', async () => {
    await expect(getGraphDataset('paper', 'empty')).resolves.toMatchObject({
      view: 'paper',
      nodes: [],
      edges: [],
    })
  })

  it('失败场景抛出可直接展示的信息', async () => {
    await expect(getGraphDataset('method', 'error')).rejects.toThrow(
      '知识图谱加载失败，请稍后重试。',
    )
  })

  it('所有图谱论文主键与重叠元数据都能在论文列表和详情服务中解析', async () => {
    const graph = await getGraphDataset('paper')
    const paperPage = await getPapers()

    for (const graphPaper of Object.values(graph.papers)) {
      const listPaper = paperPage.items.find((paper) => paper.id === graphPaper.id)
      const detailPaper = await getPaperDetail(graphPaper.id)

      expect(listPaper).toMatchObject({
        id: graphPaper.id,
        title: graphPaper.title,
        year: graphPaper.year,
      })
      expect(listPaper?.authors.map((author) => author.name)).toEqual(graphPaper.authorNames)
      expect(detailPaper).toMatchObject({
        id: graphPaper.id,
        title: graphPaper.title,
        year: graphPaper.year,
      })
      expect(detailPaper.authors.map((author) => author.name)).toEqual(graphPaper.authorNames)
    }
  })

  it('每类网络的节点计数、边端点、论文与 Evidence 外键保持完整一致', async () => {
    for (const view of graphViews) {
      const graph = await getGraphDataset(view)
      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      const allNodeIds = new Set([
        ...nodeIds,
        ...graph.contextOverlay.nodes.map((node) => node.id),
      ])
      const evidenceById = new Map(graph.evidence.map((evidence) => [evidence.id, evidence]))
      const referencedEvidenceIds = new Set(graph.edges.flatMap((edge) => edge.evidenceIds))

      expect(new Set(Object.keys(graph.nodeDetails))).toEqual(allNodeIds)
      for (const [paperId, paper] of Object.entries(graph.papers)) {
        expect(paper.id).toBe(paperId)
      }

      for (const node of graph.nodes) {
        expect(graph.nodeDetails[node.id].nodeId).toBe(node.id)
        expect(node.sourcePaperIds.every((paperId) => graph.papers[paperId])).toBe(true)
        if (node.metrics.paperCount !== undefined) {
          expect(node.metrics.paperCount).toBe(new Set(node.sourcePaperIds).size)
        }
        if (node.metrics.connectionCount !== undefined) {
          const incidentEdges = graph.edges.filter(
            (edge) => edge.sourceId === node.id || edge.targetId === node.id,
          )
          expect(node.metrics.connectionCount).toBe(incidentEdges.length)
        }
      }

      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.sourceId)).toBe(true)
        expect(nodeIds.has(edge.targetId)).toBe(true)
        expect(edge.sourcePaperIds.every((paperId) => graph.papers[paperId])).toBe(true)
        for (const evidenceId of edge.evidenceIds) {
          const evidence = evidenceById.get(evidenceId)
          expect(evidence).toBeDefined()
          expect(edge.sourcePaperIds).toContain(evidence?.paperId)
        }
      }

      for (const evidence of graph.evidence) {
        expect(graph.papers[evidence.paperId]).toBeDefined()
        expect(referencedEvidenceIds.has(evidence.id)).toBe(true)
      }
    }
  })

  it('核心作者仅由一作、共同一作和通讯作者身份决定', async () => {
    const graph = await getGraphDataset('author', 'success', { authorMode: 'core' })
    const authorIdByName = new Map(graph.nodes.map((node) => [node.label, node.id]))
    const explicitlyIncludedIds = new Set(
      Object.values(graph.papers).flatMap((paper) => (paper.authors ?? [])
        .filter((author) => author.order === 1 || author.contributionRoles.some((role) =>
          ['firstAuthor', 'coFirstAuthor', 'correspondingAuthor'].includes(role)))
        .map((author) => author.id)),
    )
    const legacyFirstAuthorNames = new Set(Object.values(graph.papers)
      .filter((paper) => !paper.authors?.length)
      .map((paper) => paper.authorNames[0])
      .filter(Boolean))
    const expectedPairs = new Set<string>()

    expect(graph.nodes.every((author) =>
      explicitlyIncludedIds.has(author.id)
      || legacyFirstAuthorNames.has(author.label),
    )).toBe(true)
    expect(authorIdByName.has('赵静')).toBe(true)
    expect(authorIdByName.has('孙悦')).toBe(true)

    for (const paper of Object.values(graph.papers)) {
      const authorIds = paper.authorNames.flatMap((name) => {
        const authorId = authorIdByName.get(name)
        return authorId ? [authorId] : []
      })
      for (let leftIndex = 0; leftIndex < authorIds.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < authorIds.length; rightIndex += 1) {
          expectedPairs.add([authorIds[leftIndex], authorIds[rightIndex]].sort().join('|'))
        }
      }
    }

    const actualPairs = new Set(
      graph.edges
        .filter((edge) => edge.relationType === 'coAuthor')
        .map((edge) => [edge.sourceId, edge.targetId].sort().join('|')),
    )
    expect(actualPairs).toEqual(expectedPairs)

    for (const edge of graph.edges.filter((item) => item.relationType === 'coAuthor')) {
      const sourcePapers = graph.nodes.find((node) => node.id === edge.sourceId)?.sourcePaperIds ?? []
      const targetPapers = new Set(
        graph.nodes.find((node) => node.id === edge.targetId)?.sourcePaperIds ?? [],
      )
      const sharedPaperIds = sourcePapers.filter((paperId) => targetPapers.has(paperId)).sort()

      expect([...edge.sourcePaperIds].sort()).toEqual(sharedPaperIds)
      expect(edge.weight).toBe(sharedPaperIds.length)
    }

  })
})
