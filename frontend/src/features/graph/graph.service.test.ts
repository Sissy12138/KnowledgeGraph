import { describe, expect, it } from 'vitest'
import { getPaperDetail, getPapers } from '../papers/paper.service'
import { getGraphDataset } from './graph.service'
import type { GraphView } from './graph.types'

const graphViews: GraphView[] = ['concept', 'method', 'author', 'paper']

describe('getGraphDataset', () => {
  it('返回具有稳定节点和关系的概念网络', async () => {
    const result = await getGraphDataset('concept')

    expect(result.view).toBe('concept')
    expect(result.nodes.some((node) => node.id === 'concept-reversal-learning')).toBe(true)
    expect(result.edges.some((edge) => edge.relationType === 'broaderThan')).toBe(true)
    expect(result.nodeDetails['concept-reversal-learning'].nodeType).toBe('concept')
  })

  it('概念网络提供以稳定节点 ID 和共同论文构造的作者与方法上下文', async () => {
    const result = await getGraphDataset('concept')
    const primaryNodeById = new Map(result.nodes.map((node) => [node.id, node]))
    const contextNodeById = new Map(
      result.contextOverlay.nodes.map((node) => [node.id, node]),
    )

    expect(result.contextOverlay.nodes.some((node) => node.nodeType === 'author')).toBe(true)
    expect(result.contextOverlay.nodes.some((node) => node.nodeType === 'method')).toBe(true)
    expect(result.contextOverlay.edges.some((edge) => edge.relationType === 'conceptAuthor')).toBe(true)
    expect(result.contextOverlay.edges.some((edge) => edge.relationType === 'conceptMethod')).toBe(true)

    for (const edge of result.contextOverlay.edges) {
      const concept = primaryNodeById.get(edge.sourceId)
      const contextNode = contextNodeById.get(edge.targetId)
      const sharedPaperIds = concept?.sourcePaperIds.filter((paperId) =>
        contextNode?.sourcePaperIds.includes(paperId),
      ) ?? []

      expect(concept?.nodeType).toBe('concept')
      expect(['author', 'method']).toContain(contextNode?.nodeType)
      expect(edge.sourcePaperIds).toEqual(sharedPaperIds)
      expect(edge.sourcePaperIds.length).toBeGreaterThan(0)
      expect(result.nodeDetails[edge.targetId]?.nodeId).toBe(edge.targetId)
    }
  })

  it('作者合作边权重等于共同论文数量', async () => {
    const result = await getGraphDataset('author')
    const collaboration = result.edges.find((edge) => edge.relationType === 'coAuthor')

    expect(collaboration).toBeDefined()
    expect(collaboration?.weight).toBe(collaboration?.sourcePaperIds.length)
  })

  it('作者网络按论文外键提供概念和方法上下文，并计算已知论文 JIF 总和', async () => {
    const result = await getGraphDataset('author')
    const authorById = new Map(result.nodes.map((node) => [node.id, node]))
    const contextById = new Map(result.contextOverlay.nodes.map((node) => [node.id, node]))

    expect(authorById.get('author-li-ming')?.metrics.totalImpactFactor).toBe(41.2)
    expect(authorById.get('author-wu-lan')?.metrics.totalImpactFactor).toBe(0)
    expect(result.contextOverlay.nodes.some((node) => node.nodeType === 'concept')).toBe(true)
    expect(result.contextOverlay.nodes.some((node) => node.nodeType === 'method')).toBe(true)
    expect(result.contextOverlay.edges.some((edge) => edge.relationType === 'authorConcept')).toBe(true)
    expect(result.contextOverlay.edges.some((edge) => edge.relationType === 'authorMethod')).toBe(true)

    for (const edge of result.contextOverlay.edges) {
      const author = authorById.get(edge.sourceId)
      const contextNode = contextById.get(edge.targetId)
      const sharedPaperIds = author?.sourcePaperIds.filter((paperId) =>
        contextNode?.sourcePaperIds.includes(paperId),
      ) ?? []

      expect(author?.nodeType).toBe('author')
      expect(['concept', 'method']).toContain(contextNode?.nodeType)
      expect(edge.sourcePaperIds).toEqual(sharedPaperIds)
      expect(edge.sourcePaperIds.length).toBeGreaterThan(0)
      expect(result.nodeDetails[edge.targetId]?.nodeId).toBe(edge.targetId)
    }
  })

  it('方法网络以论文到方法的 uses 边连接两类节点', async () => {
    const result = await getGraphDataset('method')
    const nodeTypeById = new Map(result.nodes.map((node) => [node.id, node.nodeType]))
    const usesEdges = result.edges.filter((edge) => edge.relationType === 'uses')

    expect(result.nodes.filter((node) => node.nodeType === 'paper')).toHaveLength(5)
    expect(usesEdges.length).toBeGreaterThan(0)
    expect(usesEdges.every((edge) => nodeTypeById.get(edge.sourceId) === 'paper')).toBe(true)
    expect(usesEdges.every((edge) => nodeTypeById.get(edge.targetId) === 'method')).toBe(true)
    expect(result.nodeDetails['paper-002'].nodeType).toBe('paper')
  })

  it('方法的来源论文与指向该方法的 uses 边一致', async () => {
    const result = await getGraphDataset('method')
    const methodNodes = result.nodes.filter((node) => node.nodeType === 'method')

    for (const method of methodNodes) {
      const sourcePaperIds = result.edges
        .filter((edge) => edge.relationType === 'uses' && edge.targetId === method.id)
        .map((edge) => edge.sourceId)
        .sort()
      const detail = result.nodeDetails[method.id]

      expect([...method.sourcePaperIds].sort()).toEqual(sourcePaperIds)
      expect(detail.nodeType).toBe('method')
      if (detail.nodeType === 'method') {
        expect([...detail.paperIds].sort()).toEqual(sourcePaperIds)
      }
    }

    const paperNodes = result.nodes.filter((node) => node.nodeType === 'paper')
    for (const paper of paperNodes) {
      const methodIds = result.edges
        .filter((edge) => edge.relationType === 'uses' && edge.sourceId === paper.id)
        .map((edge) => edge.targetId)
        .sort()
      const detail = result.nodeDetails[paper.id]

      expect(detail.nodeType).toBe('paper')
      if (detail.nodeType === 'paper') {
        expect([...detail.methodIds].sort()).toEqual(methodIds)
      }
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

      for (const edge of graph.contextOverlay.edges) {
        expect(nodeIds.has(edge.sourceId)).toBe(true)
        expect(allNodeIds.has(edge.targetId)).toBe(true)
        expect(edge.sourcePaperIds.every((paperId) => graph.papers[paperId])).toBe(true)
      }

      for (const evidence of graph.evidence) {
        expect(graph.papers[evidence.paperId]).toBeDefined()
        expect(referencedEvidenceIds.has(evidence.id)).toBe(true)
      }
    }
  })

  it('作者合作边完整覆盖每篇多人论文的作者对，并保留独立作者', async () => {
    const graph = await getGraphDataset('author')
    const authorIdByName = new Map(graph.nodes.map((node) => [node.label, node.id]))
    const expectedPairs = new Set<string>()

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

    expect(
      graph.nodes.some((node) =>
        graph.edges.every((edge) => edge.sourceId !== node.id && edge.targetId !== node.id),
      ),
    ).toBe(true)
  })
})
