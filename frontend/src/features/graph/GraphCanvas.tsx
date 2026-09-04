import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'
import { useDisplayPreferences } from '../../styles/display-preferences'
import {
  buildGraphOption,
  buildGraphPresentationOption,
  getVisibleGraphCounts,
  GRAPH_SERIES_ID,
} from './graph-transform'
import type { GraphPresentation } from './graph-transform'
import type { GraphDataset, GraphSelection, GraphView } from './graph.types'

export type GraphCanvasHandle = {
  fitToView: () => void
  focusNode: (nodeId: string) => void
  resetView: () => void
}

export type GraphCanvasProps = {
  dataset: GraphDataset
  selection: GraphSelection
  selectedPaperIds: string[]
  highlightedNodeIds: Set<string>
  isSearchActive: boolean
  contextConceptId: string | null
  contextAuthorId: string | null
  showRelatedAuthors: boolean
  showRelatedConcepts: boolean
  showRelatedMethods: boolean
  onError?: (message: string) => void
  onSelectionChange: (selection: GraphSelection) => void
}

const VIEW_LABELS: Record<GraphView, string> = {
  concept: '概念网络',
  method: '方法网络',
  author: '作者合作网络',
  paper: '文献引用网络',
}

type GraphClickEvent = {
  dataType?: unknown
  data?: unknown
}

/** 管理 ECharts 图谱的生命周期，并将画布交互转换为 React 选择状态。 */
const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    dataset,
    selection,
    selectedPaperIds,
    highlightedNodeIds,
    isSearchActive,
    contextConceptId,
    contextAuthorId,
    showRelatedAuthors,
    showRelatedConcepts,
    showRelatedMethods,
    onError,
    onSelectionChange,
  },
  ref,
) {
  const { themeId, fontScalePercent } = useDisplayPreferences()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts | null>(null)
  const renderedDatasetRef = useRef<GraphDataset | null>(null)
  const latestDatasetRef = useRef(dataset)
  const latestPresentationRef = useRef<GraphPresentation>({
    selected: selection,
    selectedPaperIds,
    highlightedNodeIds,
    isSearchActive,
    contextConceptId,
    contextAuthorId,
    showRelatedAuthors,
    showRelatedConcepts,
    showRelatedMethods,
    themeId,
    fontScalePercent,
  })
  const errorCallbackRef = useRef(onError)
  const selectionCallbackRef = useRef(onSelectionChange)

  useEffect(() => {
    errorCallbackRef.current = onError
  }, [onError])

  useEffect(() => {
    selectionCallbackRef.current = onSelectionChange
  }, [onSelectionChange])

  useImperativeHandle(ref, () => ({
    fitToView: () => fitCurrentPresentation(
      chartRef.current,
      latestDatasetRef.current,
      latestPresentationRef.current,
    ),
    focusNode: (nodeId) => focusNodeInViewport(chartRef.current, nodeId),
    resetView: () => restoreInitialView(chartRef.current),
  }), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let chart: ECharts
    try {
      chart = echarts.init(container, undefined, { renderer: 'svg' })
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : '未知错误'
      errorCallbackRef.current?.(`图谱画布初始化失败：${detail}`)
      return
    }
    chartRef.current = chart
    const handleChartClick = (event: GraphClickEvent) => {
      const id = typeof event.data === 'object' && event.data !== null && 'id' in event.data
        ? event.data.id
        : undefined
      if (typeof id !== 'string') return
      if (event.dataType === 'node') {
        selectionCallbackRef.current({ kind: 'node', id })
      } else if (event.dataType === 'edge') {
        selectionCallbackRef.current({ kind: 'edge', id })
      }
    }
    const handleBlankClick = (event: { target?: unknown }) => {
      if (!event.target) selectionCallbackRef.current(null)
    }
    const handleResize = () => chart.resize()
    const zrender = chart.getZr()

    chart.on('click', handleChartClick)
    zrender.on('click', handleBlankClick)
    window.addEventListener('resize', handleResize)

    return () => {
      chart.off('click', handleChartClick)
      zrender.off('click', handleBlankClick)
      window.removeEventListener('resize', handleResize)
      chart.dispose()
      chartRef.current = null
      renderedDatasetRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const presentation = {
      selected: selection,
      selectedPaperIds,
      highlightedNodeIds,
      isSearchActive,
      contextConceptId,
      contextAuthorId,
      showRelatedAuthors,
      showRelatedConcepts,
      showRelatedMethods,
      themeId,
      fontScalePercent,
    }
    latestDatasetRef.current = dataset
    latestPresentationRef.current = presentation

    if (renderedDatasetRef.current !== dataset) {
      chart.setOption(buildGraphOption(dataset, presentation), true)
      renderedDatasetRef.current = dataset
      return
    }

    chart.setOption(buildGraphPresentationOption(dataset, presentation))
  }, [
    contextConceptId,
    contextAuthorId,
    dataset,
    highlightedNodeIds,
    isSearchActive,
    fontScalePercent,
    selection,
    selectedPaperIds,
    showRelatedAuthors,
    showRelatedConcepts,
    showRelatedMethods,
    themeId,
  ])

  const selectionLabel = selection?.kind === 'node'
    ? [...dataset.nodes, ...dataset.contextOverlay.nodes]
      .find((node) => node.id === selection.id)?.label
    : selection?.kind === 'edge'
      ? [...dataset.edges, ...dataset.contextOverlay.edges]
        .find((edge) => edge.id === selection.id)?.label
      : null
  const { nodeCount, edgeCount } = getVisibleGraphCounts(dataset, {
    selected: selection,
    selectedPaperIds,
    highlightedNodeIds,
    isSearchActive,
    contextConceptId,
    contextAuthorId,
    showRelatedAuthors,
    showRelatedConcepts,
    showRelatedMethods,
    themeId,
    fontScalePercent,
  })
  const graphLabel = `${VIEW_LABELS[dataset.view]}，${nodeCount} 个节点，${edgeCount} 条关系，当前选择：${selectionLabel ?? '无'}`

  return <div aria-label={graphLabel} ref={containerRef} role="img" />
})

