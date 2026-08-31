import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppShell from '../../components/AppShell'
import { DisplayPreferencesProvider } from '../../styles/display-preferences'
import { paperListMock } from '../papers/paper.mock'
import {
  createMockSuggestionService,
  SuggestionApiError,
  type SuggestionService,
} from './suggestion.service'
import { suggestionMocks } from './suggestion.mock'
import SuggestionReviewPage from './SuggestionReviewPage'

const loadPapers = async () => paperListMock

function renderPage(service: SuggestionService = createMockSuggestionService()) {
  return render(
    <SuggestionReviewPage
      service={service}
      loadPapers={loadPapers}
    />,
  )
}

describe('SuggestionReviewPage workspace structure', () => {
  it('主题切换后仍保留待审核标签与确认操作的可访问语义', async () => {
    const user = userEvent.setup()

    render(
      <DisplayPreferencesProvider
        initialPreferences={{ themeId: 'softResearch', fontScalePercent: 100 }}
      >
        <MemoryRouter initialEntries={['/review']}>
          <AppShell>
            <SuggestionReviewPage
              loadPapers={loadPapers}
              service={createMockSuggestionService()}
            />
          </AppShell>
        </MemoryRouter>
      </DisplayPreferencesProvider>,
    )

    const pendingTab = await screen.findByRole('tab', { name: '待审核 4' })
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(
      '#5B68D6',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '界面主题' }),
      'coolMinimal',
    )

    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(
      '#5277A8',
    )
    expect(pendingTab).toHaveAttribute('aria-selected', 'true')
    const firstPaper = screen.getByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(
      within(firstPaper).getByRole('button', {
        name: '展开论文：反转学习中的认知灵活性与前额叶活动',
      }),
    )
    const firstSuggestion = within(firstPaper).getByRole('article', {
      name: '建议：新增概念：反转学习',
    })
    expect(within(firstSuggestion).getByRole('button', { name: '确认' })).toBeEnabled()
  })

  it('defaults to pending and groups each paper into four ordered categories', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(
      await screen.findByRole('heading', { name: '建议审核' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '待审核 4' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: '已采纳 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '拒绝意见 1' })).toBeInTheDocument()

    const firstPaper = screen.getByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(
      within(firstPaper).getByRole('button', {
        name: '展开论文：反转学习中的认知灵活性与前额叶活动',
      }),
    )

    expect(
      within(firstPaper).getAllByRole('heading', { level: 3 }).map((heading) =>
        heading.textContent?.replace(/\s+\d+$/, ''),
      ),
    ).toEqual(['概念新增', '方法新增', '发现新增', '关系新增'])
    expect(within(firstPaper).getAllByText('暂无建议')).toHaveLength(2)
    const batchAccept = within(firstPaper).getByRole('button', {
      name: '批量采纳整篇论文',
    })
    const batchReject = within(firstPaper).getByRole('button', {
      name: '批量拒绝整篇论文',
    })
    expect(batchAccept).toHaveTextContent('√')
    expect(batchAccept).toHaveAttribute('title', '批量采纳整篇论文')
    expect(batchReject).toHaveTextContent('×')
    expect(batchReject).toHaveAttribute('title', '批量拒绝整篇论文')
    expect(
      within(firstPaper).queryByRole('button', { name: '批量采纳概念新增' }),
    ).toBeNull()
    expect(
      within(firstPaper).queryByRole('button', { name: '批量拒绝方法新增' }),
    ).toBeNull()
  })

  it('allows more than one paper to stay expanded', async () => {
    const user = userEvent.setup()
    renderPage()
    const firstPaper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    const secondPaper = screen.getByRole('article', {
      name: '论文：适应性决策的脑电标记',
    })

    await user.click(within(firstPaper).getByRole('button', { name: /展开论文/ }))
    await user.click(within(secondPaper).getByRole('button', { name: /展开论文/ }))

    expect(within(firstPaper).getByText('原文识别结果：反转学习')).toBeVisible()
    expect(within(secondPaper).getByText('新增发现：学习成绩提升')).toBeVisible()
    expect(
      within(firstPaper).getByRole('button', { name: /收起论文/ }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(secondPaper).getByRole('button', { name: /收起论文/ }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows accepted and rejected history as read-only grouped pages', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('tab', { name: '已采纳 1' })

    await user.click(screen.getByRole('tab', { name: '已采纳 1' }))
    const acceptedPaper = screen.getByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(acceptedPaper).getByRole('button', { name: /展开论文/ }))
    expect(
      within(acceptedPaper).getByText('新增发现：规则切换后反应变慢'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采纳建议' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: '拒绝意见 1' }))
    const rejectedPaper = screen.getByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    expect(
      within(rejectedPaper).getByText('证据不足，相关结果未通过多重比较校正'),
    ).toBeInTheDocument()
    expect(within(rejectedPaper).getByText(/审核时间/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝建议' })).toBeNull()
  })
})

describe('SuggestionReviewPage single review', () => {
  it('shows compact entity candidates and defaults to the highest confidence option', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))
    const card = within(paper).getByRole('article', {
      name: '建议：新增概念：反转学习',
    })

    expect(within(card).getByText('原文识别结果：反转学习')).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: '翻转课堂 86%' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(card).getByRole('button', { name: '混合学习 63%' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(within(card).getByRole('button', { name: '确认' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: '拒绝' })).toBeEnabled()
  })

  it('submits one to three selected candidates and refuses a fourth option', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))
    const card = within(paper).getByRole('article', {
      name: '建议：新增概念：反转学习',
    })

    await user.click(within(card).getByRole('button', { name: '混合学习 63%' }))
    await user.click(within(card).getByRole('button', { name: '反转学习 72%' }))
    await user.click(within(card).getByRole('button', { name: '课堂教学 41%' }))

    expect(within(card).getByRole('button', { name: '课堂教学 41%' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(card).getByRole('button', { name: '确认' }))

    await user.click(screen.getByRole('tab', { name: '已采纳 2' }))
    expect(screen.getByText('翻转课堂 · 连接已有')).toBeInTheDocument()
    expect(screen.getByText('混合学习 · 连接已有')).toBeInTheDocument()
    expect(screen.getByText('反转学习 · 创建新节点')).toBeInTheDocument()
  })

  it('opens a rejection dialog from the red action and keeps an optional reason', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))
    const card = within(paper).getByRole('article', {
      name: '建议：新增概念：反转学习',
    })

    await user.click(within(card).getByRole('button', { name: '拒绝' }))
    const dialog = screen.getByRole('dialog', { name: '拒绝此条识别结果' })
    await user.type(
      within(dialog).getByRole('textbox', { name: '拒绝原因（选填）' }),
      '候选均不准确',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认拒绝' }))

    await user.click(screen.getByRole('tab', { name: '拒绝意见 2' }))
    expect(screen.getByText('候选均不准确')).toBeInTheDocument()
  })

  it('redirects a renamed new candidate to an existing node instead of creating a duplicate', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))
    const card = within(paper).getByRole('article', {
      name: '建议：新增概念：反转学习',
    })

    await user.click(within(card).getByRole('button', { name: '翻转课堂 86%' }))
    await user.click(within(card).getByRole('button', { name: '反转学习 72%' }))
    const nameInput = within(card).getByRole('textbox', {
      name: '新节点规范名称：反转学习',
    })
    await user.clear(nameInput)
    await user.type(nameInput, '翻转课堂')

    expect(within(card).getByRole('button', { name: '翻转课堂 86%' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).getByRole('button', { name: '反转学习 72%' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(card).getByRole('status')).toHaveTextContent('已改为连接已有节点：翻转课堂')
  })

  it('moves an accepted suggestion out of pending and into accepted', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))
    const card = within(paper).getByRole('article', {
      name: '建议：新增概念：反转学习',
    })

    await user.click(within(card).getByRole('button', { name: '确认' }))

    expect(
      within(paper).queryByText('原文识别结果：反转学习'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '待审核 3' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '已采纳 2' }))
    expect(screen.getByText('原文识别结果：反转学习')).toBeInTheDocument()
  })

  it('moves a rejected suggestion and preserves its review comment', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：反转学习中的认知灵活性与前额叶活动',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))
    const card = within(paper).getByRole('article', {
      name: '建议：新增方法：行为任务',
    })

    await user.click(within(card).getByRole('button', { name: '拒绝' }))
    const dialog = screen.getByRole('dialog', { name: '拒绝此条识别结果' })
    await user.type(
      within(dialog).getByRole('textbox', { name: '拒绝原因（选填）' }),
      '样本信息不足',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认拒绝' }))

    await user.click(screen.getByRole('tab', { name: '拒绝意见 2' }))
    expect(screen.getByText('原文识别结果：行为任务')).toBeInTheDocument()
    expect(screen.getByText('样本信息不足')).toBeInTheDocument()
    expect(screen.queryByText('行为任务 · 连接已有')).toBeNull()
    expect(screen.getAllByText(/审核时间/).length).toBeGreaterThan(0)
  })
})

