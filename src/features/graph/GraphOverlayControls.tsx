type ConceptOverlayControlsProps = {
  view: 'concept'
  showRelatedAuthors: boolean
  showRelatedMethods: boolean
  onShowRelatedAuthorsChange: (show: boolean) => void
  onShowRelatedMethodsChange: (show: boolean) => void
}

type AuthorOverlayControlsProps = {
  view: 'author'
  showRelatedConcepts: boolean
  showRelatedMethods: boolean
  onShowRelatedConceptsChange: (show: boolean) => void
  onShowRelatedMethodsChange: (show: boolean) => void
}

type PaperOverlayControlsProps = {
  view: 'paper'
  showRelatedConcepts: boolean
  onShowRelatedConceptsChange: (show: boolean) => void
}

type GraphOverlayControlsProps =
  | ConceptOverlayControlsProps
  | AuthorOverlayControlsProps
  | PaperOverlayControlsProps

/** 控制概念或作者图中按需展开的上下文节点。 */
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
