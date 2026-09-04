import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../../contracts/api-client'
import type { SuggestionPage as SuggestionPageDto } from '../../contracts/v05.types'
import { extractionDtoMocks, suggestionPageDtoMock } from './suggestion.mock'
import { createMockSuggestionService, type SuggestionService } from './suggestion.service'
import SuggestionReviewPage from './SuggestionReviewPage'

function pageWithItems(ids: string[], counts = { pending: 2, accepted: 0, rejected: 0, superseded: 1 }): SuggestionPageDto {
  const items = suggestionPageDtoMock.items.filter((item) => ids.includes(item.id))
  const evidenceIds = new Set(items.flatMap((item) => item.evidenceIds))
  const paperIds = new Set(items.map((item) => item.paperId))
  return {
    ...structuredClone(suggestionPageDtoMock),
    items,
    total: items.length,
    evidence: suggestionPageDtoMock.evidence.filter((item) => evidenceIds.has(item.id)),
    papers: suggestionPageDtoMock.papers.filter((item) => paperIds.has(item.id)),
    statusCounts: counts,
  }
}

function renderPage(service: SuggestionService) {
  return render(<SuggestionReviewPage service={service} />)
}

async function expandPaper(user: ReturnType<typeof userEvent.setup>, title: string) {
  const paper = await screen.findByRole('article', { name: `论文：${title}` })
  await user.click(within(paper).getByRole('button', { name: `展开论文：${title}` }))
  return paper
}

describe('SuggestionReviewPage v05 behavior', () => {
  it('shows backend counts and skips batch accept items without defaults', async () => {
    const user = userEvent.setup()
    const page = pageWithItems(['suggestion-005', 'suggestion-006'], {
      pending: 9, accepted: 4, rejected: 3, superseded: 2,
    })
    const method = page.items.find((item) => item.id === 'suggestion-006')
    if (!method || method.proposedChange.type !== 'resolveMethodMatch') throw new Error('fixture missing')
    method.proposedChange.defaultCandidateId = null
    renderPage(createMockSuggestionService(page, extractionDtoMocks))

    expect(await screen.findByRole('tab', { name: '待审核 9' })).toBeVisible()
    expect(screen.getByRole('tab', { name: '已采纳 4' })).toBeVisible()
    expect(screen.queryByRole('tab', { name: /superseded/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: '批量采纳整篇论文' }))
    await user.click(screen.getByRole('button', { name: '确认采纳' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('1 条成功，1 条需要人工选择，0 条失败')
  })

  it('preserves the New selection and edited label after a stale candidate conflict', async () => {
    const user = userEvent.setup()
    const base = createMockSuggestionService(pageWithItems(['suggestion-001'], {
      pending: 1, accepted: 0, rejected: 0, superseded: 0,
    }), extractionDtoMocks)
    const acceptSuggestion = vi.fn().mockRejectedValue(new ApiClientError(409, {
      code: 'RESOLUTION_CANDIDATE_STALE',
      message: '候选已经变化',
      retryable: false,
      details: { nodeId: 'concept-replacement' },
      requestId: 'request-stale',
    }))
    const service: SuggestionService = { ...base, acceptSuggestion }
    renderPage(service)
    const paper = await expandPaper(user, '反转学习中的认知灵活性与前额叶活动')
    const card = within(paper).getByRole('article', { name: '建议：新增概念：反转学习' })

    await user.click(within(card).getByRole('button', { name: /翻转课堂.*推荐分数 86%/ }))
    await user.click(within(card).getByRole('button', { name: /反转学习.*推荐分数 72%/ }))
    const input = within(card).getByRole('textbox', { name: '新节点规范名称：反转学习' })
    await user.clear(input)
    await user.type(input, '修订名称')
    await user.click(within(card).getByRole('button', { name: '确认' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('候选已变化')
    expect(screen.getByDisplayValue('修订名称')).toBeVisible()
    expect(acceptSuggestion).toHaveBeenCalledWith('suggestion-001', {
      selectedIds: ['concept-new-inverted-learning'],
      labelOverrides: { 'concept-new-inverted-learning': '修订名称' },
      comment: null,
    })
  })

  it('allows an empty rejection reason', async () => {
    const user = userEvent.setup()
    renderPage(createMockSuggestionService(pageWithItems(['suggestion-001'], {
      pending: 1, accepted: 0, rejected: 0, superseded: 0,
    }), extractionDtoMocks))
    const paper = await expandPaper(user, '反转学习中的认知灵活性与前额叶活动')
    const card = within(paper).getByRole('article', { name: '建议：新增概念：反转学习' })

    await user.click(within(card).getByRole('button', { name: '拒绝' }))
    const dialog = screen.getByRole('dialog', { name: '拒绝此条识别结果' })
    expect(within(dialog).getByRole('button', { name: '确认拒绝' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: '确认拒绝' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('审核成功')
  })

  it('displays a missing recommendation score without treating it as accuracy', async () => {
    const user = userEvent.setup()
    const extractions = structuredClone(extractionDtoMocks)
    extractions['paper-001'].concepts[0].candidates[0].recommendationScore = null
    renderPage(createMockSuggestionService(pageWithItems(['suggestion-001'], {
      pending: 1, accepted: 0, rejected: 0, superseded: 0,
    }), extractions))

    const paper = await expandPaper(user, '反转学习中的认知灵活性与前额叶活动')
    expect(within(paper).getByRole('button', { name: /翻转课堂.*推荐分数未提供/ })).toBeVisible()
    expect(within(paper).queryByText(/正确率/)).toBeNull()
  })

  it('renders accepted resolve history from executionResult without old candidates', async () => {
    const user = userEvent.setup()
    const page = pageWithItems(['suggestion-001'], {
      pending: 0, accepted: 1, rejected: 0, superseded: 0,
    })
    page.items[0] = {
      ...page.items[0],
      status: 'accepted',
      executionResult: {
        type: 'resolveMatch',
        resolvedTargets: [{ candidateId: 'historical-candidate', nodeId: 'concept-final', label: '最终概念', created: true, relationId: 'relation-final' }],
      },
      reviewedAt: '2026-08-29T10:00:00Z',
    }
    renderPage(createMockSuggestionService(page, extractionDtoMocks))

    await user.click(await screen.findByRole('tab', { name: '已采纳 1' }))
    const paper = await expandPaper(user, '反转学习中的认知灵活性与前额叶活动')
    expect(within(paper).getByText('最终概念 · 创建新节点')).toBeVisible()
    expect(within(paper).queryByRole('button', { name: /翻转课堂/ })).toBeNull()
  })

  it('keeps successful batch items applied when another item fails', async () => {
    const user = userEvent.setup()
    const page = pageWithItems(['suggestion-005', 'suggestion-006'])
    const base = createMockSuggestionService(page, extractionDtoMocks)
    const service: SuggestionService = {
      ...base,
      async reviewSuggestions(input) {
        const updated = await base.acceptSuggestion('suggestion-005')
        return {
          updated: [updated],
          skipped: [],
          failures: [{
            id: input.ids.find((id) => id !== 'suggestion-005') ?? 'suggestion-006',
            error: new ApiClientError(500, {
              code: 'SUGGESTION_REVIEW_FAILED', message: '临时失败', retryable: true, details: null, requestId: 'request-failed',
            }),
          }],
        }
      },
    }
    renderPage(service)

    await user.click(await screen.findByRole('button', { name: '批量采纳整篇论文' }))
    await user.click(screen.getByRole('button', { name: '确认采纳' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('1 条成功，0 条需要人工选择，1 条失败')
    expect(screen.getByText('1 条建议')).toBeVisible()
  })
})
