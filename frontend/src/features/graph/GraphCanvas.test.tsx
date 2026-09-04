import { createRef, type PropsWithChildren, type ReactNode } from 'react'
import { render as renderUi, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DisplayPreferencesProvider, useDisplayPreferences } from '../../styles/display-preferences'
import type { GraphDataset } from './graph.types'
import GraphCanvas, { type GraphCanvasHandle } from './GraphCanvas'

const {
  convertToPixel,
  dispatchAction,
  dispose,
  getModel,
  init,
  off,
  on,
  resize,
  setOption,
  zrOff,
  zrOn,
} = vi.hoisted(() => {
  const setOption = vi.fn()
  const resize = vi.fn()
  const dispose = vi.fn()
  const on = vi.fn()
  const off = vi.fn()
  const zrOn = vi.fn()
  const zrOff = vi.fn()
  const dispatchAction = vi.fn()
  const graphData = {
    count: () => 1,
    getId: () => 'concept-reversal-learning',
    getItemLayout: () => [25, 40],
  }
  const getModel = vi.fn(() => ({
    getSeries: () => [{ id: 'knowledge-graph', getData: () => graphData }],
  }))
  const convertToPixel = vi.fn(() => [120, 100])
  const getWidth = vi.fn(() => 400)
  const getHeight = vi.fn(() => 300)
  const init = vi.fn(() => ({
    setOption,
    resize,
    dispose,
    on,
    off,
    getZr: () => ({ on: zrOn, off: zrOff }),
    getModel,
    convertToPixel,
    getWidth,
    getHeight,
    dispatchAction,
  }))

  return {
    convertToPixel,
    dispatchAction,
    dispose,
    getModel,
    init,
    off,
    on,
    resize,
    setOption,
    zrOff,
    zrOn,
  }
})

vi.mock('echarts', () => ({ init }))

const dataset: GraphDataset = {
  view: 'concept',
  nodes: [{
    id: 'concept-reversal-learning',
    nodeType: 'concept',
    label: '反转学习',
    description: null,
    sourcePaperIds: [],
    metrics: {},
  }],
  edges: [{
    id: 'edge-learning-reversal',
    sourceId: 'concept-learning',
    targetId: 'concept-reversal-learning',
    relationType: 'broaderThan',
    label: '包含',
    directed: true,
    weight: null,
    evidenceIds: [],
    sourcePaperIds: [],
  }],
  contextOverlay: {
    nodes: [{
      id: 'author-li-ming',
      nodeType: 'author',
      label: '李明',
      description: null,
      sourcePaperIds: [],
      metrics: {},
    }],
    edges: [{
      id: 'edge-context-concept-reversal-learning-author-li-ming',
      sourceId: 'concept-reversal-learning',
      targetId: 'author-li-ming',
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
  nodeDetails: {},
}

const baseProps = {
  dataset,
  selection: null,
  selectedPaperIds: [],
  highlightedNodeIds: new Set<string>(),
  isSearchActive: false,
  contextConceptId: null,
  contextAuthorId: null,
  showRelatedAuthors: false,
  showRelatedConcepts: false,
  showRelatedMethods: false,
  onSelectionChange: vi.fn(),
}

function latestHandler(mock: ReturnType<typeof vi.fn>, eventName: string) {
  return mock.mock.calls.filter(([registeredEvent]) => registeredEvent === eventName).at(-1)?.[1]
}

function render(ui: ReactNode) {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <DisplayPreferencesProvider initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}>
        {children}
      </DisplayPreferencesProvider>
    )
  }

  return renderUi(ui, { wrapper: Wrapper })
}

function PreferenceControls() {
  const { setFontScalePercent, setThemeId } = useDisplayPreferences()
  return <>
    <button onClick={() => setThemeId('warmPaper')}>暖色主题</button>
    <button onClick={() => setFontScalePercent(125)}>125% 字号</button>
  </>
}

