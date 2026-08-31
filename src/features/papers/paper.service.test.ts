import { describe, expect, it } from 'vitest'
import { getPaperDetail, getPapers } from './paper.service'

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
    })
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
