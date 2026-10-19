import { requestJson } from '../../contracts/api-client'
import { getDataMode } from '../../contracts/data-mode'
import type {
  AuthorDetail as AuthorDetailDto,
  PageResult,
  PaperDetail as PaperDetailDto,
  PaperSummary as PaperSummaryDto,
} from '../../contracts/v05.types'
import type { Extraction, SuggestionPage } from '../../contracts/v05.types'
import type { AnalysisJob } from '../analysis/analysis-job.types'
import {
  toAuthorDetailView,
  toPaperDetailView,
  toPaperPageView,
} from './paper.adapter'
import { authorDetailMocks, paperDetailMocks } from './paper-detail.mock'
import { getPaperPageMock } from './paper.mock'
import {
  extractionDtoMocks,
  suggestionPageDtoMock,
} from '../suggestions/suggestion.mock'
import type {
  AuthorDetailView,
  PaperDetail,
  PaperListScenario,
  PaperMetricSource,
  PaperPage,
} from './paper.types'

function metricSourceForMode(
  mode: ReturnType<typeof getDataMode>,
): PaperMetricSource {
  return mode === 'mock' ? 'mock' : 'unavailable'
}

/** 获取论文分页，并统一经 v05 DTO 适配器生成页面 ViewModel。 */
export async function getPapers(
  scenario: PaperListScenario = 'success',
): Promise<PaperPage> {
  const mode = getDataMode()
  const dto = mode === 'api'
    ? await requestJson<PageResult<PaperSummaryDto>>(
        '/api/v1/papers?page=1&pageSize=20&sortBy=year&sortOrder=desc',
      )
    : getPaperPageMock(scenario)

  return toPaperPageView(structuredClone(dto), metricSourceForMode(mode))
}

/** 根据稳定 paperId 获取详情，并统一适配为页面 ViewModel。 */
export async function getPaperDetail(paperId: string): Promise<PaperDetail> {
  const mode = getDataMode()
  const dto = mode === 'api'
    ? await requestJson<PaperDetailDto>(
        `/api/v1/papers/${encodeURIComponent(paperId)}`,
      )
    : paperDetailMocks.find((item) => item.id === paperId)

  if (!dto) {
    throw new Error('论文不存在。')
  }

  return toPaperDetailView(structuredClone(dto), metricSourceForMode(mode))
}

/** 获取作者详情，供后续图谱详情缓存注入使用。 */
export async function getAuthorDetail(
  authorId: string,
): Promise<AuthorDetailView> {
  const mode = getDataMode()
  const dto = mode === 'api'
    ? await requestJson<AuthorDetailDto>(
        `/api/v1/authors/${encodeURIComponent(authorId)}`,
      )
    : authorDetailMocks.find((item) => item.id === authorId)

  if (!dto) {
    throw new Error('作者不存在。')
  }

  return toAuthorDetailView(structuredClone(dto))
}

export async function getLatestExtraction(paperId: string): Promise<Extraction> {
  if (getDataMode() === 'mock') {
    const extraction = extractionDtoMocks[paperId]
    if (!extraction) throw new Error('论文尚无分析结果。')
    return structuredClone(extraction)
  }
  return requestJson<Extraction>(`/api/v1/papers/${encodeURIComponent(paperId)}/extractions/latest`)
}

export async function getPaperSuggestions(paperId: string): Promise<SuggestionPage> {
  if (getDataMode() === 'mock') {
    const items = suggestionPageDtoMock.items.filter(
      (item) => item.paperId === paperId && item.status === 'pending',
    )
    const evidenceIds = new Set(items.flatMap((item) => item.evidenceIds))
    return {
      ...structuredClone(suggestionPageDtoMock),
      items: structuredClone(items),
      evidence: suggestionPageDtoMock.evidence
        .filter((item) => evidenceIds.has(item.id))
        .map((item) => ({ ...item })),
      papers: suggestionPageDtoMock.papers
        .filter((item) => item.id === paperId)
        .map((item) => ({ ...item })),
      total: items.length,
      statusCounts: {
        pending: items.length,
        accepted: 0,
        rejected: 0,
        superseded: 0,
      },
    }
  }
  return requestJson<SuggestionPage>(`/api/v1/suggestions?page=1&pageSize=50&paperId=${encodeURIComponent(paperId)}&status=pending`)
}

export async function createPaperAnalysisJob(
  paperId: string,
  resultMode: 'preserve' | 'replace' = 'preserve',
): Promise<AnalysisJob> {
  if (getDataMode() !== 'api') throw new Error('演示模式不支持提交真实分析任务。')
  return requestJson<AnalysisJob>(`/api/v1/papers/${encodeURIComponent(paperId)}/analysis-jobs`, {
    method: 'POST',
    body: JSON.stringify({ resultMode }),
  })
}

export type NewPaperAnalysisBatch = {
  createdCount: number
  jobs: AnalysisJob[]
}

/** 一次仅为仍处于“未解析”状态的新导入论文创建分析任务。 */
export async function createNewPaperAnalysisJobs(): Promise<NewPaperAnalysisBatch> {
  if (getDataMode() !== 'api') throw new Error('演示模式不支持提交真实分析任务。')
  return requestJson<NewPaperAnalysisBatch>('/api/v1/analysis-jobs/analyze-new', {
    method: 'POST',
    body: '{}',
  })
}
