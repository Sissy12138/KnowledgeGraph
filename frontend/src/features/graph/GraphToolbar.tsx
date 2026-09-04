import { useRef, useState, type KeyboardEvent } from 'react'
import type { GraphNode, GraphView } from './graph.types'

type GraphToolbarProps = {
  view: GraphView
  query: string
  searchResults: GraphNode[]
  onViewChange: (view: GraphView) => void
  onQueryChange: (query: string) => void
  onResultSelect: (nodeId: string) => void
  onFit: () => void
  onReset: () => void
}

const graphViews: Array<{ value: GraphView; label: string }> = [
  { value: 'concept', label: '概念关系' },
  { value: 'method', label: '方法网络' },
  { value: 'author', label: '作者合作' },
  { value: 'paper', label: '文献引用' },
]

/** 提供网络视图切换、节点搜索和画布控制操作。 */
export default function GraphToolbar({
  view,
  query,
  searchResults,
  onViewChange,
  onQueryChange,
  onResultSelect,
  onFit,
  onReset,
}: GraphToolbarProps) {
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const safeActiveIndex = Math.min(
    activeResultIndex,
    Math.max(searchResults.length - 1, 0),
  )

  function moveToView(nextIndex: number) {
    const nextView = graphViews[nextIndex]
    onViewChange(nextView.value)
    tabRefs.current[nextIndex]?.focus()
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveToView((index + 1) % graphViews.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveToView((index - 1 + graphViews.length) % graphViews.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveToView(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveToView(graphViews.length - 1)
    }
  }

  function handleResultKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (searchResults.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveResultIndex((safeActiveIndex + 1) % searchResults.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveResultIndex(
        (safeActiveIndex - 1 + searchResults.length) % searchResults.length,
      )
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveResultIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveResultIndex(searchResults.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onResultSelect(searchResults[safeActiveIndex].id)
    }
  }

  return (
    <section className="graph-toolbar" aria-label="知识图谱工具栏">
      <div className="graph-toolbar__tabs" role="tablist" aria-label="网络类型">
        {graphViews.map((graphView, index) => (
          <button
            aria-controls={`graph-panel-${graphView.value}`}
            aria-selected={view === graphView.value}
            className={`graph-toolbar__tab${view === graphView.value ? ' graph-toolbar__tab--active' : ''}`}
            id={`graph-tab-${graphView.value}`}
            key={graphView.value}
            onClick={() => {
              onViewChange(graphView.value)
            }}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            role="tab"
            tabIndex={view === graphView.value ? 0 : -1}
            type="button"
          >
            {graphView.label}
          </button>
        ))}
      </div>

      <div className="graph-toolbar__search">
        <input
          aria-label="搜索当前网络中的节点"
          onChange={(event) => {
            setActiveResultIndex(0)
            onQueryChange(event.target.value)
          }}
          type="search"
          value={query}
        />
        {query.trim() !== '' && (
          <ul
            aria-activedescendant={searchResults.length > 0
              ? `graph-result-${searchResults[safeActiveIndex].id}`
              : undefined}
            aria-label="搜索结果"
            className="graph-toolbar__results"
            onKeyDown={handleResultKeyDown}
            role="listbox"
            tabIndex={0}
          >
            {searchResults.length > 0 ? (
              searchResults.map((node, index) => (
                <li
                  aria-selected={safeActiveIndex === index}
                  id={`graph-result-${node.id}`}
                  key={node.id}
                  onClick={() => {
                    setActiveResultIndex(index)
                    onResultSelect(node.id)
                  }}
                  role="option"
                  tabIndex={-1}
                >
                  {node.label}
                </li>
              ))
            ) : (
              <li aria-disabled="true" aria-selected="false" role="option">
                没有匹配节点
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="graph-toolbar__actions">
        <button onClick={onFit} type="button">适应画布</button>
        <button onClick={onReset} type="button">重置</button>
      </div>
    </section>
  )
}
