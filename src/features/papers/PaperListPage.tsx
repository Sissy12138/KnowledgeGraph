import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPapers } from './paper.service'
import type { PaperPage, PaperStatus, PaperSummary } from './paper.types'
import './PaperListPage.css'

type PaperListPageProps = {
  loadPapers?: () => Promise<PaperPage>
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
}: PaperListPageProps) {
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })

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
  }, [loadPapers])

  return (
    <section className="paper-list-page" aria-labelledby="paper-list-title">
      <header className="paper-list-page__header">
        <div>
          <p className="paper-list-page__eyebrow">RESEARCH LIBRARY</p>
          <h1 id="paper-list-title">论文库</h1>
          <p>查看论文的解析状态和待审核知识建议。</p>
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
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function PaperCard({ paper }: { paper: PaperSummary }) {
  const authors = paper.authors.length
    ? paper.authors.map((author) => author.name).join('、')
    : '作者信息缺失'

  return (
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
  )
}
