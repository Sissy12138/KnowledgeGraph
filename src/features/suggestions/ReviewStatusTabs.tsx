import type { SuggestionStatus } from './suggestion.types'

type ReviewStatusTabsProps = {
  value: SuggestionStatus
  counts: Record<SuggestionStatus, number>
  onChange: (status: SuggestionStatus) => void
}

const tabs: Array<{ status: SuggestionStatus; label: string }> = [
  { status: 'pending', label: '待审核' },
  { status: 'accepted', label: '已采纳' },
  { status: 'rejected', label: '拒绝意见' },
]

/** 在三种审核状态之间切换，并显示每种状态的建议数量。 */
export default function ReviewStatusTabs({
  value,
  counts,
  onChange,
}: ReviewStatusTabsProps) {
  return (
    <div className="review-status-tabs" role="tablist" aria-label="审核状态">
      {tabs.map((tab) => (
        <button
          aria-controls="review-status-panel"
          aria-selected={value === tab.status}
          className={`review-status-tabs__tab${value === tab.status ? ' review-status-tabs__tab--active' : ''}`}
          id={`review-tab-${tab.status}`}
          key={tab.status}
          onClick={() => onChange(tab.status)}
          role="tab"
          type="button"
        >
          {tab.label} <span>{counts[tab.status]}</span>
        </button>
      ))}
    </div>
  )
}
