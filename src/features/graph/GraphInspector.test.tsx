import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  authorGraphMock,
  conceptGraphMock,
  methodGraphMock,
  paperGraphMock,
} from './graph.mock'
import { EdgeInspector } from './EdgeInspector'
import { NodeInspector } from './NodeInspector'
import type { GraphDataset } from './graph.types'

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const emptyDisplayDataset: GraphDataset = {
  view: 'author',
  nodes: [
    { id: 'author-primary', nodeType: 'author', label: '', description: null, sourcePaperIds: ['paper-empty'], metrics: {} },
    { id: 'author-collaborator', nodeType: 'author', label: '', description: null, sourcePaperIds: [], metrics: {} },
  ],
  edges: [
    { id: 'edge-empty-author', sourceId: 'author-primary', targetId: 'author-collaborator', relationType: 'coAuthor', label: '', directed: false, weight: 1, evidenceIds: [], sourcePaperIds: ['paper-empty'] },
    { id: 'edge-empty-evidence', sourceId: 'author-primary', targetId: 'author-collaborator', relationType: 'relatedTo', label: '', directed: true, weight: null, evidenceIds: ['evidence-empty'], sourcePaperIds: ['paper-empty'] },
  ],
  contextOverlay: { nodes: [], edges: [] },
  evidence: [{ id: 'evidence-empty', paperId: 'paper-empty', section: null, text: '' }],
  papers: {
    'paper-empty': { id: 'paper-empty', title: '', authorNames: [], year: null, journal: null },
  },
  relatedNodeLabels: {},
  nodeDetails: {
    'author-primary': { nodeId: 'author-primary', nodeType: 'author', orcid: null, affiliations: [], paperIds: ['paper-empty'] },
    'author-collaborator': { nodeId: 'author-collaborator', nodeType: 'author', orcid: null, affiliations: [], paperIds: [] },
  },
}

