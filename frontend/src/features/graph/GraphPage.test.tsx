import { StrictMode, act } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { GraphCanvasHandle, GraphCanvasProps } from './GraphCanvas'
import type { GraphDataset, GraphNode, GraphView } from './graph.types'
import GraphPage from './GraphPage'

vi.mock('./GraphCanvas', async () => {
  const React = await import('react')

  return {
    default: React.forwardRef(function TestGraphCanvas(
      {
        dataset,
        contextConceptId,
        contextAuthorId,
        isSearchActive,
        onError,
        onSelectionChange,
        selection,
        showRelatedAuthors,
        showRelatedConcepts,
        showRelatedMethods,
        ...extraProps
      }: GraphCanvasProps,
      ref: React.ForwardedRef<GraphCanvasHandle>,
    ) {
      const selectedPaperIds = (extraProps as { selectedPaperIds?: string[] }).selectedPaperIds ?? []
      const [fitCount, setFitCount] = React.useState(0)
      const [focusedNodeId, setFocusedNodeId] = React.useState('无')
      const [resetCount, setResetCount] = React.useState(0)
      React.useImperativeHandle(ref, () => ({
        fitToView: () => setFitCount((count) => count + 1),
        focusNode: (nodeId) => setFocusedNodeId(nodeId),
        resetView: () => setResetCount((count) => count + 1),
      }))

      return (
        <div aria-label={`测试图谱 ${dataset.view}`}>
          <span aria-label="当前画布选择">{selection?.id ?? '无'}</span>
          <span aria-label="概念上下文锚点">{contextConceptId ?? '无'}</span>
          <span aria-label="作者上下文锚点">{contextAuthorId ?? '无'}</span>
          <span aria-label="作者上下文状态">{showRelatedAuthors ? '是' : '否'}</span>
          <span aria-label="概念上下文状态">{showRelatedConcepts ? '是' : '否'}</span>
          <span aria-label="方法上下文状态">{showRelatedMethods ? '是' : '否'}</span>
          <span aria-label="多选论文">{selectedPaperIds.join(',') || '无'}</span>
          <span aria-label="搜索激活状态">{isSearchActive ? '是' : '否'}</span>
          <span aria-label="适应画布次数">{fitCount}</span>
          <span aria-label="画布聚焦节点">{focusedNodeId}</span>
          <span aria-label="重置视口次数">{resetCount}</span>
          <button
            onClick={() => onSelectionChange({ kind: 'node', id: dataset.nodes[0].id })}
            type="button"
          >
            选择第一个节点
          </button>
          <button
            onClick={() => onError?.('图谱画布初始化失败：测试错误')}
            type="button"
          >
            模拟画布初始化失败
          </button>
          {dataset.nodes[1] && (
            <button
              onClick={() => onSelectionChange({ kind: 'node', id: dataset.nodes[1].id })}
              type="button"
            >
              选择第二个节点
            </button>
          )}
          {dataset.contextOverlay.nodes[0] && (
            <button
              onClick={() => onSelectionChange({ kind: 'node', id: dataset.contextOverlay.nodes[0].id })}
              type="button"
            >
              选择上下文节点
            </button>
          )}
          {dataset.contextOverlay.edges[0] && (
            <button
              onClick={() => onSelectionChange({ kind: 'edge', id: dataset.contextOverlay.edges[0].id })}
              type="button"
            >
              选择上下文关系
            </button>
          )}
        </div>
      )
    }),
  }
})

