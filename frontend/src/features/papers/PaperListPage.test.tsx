import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { PaperPage } from './paper.types'
import PaperListPage from './PaperListPage'

const onePaperPage: PaperPage = {
  items: [
    {
      id: 'paper-test',
      title: '用于测试的论文',
      authors: [
        { id: 'author-test-a', name: '测试作者甲', rawName: 'Test A', order: 1 },
        { id: 'author-test-b', name: '测试作者乙', rawName: 'Test B', order: 2 },
      ],
      year: 2026,
      doi: null,
      journal: {
        name: '测试期刊',
        issn: null,
        impactFactor: 4.2,
        impactFactorYear: 2024,
        categories: [{ category: 'Neurosciences', quartile: 'Q2' }],
      },
      metricSource: 'mock',
      status: 'pendingReview',
      latestJobId: 'job-test',
      pendingSuggestionCount: 3,
      createdAt: '2026-08-29T08:00:00Z',
      updatedAt: '2026-08-29T08:00:00Z',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
}

describe('PaperListPage', () => {
  it('请求未完成时显示加载状态', () => {
    const neverResolves = () => new Promise<PaperPage>(() => undefined)

    render(
      <MemoryRouter>
        <PaperListPage loadPapers={neverResolves} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在加载论文')
  })

  it('加载成功后显示论文及待审核数量', async () => {
    render(
      <MemoryRouter>
        <PaperListPage loadPapers={async () => onePaperPage} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '用于测试的论文' }),
    ).toBeInTheDocument()
    expect(screen.getByText('3 条待审核')).toBeInTheDocument()
    expect(screen.getByText('测试作者甲、测试作者乙')).toBeInTheDocument()
    expect(screen.getByText('测试期刊')).toBeInTheDocument()
    expect(screen.getByText('JIF 4.2（2024）')).toBeInTheDocument()
    expect(screen.getByText('JIF/JCR 演示数据')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '查看论文详情：用于测试的论文' }),
    ).toHaveAttribute('href', '/papers/paper-test')
  })

  it('没有论文时显示空态提示', async () => {
    render(
      <MemoryRouter>
        <PaperListPage
          loadPapers={async () => ({ ...onePaperPage, items: [], total: 0 })}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('还没有论文')).toBeInTheDocument()
  })

  it('正式数据指标不可用时不显示 JIF/JCR', async () => {
    const unavailablePage: PaperPage = {
      ...onePaperPage,
      items: [{
        ...onePaperPage.items[0],
        journal: {
          ...onePaperPage.items[0].journal!,
          impactFactor: null,
          impactFactorYear: null,
          categories: [],
        },
        metricSource: 'unavailable',
      }],
    }

    render(
      <MemoryRouter>
        <PaperListPage loadPapers={async () => unavailablePage} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: '用于测试的论文' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/JIF/)).not.toBeInTheDocument()
    expect(screen.queryByText(/JCR/)).not.toBeInTheDocument()
  })

  it('加载失败时显示错误信息', async () => {
    render(
      <MemoryRouter>
        <PaperListPage
          loadPapers={async () => {
            throw new Error('测试中的网络错误')
          }}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('测试中的网络错误')
  })
})