describe('Graph inspectors', () => {
  it('概念详情显示定义并允许切换论文排序', async () => {
    const user = userEvent.setup()
    renderWithRouter(<NodeInspector dataset={conceptGraphMock} nodeId="concept-reversal-learning" />)

    expect(screen.getByRole('heading', { name: '反转学习' })).toBeInTheDocument()
    expect(screen.getByText('在奖惩规则改变后更新行为策略的能力。')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('关联论文排序'), 'year')
    expect(screen.getAllByTestId('related-paper')[0]).toHaveTextContent('2025')
  })

  it('概念详情分别显示概念层级，并为关联论文展示完整书目信息', () => {
    renderWithRouter(<NodeInspector dataset={conceptGraphMock} nodeId="concept-reversal-learning" />)

    const detail = screen.getByLabelText('概念详情')
    expect(detail).toHaveTextContent('上位概念：学习')
    expect(detail).toHaveTextContent('下位概念：暂无数据')
    expect(detail).toHaveTextContent('相关概念：认知控制、价值更新')

    const paper = within(detail).getAllByTestId('related-paper')[0]
    expect(paper).toHaveTextContent('作者：李明、王芳')
    expect(paper).toHaveTextContent('期刊：Nature Neuroscience')
    expect(paper).toHaveTextContent('年份：2025')
    expect(paper).toHaveTextContent('JIF 25（2024）')
  })

  it('作者详情显示 ORCID、单位、论文和主要合作边摘要', () => {
    renderWithRouter(<NodeInspector dataset={authorGraphMock} nodeId="author-li-ming" />)

    expect(screen.getByText(/ORCID/)).toBeInTheDocument()
    expect(screen.getByText('0000-0002-1825-0097')).toBeInTheDocument()
    expect(screen.getByText('研知大学认知科学中心')).toBeInTheDocument()
    expect(screen.getByText('主要合作')).toBeInTheDocument()
    expect(screen.getByText('王芳：2 篇共同论文')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /查看论文/ })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/papers\//),
    )
  })

  it('方法和论文详情显示各自的专有元数据', () => {
    const { rerender } = renderWithRouter(
      <NodeInspector dataset={methodGraphMock} nodeId="method-rl-model" />,
    )

    expect(screen.getByText('计算建模')).toBeInTheDocument()
    expect(screen.getByText('拟合试次级价值与学习率。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看论文：价值更新中的网络动力学/ })).toHaveAttribute(
      'href',
      '/papers/paper-002',
    )

    rerender(
      <MemoryRouter>
      <NodeInspector dataset={methodGraphMock} nodeId="paper-001" />
      </MemoryRouter>,
    )
    expect(screen.getByText('JIF 25（2024）')).toBeInTheDocument()
    expect(screen.getByText('李明、王芳')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('Nature Neuroscience')).toBeInTheDocument()
    expect(screen.getByLabelText('论文详情')).toHaveTextContent('概念：反转学习、认知控制')
    expect(screen.getByLabelText('论文详情')).toHaveTextContent('方法：功能磁共振')
    expect(screen.getByText('反转阶段的认知控制信号增强。')).toBeInTheDocument()
  })

  it('文献详情从 cites 边分别列出引用论文与引用本文的论文', () => {
    renderWithRouter(<NodeInspector dataset={paperGraphMock} nodeId="paper-002" />)

    const detail = screen.getByLabelText('论文详情')
    expect(detail).toHaveTextContent('引用论文：适应性决策的脑电标记')
    expect(detail).toHaveTextContent('被引用论文：反转学习中的认知灵活性与前额叶活动')
  })

  it('缺失节点资料时统一显示暂无数据', () => {
    renderWithRouter(<NodeInspector dataset={authorGraphMock} nodeId="missing-node" />)

    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('合作边显示权重和共同论文', () => {
    renderWithRouter(
      <EdgeInspector
        dataset={authorGraphMock}
        edgeId="edge-author-li-ming-author-wang-fang"
      />,
    )

    expect(screen.getByText('共同论文：2 篇')).toBeInTheDocument()
    const paperLinks = screen.getAllByRole('link')
    expect(paperLinks).toHaveLength(2)
    expect(paperLinks[0]).toHaveAttribute('href', '/papers/paper-001')
    expect(paperLinks[1]).toHaveAttribute('href', '/papers/paper-002')
  })

  it('普通关系显示来源论文和原文证据，缺失时显示统一回退', () => {
    const { rerender } = renderWithRouter(
      <EdgeInspector dataset={conceptGraphMock} edgeId="edge-concept-learning-reversal" />,
    )

    expect(screen.getByText('Reversal trials increased adaptive control signals.')).toBeInTheDocument()
    expect(screen.getByText('包含')).toBeInTheDocument()
    expect(screen.getByLabelText('关系详情')).toHaveTextContent('源节点：学习')
    expect(screen.getByLabelText('关系详情')).toHaveTextContent('目标节点：反转学习')
    expect(screen.getByLabelText('关系详情')).toHaveTextContent('方向：有向')
    expect(screen.getByRole('link', { name: /反转学习中的认知灵活性/ })).toHaveAttribute(
      'href',
      '/papers/paper-001',
    )

    rerender(
      <MemoryRouter>
        <EdgeInspector dataset={conceptGraphMock} edgeId="edge-concept-reversal-value" />
      </MemoryRouter>,
    )
    expect(screen.getByText('暂无原文证据')).toBeInTheDocument()
  })

  it('空字符串详情使用统一回退而不渲染空白内容', () => {
    const { rerender } = renderWithRouter(
      <NodeInspector dataset={emptyDisplayDataset} nodeId="author-primary" />,
    )

    expect(screen.getByRole('heading', { name: '暂无数据' })).toBeInTheDocument()
    expect(screen.getByLabelText('作者详情')).toHaveTextContent('暂无数据：1 篇共同论文')
    expect(screen.getByRole('link', { name: '查看论文：暂无数据' })).toHaveAttribute(
      'href',
      '/papers/paper-empty',
    )

    rerender(
      <MemoryRouter>
        <EdgeInspector dataset={emptyDisplayDataset} edgeId="edge-empty-evidence" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: '暂无数据' })).toBeInTheDocument()
    expect(screen.getByLabelText('关系详情')).toHaveTextContent('源节点：暂无数据')
    expect(screen.getByLabelText('关系详情')).toHaveTextContent('目标节点：暂无数据')
    expect(screen.getByLabelText('关系详情')).toHaveTextContent('方向：有向')
    expect(screen.getByRole('link', { name: '暂无数据' })).toHaveAttribute('href', '/papers/paper-empty')
    expect(screen.getByText('暂无原文证据')).toBeInTheDocument()
  })
})
