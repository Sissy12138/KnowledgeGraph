import { useEffect, useMemo, useRef, useState } from 'react'
import { EdgeInspector } from './EdgeInspector'
import GraphCanvas, { type GraphCanvasHandle } from './GraphCanvas'
import { getGraphDataset } from './graph.service'
import { findMatchingNodes } from './graph-transform'
import type {
  GraphDataset,
  GraphEdge,
  GraphNodeType,
  GraphSelection,
  GraphView,
} from './graph.types'
import GraphToolbar from './GraphToolbar'
import GraphOverlayControls from './GraphOverlayControls'
import { NodeInspector } from './NodeInspector'
import './GraphPage.css'

type LoadGraph = (view: GraphView) => Promise<GraphDataset>

type GraphPageProps = {
  loadGraph?: LoadGraph
}

type RequestState = 'loading' | 'success' | 'error'

const VIEW_LABELS: Record<GraphView, string> = {
  concept: '概念网络',
  method: '方法网络',
  author: '作者合作网络',
  paper: '文献引用网络',
}

/** 编排图谱视图的数据请求、搜索、选择记忆和详情展示。 */
export default function GraphPage({ loadGraph = getGraphDataset }: GraphPageProps) {
  const [view, setView] = useState<GraphView>('concept')
  const [dataset, setDataset] = useState<GraphDataset | null>(null)
  const [requestState, setRequestState] = useState<RequestState>('loading')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<GraphSelection>(null)
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([])
  const [contextConceptId, setContextConceptId] = useState<string | null>(null)
  const [contextAuthorId, setContextAuthorId] = useState<string | null>(null)
  const [showRelatedAuthors, setShowRelatedAuthors] = useState(false)
  const [showRelatedConcepts, setShowRelatedConcepts] = useState(false)
  const [showPaperRelatedConcepts, setShowPaperRelatedConcepts] = useState(false)
  const [showRelatedMethods, setShowRelatedMethods] = useState(false)
  const [showAuthorRelatedMethods, setShowAuthorRelatedMethods] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [canvasError, setCanvasError] = useState('')
  const [canvasAttempt, setCanvasAttempt] = useState(0)
  const requestSequence = useRef(0)
  const canvasRef = useRef<GraphCanvasHandle>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const shouldFocusInspectorRef = useRef(false)
  const selectionMemory = useRef<Partial<Record<GraphView, GraphSelection>>>({})
  const contextConceptMemory = useRef<string | null>(null)
  const contextAuthorMemory = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const requestId = ++requestSequence.current
    // oxlint-disable-next-line react/set-state-in-effect -- 视图 effect 必须在启动请求前立即清除旧画布。
    setRequestState('loading')
    setDataset(null)
    setError('')
    setSelection(null)
    setSelectedPaperIds([])

    Promise.resolve()
      .then(() => {
        if (!active || requestSequence.current !== requestId) return null
        return loadGraph(view)
      })
      .then((nextDataset) => {
        if (!active || requestSequence.current !== requestId || !nextDataset) return

        const rememberedSelection = selectionMemory.current[view]
        const nextSelection = isSelectionAvailable(nextDataset, rememberedSelection)
          ? rememberedSelection ?? null
          : getDefaultSelection(nextDataset)
        selectionMemory.current[view] = nextSelection
        const rememberedContextConcept = view === 'concept'
          && nextDataset.nodes.some((node) =>
            node.id === contextConceptMemory.current && node.nodeType === 'concept')
          ? contextConceptMemory.current
          : nextSelection?.kind === 'node'
            && nextDataset.nodes.some((node) =>
              node.id === nextSelection.id && node.nodeType === 'concept')
            ? nextSelection.id
            : null
        contextConceptMemory.current = rememberedContextConcept
        const rememberedContextAuthor = view === 'author'
          && nextDataset.nodes.some((node) =>
            node.id === contextAuthorMemory.current && node.nodeType === 'author')
          ? contextAuthorMemory.current
          : nextSelection?.kind === 'node'
            && nextDataset.nodes.some((node) =>
              node.id === nextSelection.id && node.nodeType === 'author')
            ? nextSelection.id
            : null
        contextAuthorMemory.current = rememberedContextAuthor
        setDataset(nextDataset)
        setSelection(nextSelection)
        setContextConceptId(rememberedContextConcept)
        setContextAuthorId(rememberedContextAuthor)
        setRequestState('success')
      })
      .catch((reason: unknown) => {
        if (!active || requestSequence.current !== requestId) return
        setError(reason instanceof Error ? reason.message : '知识图谱加载失败，请稍后重试。')
        setRequestState('error')
      })

    return () => {
      active = false
    }
  }, [loadGraph, retryCount, view])

  useEffect(() => {
    if (!shouldFocusInspectorRef.current || !selection) return
    const heading = inspectorRef.current?.querySelector<HTMLElement>('h2')
    if (!heading) return
    heading.focus()
    shouldFocusInspectorRef.current = false
  }, [dataset, selection])

  const isSearchActive = query.trim().length > 0
  const searchResults = useMemo(
    () => dataset && isSearchActive ? findMatchingNodes(dataset, query) : [],
    [dataset, isSearchActive, query],
  )
  const highlightedNodeIds = useMemo(
    () => new Set(searchResults.map((node) => node.id)),
    [searchResults],
  )

  function rememberSelection(nextSelection: GraphSelection) {
    if (view === 'paper' && showPaperRelatedConcepts) {
      if (!nextSelection) return
      if (
        nextSelection.kind === 'node'
        && dataset?.nodes.some((node) => node.id === nextSelection.id && node.nodeType === 'paper')
      ) {
        const nextPaperIds = selectedPaperIds.includes(nextSelection.id)
          ? selectedPaperIds.filter((paperId) => paperId !== nextSelection.id)
          : [...selectedPaperIds, nextSelection.id]
        const nextActivePaperId = nextPaperIds.at(-1)
        const nextActiveSelection: GraphSelection = nextActivePaperId
          ? { kind: 'node', id: nextActivePaperId }
          : null
        setSelectedPaperIds(nextPaperIds)
        selectionMemory.current[view] = nextActiveSelection
        setSelection(nextActiveSelection)
        return
      }
    }

    selectionMemory.current[view] = nextSelection
    if (view === 'concept') {
      if (!nextSelection) {
        contextConceptMemory.current = null
        setContextConceptId(null)
      } else if (
        nextSelection.kind === 'node'
        && dataset?.nodes.some((node) =>
          node.id === nextSelection.id && node.nodeType === 'concept')
      ) {
        contextConceptMemory.current = nextSelection.id
        setContextConceptId(nextSelection.id)
      }
    } else if (view === 'author') {
      if (!nextSelection) {
        contextAuthorMemory.current = null
        setContextAuthorId(null)
      } else if (
        nextSelection.kind === 'node'
        && dataset?.nodes.some((node) =>
          node.id === nextSelection.id && node.nodeType === 'author')
      ) {
        contextAuthorMemory.current = nextSelection.id
        setContextAuthorId(nextSelection.id)
      }
    }
    setSelection(nextSelection)
  }

  function handleViewChange(nextView: GraphView) {
    if (nextView === view) return
    setQuery('')
    setCanvasError('')
    setSelectedPaperIds([])
    setView(nextView)
  }

  function clearContextSelection(
    nodeType: GraphNodeType,
    relationType: GraphEdge['relationType'],
  ) {
    if (!selection || !dataset) return
    const isHiddenNode = selection.kind === 'node'
      && dataset.contextOverlay.nodes.some((node) =>
        node.id === selection.id && node.nodeType === nodeType)
    const isHiddenEdge = selection.kind === 'edge'
      && dataset.contextOverlay.edges.some((edge) =>
        edge.id === selection.id && edge.relationType === relationType)
    if (!isHiddenNode && !isHiddenEdge) return
    selectionMemory.current[view] = null
    setSelection(null)
  }

  function handleResultSelect(nodeId: string) {
    if (!dataset?.nodes.some((node) => node.id === nodeId)) return
    shouldFocusInspectorRef.current = true
    rememberSelection({ kind: 'node', id: nodeId })
    canvasRef.current?.focusNode(nodeId)
    setQuery('')
  }

  function handleReset() {
    setQuery('')
    setSelectedPaperIds([])
    if (!dataset) return
    if (view === 'paper') {
      selectionMemory.current.paper = null
      setSelection(null)
    } else {
      rememberSelection(null)
    }
    canvasRef.current?.resetView()
  }

  return (
    <section aria-labelledby="graph-page-title" className="graph-page">
      <header className="graph-page__header">
        <div>
          <p className="graph-page__eyebrow">KNOWLEDGE EXPLORER</p>
          <h1 id="graph-page-title">知识图谱</h1>
          <p>{VIEW_LABELS[view]}</p>
        </div>
      </header>

      <GraphToolbar
        onFit={() => canvasRef.current?.fitToView()}
        onQueryChange={setQuery}
        onReset={handleReset}
        onResultSelect={handleResultSelect}
        onViewChange={handleViewChange}
        query={query}
        searchResults={searchResults}
        view={view}
      />

      <div
        aria-labelledby={`graph-tab-${view}`}
        id={`graph-panel-${view}`}
        role="tabpanel"
        tabIndex={0}
      >
        {requestState === 'loading' && (
          <div className="graph-page__state" role="status">正在加载知识图谱…</div>
        )}

        {requestState === 'error' && (
          <div className="graph-page__state graph-page__state--error" role="alert">
            <strong>加载失败</strong>
            <span>{error}</span>
            <button onClick={() => setRetryCount((count) => count + 1)} type="button">
              重新加载
            </button>
          </div>
        )}

        {requestState === 'success' && dataset?.nodes.length === 0 && (
          <div className="graph-page__state">
            <strong>当前网络暂无节点</strong>
            <span>切换其他网络，或稍后重新加载。</span>
          </div>
        )}

        {requestState === 'success' && dataset && dataset.nodes.length > 0 && (
          <div className="graph-page__workspace">
            <div className="graph-page__canvas">
              {canvasError ? (
                <div className="graph-page__state graph-page__state--error" role="alert">
                  <strong>画布加载失败</strong>
                  <span>{canvasError}</span>
                  <button
                    onClick={() => {
                      setCanvasError('')
                      setCanvasAttempt((attempt) => attempt + 1)
                    }}
                    type="button"
                  >
                    重试画布
                  </button>
                </div>
              ) : (
                <GraphCanvas
                  contextAuthorId={contextAuthorId}
                  contextConceptId={contextConceptId}
                  dataset={dataset}
                  highlightedNodeIds={highlightedNodeIds}
                  isSearchActive={isSearchActive}
                  key={`${view}-${canvasAttempt}`}
                  onError={setCanvasError}
                  onSelectionChange={rememberSelection}
                  ref={canvasRef}
                  selection={selection}
                  selectedPaperIds={selectedPaperIds}
                  showRelatedAuthors={showRelatedAuthors}
                  showRelatedConcepts={view === 'paper'
                    ? showPaperRelatedConcepts
                    : showRelatedConcepts}
                  showRelatedMethods={view === 'author'
                    ? showAuthorRelatedMethods
                    : showRelatedMethods}
                />
              )}
              {view === 'concept' && !canvasError && (
                <GraphOverlayControls
                  view="concept"
                  onShowRelatedAuthorsChange={(show) => {
                    setShowRelatedAuthors(show)
                    if (!show) clearContextSelection('author', 'conceptAuthor')
                  }}
                  onShowRelatedMethodsChange={(show) => {
                    setShowRelatedMethods(show)
                    if (!show) clearContextSelection('method', 'conceptMethod')
                  }}
                  showRelatedAuthors={showRelatedAuthors}
                  showRelatedMethods={showRelatedMethods}
                />
              )}
              {view === 'author' && !canvasError && (
                <GraphOverlayControls
                  view="author"
                  onShowRelatedConceptsChange={(show) => {
                    setShowRelatedConcepts(show)
                    if (!show) clearContextSelection('concept', 'authorConcept')
                  }}
                  onShowRelatedMethodsChange={(show) => {
                    setShowAuthorRelatedMethods(show)
                    if (!show) clearContextSelection('method', 'authorMethod')
                  }}
                  showRelatedConcepts={showRelatedConcepts}
                  showRelatedMethods={showAuthorRelatedMethods}
                />
              )}
              {view === 'paper' && !canvasError && (
                <GraphOverlayControls
                  view="paper"
                  onShowRelatedConceptsChange={(show) => {
                    setShowPaperRelatedConcepts(show)
                    setSelectedPaperIds([])
                    if (show) {
                      selectionMemory.current.paper = null
                      setSelection(null)
                    } else {
                      clearContextSelection('concept', 'paperConcept')
                    }
                  }}
                  showRelatedConcepts={showPaperRelatedConcepts}
                />
              )}
            </div>
            <aside
              aria-label="图谱详情"
              className="graph-page__inspector"
              ref={inspectorRef}
            >
              {selection?.kind === 'node' && (
                <NodeInspector dataset={dataset} nodeId={selection.id} />
              )}
              {selection?.kind === 'edge' && (
                <EdgeInspector dataset={dataset} edgeId={selection.id} />
              )}
              {!selection && <p>请选择节点或关系查看详情。</p>}
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}

/** 计算每类网络的首个选择；概念网络按论文数最大值选择。 */
function getDefaultSelection(dataset: GraphDataset): GraphSelection {
  if (dataset.nodes.length === 0) return null

  if (dataset.view !== 'concept') {
    return { kind: 'node', id: dataset.nodes[0].id }
  }

  const concept = dataset.nodes.reduce((current, candidate) =>
    (candidate.metrics.paperCount ?? 0) > (current.metrics.paperCount ?? 0)
      ? candidate
      : current,
  )
  return { kind: 'node', id: concept.id }
}

/** 确认会话记忆中的节点或关系仍存在于本次响应。 */
function isSelectionAvailable(
  dataset: GraphDataset,
  selection: GraphSelection | undefined,
): boolean {
  if (!selection) return false
  return selection.kind === 'node'
    ? [...dataset.nodes, ...dataset.contextOverlay.nodes]
      .some((node) => node.id === selection.id)
    : [...dataset.edges, ...dataset.contextOverlay.edges]
      .some((edge) => edge.id === selection.id)
}
