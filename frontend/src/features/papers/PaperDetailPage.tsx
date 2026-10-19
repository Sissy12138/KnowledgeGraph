import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AnalysisProgressPanel from '../analysis/AnalysisProgressPanel'
import type { AnalysisJobLoader } from '../analysis/analysis-job.service'
import { createPaperAnalysisJob, getLatestExtraction, getPaperDetail, getPaperSuggestions } from './paper.service'
import type {
  Evidence,
  Extraction,
  ExtractedConcept,
  ExtractedMethod,
  RelationType,
  ResearchOverview,
  Suggestion,
  SuggestionPage,
} from '../../contracts/v05.types'
import type { PaperDetail } from './paper.types'
import './PaperDetailPage.css'

type PaperDetailPageProps = {
  loadPaper?: (paperId: string) => Promise<PaperDetail>
  loadAnalysisJob?: AnalysisJobLoader
  loadExtraction?: (paperId: string) => Promise<Extraction>
  loadSuggestions?: (paperId: string) => Promise<SuggestionPage>
}

type ViewState =
  | { status: 'loading' }
  | { status: 'success'; paper: PaperDetail }
  | { status: 'error'; message: string }

const relationLabels: Record<RelationType, string> = {
  authored: '作者',
  coAuthor: '合作作者',
  studies: '研究',
  uses: '使用',
  reports: '报告',
  supports: '支持',
  contradicts: '矛盾',
  relatedTo: '相关',
  broaderThan: '上位概念',
  combinedWith: '联合使用',
  variantOf: '方法变体',
  alternativeTo: '替代方法',
  cites: '引用',
}

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function evidenceFor(
  evidenceIds: string[],
  evidenceById: ReadonlyMap<string, Evidence>,
) {
  return evidenceIds.flatMap((id) => {
    const evidence = evidenceById.get(id)
    return evidence ? [evidence] : []
  })
}

function EntityResultCard({
  item,
  kind,
  evidenceById,
}: {
  item: ExtractedConcept | ExtractedMethod
  kind: '概念' | '方法'
  evidenceById: ReadonlyMap<string, Evidence>
}) {
  const evidence = evidenceFor(item.evidenceIds, evidenceById)[0]
  return (
    <article className="analysis-entity-card">
      <div className="analysis-entity-card__heading">
        <div>
          <span>{kind}</span>
          <h4>{item.normalizedLabel}</h4>
        </div>
        <strong>{percent(item.extractionConfidence)}</strong>
      </div>
      {item.rawText !== item.normalizedLabel && (
        <p className="analysis-entity-card__source">原文表达：{item.rawText}</p>
      )}
      {evidence && (
        <blockquote>
          <cite>{evidence.section ?? '正文'}</cite>
          <p>{evidence.text}</p>
        </blockquote>
      )}
    </article>
  )
}

function ResearchOverviewSection({ overview }: { overview: ResearchOverview | null }) {
  const missing = '本轮分析未定位到明确原文证据'
  return (
    <section className="paper-detail-section" aria-labelledby="research-overview-title">
      <div className="paper-detail-section__heading">
        <div>
          <h2 id="research-overview-title">研究概览</h2>
          <p>以下为基于原文证据的中文忠实整理；“未定位到”不等于原文一定没有。</p>
        </div>
      </div>
      {overview ? (
        <dl className="research-overview">
          <div>
            <dt>研究主题</dt>
            <dd>{overview.researchTopics.join('、') || missing}</dd>
          </div>
          <div>
            <dt>研究问题</dt>
            <dd>{overview.researchQuestion ?? missing}</dd>
          </div>
          <div>
            <dt>样本及分组</dt>
            <dd>{overview.sample ?? missing}</dd>
          </div>
          <div>
            <dt>方法</dt>
            <dd>{overview.methods ?? missing}</dd>
          </div>
          <div>
            <dt>主要结果</dt>
            <dd>{overview.mainResults ?? missing}</dd>
          </div>
        </dl>
      ) : (
        <p className="paper-detail-page__muted">研究概览尚未生成。</p>
      )}
    </section>
  )
}

