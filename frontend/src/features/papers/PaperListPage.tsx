import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createNewPaperAnalysisJobs, getPapers, type NewPaperAnalysisBatch } from './paper.service'
import { requestJson } from '../../contracts/api-client'
import type { PaperPage, PaperStatus, PaperSummary } from './paper.types'
import './PaperListPage.css'

type PaperListPageProps = {
  loadPapers?: () => Promise<PaperPage>
  startNewAnalyses?: () => Promise<NewPaperAnalysisBatch>
}

type ViewState =
  | { status: 'loading' }
  | { status: 'success'; data: PaperPage }
  | { status: 'error'; message: string }

const statusLabels: Record<PaperStatus, string> = {
  unprocessed: '未解析',
  queued: '排队中',
  processing: '解析中',
  pendingReview: '待审核',
  completed: '已完成',
  failed: '解析失败',
}

/** 展示论文分页数据，并覆盖加载、成功、空态和失败四种状态。 */
export default function PaperListPage({
  loadPapers = getPapers,
  startNewAnalyses = createNewPaperAnalysisJobs,
}: PaperListPageProps) {
  const navigate = useNavigate()
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [isStartingNewAnalyses, setIsStartingNewAnalyses] = useState(false)
  const [analysisMessage, setAnalysisMessage] = useState('')

  useEffect(() => {
    let isActive = true

    loadPapers()
      .then((data) => {
        if (isActive) setViewState({ status: 'success', data })
      })
      .catch((error: unknown) => {
        if (!isActive) return
        const message =
          error instanceof Error ? error.message : '论文列表加载失败，请稍后重试。'
        setViewState({ status: 'error', message })
      })

    return () => {
      isActive = false
    }
  }, [loadPapers, refresh])

  async function startNewPaperAnalyses() {
    setIsStartingNewAnalyses(true)
    setAnalysisMessage('')
    try {
      const result = await startNewAnalyses()
      if (result.createdCount === 0) {
        setAnalysisMessage('没有待分析的新导入论文。')
        return
      }
      navigate('/analysis-jobs')
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : '无法创建分析任务。')
    } finally {
      setIsStartingNewAnalyses(false)
    }
  }

  return (
    <section className="paper-list-page" aria-labelledby="paper-list-title">
      <header className="paper-list-page__header">
        <div>
          <p className="paper-list-page__eyebrow">RESEARCH LIBRARY</p>
          <h1 id="paper-list-title">论文库</h1>
          <p>查看论文的解析状态和待审核知识建议。</p>
        </div>
        <div className="paper-list-page__actions">
          <button
            type="button"
            onClick={() => void startNewPaperAnalyses()}
            disabled={isStartingNewAnalyses || viewState.status === 'loading'}
          >
            {isStartingNewAnalyses ? '正在创建分析任务…' : '一键分析新导入文献'}
          </button>
          {analysisMessage && <p role="status">{analysisMessage}</p>}
        </div>
      </header>

      {viewState.status === 'loading' && (
        <div className="paper-list-state" role="status">
          正在加载论文…
        </div>
      )}

      {viewState.status === 'error' && (
        <div className="paper-list-state paper-list-state--error" role="alert">
          <strong>加载失败</strong>
          <span>{viewState.message}</span>
        </div>
      )}

      {viewState.status === 'success' && viewState.data.items.length === 0 && (
        <div className="paper-list-state">
          <strong>还没有论文</strong>
          <span>导入论文后，它们会显示在这里。</span>
        </div>
      )}

      {viewState.status === 'success' && viewState.data.items.length > 0 && (
        <>
          <p className="paper-list-page__summary">
            共 {viewState.data.total} 篇论文
          </p>
          <div className="paper-grid">
            {viewState.data.items.map((paper) => (
              <PaperCard key={paper.id} paper={paper} onRemoved={() => setRefresh((value) => value + 1)} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function PaperCard({ paper, onRemoved }: { paper: PaperSummary; onRemoved: () => void }) {
  const authors = paper.authors.length
    ? paper.authors.map((author) => author.name).join('、')
    : '作者信息缺失'
  const showDemoMetrics =
    paper.metricSource === 'mock'
    && paper.journal?.impactFactor != null

  async function removeFromLibrary() {
    await requestJson(`/api/v1/papers/${encodeURIComponent(paper.id)}`, { method: 'DELETE' })
    onRemoved()
  }

  return (
    <div
      className="paper-card-link"
      onContextMenu={(event) => {
        event.preventDefault()
        const confirmed = window.confirm(`操作：从研知图移除“${paper.title}”？\n\n点击“确定”后将删除本地记录，但不会修改 Zotero。`)
        if (confirmed) void removeFromLibrary()
      }}
    >
    <Link
      aria-label={`查看论文详情：${paper.title}`}
      className="paper-card-link"
      to={`/papers/${paper.id}`}
    >
      <article className="paper-card">
        <div className="paper-card__topline">
          <span className={`paper-status paper-status--${paper.status}`}>
            {statusLabels[paper.status]}
          </span>
          <span>{paper.year ?? '年份未知'}</span>
        </div>
        <h2>{paper.title}</h2>
        <p className="paper-card__authors">{authors}</p>
        {paper.journal && <p>{paper.journal.name}</p>}
        {showDemoMetrics && paper.journal && (
          <p>
            <span>
              JIF {paper.journal.impactFactor}
              （{paper.journal.impactFactorYear ?? '年份未知'}）
            </span>{' '}
            <strong>JIF/JCR 演示数据</strong>
          </p>
        )}
        <div className="paper-card__footer">
          <span>{paper.doi ? `DOI ${paper.doi}` : '暂无 DOI'}</span>
          {paper.pendingSuggestionCount > 0 ? (
            <strong>{paper.pendingSuggestionCount} 条待审核</strong>
          ) : (
            <strong className="paper-card__action">查看详情 →</strong>
          )}
        </div>
      </article>
    </Link>
    </div>
  )
}