/** 恢复当前数据集首次渲染时的完整视口。 */
function restoreInitialView(chart: ECharts | null) {
  if (!chart) return
  chart.dispatchAction({ type: 'restore' })
  chart.resize()
}

/** 适应当前画布视口，同时恢复 restore 会撤销的选择与搜索呈现。 */
function fitCurrentPresentation(
  chart: ECharts | null,
  dataset: GraphDataset,
  presentation: GraphPresentation,
) {
  if (!chart) return
  chart.dispatchAction({ type: 'restore' })
  chart.setOption(buildGraphPresentationOption(dataset, presentation))
  chart.resize()
}

/** 读取力导向节点的当前布局坐标，并把目标平移到画布中心。 */
function focusNodeInViewport(chart: ECharts | null, nodeId: string) {
  if (!chart) return
  // ECharts 暂未把读取当前力导向布局暴露为公开类型，只在此处收窄运行时接口。
  const model = (chart as unknown as GraphChartRuntime).getModel()
  const series = model.getSeries().find((candidate) =>
    candidate.id === GRAPH_SERIES_ID,
  )
  const data = series?.getData()
  if (!data) return

  let dataIndex = -1
  for (let index = 0; index < data.count(); index += 1) {
    if (data.getId(index) === nodeId) {
      dataIndex = index
      break
    }
  }
  if (dataIndex < 0) return

  const layout = data.getItemLayout(dataIndex)
  if (
    !Array.isArray(layout)
    || layout.length < 2
    || typeof layout[0] !== 'number'
    || typeof layout[1] !== 'number'
  ) return
  const pixel = chart.convertToPixel({ seriesId: GRAPH_SERIES_ID }, layout)
  if (
    !Array.isArray(pixel)
    || pixel.length < 2
    || typeof pixel[0] !== 'number'
    || typeof pixel[1] !== 'number'
  ) return

  chart.dispatchAction({
    type: 'graphRoam',
    seriesId: GRAPH_SERIES_ID,
    dx: chart.getWidth() / 2 - pixel[0],
    dy: chart.getHeight() / 2 - pixel[1],
  })
}

type GraphChartRuntime = {
  getModel: () => {
    getSeries: () => Array<{
      id: string
      getData: () => {
        count: () => number
        getId: (index: number) => string
        getItemLayout: (index: number) => unknown
      }
    }>
  }
}

export default GraphCanvas
