import { useEffect, useMemo, useState } from 'react'
import { ApiClientError } from '../../contracts/api-client'
import BatchReviewDialog, {
  type PendingBatchReview,
} from './BatchReviewDialog'
import PaperReviewGroup from './PaperReviewGroup'
import ReviewStatusTabs from './ReviewStatusTabs'
import { groupSuggestionsByPaper } from './suggestion-grouping'
import {
  suggestionService,
  type SuggestionService,
} from './suggestion.service'
import type {
  ReviewedSuggestionStatus,
  Suggestion,
  SuggestionPage,
} from './suggestion.types'
import type { ReviewTabStatus } from './ReviewStatusTabs'
import './SuggestionReviewPage.css'

type SuggestionReviewPageProps = {
  service?: SuggestionService
}

type ViewState =
  | { status: 'loading' }
  | { status: 'success'; page: SuggestionPage }
  | { status: 'error'; message: string }

/** 编排审核状态、论文分组与信息类型模块。 */
export default function SuggestionReviewPage({
  service = suggestionService,
}: SuggestionReviewPageProps) {
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })
  const [activeStatus, setActiveStatus] = useState<ReviewTabStatus>('pending')
  const [expandedPaperIds, setExpandedPaperIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [batchRequest, setBatchRequest] = useState<PendingBatchReview | null>(null)
  const [batchSubmitting, setBatchSubmitting] = useState(false)

  useEffect(() => {
    let isActive = true

    service.listSuggestions(activeStatus)
      .then((page) => {
        if (isActive) {
          setViewState({ status: 'success', page })
        }
      })
      .catch((error: unknown) => {
        if (!isActive) return
        setViewState({
          status: 'error',
          message: error instanceof Error ? error.message : '建议列表加载失败。',
        })
      })

    return () => {
      isActive = false
    }
  }, [activeStatus, service])

  const counts = viewState.status === 'success'
    ? viewState.page.statusCounts
    : { pending: 0, accepted: 0, rejected: 0, superseded: 0 }

  const groups = useMemo(() => {
    if (viewState.status !== 'success') return []
    return groupSuggestionsByPaper(
      viewState.page.items,
      viewState.page.papers,
    )
  }, [viewState])

  function togglePaper(paperId: string) {
    setExpandedPaperIds((current) => {
      const next = new Set(current)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  async function refreshPage() {
    const page = await service.listSuggestions(activeStatus)
    setViewState({ status: 'success', page })
  }

  function showReviewError(error: unknown) {
    if (
      error instanceof ApiClientError
      && error.status === 409
      && error.code === 'RESOLUTION_CANDIDATE_STALE'
    ) {
      const replacement = typeof error.details?.nodeId === 'string'
        ? `；可重新选择节点 ${error.details.nodeId}`
        : ''
      setNotice(`候选已变化：${error.message}${replacement}`)
      return
    }
    setNotice(
      error instanceof ApiClientError && error.status === 409
        ? '该建议状态已变化，请刷新后查看。'
        : error instanceof Error
          ? error.message
          : '审核失败，请稍后重试。',
    )
  }

  async function acceptOne(
    suggestion: Suggestion,
    selectedIds: string[],
    labelOverrides: Record<string, string>,
  ) {
    setBusyId(suggestion.id)
    setNotice(null)

    try {
      await service.acceptSuggestion(suggestion.id, {
        selectedIds,
        labelOverrides,
        comment: null,
      })
      await refreshPage()
      setNotice('审核成功。')
    } catch (error) {
      showReviewError(error)
    } finally {
      setBusyId(null)
    }
  }

  async function rejectOne(suggestion: Suggestion, reason: string | null) {
    setBusyId(suggestion.id)
    setNotice(null)
    try {
      await service.rejectSuggestion(suggestion.id, reason)
      await refreshPage()
      setNotice('审核成功。')
    } catch (error) {
      showReviewError(error)
    } finally {
      setBusyId(null)
    }
  }

  function requestBatchReview(
    ids: string[],
    decision: ReviewedSuggestionStatus,
    scopeLabel: string,
  ) {
    setBatchRequest({
      ids,
      decision,
      scopeLabel,
    })
    setNotice(null)
  }

  async function submitBatchReview(reviewComment: string | null) {
    if (!batchRequest) return
    setBatchSubmitting(true)

    try {
      const result = await service.reviewSuggestions({
        ids: batchRequest.ids,
        status: batchRequest.decision,
        comment: reviewComment,
      })
      await refreshPage()
      setNotice(`${result.updated.length} 条成功，${result.skipped.length} 条需要人工选择，${result.failures.length} 条失败。`)
      setBatchRequest(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '批量审核失败。')
    } finally {
      setBatchSubmitting(false)
    }
  }

  return (
    <section className="suggestion-review-page" aria-labelledby="review-title">
      <header className="suggestion-review-page__header">
        <div>
          <p className="suggestion-review-page__eyebrow">KNOWLEDGE REVIEW</p>
          <h1 id="review-title">建议审核</h1>
          <p>按论文和知识类型核对原文证据，再决定是否写入知识图谱。</p>
        </div>
      </header>

      <ReviewStatusTabs
        value={activeStatus}
        counts={counts}
        onChange={setActiveStatus}
      />

      {notice && (
        <div className="suggestion-review-notice" role="alert">
          {notice}
        </div>
      )}

      {viewState.status === 'loading' && (
        <div className="suggestion-review-state" role="status">
          正在加载建议…
        </div>
      )}

      {viewState.status === 'error' && (
        <div className="suggestion-review-state suggestion-review-state--error" role="alert">
          <strong>加载失败</strong>
          <span>{viewState.message}</span>
        </div>
      )}

      {viewState.status === 'success' && (
        <div
          aria-labelledby={`review-tab-${activeStatus}`}
          className="review-status-panel"
          id="review-status-panel"
          role="tabpanel"
        >
          {groups.length === 0 ? (
            <div className="suggestion-review-state">
              <strong>当前状态下没有建议</strong>
              <span>其他状态的建议可以通过上方标签查看。</span>
            </div>
          ) : (
            <div className="paper-review-list">
              {groups.map((group) => (
                <PaperReviewGroup
                  batchBusy={batchSubmitting}
                  busyId={busyId}
                  expanded={expandedPaperIds.has(group.paperId)}
                  group={group}
                  key={group.paperId}
                  onToggle={() => togglePaper(group.paperId)}
                  onAccept={activeStatus === 'pending' ? acceptOne : undefined}
                  onReject={activeStatus === 'pending' ? rejectOne : undefined}
                  onReviewMany={
                    activeStatus === 'pending' ? requestBatchReview : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
      {batchRequest && (
        <BatchReviewDialog
          onCancel={() => setBatchRequest(null)}
          onConfirm={submitBatchReview}
          request={batchRequest}
          submitting={batchSubmitting}
        />
      )}
    </section>
  )
}
