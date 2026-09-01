import { useState } from 'react'
import { getDefaultCandidateIds, toggleCandidateSelection } from './suggestion-resolution'
import type { Suggestion } from './suggestion.types'
import RejectSuggestionDialog from './RejectSuggestionDialog'

type SuggestionReviewCardProps = {
  suggestion: Suggestion
  busy?: boolean
  onAccept?: (
    suggestion: Suggestion,
    selectedIds: string[],
    labelOverrides: Record<string, string>,
  ) => Promise<void>
  onReject?: (suggestion: Suggestion, reason: string | null) => Promise<void>
}

function resultTitle(title: string) {
  return title.replace(/^新增(?:概念|方法)：/, '')
}

function reviewLabel(suggestion: Suggestion) {
  if (suggestion.status === 'accepted') return '已采纳'
  if (suggestion.status === 'rejected') return '已拒绝'
  if (suggestion.status === 'superseded') return '已失效'
  return '待审核'
}

/** 显示 v05 Suggestion；候选来自当前 Extraction，历史目标来自 executionResult。 */
export default function SuggestionReviewCard({
  suggestion,
  busy = false,
  onAccept,
  onReject,
}: SuggestionReviewCardProps) {
  const isResolutionCard = suggestion.operation === 'resolveConceptMatch'
    || suggestion.operation === 'resolveMethodMatch'
  const [rejectOpen, setRejectOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => getDefaultCandidateIds(suggestion))
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({})
  const resolvedTargets = suggestion.executionResult?.type === 'resolveMatch'
    ? suggestion.executionResult.resolvedTargets
    : []

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
    return (
      <article
        className={`suggestion-card suggestion-card--resolution suggestion-card--${suggestion.status}`}
        aria-label={`建议：${suggestion.title}`}
      >
        <header className="resolution-card__header">
          <h4>原文识别结果：{resultTitle(suggestion.title)}</h4>
        </header>

        {suggestion.status === 'pending' && suggestion.candidateState === 'current' ? (
          <>
            <div className="resolution-candidates" aria-label="实体候选">
              {suggestion.candidates.map((candidate) => {
                const score = candidate.recommendationScore === null
                  ? '推荐分数未提供'
                  : `推荐分数 ${Math.round(candidate.recommendationScore * 100)}%`
                return (
                  <button
                    aria-label={`${candidate.label} ${score}`}
                    aria-pressed={selectedIds.includes(candidate.id)}
                    className={`resolution-candidate resolution-candidate--${candidate.kind}`}
                    disabled={busy}
                    key={candidate.id}
                    onClick={() => setSelectedIds((current) => toggleCandidateSelection(current, candidate.id))}
                    type="button"
                  >
                    {candidate.label} · {score}
                  </button>
                )
              })}
            </div>
            {suggestion.candidates
              .filter((candidate) => candidate.kind === 'new' && selectedIds.includes(candidate.id))
              .map((candidate) => (
                <label className="resolution-name-editor" key={candidate.id}>
                  <span>新节点规范名称：{candidate.label}</span>
                  <input
                    disabled={busy}
                    maxLength={200}
                    onChange={(event) => setLabelOverrides((current) => ({
                      ...current,
                      [candidate.id]: event.target.value,
                    }))}
                    value={labelOverrides[candidate.id] ?? candidate.label}
                  />
                </label>
              ))}
          </>
        ) : suggestion.status === 'pending' ? (
          <p role="status">候选已失效，请刷新后重新审核。</p>
        ) : suggestion.status === 'accepted' ? (
          <div className="resolution-candidates" aria-label="审核结果">
            {resolvedTargets.map((target) => (
              <span className="resolution-candidate resolution-candidate--result" key={target.candidateId}>
                {target.label} · {target.created ? '创建新节点' : '连接已有'}
              </span>
            ))}
          </div>
        ) : null}

        {evidencePanel}
        {suggestion.canReview && onAccept && onReject && (
          <div className="resolution-card__actions">
            <button aria-label="拒绝" className="resolution-action resolution-action--reject" disabled={busy} onClick={() => setRejectOpen(true)} type="button">×</button>
            <button
              aria-label="确认"
              className="resolution-action resolution-action--confirm"
              disabled={busy || selectedIds.length === 0}
              onClick={() => onAccept(suggestion, selectedIds, labelOverrides)}
              type="button"
            >√</button>
          </div>
        )}
        {suggestion.status !== 'pending' && (
          <div className="suggestion-card__result">
            <strong>{reviewLabel(suggestion)}</strong>
            <span>审核时间：{suggestion.reviewedAt ? new Date(suggestion.reviewedAt).toLocaleString('zh-CN') : '未记录'}</span>
            {suggestion.reviewComment && <p>{suggestion.reviewComment}</p>}
          </div>
        )}
        {rejectOpen && onReject && (
          <RejectSuggestionDialog
            onCancel={() => setRejectOpen(false)}
            onConfirm={async (reason) => {
              await onReject(suggestion, reason)
              setRejectOpen(false)
            }}
            submitting={busy}
          />
        )}
      </article>
    )
  }

  const confidence = suggestion.confidence === null
    ? '未提供'
    : `${Math.round(suggestion.confidence * 100)}%`

  return (
    <article className={`suggestion-card suggestion-card--${suggestion.status}`} aria-label={`建议：${suggestion.title}`}>
      <div className="suggestion-card__topline">
        <span className={`suggestion-card__status suggestion-card__status--${suggestion.status}`}>
          {reviewLabel(suggestion)}
        </span>
      </div>
      <h4>{suggestion.title}</h4>
      <p className="suggestion-card__reason">{suggestion.reason}</p>
      <dl className="suggestion-card__meta"><div><dt>置信度</dt><dd>{confidence}</dd></div></dl>
      {evidencePanel}
      {suggestion.canReview && onAccept && onReject && (
        <div className="suggestion-card__buttons">
          <button className="review-button review-button--reject" disabled={busy} onClick={() => setRejectOpen(true)} type="button">拒绝建议</button>
          <button className="review-button review-button--accept" disabled={busy} onClick={() => onAccept(suggestion, [], {})} type="button">采纳建议</button>
        </div>
      )}
      {suggestion.status !== 'pending' && (
        <div className="suggestion-card__result">
          <strong>{reviewLabel(suggestion)}</strong>
          <span>审核时间：{suggestion.reviewedAt ? new Date(suggestion.reviewedAt).toLocaleString('zh-CN') : '未记录'}</span>
          {suggestion.reviewComment && <p>{suggestion.reviewComment}</p>}
        </div>
      )}
      {rejectOpen && onReject && (
        <RejectSuggestionDialog
          onCancel={() => setRejectOpen(false)}
          onConfirm={async (reason) => {
            await onReject(suggestion, reason)
            setRejectOpen(false)
          }}
          submitting={busy}
        />
      )}
    </article>
  )
}
