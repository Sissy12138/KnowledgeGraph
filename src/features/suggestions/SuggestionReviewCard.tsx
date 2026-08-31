import { useState } from 'react'
import {
  buildResolutionSelections,
  getDefaultCandidateIds,
  resolveNewCandidateName,
  toggleCandidateSelection,
} from './suggestion-resolution'
import type {
  ResolutionSelection,
  ReviewedSuggestionStatus,
  Suggestion,
} from './suggestion.types'
import RejectSuggestionDialog from './RejectSuggestionDialog'

type SuggestionReviewCardProps = {
  suggestion: Suggestion
  busy?: boolean
  onReview?: (
    suggestion: Suggestion,
    status: ReviewedSuggestionStatus,
    reviewComment: string | null,
    selections?: ResolutionSelection[],
  ) => Promise<void>
}

function resultTitle(title: string) {
  return title.replace(/^新增(?:概念|方法)：/, '')
}

/** 显示 Evidence 候选消歧卡；非实体建议继续使用原有审核方式。 */
export default function SuggestionReviewCard({
  suggestion,
  busy = false,
  onReview,
}: SuggestionReviewCardProps) {
  const candidates = suggestion.candidates ?? []
  const isResolutionCard = candidates.length > 0
  const [reviewComment, setReviewComment] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    getDefaultCandidateIds(candidates),
  )
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({})
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)

  const evidencePanel = (
    <section className="evidence-panel" aria-label="Evidence 原文证据">
      <div className="evidence-panel__heading">
        <strong>Evidence 原文证据</strong>
        <span>{suggestion.evidence.length} 条</span>
      </div>
      {suggestion.evidence.map((evidence) => (
        <blockquote key={evidence.id}>
          <span>{evidence.section ?? '未标注章节'}</span>
          <p>{evidence.text}</p>
        </blockquote>
      ))}
    </section>
  )

  if (isResolutionCard) {
    const displaySelections =
      suggestion.status === 'accepted'
        ? suggestion.resolvedSelections ?? []
        : suggestion.status === 'pending'
          ? buildResolutionSelections(suggestion, selectedIds, nameOverrides)
          : []

    return (
      <article
        className={`suggestion-card suggestion-card--resolution suggestion-card--${suggestion.status}`}
        aria-label={`建议：${suggestion.title}`}
      >
        <header className="resolution-card__header">
          <h4>原文识别结果：{resultTitle(suggestion.title)}</h4>
        </header>

        {suggestion.status === 'pending' ? (
          <>
            <div className="resolution-candidates" aria-label="实体候选">
              {candidates.map((candidate) => (
                <button
                  aria-pressed={selectedIds.includes(candidate.id)}
                  className={`resolution-candidate resolution-candidate--${candidate.kind}`}
                  disabled={busy}
                  key={candidate.id}
                  onClick={() => setSelectedIds((current) => toggleCandidateSelection(current, candidate.id))}
                  type="button"
                >
                  {candidate.name} {Math.round(candidate.confidence * 100)}%
                </button>
              ))}
            </div>
            {candidates
              .filter((candidate) => candidate.kind === 'new' && selectedIds.includes(candidate.id))
              .map((candidate) => (
                <label className="resolution-name-editor" key={candidate.id}>
                  <span>新节点规范名称：{candidate.name}</span>
                  <input
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value
                      setNameOverrides((current) => ({ ...current, [candidate.id]: value }))
                      const match = resolveNewCandidateName(value, candidates)
                      if (match.matchingExistingCandidateId) {
                        const existingCandidateId = match.matchingExistingCandidateId
                        setSelectedIds((current) => [
                          ...current.filter((id) => id !== candidate.id && id !== existingCandidateId),
                          existingCandidateId,
                        ])
                        setDuplicateNotice(`已改为连接已有节点：${match.normalizedName}`)
                      } else {
                        setDuplicateNotice(null)
                      }
                    }}
                    value={nameOverrides[candidate.id] ?? candidate.name}
                  />
                </label>
              ))}
            {duplicateNotice && <p className="resolution-duplicate-notice" role="status">{duplicateNotice}</p>}
          </>
        ) : suggestion.status === 'accepted' ? (
          <div className="resolution-candidates" aria-label="审核结果">
            {displaySelections.map((selection) => (
              <span className="resolution-candidate resolution-candidate--result" key={selection.candidateId}>
                {selection.name} · {selection.operation === 'linkExisting' ? '连接已有' : '创建新节点'}
              </span>
            ))}
          </div>
        ) : null}

        {evidencePanel}
        {suggestion.status === 'pending' && onReview && (
          <div className="resolution-card__actions">
            <button aria-label="拒绝" className="resolution-action resolution-action--reject" disabled={busy} onClick={() => setRejectOpen(true)} type="button">×</button>
            <button
              aria-label="确认"
              className="resolution-action resolution-action--confirm"
              disabled={busy || selectedIds.length === 0}
              onClick={() => onReview(suggestion, 'accepted', null, displaySelections)}
              type="button"
            >√</button>
          </div>
        )}
        {suggestion.status !== 'pending' && (
          <div className="suggestion-card__result">
            <strong>{suggestion.status === 'accepted' ? '已采纳' : '已拒绝'}</strong>
            <span>审核时间：{suggestion.reviewedAt ? new Date(suggestion.reviewedAt).toLocaleString('zh-CN') : '未记录'}</span>
            {suggestion.reviewComment && <p>{suggestion.reviewComment}</p>}
          </div>
        )}
        {rejectOpen && onReview && (
          <RejectSuggestionDialog
            onCancel={() => setRejectOpen(false)}
            onConfirm={async (reason) => {
              await onReview(suggestion, 'rejected', reason)
              setRejectOpen(false)
            }}
            submitting={busy}
          />
        )}
      </article>
    )
  }

  const confidence = suggestion.confidence === null ? '未提供' : `${Math.round(suggestion.confidence * 100)}%`

  return (
    <article className={`suggestion-card suggestion-card--${suggestion.status}`} aria-label={`建议：${suggestion.title}`}>
      <div className="suggestion-card__topline">
        <span className={`suggestion-card__status suggestion-card__status--${suggestion.status}`}>
          {suggestion.status === 'pending' ? '待审核' : suggestion.status === 'accepted' ? '已采纳' : '已拒绝'}
        </span>
      </div>
      <h4>{suggestion.title}</h4>
      <p className="suggestion-card__reason">{suggestion.reason}</p>
      <dl className="suggestion-card__meta"><div><dt>置信度</dt><dd>{confidence}</dd></div></dl>
      {evidencePanel}
      {suggestion.status === 'pending' && onReview && (
        <div className="suggestion-card__review">
          <label>
            <span>拒绝原因</span>
            <textarea disabled={busy} onChange={(event) => setReviewComment(event.target.value)} placeholder="拒绝时填写，例如：证据不足" rows={2} value={reviewComment} />
          </label>
          <div className="suggestion-card__buttons">
            <button className="review-button review-button--reject" disabled={busy || reviewComment.trim().length === 0} onClick={() => onReview(suggestion, 'rejected', reviewComment.trim())} type="button">{busy ? '处理中…' : '拒绝建议'}</button>
            <button className="review-button review-button--accept" disabled={busy} onClick={() => onReview(suggestion, 'accepted', null)} type="button">{busy ? '处理中…' : '采纳建议'}</button>
          </div>
        </div>
      )}
      {suggestion.status !== 'pending' && (
        <div className="suggestion-card__result">
          <strong>{suggestion.status === 'accepted' ? '已采纳' : '已拒绝'}</strong>
          <span>审核时间：{suggestion.reviewedAt ? new Date(suggestion.reviewedAt).toLocaleString('zh-CN') : '未记录'}</span>
          {suggestion.reviewComment && <p>{suggestion.reviewComment}</p>}
        </div>
      )}
    </article>
  )
}
