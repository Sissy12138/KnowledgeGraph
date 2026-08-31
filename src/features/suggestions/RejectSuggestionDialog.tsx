import { useState } from 'react'

type RejectSuggestionDialogProps = {
  submitting: boolean
  onCancel: () => void
  onConfirm: (reason: string | null) => void
}

/** 为单条 Evidence 收集可选的拒绝原因，并在二次确认后提交。 */
export default function RejectSuggestionDialog({
  submitting,
  onCancel,
  onConfirm,
}: RejectSuggestionDialogProps) {
  const [reason, setReason] = useState('')

  return (
    <div className="batch-review-dialog-backdrop">
      <section
        aria-labelledby="reject-suggestion-title"
        aria-modal="true"
        className="batch-review-dialog"
        role="dialog"
      >
        <h2 id="reject-suggestion-title">拒绝此条识别结果</h2>
        <p>这段 Evidence 将不会连接或创建任何候选节点。</p>
        <label>
          <span>拒绝原因（选填）</span>
          <textarea
            autoFocus
            disabled={submitting}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />
        </label>
        <div className="batch-review-dialog__buttons">
          <button disabled={submitting} onClick={onCancel} type="button">取消</button>
          <button
            className="review-button review-button--reject"
            disabled={submitting}
            onClick={() => onConfirm(reason.trim() || null)}
            type="button"
          >
            {submitting ? '处理中…' : '确认拒绝'}
          </button>
        </div>
      </section>
    </div>
  )
}
