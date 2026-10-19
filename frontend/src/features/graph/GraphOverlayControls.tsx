import type { AuthorNetworkMode } from './graph.types'

type ConceptOverlayControlsProps = {
  view: 'concept'
  showRelatedAuthors: boolean
  showRelatedMethods: boolean
  onShowRelatedAuthorsChange: (show: boolean) => void
  onShowRelatedMethodsChange: (show: boolean) => void
}

type AuthorOverlayControlsProps = {
  view: 'author'
  authorMode: AuthorNetworkMode
  canExpandSelectedAuthor: boolean
  expandedSelectedAuthor: boolean
  showRelatedConcepts: boolean
  showRelatedMethods: boolean
  onAuthorModeChange: (mode: AuthorNetworkMode) => void
  onExpandedSelectedAuthorChange: (expanded: boolean) => void
  onShowRelatedConceptsChange: (show: boolean) => void
  onShowRelatedMethodsChange: (show: boolean) => void
}

type PaperOverlayControlsProps = {
  view: 'paper'
  showRelatedConcepts: boolean
  showRelatedMethods: boolean
  onShowRelatedConceptsChange: (show: boolean) => void
  onShowRelatedMethodsChange: (show: boolean) => void
}

type MethodOverlayControlsProps = {
  view: 'method'
  showRelatedConcepts: boolean
  onShowRelatedConceptsChange: (show: boolean) => void
}

type GraphOverlayControlsProps =
  | ConceptOverlayControlsProps
  | AuthorOverlayControlsProps
  | MethodOverlayControlsProps
  | PaperOverlayControlsProps

/** 控制各关系网络中按需展开的上下文节点。 */
export default function GraphOverlayControls(props: GraphOverlayControlsProps) {
  if (props.view === 'paper') {
    return (
      <div className="graph-overlay-controls" aria-label="文献关联显示选项">
        <button
          type="button"
          aria-pressed={props.showRelatedConcepts}
          onClick={() => props.onShowRelatedConceptsChange(!props.showRelatedConcepts)}
        >
          显示相关概念
        </button>
        <button
          type="button"
          aria-pressed={props.showRelatedMethods}
          onClick={() => props.onShowRelatedMethodsChange(!props.showRelatedMethods)}
        >
          显示相关方法
        </button>
      </div>
    )
  }

  if (props.view === 'method') {
    return (
      <div className="graph-overlay-controls" aria-label="方法关联显示选项">
        <button
          type="button"
          aria-pressed={props.showRelatedConcepts}
          onClick={() => props.onShowRelatedConceptsChange(!props.showRelatedConcepts)}
        >
          显示相关概念
        </button>
      </div>
    )
  }

  const firstPressed = props.view === 'concept'
    ? props.showRelatedAuthors
    : props.showRelatedConcepts
  const firstLabel = props.view === 'concept' ? '显示相关作者' : '显示相关概念'
  const handleFirstChange = () => {
    if (props.view === 'concept') {
      props.onShowRelatedAuthorsChange(!props.showRelatedAuthors)
    } else {
      props.onShowRelatedConceptsChange(!props.showRelatedConcepts)
    }
  }

  return (
    <div
      className="graph-overlay-controls"
      aria-label={`${props.view === 'concept' ? '概念' : '作者'}关联显示选项`}
    >
      {props.view === 'author' && (
        <>
          <label className="graph-overlay-controls__select">
            作者范围
            <select
              aria-label="作者网络范围"
              value={props.authorMode}
              onChange={(event) => props.onAuthorModeChange(event.target.value as AuthorNetworkMode)}
            >
              <option value="core">仅核心作者</option>
              <option value="coreBridge">核心 + 桥接作者</option>
              <option value="all">全部作者</option>
            </select>
          </label>
          <button
            type="button"
            aria-pressed={props.expandedSelectedAuthor}
            disabled={!props.canExpandSelectedAuthor}
            onClick={() => props.onExpandedSelectedAuthorChange(!props.expandedSelectedAuthor)}
          >
            {props.expandedSelectedAuthor ? '收起当前作者合作圈' : '展开当前作者全部合作者'}
          </button>
        </>
      )}
      <button
        type="button"
        aria-pressed={firstPressed}
        onClick={handleFirstChange}
      >
        {firstLabel}
      </button>
      <button
        type="button"
        aria-pressed={props.showRelatedMethods}
        onClick={() => props.onShowRelatedMethodsChange(!props.showRelatedMethods)}
      >
        显示相关方法
      </button>
    </div>
  )
}