function makeDataset(view: GraphView): GraphDataset {
  if (view === 'concept') {
    return {
      view,
      nodes: [
        {
          id: 'concept-first',
          nodeType: 'concept',
          label: '普通概念',
          description: '第一项但不是默认项。',
          sourcePaperIds: [],
          metrics: { paperCount: 2 },
        },
        {
          id: 'concept-top',
          nodeType: 'concept',
          label: '高论文概念',
          description: '论文数最多，应成为默认项。',
          sourcePaperIds: [],
          metrics: { paperCount: 9 },
        },
        {
          id: 'concept-target',
          nodeType: 'concept',
          label: '目标概念',
          description: '可通过搜索找到。',
          sourcePaperIds: [],
          metrics: { paperCount: 3 },
        },
      ],
      edges: [],
      contextOverlay: {
        nodes: [{
          id: 'author-context',
          nodeType: 'author',
          label: '相关作者',
          description: null,
          sourcePaperIds: [],
          metrics: {},
        }],
        edges: [{
          id: 'edge-context-concept-top-author-context',
          sourceId: 'concept-top',
          targetId: 'author-context',
          relationType: 'conceptAuthor',
          label: '相关作者',
          directed: false,
          weight: null,
          evidenceIds: [],
          sourcePaperIds: [],
        }],
      },
      evidence: [],
      papers: {},
      relatedNodeLabels: {},
      nodeDetails: {
        'concept-first': {
          nodeId: 'concept-first',
          nodeType: 'concept',
          aliases: [],
          broaderConceptIds: [],
          narrowerConceptIds: [],
          relatedConceptIds: [],
          paperIds: [],
        },
        'concept-top': {
          nodeId: 'concept-top',
          nodeType: 'concept',
          aliases: [],
          broaderConceptIds: [],
          narrowerConceptIds: [],
          relatedConceptIds: [],
          paperIds: [],
        },
        'concept-target': {
          nodeId: 'concept-target',
          nodeType: 'concept',
          aliases: [],
          broaderConceptIds: [],
          narrowerConceptIds: [],
          relatedConceptIds: [],
          paperIds: [],
        },
        'author-context': {
          nodeId: 'author-context',
          nodeType: 'author',
          orcid: null,
          affiliations: [],
          paperIds: [],
        },
      },
    }
  }

  const nodeType = view === 'author' ? 'author' : view === 'method' ? 'method' : 'paper'
  const firstId = `${view}-first`
  const secondId = `${view}-second`
  const nodes: GraphNode[] = [firstId, secondId].map((id, index) => ({
    id,
    nodeType,
    label: `${view === 'author' ? '作者' : view === 'method' ? '方法' : '论文'}${index + 1}`,
    description: null,
    sourcePaperIds: [],
    metrics: {},
  }))
  const nodeDetails = Object.fromEntries(nodes.map((node) => {
    if (nodeType === 'author') {
      return [node.id, {
        nodeId: node.id,
        nodeType: 'author' as const,
        orcid: null,
        affiliations: [],
        paperIds: [],
      }]
    }
    if (nodeType === 'method') {
      return [node.id, {
        nodeId: node.id,
        nodeType: 'method' as const,
        methodType: '实验方法',
        paperIds: [],
      }]
    }
    return [node.id, {
      nodeId: node.id,
      nodeType: 'paper' as const,
      paperId: node.id,
      conceptIds: [],
      methodIds: [],
      findingSummaries: [],
    }]
  }))

  const contextOverlay = view === 'author'
    ? {
        nodes: [
          { id: 'concept-context', nodeType: 'concept' as const, label: '相关概念', description: null, sourcePaperIds: [], metrics: {} },
          { id: 'method-context', nodeType: 'method' as const, label: '相关方法', description: null, sourcePaperIds: [], metrics: {} },
        ],
        edges: [
          { id: 'edge-author-concept', sourceId: firstId, targetId: 'concept-context', relationType: 'authorConcept' as const, label: '相关概念', directed: false, weight: null, evidenceIds: [], sourcePaperIds: [] },
          { id: 'edge-author-method', sourceId: firstId, targetId: 'method-context', relationType: 'authorMethod' as const, label: '相关方法', directed: false, weight: null, evidenceIds: [], sourcePaperIds: [] },
        ],
      }
    : view === 'paper'
      ? {
          nodes: [
            { id: 'paper-concept-context', nodeType: 'concept' as const, label: '论文相关概念', description: null, sourcePaperIds: [firstId], metrics: {} },
          ],
          edges: [
            { id: 'edge-paper-concept', sourceId: firstId, targetId: 'paper-concept-context', relationType: 'paperConcept' as const, label: '相关概念', directed: false, weight: null, evidenceIds: [], sourcePaperIds: [firstId] },
          ],
        }
      : { nodes: [], edges: [] }

  return {
    view,
    nodes,
    edges: [],
    contextOverlay,
    evidence: [],
    papers: view === 'paper'
      ? Object.fromEntries(nodes.map((node) => [node.id, {
          id: node.id,
          title: node.label,
          authorNames: [],
          year: null,
          journal: null,
        }]))
      : {},
    relatedNodeLabels: {},
    nodeDetails: {
      ...nodeDetails,
      ...(view === 'author'
        ? {
            'concept-context': { nodeId: 'concept-context', nodeType: 'concept' as const, aliases: [], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: [], paperIds: [] },
            'method-context': { nodeId: 'method-context', nodeType: 'method' as const, methodType: '实验方法', paperIds: [] },
          }
        : view === 'paper'
          ? {
              'paper-concept-context': { nodeId: 'paper-concept-context', nodeType: 'concept' as const, aliases: [], broaderConceptIds: [], narrowerConceptIds: [], relatedConceptIds: [], paperIds: [firstId] },
            }
          : {}),
    },
  }
}

