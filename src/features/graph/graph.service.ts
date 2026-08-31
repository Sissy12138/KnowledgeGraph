import { graphMocks } from './graph.mock'
import type { GraphDataset, GraphScenario, GraphView } from './graph.types'

/** 获取指定图谱视图的开发期数据集，并支持空态和失败态演示。 */
export async function getGraphDataset(
  view: GraphView,
  scenario: GraphScenario = 'success',
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

  return structuredClone(graphMocks[view])
}
