import { requestJson } from '../../contracts/api-client'
import { getDataMode } from '../../contracts/data-mode'
import type {
  AuthorDetail as AuthorDetailDto,
  PageResult,
  PaperDetail as PaperDetailDto,
  PaperSummary as PaperSummaryDto,
} from '../../contracts/v05.types'
import {
  toAuthorDetailView,
  toPaperDetailView,
  toPaperPageView,
} from './paper.adapter'
import { authorDetailMocks, paperDetailMocks } from './paper-detail.mock'
import { getPaperPageMock } from './paper.mock'
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
