import { useEffect, useMemo, useState } from 'react'
import { getPapers } from '../papers/paper.service'
import type { PaperPage, PaperSummary } from '../papers/paper.types'
import BatchReviewDialog, {
  type PendingBatchReview,
} from './BatchReviewDialog'
import PaperReviewGroup from './PaperReviewGroup'
import ReviewStatusTabs from './ReviewStatusTabs'
import { groupSuggestionsByPaper } from './suggestion-grouping'
import { buildResolutionSelections, getDefaultCandidateIds } from './suggestion-resolution'
import {
  suggestionService,
  SuggestionApiError,
  type SuggestionService,
} from './suggestion.service'
import type {
  ReviewedSuggestionStatus,
  ResolutionSelection,
  Suggestion,
  SuggestionStatus,
} from './suggestion.types'
import './SuggestionReviewPage.css'

type SuggestionReviewPageProps = {
  service?: SuggestionService
  loadPapers?: () => Promise<PaperPage>
}

type ViewState =
  | { status: 'loading' }
  | { status: 'success'; items: Suggestion[]; papers: PaperSummary[] }
  | { status: 'error'; message: string }

/** 编排审核状态、论文分组与信息类型模块。 */
export default function SuggestionReviewPage({
  service = suggestionService,
  loadPapers = getPapers,
}: SuggestionReviewPageProps) {
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })
  const [activeStatus, setActiveStatus] = useState<SuggestionStatus>('pending')
  const [expandedPaperIds, setExpandedPaperIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [batchRequest, setBatchRequest] = useState<PendingBatchReview | null>(null)
  const [batchSubmitting, setBatchSubmitting] = useState(false)

  useEffect(() => {
    let isActive = true

    Promise.all([service.listAllSuggestions(), loadPapers()])
      .then(([items, paperPage]) => {
        if (isActive) {
          setViewState({ status: 'success', items, papers: paperPage.items })
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
  }, [loadPapers, service])

  const counts = useMemo<Record<SuggestionStatus, number>>(() => {
    const items = viewState.status === 'success' ? viewState.items : []
    return {
      pending: items.filter((item) => item.status === 'pending').length,
      accepted: items.filter((item) => item.status === 'accepted').length,
      rejected: items.filter((item) => item.status === 'rejected').length,
    }
  }, [viewState])

  const groups = useMemo(() => {
    if (viewState.status !== 'success') return []
    return groupSuggestionsByPaper(
      viewState.items.filter((item) => item.status === activeStatus),
      viewState.papers,
    )
  }, [activeStatus, viewState])

  function togglePaper(paperId: string) {
    setExpandedPaperIds((current) => {
      const next = new Set(current)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  async function reviewOne(
    suggestion: Suggestion,
    status: ReviewedSuggestionStatus,
    reviewComment: string | null,
    selections?: ResolutionSelection[],
  ) {
    setBusyId(suggestion.id)
    setNotice(null)

    try {
      const updated =
        status === 'accepted'
          ? await service.acceptSuggestion(suggestion.id, {
              reviewComment,
              selections,
            })
          : await service.rejectSuggestion(suggestion.id, reviewComment)
      setViewState((current) =>
        current.status === 'success'
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      )
    } catch (error) {
      setNotice(
        error instanceof SuggestionApiError && error.status === 409
          ? '该建议已被其他人审核，请刷新后查看最新状态。'
          : error instanceof Error
            ? error.message
            : '审核失败，请稍后重试。',
      )
    } finally {
      setBusyId(null)
    }
  }

  function requestBatchReview(
    ids: string[],
    decision: ReviewedSuggestionStatus,
    scopeLabel: string,
  ) {
    const requestedItems =
      viewState.status === 'success'
        ? viewState.items.filter((item) => ids.includes(item.id))
        : []
    const selectionsById: Record<string, ResolutionSelection[]> = {}
    const eligibleIds = requestedItems.flatMap((item) => {
      if (decision === 'rejected' || !item.candidates?.length) return [item.id]
      const defaultIds = getDefaultCandidateIds(item.candidates)
      if (defaultIds.length === 0) return []
      selectionsById[item.id] = buildResolutionSelections(item, defaultIds)
      return [item.id]
    })

    if (eligibleIds.length === 0) {
      setNotice('当前范围没有达到 70% 默认置信度阈值的候选，请逐条人工审核。')
      return
    }

    setBatchRequest({
      ids: eligibleIds,
      decision,
      scopeLabel,
      skippedCount: ids.length - eligibleIds.length,
      selectionsById,
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
        reviewComment,
        selectionsById: batchRequest.selectionsById,
      })
      setViewState((current) =>
        current.status === 'success'
          ? {
              ...current,
              items: current.items.map(
                (item) =>
                  result.updated.find((updated) => updated.id === item.id) ?? item,
              ),
            }
          : current,
      )

      const hasConflict = result.failures.some(
        (failure) => failure.error.status === 409,
      )
      if (hasConflict) {
        const refreshed = await service.listAllSuggestions()
        setViewState((current) =>
          current.status === 'success'
            ? { ...current, items: refreshed }
            : current,
        )
        setNotice('部分建议已被其他人审核，已刷新最新状态。')
      } else if (result.failures.length > 0) {
        setNotice(
          `成功 ${result.updated.length} 条，失败 ${result.failures.length} 条。失败项仍保留在待审核列表。`,
        )
      } else {
        setNotice(`已成功处理 ${result.updated.length} 条建议。`)
      }
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
                  onReviewOne={activeStatus === 'pending' ? reviewOne : undefined}
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
