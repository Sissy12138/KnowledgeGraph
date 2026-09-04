import type { SuggestionCategoryGroup } from './suggestion-grouping'
import type { Suggestion } from './suggestion.types'
import SuggestionReviewCard from './SuggestionReviewCard'

type SuggestionTypeSectionProps = {
  category: SuggestionCategoryGroup
  busyId?: string | null
  onAccept?: (
    suggestion: Suggestion,
    selectedIds: string[],
    labelOverrides: Record<string, string>,
  ) => Promise<void>
  onReject?: (suggestion: Suggestion, reason: string | null) => Promise<void>
}

/** 显示论文内的一种 v05 operation，并为空类别保留明确占位。 */
export default function SuggestionTypeSection({
  category,
  busyId = null,
  onAccept,
  onReject,
}: SuggestionTypeSectionProps) {
  return (
    <section className="suggestion-type-section" aria-label={`${category.label}模块`}>
      <header className="suggestion-type-section__header">
        <h3>{category.label} <span>{category.items.length}</span></h3>
      </header>
      {category.items.length === 0 ? (
        <p className="suggestion-type-section__empty">暂无建议</p>
      ) : (
        <div className="suggestion-type-section__items">
          {category.items.map((suggestion) => (
            <SuggestionReviewCard
              busy={busyId === suggestion.id}
              key={suggestion.id}
              onAccept={onAccept}
              onReject={onReject}
              suggestion={suggestion}
            />
          ))}
        </div>
      )}
    </section>
  )
}