function RelationResultCard({
  suggestion,
  evidenceById,
}: {
  suggestion: Suggestion
  evidenceById: ReadonlyMap<string, Evidence>
}) {
  if (suggestion.proposedChange.type !== 'addRelation') return null
  const evidence = evidenceFor(suggestion.evidenceIds, evidenceById)
  const paperCount = new Set(evidence.map((item) => item.paperId)).size
  return (
    <article className="analysis-relation-card">
      <div className="analysis-relation-card__heading">
        <span>{paperCount > 1 ? '跨论文关系' : '同篇关系'}</span>
        <strong>{relationLabels[suggestion.proposedChange.relationType]}</strong>
        <em>模型复核 {percent(suggestion.confidence)}</em>
      </div>
      <h4>{suggestion.title.replace(/^概念关系：/, '')}</h4>
      <p>{suggestion.reason}</p>
      <div className="analysis-relation-card__evidence">
        {evidence.map((item) => (
          <blockquote key={item.id}>
            <cite>{item.section ?? '正文'}</cite>
            <p>{item.text}</p>
          </blockquote>
        ))}
      </div>
    </article>
  )
}

/** 根据地址中的 paperId 加载并展示单篇论文详情。 */
export default function PaperDetailPage({
  loadPaper = getPaperDetail,
  loadAnalysisJob,
  loadExtraction = getLatestExtraction,
  loadSuggestions = getPaperSuggestions,
}: PaperDetailPageProps) {
  const { paperId } = useParams()
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' })
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestionPage | null>(null)
  const [createdJobId, setCreatedJobId] = useState<string | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false)

  useEffect(() => {
    let isActive = true

    if (!paperId) {
      return () => {
        isActive = false
      }
    }

    loadPaper(paperId)
      .then((paper) => {
        if (isActive) {
          setViewState({ status: 'success', paper })
          void Promise.allSettled([
            loadExtraction(paperId),
            loadSuggestions(paperId),
          ]).then(([extractionResult, suggestionResult]) => {
            if (!isActive) return
            if (extractionResult.status === 'fulfilled') {
              setExtraction(extractionResult.value)
            }
            if (suggestionResult.status === 'fulfilled') {
              setSuggestions(suggestionResult.value)
            }
          })
        }
      })
      .catch((error: unknown) => {
        if (!isActive) return
        const message = error instanceof Error ? error.message : '论文详情加载失败。'
        setViewState({ status: 'error', message })
      })

    return () => {
      isActive = false
    }
  }, [loadExtraction, loadPaper, loadSuggestions, paperId])

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
  const overview = extraction?.researchOverview ?? paper.researchOverview
  const showDemoMetrics =
    paper.metricSource === 'mock'
    && paper.journal?.impactFactor != null
  const activeJobId = createdJobId ?? paper.latestJobId
  const evidenceById = new Map(
    [
      ...(extraction?.evidence ?? []),
      ...(suggestions?.evidence ?? []),
    ].map((item) => [item.id, item]),
  )
  const relationSuggestions = suggestions?.items.filter(
    (item) => item.operation === 'addRelation',
  ) ?? []

  async function startAnalysis(resultMode: 'preserve' | 'replace' = 'preserve') {
    if (!paperId) return
    setIsStartingAnalysis(true)
    setAnalysisMessage('')
    try {
      const job = await createPaperAnalysisJob(paperId, resultMode)
      setCreatedJobId(job.id)
      setAnalysisMessage('分析任务已创建，正在等待 Worker 处理。')
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : '无法创建分析任务。')
    } finally {
      setIsStartingAnalysis(false)
    }
  }

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
          <span>{paper.source.type === 'zotero' ? 'Zotero 已导入' : '手动/外部来源'}</span>
          {activeJobId && (
            <AnalysisProgressPanel
              jobId={activeJobId}
              loadJob={loadAnalysisJob}
            />
          )}
        </div>
        <div className="paper-detail-page__actions">
          {extraction ? (
            <>
              <button type="button" onClick={() => void startAnalysis('preserve')} disabled={isStartingAnalysis}>
                {isStartingAnalysis ? '正在创建任务…' : '保留旧结果再分析'}
              </button>
              <button
                className="paper-detail-page__replace-analysis"
                type="button"
                onClick={() => void startAnalysis('replace')}
                disabled={isStartingAnalysis}
                title="只有新分析成功后才删除该论文旧结果；失败时原结果保留"
              >
                用新结果替换
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void startAnalysis()} disabled={isStartingAnalysis}>
              {isStartingAnalysis ? '正在创建分析任务…' : '开始分析本文'}
            </button>
          )}
          <Link to="/analysis-jobs">查看分析任务</Link>
          {paper.source.url && (
            <a href={paper.source.url} target="_blank" rel="noreferrer">
              在 Zotero 中打开
            </a>
          )}
          {paper.source.type === 'zotero' && !paper.source.url && (
            <span className="paper-detail-page__muted">已从 Zotero 导入</span>
          )}
        </div>
        {analysisMessage && <p className="paper-detail-page__analysis-message" role="status">{analysisMessage}</p>}
      </header>

      <section className="paper-detail-section">
        <h2>摘要（导入原文）</h2>
        <p>{paper.abstract ?? '暂未提供摘要。'}</p>
      </section>

      <ResearchOverviewSection overview={overview} />

      <section className="paper-detail-section paper-analysis-report" aria-labelledby="analysis-report-title">
        <div className="paper-analysis-report__header">
          <div>
            <p>ANALYSIS REPORT</p>
            <h2 id="analysis-report-title">分析结果</h2>
            <span>从摘要判断线索，校验作者关键词，定位后覆盖全部非参考文献正文。</span>
          </div>
          {extraction && <strong className="paper-analysis-report__ready">分析已完成</strong>}
        </div>

        {extraction ? (
          <>
            <div className="analysis-stat-grid" aria-label="分析结果统计">
              <div><strong>{extraction.concepts.length}</strong><span>概念候选</span></div>
              <div><strong>{extraction.methods.length}</strong><span>方法候选</span></div>
              <div><strong>{extraction.findings.length}</strong><span>主要发现</span></div>
              <div><strong>{relationSuggestions.length}</strong><span>关系建议</span></div>
            </div>

            <ol className="analysis-pipeline" aria-label="分析路径">
              <li><span>1</span><div><strong>摘要预判</strong><p>先判断研究主题与概念线索</p></div><em>已完成</em></li>
              <li><span>2</span><div><strong>关键词核验</strong><p>作者关键词只有在正文复现并符合概念标准才进入候选</p></div><em>规则已启用</em></li>
              <li><span>3</span><div><strong>全文定位与扫描</strong><p>优先检查命中段落，再分批扫描所有剩余正文</p></div><em>无 14 块总量上限</em></li>
              <li><span>4</span><div><strong>关系二次判断</strong><p>同篇共现与跨文献线索只用于召回，由模型结合双方证据决定</p></div><em>需人工审核</em></li>
            </ol>

            <div className="analysis-result-columns">
              <section aria-labelledby="concept-result-title">
                <div className="analysis-result-columns__heading">
                  <h3 id="concept-result-title">概念候选</h3>
                  <span>{extraction.concepts.length} 个</span>
                </div>
                <div className="analysis-entity-list">
                  {extraction.concepts.map((item) => (
                    <EntityResultCard evidenceById={evidenceById} item={item} key={item.id} kind="概念" />
                  ))}
                </div>
              </section>
              <section aria-labelledby="method-result-title">
                <div className="analysis-result-columns__heading">
                  <h3 id="method-result-title">方法候选</h3>
                  <span>{extraction.methods.length} 个</span>
                </div>
                <div className="analysis-entity-list">
                  {extraction.methods.map((item) => (
                    <EntityResultCard evidenceById={evidenceById} item={item} key={item.id} kind="方法" />
                  ))}
                </div>
              </section>
            </div>

            <section className="analysis-relation-results" aria-labelledby="relation-result-title">
              <div className="analysis-result-columns__heading">
                <div>
                  <h3 id="relation-result-title">概念关系建议</h3>
                  <p>共现、术语相似和引用关系都不会直接写入图谱。</p>
                </div>
                <Link to="/review">进入建议审核 →</Link>
              </div>
              {relationSuggestions.length ? (
                <div className="analysis-relation-list">
                  {relationSuggestions.map((item) => (
                    <RelationResultCard evidenceById={evidenceById} key={item.id} suggestion={item} />
                  ))}
                </div>
              ) : (
                <p className="paper-detail-page__muted">当前论文尚无符合双边证据要求的关系建议。</p>
              )}
            </section>
          </>
        ) : (
          <p className="paper-detail-page__muted">尚无可展示的分析结果。</p>
        )}
      </section>

      <section className="paper-detail-section"><h2>主要发现</h2>{extraction?.findings.length ? extraction.findings.map((finding) => (
        <p key={finding.id}>• {finding.statement}（置信度 {percent(finding.confidence)}）</p>
      )) : <p className="paper-detail-page__muted">本轮分析未定位到有明确原文证据的主要发现。</p>}</section>
    </article>
  )
}
