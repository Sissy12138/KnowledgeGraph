import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AnalysisProgressPanel from '../analysis/AnalysisProgressPanel'
import type { AnalysisJobLoader } from '../analysis/analysis-job.service'
import { getPaperDetail } from './paper.service'
import type { PaperDetail } from './paper.types'
import './PaperDetailPage.css'

type PaperDetailPageProps = {
  loadPaper?: (paperId: string) => Promise<PaperDetail>
  loadAnalysisJob?: AnalysisJobLoader
}

type ViewState =
  | { status: 'loading' }
  | { status: 'success'; paper: PaperDetail }
  | { status: 'error'; message: string }

/** 根据地址中的 paperId 加载并展示单篇论文详情。 */
export default function PaperDetailPage({
  loadPaper = getPaperDetail,
  loadAnalysisJob,
}: PaperDetailPageProps) {
  const { paperId } = useParams()
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let isActive = true

    if (!paperId) {
      return () => {
        isActive = false
      }
    }

    loadPaper(paperId)
      .then((paper) => {
        if (isActive) setViewState({ status: 'success', paper })
      })
      .catch((error: unknown) => {
        if (!isActive) return
        const message = error instanceof Error ? error.message : '论文详情加载失败。'
        setViewState({ status: 'error', message })
      })

    return () => {
      isActive = false
    }
  }, [loadPaper, paperId])

  if (!paperId) {
    return (
      <section className="paper-detail-state" role="alert">
        <strong>无法打开论文</strong>
        <span>论文地址缺少 paperId。</span>
        <Link to="/papers">返回论文库</Link>
      </section>
    )
  }

  if (viewState.status === 'loading') {
    return (
      <div className="paper-detail-state" role="status">
        正在加载论文详情…
      </div>
    )
  }

  if (viewState.status === 'error') {
    return (
      <section className="paper-detail-state" role="alert">
        <strong>无法打开论文</strong>
        <span>{viewState.message}</span>
        <Link to="/papers">返回论文库</Link>
      </section>
    )
  }

  const { paper } = viewState
  const overview = paper.researchOverview
  const showDemoMetrics =
    paper.metricSource === 'mock'
    && paper.journal?.impactFactor != null

  return (
    <article className="paper-detail-page">
      <Link className="paper-detail-page__back" to="/papers">
        ← 返回论文库
      </Link>

      <header className="paper-detail-page__hero">
        <p className="paper-detail-page__eyebrow">PAPER DETAIL</p>
        <h1>{paper.title}</h1>
        <p className="paper-detail-page__authors">
          {paper.authors.length
            ? paper.authors.map((author) => author.name).join('、')
            : '作者信息缺失'}
        </p>
        <div className="paper-detail-page__meta">
          <span>{paper.year ?? '年份未知'}</span>
          <span>{paper.doi ? `DOI ${paper.doi}` : '暂无 DOI'}</span>
          {paper.journal && <span>{paper.journal.name}</span>}
          {showDemoMetrics && paper.journal && (
            <>
              <span>
                JIF {paper.journal.impactFactor}
                （{paper.journal.impactFactorYear ?? '年份未知'}）
              </span>
              <span>JIF/JCR 演示数据</span>
            </>
          )}
          <span>{paper.pendingSuggestionCount} 条待审核</span>
          {paper.latestJobId && (
            <AnalysisProgressPanel
              jobId={paper.latestJobId}
              loadJob={loadAnalysisJob}
            />
          )}
        </div>
      </header>

      <section className="paper-detail-section">
        <h2>摘要</h2>
        <p>{paper.abstract ?? '暂未提供摘要。'}</p>
      </section>

      <section className="paper-detail-section">
        <h2>研究概览</h2>
        {overview ? (
          <dl className="research-overview">
            <div>
              <dt>研究主题</dt>
              <dd>{overview.researchTopics.join('、') || '暂未提取'}</dd>
            </div>
            <div>
              <dt>研究问题</dt>
              <dd>{overview.researchQuestion ?? '暂未提取'}</dd>
            </div>
            <div>
              <dt>样本</dt>
              <dd>{overview.sample ?? '暂未提取'}</dd>
            </div>
            <div>
              <dt>方法</dt>
              <dd>{overview.methods ?? '暂未提取'}</dd>
            </div>
            <div>
              <dt>主要结果</dt>
              <dd>{overview.mainResults ?? '暂未提取'}</dd>
            </div>
          </dl>
        ) : (
          <p className="paper-detail-page__muted">研究概览尚未生成。</p>
        )}
      </section>
    </article>
  )
}
