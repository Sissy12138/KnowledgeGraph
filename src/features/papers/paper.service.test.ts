import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageResult, PaperSummary as PaperSummaryDto } from '../../contracts/v05.types'
import { getAuthorDetail, getPaperDetail, getPapers } from './paper.service'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getPapers', () => {
  it('返回可供论文列表展示的分页数据', async () => {
    const result = await getPapers('success')

    expect(result.total).toBe(5)
    expect(result.items).toHaveLength(5)
    expect(result.items[0]).toMatchObject({
      id: 'paper-001',
      title: '反转学习中的认知灵活性与前额叶活动',
      status: 'pendingReview',
      pendingSuggestionCount: 2,
      metricSource: 'mock',
    })
    expect(result.items[0].authors[0].id).toBe('author-li-ming')
    expect(result.items[0].journal?.impactFactor).toBe(25)
  })

  it('空态返回有效的空分页，而不是 null', async () => {
    const result = await getPapers('empty')

    expect(result).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    })
  })

  it('失败场景抛出可以直接展示的信息', async () => {
    await expect(getPapers('error')).rejects.toThrow('论文列表加载失败，请稍后重试。')
  })

  it('api 模式请求 v05 论文分页并隐藏不可用指标', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const response: PageResult<PaperSummaryDto> = {
      items: [{
        id: 'paper-api',
        title: 'API paper',
        authors: [],
        year: 2026,
        doi: null,
        journal: { name: 'API Journal', issn: null, metrics: null },
        status: 'completed',
        latestJobId: null,
        pendingSuggestionCount: 0,
        createdAt: '2026-08-20T08:00:00Z',
        updatedAt: '2026-08-26T09:10:00Z',
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const result = await getPapers()

    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/papers?page=1&pageSize=20&sortBy=year&sortOrder=desc',
      undefined,
    )
    expect(result.items[0].journal?.impactFactor).toBeNull()
    expect(result.items[0].metricSource).toBe('unavailable')
  })
})

describe('getPaperDetail', () => {
  it('根据 paperId 返回对应的论文详情', async () => {
    const result = await getPaperDetail('paper-001')

    expect(result).toMatchObject({
      id: 'paper-001',
      title: '反转学习中的认知灵活性与前额叶活动',
      latestExtractionId: 'extraction-001',
      researchOverview: {
        researchTopics: ['反转学习', '认知灵活性', '脑电'],
      },
    })
  })

  it('paperId 不存在时返回明确错误', async () => {
    await expect(getPaperDetail('paper-missing')).rejects.toThrow('论文不存在。')
  })
})

describe('getAuthorDetail', () => {
  it('按稳定 authorId 返回 ORCID 来源与认证状态', async () => {
    const result = await getAuthorDetail('author-li-ming')

    expect(result.id).toBe('author-li-ming')
    expect(result.orcid).toEqual({
      value: '0000-0002-1825-0097',
      source: 'crossref',
      authenticated: false,
    })
  })

  it('authorId 不存在时返回明确错误', async () => {
    await expect(getAuthorDetail('author-missing')).rejects.toThrow('作者不存在。')
  })
})