describe('SuggestionReviewPage batch review', () => {
  it('skips entity cards whose best candidate is below the default threshold', async () => {
    const user = userEvent.setup()
    const lowConfidenceSuggestions = suggestionMocks.map((suggestion) =>
      suggestion.id === 'suggestion-006'
        ? {
            ...suggestion,
            candidates: suggestion.candidates?.map((candidate) => ({
              ...candidate,
              confidence: 0.69,
            })),
          }
        : suggestion,
    )
    renderPage(createMockSuggestionService(lowConfidenceSuggestions))
    const paper = await screen.findByRole('article', {
      name: '论文：适应性决策的脑电标记',
    })

    await user.click(
      within(paper).getByRole('button', { name: '批量采纳整篇论文' }),
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('将采纳 1 条建议')
    expect(dialog).toHaveTextContent('跳过 1 条')
  })

  it('rejects all pending suggestions in one paper with a shared comment', async () => {
    const user = userEvent.setup()
    renderPage()
    const paper = await screen.findByRole('article', {
      name: '论文：适应性决策的脑电标记',
    })
    await user.click(within(paper).getByRole('button', { name: /展开论文/ }))

    await user.click(
      within(paper).getByRole('button', { name: '批量拒绝整篇论文' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('将拒绝 2 条建议')
    expect(
      within(dialog).getByRole('button', { name: '确认拒绝' }),
    ).toBeDisabled()
    await user.type(
      within(dialog).getByRole('textbox', { name: '统一拒绝原因' }),
      '需要补充统计检验',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认拒绝' }))

    expect(
      screen.queryByRole('article', { name: '论文：适应性决策的脑电标记' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '拒绝意见 3' }))
    const rejectedPaper = screen.getByRole('article', {
      name: '论文：适应性决策的脑电标记',
    })
    expect(within(rejectedPaper).getAllByText('需要补充统计检验')).toHaveLength(2)
  })

  it('keeps failed items pending when a batch only partially succeeds', async () => {
    const user = userEvent.setup()
    const baseService = createMockSuggestionService()
    const partialService: SuggestionService = {
      ...baseService,
      async reviewSuggestions(input) {
        const updated = await baseService.acceptSuggestion(input.ids[0])
        return {
          updated: [updated],
          failures: [
            {
              id: input.ids[1],
              error: new SuggestionApiError(
                500,
                'SUGGESTION_REVIEW_FAILED',
                '临时审核失败',
              ),
            },
          ],
        }
      },
    }
    renderPage(partialService)
    const paper = await screen.findByRole('article', {
      name: '论文：适应性决策的脑电标记',
    })

    await user.click(
      within(paper).getByRole('button', { name: '批量采纳整篇论文' }),
    )
    await user.click(screen.getByRole('button', { name: '确认采纳' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '成功 1 条，失败 1 条。失败项仍保留在待审核列表。',
    )
    expect(within(paper).getByText('1 条建议')).toBeInTheDocument()
  })

  it('reloads all states when another reviewer causes a 409 conflict', async () => {
    const user = userEvent.setup()
    const baseService = createMockSuggestionService()
    const conflictService: SuggestionService = {
      ...baseService,
      async reviewSuggestions(input) {
        const updated = await baseService.acceptSuggestion(input.ids[0])
        await baseService.acceptSuggestion(input.ids[1])
        return {
          updated: [updated],
          failures: [
            {
              id: input.ids[1],
              error: new SuggestionApiError(
                409,
                'SUGGESTION_ALREADY_REVIEWED',
                '该建议已经完成审核',
              ),
            },
          ],
        }
      },
    }
    renderPage(conflictService)
    const paper = await screen.findByRole('article', {
      name: '论文：适应性决策的脑电标记',
    })

    await user.click(
      within(paper).getByRole('button', { name: '批量采纳整篇论文' }),
    )
    await user.click(screen.getByRole('button', { name: '确认采纳' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '部分建议已被其他人审核，已刷新最新状态。',
    )
    expect(
      screen.queryByRole('article', { name: '论文：适应性决策的脑电标记' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '已采纳 3' })).toBeInTheDocument()
  })
})
