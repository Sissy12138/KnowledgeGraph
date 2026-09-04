import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode, GraphView } from './graph.types'
import GraphToolbar from './GraphToolbar'

const conceptNode: GraphNode = {
  id: 'concept-reversal-learning',
  nodeType: 'concept',
  label: '反转学习',
  description: '通过改变奖惩规则来研究认知灵活性的任务。',
  sourcePaperIds: ['paper-001'],
  metrics: { paperCount: 1 },
}

const methodNode: GraphNode = {
  ...conceptNode,
  id: 'method-fmri',
  nodeType: 'method',
  label: '功能磁共振成像',
}

const baseProps = {
  view: 'concept' as const,
  query: '',
  searchResults: [] as GraphNode[],
  onViewChange: vi.fn(),
  onQueryChange: vi.fn(),
  onResultSelect: vi.fn(),
  onFit: vi.fn(),
  onReset: vi.fn(),
}

describe('GraphToolbar', () => {
  it('显示四个网络标签、正确映射视图且仅当前标签被选中', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    render(<GraphToolbar {...baseProps} onViewChange={onViewChange} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(4)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '概念关系',
      '方法网络',
      '作者合作',
      '文献引用',
    ])
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: '概念关系' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: '方法网络' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: '概念关系' })).toHaveAttribute(
      'aria-controls',
      'graph-panel-concept',
    )
    expect(screen.getByRole('tab', { name: '概念关系' })).toHaveAttribute(
      'id',
      'graph-tab-concept',
    )
    await user.click(screen.getByRole('tab', { name: '作者合作' }))
    expect(onViewChange).toHaveBeenCalledWith('author')
  })

  it('用方向键、Home 和 End 移动标签焦点并报告目标视图', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    render(<GraphToolbar {...baseProps} onViewChange={onViewChange} />)

    const conceptTab = screen.getByRole('tab', { name: '概念关系' })
    conceptTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '方法网络' })).toHaveFocus()
    expect(onViewChange).toHaveBeenLastCalledWith('method')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: '文献引用' })).toHaveFocus()
    expect(onViewChange).toHaveBeenLastCalledWith('paper')
    await user.keyboard('{Home}')
    expect(conceptTab).toHaveFocus()
    expect(onViewChange).toHaveBeenLastCalledWith('concept')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '文献引用' })).toHaveFocus()
    expect(onViewChange).toHaveBeenLastCalledWith('paper')
  })

  it('受控切换时逐项映射四个标签并始终只选择当前视图', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    function ControlledToolbar() {
      const [view, setView] = useState<GraphView>('concept')

      return (
        <GraphToolbar
          {...baseProps}
          view={view}
          onViewChange={(nextView) => {
            onViewChange(nextView)
            setView(nextView)
          }}
        />
      )
    }
    render(<ControlledToolbar />)

    const mappings: Array<[string, GraphView]> = [
      ['概念关系', 'concept'],
      ['方法网络', 'method'],
      ['作者合作', 'author'],
      ['文献引用', 'paper'],
    ]
    for (const [label, view] of mappings) {
      await user.click(screen.getByRole('tab', { name: label }))
      expect(onViewChange).toHaveBeenLastCalledWith(view)
      expect(screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
    }
  })

  it('输入搜索词并选择匹配节点', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    const onResultSelect = vi.fn()
    function ControlledToolbar() {
      const [query, setQuery] = useState('')

      return (
        <GraphToolbar
          {...baseProps}
          query={query}
          searchResults={[conceptNode]}
          onQueryChange={(nextQuery) => {
            onQueryChange(nextQuery)
            setQuery(nextQuery)
          }}
          onResultSelect={onResultSelect}
        />
      )
    }
    render(<ControlledToolbar />)

    await user.type(
      screen.getByRole('searchbox', { name: '搜索当前网络中的节点' }),
      '反转',
    )
    expect(onQueryChange).toHaveBeenLastCalledWith('反转')
    await user.click(screen.getByRole('option', { name: '反转学习' }))
    expect(onResultSelect).toHaveBeenCalledWith('concept-reversal-learning')
  })

  it('查询无匹配结果时显示空态提示', () => {
    render(<GraphToolbar {...baseProps} query="不存在" />)

    expect(screen.getByText('没有匹配节点')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '没有匹配节点' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('纯空白查询不打开搜索结果列表', () => {
    render(<GraphToolbar {...baseProps} query="   " />)

    expect(screen.queryByRole('listbox', { name: '搜索结果' })).not.toBeInTheDocument()
  })

  it('用 listbox 的方向键移动结果焦点并选择当前结果', async () => {
    const user = userEvent.setup()
    const onResultSelect = vi.fn()
    render(
      <GraphToolbar
        {...baseProps}
        query="学习"
        searchResults={[conceptNode, methodNode]}
        onResultSelect={onResultSelect}
      />,
    )

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options.every((option) => option.getAttribute('tabindex') === '-1')).toBe(true)
    expect(options.filter((option) => option.getAttribute('aria-selected') === 'true')).toHaveLength(1)

    listbox.focus()
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(onResultSelect).toHaveBeenCalledWith('method-fmri')
  })

  it('搜索结果缩减后保留有效的活动结果而不崩溃', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <GraphToolbar
        {...baseProps}
        query="学习"
        searchResults={[conceptNode, methodNode]}
      />,
    )

    const listbox = screen.getByRole('listbox')
    listbox.focus()
    await user.keyboard('{ArrowDown}')
    expect(listbox).toHaveAttribute('aria-activedescendant', 'graph-result-method-fmri')

    expect(() => rerender(
      <GraphToolbar
        {...baseProps}
        query="学习"
        searchResults={[conceptNode]}
      />,
    )).not.toThrow()
    expect(screen.getByRole('listbox')).toHaveAttribute(
      'aria-activedescendant',
      'graph-result-concept-reversal-learning',
    )
  })

  it('报告适应画布和重置操作', async () => {
    const user = userEvent.setup()
    const onFit = vi.fn()
    const onReset = vi.fn()
    render(<GraphToolbar {...baseProps} onFit={onFit} onReset={onReset} />)

    await user.click(screen.getByRole('button', { name: '适应画布' }))
    await user.click(screen.getByRole('button', { name: '重置' }))

    expect(onFit).toHaveBeenCalledTimes(1)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
