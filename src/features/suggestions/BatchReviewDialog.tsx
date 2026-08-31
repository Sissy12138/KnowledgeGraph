import { useState } from 'react'
import type { ReviewedSuggestionStatus } from './suggestion.types'
import type { ResolutionSelection } from './suggestion.types'

export interface PendingBatchReview {
  ids: string[]
  scopeLabel: string
  decision: ReviewedSuggestionStatus
  skippedCount: number
  selectionsById: Record<string, ResolutionSelection[]>
}

type BatchReviewDialogProps = {
  request: PendingBatchReview
  submitting: boolean
  onCancel: () => void
  onConfirm: (reviewComment: string | null) => void
}

/** 确认批量范围；批量拒绝时收集一条应用于全部建议的统一原因。 */
export default function BatchReviewDialog({
  request,
  submitting,
  onCancel,
  onConfirm,
}: BatchReviewDialogProps) {
  const [reviewComment, setReviewComment] = useState('')
  const isReject = request.decision === 'rejected'
  const decisionLabel = isReject ? '拒绝' : '采纳'

  return (
    <div className="batch-review-dialog-backdrop">
      <section
        aria-describedby="batch-review-description"
        aria-labelledby="batch-review-title"
        aria-modal="true"
        className="batch-review-dialog"
        role="dialog"
      >
        <h2 id="batch-review-title">确认批量{decisionLabel}</h2>
        <p id="batch-review-description">
          将{decisionLabel} {request.ids.length} 条建议
        </p>
        <p className="batch-review-dialog__scope">范围：{request.scopeLabel}</p>
        {request.skippedCount > 0 && (
          <p className="batch-review-dialog__skipped">跳过 {request.skippedCount} 条（未达到默认置信度阈值）</p>
        )}
        {isReject && (
          <label>
            <span>统一拒绝原因</span>
            <textarea
              autoFocus
              disabled={submitting}
              onChange={(event) => setReviewComment(event.target.value)}
              rows={3}
              value={reviewComment}
            />
          </label>
        )}
        <div className="batch-review-dialog__buttons">
          <button disabled={submitting} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className={`review-button ${isReject ? 'review-button--reject' : 'review-button--accept'}`}
            disabled={submitting || (isReject && reviewComment.trim().length === 0)}
            onClick={() => onConfirm(isReject ? reviewComment.trim() : null)}
            type="button"
          >
            {submitting ? '处理中…' : `确认${decisionLabel}`}
          </button>
        </div>
      </section>
    </div>
  )
}
