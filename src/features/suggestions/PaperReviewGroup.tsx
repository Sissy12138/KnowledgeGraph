import type { SuggestionPaperGroup } from './suggestion-grouping'
import SuggestionTypeSection from './SuggestionTypeSection'
import type { ResolutionSelection, ReviewedSuggestionStatus, Suggestion } from './suggestion.types'

type PaperReviewGroupProps = {
  group: SuggestionPaperGroup
  expanded: boolean
  onToggle: () => void
  busyId?: string | null
  onReviewOne?: (
    suggestion: Suggestion,
    status: ReviewedSuggestionStatus,
    reviewComment: string | null,
    selections?: ResolutionSelection[],
  ) => Promise<void>
  batchBusy?: boolean
  onReviewMany?: (
    ids: string[],
    status: ReviewedSuggestionStatus,
    scopeLabel: string,
  ) => void
}

/** 显示单篇论文的审核摘要，并独立控制该论文的展开状态。 */
export default function PaperReviewGroup({
  group,
  expanded,
  onToggle,
  busyId = null,
  onReviewOne,
  batchBusy = false,
  onReviewMany,
}: PaperReviewGroupProps) {
  const contentId = `paper-review-content-${group.paperId}`

  return (
    <article className="paper-review-group" aria-label={`论文：${group.paperTitle}`}>
      <header className="paper-review-group__header">
        <div>
          <h2>{group.paperTitle}</h2>
          <span>{group.total} 条建议</span>
        </div>
        <div className="paper-review-group__actions">
          {onReviewMany && group.total > 0 && (
            <>
              <button
                aria-label="批量拒绝整篇论文"
                className="batch-action batch-action--decision batch-action--reject"
                disabled={batchBusy}
                onClick={() =>
                  onReviewMany(
                    group.categories.flatMap((category) =>
                      category.items.map((item) => item.id),
                    ),
                    'rejected',
                    group.paperTitle,
                  )
                }
                type="button"
                title="批量拒绝整篇论文"
              >
                ×
              </button>
              <button
                aria-label="批量采纳整篇论文"
                className="batch-action batch-action--decision batch-action--accept"
                disabled={batchBusy}
                onClick={() =>
                  onReviewMany(
                    group.categories.flatMap((category) =>
                      category.items.map((item) => item.id),
                    ),
                    'accepted',
                    group.paperTitle,
                  )
                }
                type="button"
                title="批量采纳整篇论文"
              >
                √
              </button>
            </>
          )}
          <button
            aria-label={`${expanded ? '收起' : '展开'}论文：${group.paperTitle}`}
            aria-controls={contentId}
            aria-expanded={expanded}
            className="batch-action batch-action--toggle"
            onClick={onToggle}
            type="button"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>
      </header>
      {expanded && (
        <div className="paper-review-group__content" id={contentId}>
          {group.categories.map((category) => (
            <SuggestionTypeSection
              busyId={busyId}
              category={category}
              key={category.action}
              onReviewOne={onReviewOne}
            />
          ))}
        </div>
      )}
    </article>
  )
}
