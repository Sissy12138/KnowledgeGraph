import { useState } from 'react'
import type { ReviewedSuggestionStatus } from './suggestion.types'

export interface PendingBatchReview {
  ids: string[]
  scopeLabel: string
  decision: ReviewedSuggestionStatus
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
            disabled={submitting || reviewComment.trim().length > 1000}
            onClick={() => onConfirm(isReject ? reviewComment.trim() || null : null)}
            type="button"
          >
            {submitting ? '处理中…' : `确认${decisionLabel}`}
          </button>
        </div>
      </section>
    </div>
  )
}
