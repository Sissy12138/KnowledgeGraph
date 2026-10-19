import { useRef, useState, type KeyboardEvent } from 'react'
import type { GraphCollection, GraphNode, GraphView } from './graph.types'

type GraphToolbarProps = {
  view: GraphView
  language: 'zh' | 'en'
  collectionKey: string | null
  collections: GraphCollection[]
  query: string
  searchResults: GraphNode[]
  onViewChange: (view: GraphView) => void
  onQueryChange: (query: string) => void
  onResultSelect: (nodeId: string) => void
  onFit: () => void
  onReset: () => void
  onLanguageChange: (language: 'zh' | 'en') => void
  onCollectionChange: (collectionKey: string | null) => void
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
  language,
  collectionKey,
  collections,
  query,
  searchResults,
  onViewChange,
  onQueryChange,
  onResultSelect,
  onFit,
  onReset,
  onLanguageChange,
  onCollectionChange,
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

      <label className="graph-toolbar__scope">
        <span className="graph-toolbar__scope-label">
          <span aria-hidden="true">📁</span>
          文献范围
        </span>
        <select
          aria-label="图谱文献范围"
          title="按 Zotero 文件夹筛选图谱"
          onChange={(event) => onCollectionChange(event.target.value || null)}
          value={collectionKey ?? ''}
        >
          <option value="">全部文件夹</option>
          {collections.map((collection) => (
            <option key={collection.key} value={collection.key}>
              {collection.name}（{collection.paperCount}）
            </option>
          ))}
        </select>
      </label>

      <div className="graph-toolbar__search">
        <label className="graph-toolbar__search-control">
          <span className="graph-toolbar__search-label">
            <span aria-hidden="true">🔍</span>
            搜索节点
          </span>
          <input
            aria-label="搜索当前网络中的节点"
            onChange={(event) => {
              setActiveResultIndex(0)
              onQueryChange(event.target.value)
            }}
            placeholder="输入节点名称"
            type="search"
            value={query}
          />
        </label>
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
        <div className="graph-toolbar__language" aria-label="图谱语言">
          <button
            aria-pressed={language === 'zh'}
            onClick={() => onLanguageChange('zh')}
            type="button"
          >
            中文
          </button>
          <button
            aria-pressed={language === 'en'}
            onClick={() => onLanguageChange('en')}
            type="button"
          >
            English
          </button>
        </div>
        <button onClick={onFit} type="button">适应画布</button>
        <button onClick={onReset} type="button">重置</button>
      </div>
    </section>
  )
}