function emptyDataset(view: GraphView): GraphDataset {
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function renderPage(loadGraph: (view: GraphView) => Promise<GraphDataset>) {
  return render(
    <MemoryRouter>
      <GraphPage loadGraph={loadGraph} />
    </MemoryRouter>,
  )
}

describe('GraphPage', () => {
  it('默认显示知识图谱、概念网络，并选择论文数最多的概念', async () => {
    renderPage(async (view) => makeDataset(view))

    expect(screen.getByRole('heading', { name: '知识图谱' })).toBeInTheDocument()
    expect(await screen.findByText('概念网络')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '高论文概念' })).toBeInTheDocument()
    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('concept-top')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('id', 'graph-panel-concept')
    expect(panel).toHaveAttribute('aria-labelledby', 'graph-tab-concept')
  })

  it('请求未完成时显示加载状态', () => {
    const pending = deferred<GraphDataset>()
    renderPage(() => pending.promise)

    expect(screen.getByRole('status')).toHaveTextContent('正在加载知识图谱')
    expect(screen.queryByLabelText(/测试图谱/)).not.toBeInTheDocument()
  })

  it('卸载后不会再启动 effect 中排队的加载工作', async () => {
    const pending = deferred<GraphDataset>()
    const loadGraph = vi.fn(() => pending.promise)
    const { unmount } = renderPage(loadGraph)
    const callsBeforeUnmount = loadGraph.mock.calls.length

    unmount()
    await act(async () => Promise.resolve())

    expect(loadGraph).toHaveBeenCalledTimes(callsBeforeUnmount)
  })

  it('StrictMode 首次挂载只启动一次有效请求', async () => {
    const pending = deferred<GraphDataset>()
    const loadGraph = vi.fn(() => pending.promise)

    render(
      <StrictMode>
        <MemoryRouter>
          <GraphPage loadGraph={loadGraph} />
        </MemoryRouter>
      </StrictMode>,
    )

    await waitFor(() => expect(loadGraph).toHaveBeenCalledTimes(1))
  })

  it('loader 同步抛错时进入错误状态并允许重试', async () => {
    const loadGraph = vi.fn(() => {
      throw new Error('同步加载失败')
    })

    renderPage(loadGraph)

    expect(await screen.findByRole('alert')).toHaveTextContent('同步加载失败')
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })

  it('切换作者合作视图时以 author 参数加载并选择第一位作者', async () => {
    const user = userEvent.setup()
    const loadGraph = vi.fn(async (view: GraphView) => makeDataset(view))
    renderPage(loadGraph)
    await screen.findByLabelText('测试图谱 concept')

    await user.click(screen.getByRole('tab', { name: '作者合作' }))

    expect(loadGraph).toHaveBeenCalledWith('author')
    expect(await screen.findByLabelText('测试图谱 author')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '作者1' })).toBeInTheDocument()
  })

  it('画布选择节点后显示对应详情', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')

    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))

    expect(screen.getByRole('heading', { name: '普通概念' })).toBeInTheDocument()
  })

  it('概念视图显示两个上下文开关，并让概念锚点与开关状态独立更新', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')

    expect(screen.getByLabelText('概念上下文锚点')).toHaveTextContent('concept-top')
    const authors = screen.getByRole('button', { name: '显示相关作者' })
    const methods = screen.getByRole('button', { name: '显示相关方法' })
    await user.click(authors)
    await user.click(methods)
    expect(screen.getByLabelText('作者上下文状态')).toHaveTextContent('是')
    expect(screen.getByLabelText('方法上下文状态')).toHaveTextContent('是')

    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    expect(screen.getByLabelText('概念上下文锚点')).toHaveTextContent('concept-first')
    await user.click(screen.getByRole('button', { name: '选择上下文节点' }))
    expect(screen.getByRole('heading', { name: '相关作者' })).toBeInTheDocument()
    expect(screen.getByLabelText('概念上下文锚点')).toHaveTextContent('concept-first')

    await user.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByLabelText('概念上下文锚点')).toHaveTextContent('无')
    expect(authors).toHaveAttribute('aria-pressed', 'true')
    expect(methods).toHaveAttribute('aria-pressed', 'true')
  })

  it('上下文开关不在方法视图出现', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '方法网络' }))
    await screen.findByLabelText('测试图谱 method')

    expect(screen.queryByRole('button', { name: '显示相关作者' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示相关方法' })).not.toBeInTheDocument()
  })

  it('作者视图显示概念和方法开关，并以作者选择作为上下文锚点', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '作者合作' }))
    await screen.findByLabelText('测试图谱 author')

    expect(screen.getByLabelText('作者上下文锚点')).toHaveTextContent('author-first')
    const concepts = screen.getByRole('button', { name: '显示相关概念' })
    const methods = screen.getByRole('button', { name: '显示相关方法' })
    await user.click(concepts)
    await user.click(methods)
    expect(screen.getByLabelText('概念上下文状态')).toHaveTextContent('是')
    expect(screen.getByLabelText('方法上下文状态')).toHaveTextContent('是')

    await user.click(screen.getByRole('button', { name: '选择第二个节点' }))
    expect(screen.getByLabelText('作者上下文锚点')).toHaveTextContent('author-second')
    await user.click(screen.getByRole('button', { name: '选择上下文节点' }))
    expect(screen.getByRole('heading', { name: '相关概念' })).toBeInTheDocument()
    expect(screen.getByLabelText('作者上下文锚点')).toHaveTextContent('author-second')
  })

  it('搜索并选择结果后显示目标详情、清空查询并退出搜索态', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')

    const searchbox = screen.getByRole('searchbox', { name: '搜索当前网络中的节点' })
    await user.type(searchbox, '目标')
    expect(screen.getByLabelText('搜索激活状态')).toHaveTextContent('是')
    await user.click(screen.getByRole('option', { name: '目标概念' }))

    expect(screen.getByRole('heading', { name: '目标概念' })).toBeInTheDocument()
    expect(searchbox).toHaveValue('')
    expect(screen.queryByRole('listbox', { name: '搜索结果' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('搜索激活状态')).toHaveTextContent('否')
    expect(screen.getByLabelText('画布聚焦节点')).toHaveTextContent('concept-target')
  })

  it('键盘选择搜索结果后把焦点移动到新详情标题', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')

    await user.type(
      screen.getByRole('searchbox', { name: '搜索当前网络中的节点' }),
      '目标',
    )
    screen.getByRole('listbox', { name: '搜索结果' }).focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: '目标概念' })).toHaveFocus()
  })

  it('空数据只显示空态，不渲染画布', async () => {
    renderPage(async (view) => emptyDataset(view))

    expect(await screen.findByText('当前网络暂无节点')).toBeInTheDocument()
    expect(screen.queryByLabelText(/测试图谱/)).not.toBeInTheDocument()
  })

  it('失败时显示警报且重新加载会再次请求并恢复内容', async () => {
    const user = userEvent.setup()
    const loadGraph = vi.fn()
      .mockRejectedValueOnce(new Error('服务暂不可用'))
      .mockResolvedValueOnce(makeDataset('concept'))
    renderPage(loadGraph)

    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂不可用')
    expect(screen.queryByLabelText(/测试图谱/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新加载' }))

    expect(loadGraph).toHaveBeenCalledTimes(2)
    expect(await screen.findByLabelText('测试图谱 concept')).toBeInTheDocument()
  })

  it('画布初始化失败时显示警报，并可只重建画布恢复', async () => {
    const user = userEvent.setup()
    const loadGraph = vi.fn(async (view: GraphView) => makeDataset(view))
    renderPage(loadGraph)
    await screen.findByLabelText('测试图谱 concept')

    await user.click(screen.getByRole('button', { name: '模拟画布初始化失败' }))
    expect(screen.getByRole('alert')).toHaveTextContent('图谱画布初始化失败：测试错误')
    expect(screen.queryByLabelText('测试图谱 concept')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试画布' }))
    expect(await screen.findByLabelText('测试图谱 concept')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(loadGraph).toHaveBeenCalledTimes(1)
  })

  it('较早请求晚返回时不会覆盖当前视图', async () => {
    const user = userEvent.setup()
    const authorRequest = deferred<GraphDataset>()
    const methodRequest = deferred<GraphDataset>()
    const loadGraph = vi.fn((view: GraphView) => {
      if (view === 'author') return authorRequest.promise
      if (view === 'method') return methodRequest.promise
      return Promise.resolve(makeDataset(view))
    })
    renderPage(loadGraph)
    await screen.findByLabelText('测试图谱 concept')

    await user.click(screen.getByRole('tab', { name: '作者合作' }))
    await user.click(screen.getByRole('tab', { name: '方法网络' }))
    await act(async () => methodRequest.resolve(makeDataset('method')))
    expect(await screen.findByLabelText('测试图谱 method')).toBeInTheDocument()
    await act(async () => authorRequest.resolve(makeDataset('author')))

    await waitFor(() => {
      expect(screen.getByLabelText('测试图谱 method')).toBeInTheDocument()
      expect(screen.queryByLabelText('测试图谱 author')).not.toBeInTheDocument()
    })
  })

  it('快速切换立即移除旧画布，并忽略旧视图随后发生的失败', async () => {
    const authorRequest = deferred<GraphDataset>()
    const methodRequest = deferred<GraphDataset>()
    const loadGraph = vi.fn((view: GraphView) => {
      if (view === 'author') return authorRequest.promise
      if (view === 'method') return methodRequest.promise
      return Promise.resolve(makeDataset(view))
    })
    renderPage(loadGraph)
    await screen.findByLabelText('测试图谱 concept')

    fireEvent.click(screen.getByRole('tab', { name: '作者合作' }))
    expect(screen.queryByLabelText('测试图谱 concept')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载知识图谱')
    await waitFor(() => expect(loadGraph).toHaveBeenCalledWith('author'))
    fireEvent.click(screen.getByRole('tab', { name: '方法网络' }))
    await act(async () => authorRequest.reject(new Error('过期的作者请求失败')))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载知识图谱')
    await act(async () => methodRequest.resolve(makeDataset('method')))
    expect(await screen.findByLabelText('测试图谱 method')).toBeInTheDocument()
  })

  it('切换标签时分别恢复各视图在本次页面会话中的最后选择', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))

    await user.click(screen.getByRole('tab', { name: '作者合作' }))
    await screen.findByLabelText('测试图谱 author')
    await user.click(screen.getByRole('button', { name: '选择第二个节点' }))

    await user.click(screen.getByRole('tab', { name: '概念关系' }))
    await screen.findByLabelText('测试图谱 concept')
    expect(screen.getByRole('heading', { name: '普通概念' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '作者合作' }))
    await screen.findByLabelText('测试图谱 author')
    expect(screen.getByRole('heading', { name: '作者2' })).toBeInTheDocument()
  })

  it('文献概念开关开启后累积选择论文，再次点击时反选并回退详情焦点', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '文献引用' }))
    await screen.findByLabelText('测试图谱 paper')

    await user.click(screen.getByRole('button', { name: '显示相关概念' }))
    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('无')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    expect(screen.getByLabelText('多选论文')).toHaveTextContent('paper-first')
    await user.click(screen.getByRole('button', { name: '选择第二个节点' }))
    expect(screen.getByLabelText('多选论文')).toHaveTextContent('paper-first,paper-second')
    expect(screen.getByRole('heading', { name: '论文2' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '选择第二个节点' }))
    expect(screen.getByLabelText('多选论文')).toHaveTextContent('paper-first')
    expect(screen.getByRole('heading', { name: '论文1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    expect(screen.getByLabelText('多选论文')).toHaveTextContent('无')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
  })

  it('关闭文献相关概念时清空多选集合并恢复普通单选', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '文献引用' }))
    await screen.findByLabelText('测试图谱 paper')

    const concepts = screen.getByRole('button', { name: '显示相关概念' })
    await user.click(concepts)
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    await user.click(concepts)
    expect(screen.getByLabelText('多选论文')).toHaveTextContent('无')
    await user.click(screen.getByRole('button', { name: '选择第二个节点' }))
    expect(screen.getByLabelText('多选论文')).toHaveTextContent('无')
    expect(screen.getByRole('heading', { name: '论文2' })).toBeInTheDocument()
  })

  it('文献多选模式下重置会清空论文集合、详情与视口', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '文献引用' }))
    await screen.findByLabelText('测试图谱 paper')
    await user.click(screen.getByRole('button', { name: '显示相关概念' }))
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))

    await user.click(screen.getByRole('button', { name: '重置' }))

    expect(screen.getByLabelText('多选论文')).toHaveTextContent('无')
    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('无')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
    expect(screen.getByLabelText('重置视口次数')).toHaveTextContent('1')
  })

  it('关闭文献相关概念时清除已经隐藏的概念详情选择', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '文献引用' }))
    await screen.findByLabelText('测试图谱 paper')
    const concepts = screen.getByRole('button', { name: '显示相关概念' })
    await user.click(concepts)
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    await user.click(screen.getByRole('button', { name: '选择上下文节点' }))
    expect(screen.getByRole('heading', { name: '论文相关概念' })).toBeInTheDocument()

    await user.click(concepts)

    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('无')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
  })

  it('关闭文献相关概念时清除已经隐藏的上下文关系选择', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '文献引用' }))
    await screen.findByLabelText('测试图谱 paper')
    const concepts = screen.getByRole('button', { name: '显示相关概念' })
    await user.click(concepts)
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    await user.click(screen.getByRole('button', { name: '选择上下文关系' }))
    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('edge-paper-concept')

    await user.click(concepts)

    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('无')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
  })

  it.each([
    ['概念关系', '测试图谱 concept', '显示相关作者'],
    ['作者合作', '测试图谱 author', '显示相关概念'],
  ])('关闭%s的上下文开关时清除已隐藏节点的详情', async (tabName, canvasName, toggleName) => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    if (tabName !== '概念关系') {
      await user.click(screen.getByRole('tab', { name: tabName }))
      await screen.findByLabelText(canvasName)
    }
    const toggle = screen.getByRole('button', { name: toggleName })
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: '选择上下文节点' }))

    await user.click(toggle)

    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('无')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
  })

  it('作者图与文献引用图分别记忆各自的相关概念开关', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('tab', { name: '作者合作' }))
    await screen.findByLabelText('测试图谱 author')
    await user.click(screen.getByRole('button', { name: '显示相关概念' }))
    expect(screen.getByLabelText('概念上下文状态')).toHaveTextContent('是')

    await user.click(screen.getByRole('tab', { name: '文献引用' }))
    await screen.findByLabelText('测试图谱 paper')
    expect(screen.getByRole('button', { name: '显示相关概念' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('概念上下文状态')).toHaveTextContent('否')
  })

  it('适应画布调用画布句柄，重置清空查询、选择并恢复初始视口', async () => {
    const user = userEvent.setup()
    renderPage(async (view) => makeDataset(view))
    await screen.findByLabelText('测试图谱 concept')
    await user.click(screen.getByRole('button', { name: '选择第一个节点' }))
    const searchbox = screen.getByRole('searchbox', { name: '搜索当前网络中的节点' })
    await user.type(searchbox, '普通')

    await user.click(screen.getByRole('button', { name: '适应画布' }))
    expect(screen.getByLabelText('适应画布次数')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: '重置' }))

    expect(searchbox).toHaveValue('')
    expect(screen.getByText('请选择节点或关系查看详情。')).toBeInTheDocument()
    expect(screen.getByLabelText('当前画布选择')).toHaveTextContent('无')
    expect(screen.getByLabelText('重置视口次数')).toHaveTextContent('1')
  })
})