describe('GraphCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('以 SVG 渲染器初始化并提供说明性图谱标签', () => {
    render(<GraphCanvas {...baseProps} />)

    const canvas = screen.getByRole('img', {
      name: '概念网络，1 个节点，1 条关系，当前选择：无',
    })
    expect(init).toHaveBeenCalledWith(canvas, undefined, { renderer: 'svg' })
    expect(setOption).toHaveBeenCalledTimes(1)
  })

  it('画布文字摘要随节点和关系选择更新', () => {
    const { rerender } = render(
      <GraphCanvas
        {...baseProps}
        selection={{ kind: 'node', id: 'concept-reversal-learning' }}
      />,
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(/当前选择：反转学习/)

    rerender(
      <GraphCanvas
        {...baseProps}
        selection={{ kind: 'edge', id: 'edge-learning-reversal' }}
      />,
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(/当前选择：包含/)
  })

  it('画布文字摘要使用当前开关下实际可见的节点和关系数量', () => {
    render(
      <GraphCanvas
        {...baseProps}
        contextConceptId="concept-reversal-learning"
        showRelatedAuthors
      />,
    )

    expect(screen.getByRole('img')).toHaveAccessibleName('概念网络，2 个节点，2 条关系，当前选择：无')
  })

  it('ECharts 初始化失败时报告可读错误而不让组件抛出', () => {
    const onError = vi.fn()
    init.mockImplementationOnce(() => {
      throw new Error('SVG renderer unavailable')
    })

    expect(() => render(<GraphCanvas {...baseProps} onError={onError} />)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(
      '图谱画布初始化失败：SVG renderer unavailable',
    )
    expect(on).not.toHaveBeenCalled()
    expect(setOption).not.toHaveBeenCalled()
  })

  it('数据变化全量替换，而搜索和选择变化只按稳定系列 ID 合并呈现', () => {
    const { rerender } = render(<GraphCanvas {...baseProps} />)

    expect(setOption).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({
        series: [expect.objectContaining({ id: 'knowledge-graph' })],
      }),
      true,
    )

    setOption.mockClear()
    rerender(
      <GraphCanvas
        {...baseProps}
        isSearchActive
        highlightedNodeIds={new Set(['concept-reversal-learning'])}
        selection={{ kind: 'node', id: 'concept-reversal-learning' }}
      />,
    )

    expect(setOption).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenLastCalledWith(expect.objectContaining({
      series: [expect.objectContaining({
        id: 'knowledge-graph',
        data: [expect.objectContaining({ id: 'concept-reversal-learning' })],
      })],
    }))

    setOption.mockClear()
    rerender(<GraphCanvas {...baseProps} dataset={{ ...dataset }} />)
    expect(setOption).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenLastCalledWith(expect.any(Object), true)
  })

  it('主题与字号变化沿用同一实例并只合并 presentation', async () => {
    const user = userEvent.setup()
    render(<>
      <GraphCanvas
        {...baseProps}
        isSearchActive
        highlightedNodeIds={new Set(['concept-reversal-learning'])}
        selection={{ kind: 'node', id: 'concept-reversal-learning' }}
      />
      <PreferenceControls />
    </>)
    const initialSeries = setOption.mock.calls[0][0].series[0]
    const initialNode = initialSeries.data[0]

    setOption.mockClear()
    await user.click(screen.getByRole('button', { name: '暖色主题' }))

    expect(init).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenLastCalledWith(expect.objectContaining({
      series: [expect.objectContaining({
        id: 'knowledge-graph',
        data: [expect.objectContaining({
          id: 'concept-reversal-learning',
          symbolSize: initialNode.symbolSize,
          itemStyle: expect.objectContaining({
            color: '#C6DDD3',
            opacity: 1,
            borderColor: '#FFFFFF',
            borderWidth: 5,
          }),
          label: expect.objectContaining({ fontSize: 12 }),
        })],
      })],
    }))
    expect(setOption.mock.calls[0]).toHaveLength(1)

    setOption.mockClear()
    await user.click(screen.getByRole('button', { name: '125% 字号' }))

    expect(init).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenLastCalledWith(expect.objectContaining({
      series: [expect.objectContaining({
        id: 'knowledge-graph',
        data: [expect.objectContaining({
          id: 'concept-reversal-learning',
          symbolSize: initialNode.symbolSize,
          itemStyle: expect.objectContaining({ opacity: 1 }),
          label: expect.objectContaining({ fontSize: 15 }),
        })],
      })],
    }))
    expect(setOption.mock.calls[0]).toHaveLength(1)
  })

  it('将节点、边与空白点击转换为选择回调', () => {
    const onSelectionChange = vi.fn()
    render(<GraphCanvas {...baseProps} onSelectionChange={onSelectionChange} />)

    const clickHandler = latestHandler(on, 'click')
    const blankClickHandler = latestHandler(zrOn, 'click')
    clickHandler({ dataType: 'node', data: { id: 'concept-reversal-learning' } })
    clickHandler({ dataType: 'edge', data: { id: 'edge-learning-reversal' } })
    blankClickHandler({ target: null })
    blankClickHandler({ target: {} })

    expect(onSelectionChange).toHaveBeenNthCalledWith(1, { kind: 'node', id: 'concept-reversal-learning' })
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, { kind: 'edge', id: 'edge-learning-reversal' })
    expect(onSelectionChange).toHaveBeenNthCalledWith(3, null)
    expect(onSelectionChange).toHaveBeenCalledTimes(3)
  })

  it('窗口缩放时重设尺寸，并在卸载时解绑并销毁实例', () => {
    const { unmount } = render(<GraphCanvas {...baseProps} />)

    window.dispatchEvent(new Event('resize'))
    expect(resize).toHaveBeenCalledTimes(1)

    unmount()
    expect(off).toHaveBeenCalledWith('click', expect.any(Function))
    expect(zrOff).toHaveBeenCalledWith('click', expect.any(Function))
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('fitToView 先恢复默认视图再重设尺寸', () => {
    const ref = createRef<GraphCanvasHandle>()
    render(
      <GraphCanvas
        {...baseProps}
        ref={ref}
        isSearchActive
        highlightedNodeIds={new Set(['concept-reversal-learning'])}
        selection={{ kind: 'node', id: 'concept-reversal-learning' }}
      />,
    )
    setOption.mockClear()
    dispatchAction.mockClear()
    resize.mockClear()

    ref.current?.fitToView()

    expect(dispatchAction).toHaveBeenCalledWith({ type: 'restore' })
    expect(setOption).toHaveBeenCalledWith(expect.objectContaining({
      series: [expect.objectContaining({
        id: 'knowledge-graph',
        data: [expect.objectContaining({
          id: 'concept-reversal-learning',
          itemStyle: expect.objectContaining({
            opacity: 1,
            borderColor: '#FFFFFF',
            borderWidth: 5,
          }),
        })],
      })],
    }))
    expect(dispatchAction.mock.invocationCallOrder[0]).toBeLessThan(
      setOption.mock.invocationCallOrder[0],
    )
    expect(setOption.mock.invocationCallOrder[0]).toBeLessThan(
      resize.mock.invocationCallOrder[0],
    )
    expect(resize).toHaveBeenCalledTimes(1)
  })

  it('focusNode 根据节点布局平移视口中心，resetView 恢复初始视图', () => {
    const ref = createRef<GraphCanvasHandle>()
    render(<GraphCanvas {...baseProps} ref={ref} />)
    dispatchAction.mockClear()
    resize.mockClear()

    ref.current?.focusNode('concept-reversal-learning')

    expect(getModel).toHaveBeenCalled()
    expect(convertToPixel).toHaveBeenCalledWith(
      { seriesId: 'knowledge-graph' },
      [25, 40],
    )
    expect(dispatchAction).toHaveBeenCalledWith({
      type: 'graphRoam',
      seriesId: 'knowledge-graph',
      dx: 80,
      dy: 50,
    })

    ref.current?.resetView()
    expect(dispatchAction).toHaveBeenLastCalledWith({ type: 'restore' })
    expect(resize).toHaveBeenCalledTimes(1)
  })
})
